#!/usr/bin/env node
/**
 * 批注高亮的**点击**交互契约（Task 0008 · P3.8）。
 *
 * 用户 2026-11-05 裁决的两条（缺一条都算缺陷）：
 *  1. 历史标注的高亮**常驻**——不靠鼠标靠近；
 *  2. **单击高亮的文字** → 出现对应的批注框；点非高亮文字不出；
 *     **hover 不弹卡**（这条是上一轮删掉的，此处一起锁住，防回归）。
 *
 * 为什么必须用真实浏览器：命中的是 `Range.getClientRects()` 的几何，
 * jsdom 里没有布局，测不出"点到哪一段文字"。
 *
 * 测试**自己造夹具、跑完还原**（T13）：早先这些测试直接清掉验收会话里的批注，
 * 跑完页面上就什么都没有了，害得用户以为功能没做。
 */
import pw from "/Users/xulater/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js";

const ENTRY = process.env.APP_URL ?? "http://127.0.0.1:5199";
const AGENT = process.env.AGENT ?? "lifeosagent";
const PROJECT = "workspace";
const API = process.env.API_URL ?? "http://127.0.0.1:43125";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
};

const annosUrl = (sid) => `${API}/api/agents/${AGENT}/sessions/${sid}/annotations`;
const listAnnos = async (sid) => (await (await fetch(annosUrl(sid))).json()).annotations ?? [];
const post = (sid, body) => fetch(annosUrl(sid), {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const restore = async (sid, snapshot) => {
  for (const a of await listAnnos(sid)) await post(sid, { op: "remove", annotation: { id: a.id } });
  for (const a of snapshot) await post(sid, { op: "add", annotation: a });
};

/** 找一个"有 assistant 文本块"的会话（优先已经有批注的）。 */
async function pickSession() {
  const items = (await (await fetch(`${API}/api/agents/${AGENT}/projects/${PROJECT}/sessions`)).json()).items ?? [];
  for (const s of items) {
    const annos = await listAnnos(s.sessionId);
    if (annos.length > 0) return { sid: s.sessionId, messageId: annos[0].messageId };
  }
  return undefined;
}

const target = await pickSession();
if (target === undefined) {
  console.log("✖ 没有找到带批注的会话（先造数据）");
  process.exit(1);
}
const { sid, messageId } = target;
const snapshot = await listAnnos(sid);

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const url = `${ENTRY}/?agent=${AGENT}&project=${PROJECT}&session=${sid}`;

try {
  // —— 夹具：两条批注挂在同一个文本块上（一条批评、一条待办）——
  await restore(sid, []);
  await post(sid, { op: "add", annotation: {
    id: "ck1", author: { kind: "user", id: "u" }, messageId, blockIndex: 0,
    start: 0, end: 4, quote: "点击", marks: ["critic"], note: "点开我",
  } });
  await post(sid, { op: "add", annotation: {
    id: "ck2", author: { kind: "user", id: "u" }, messageId, blockIndex: 0,
    start: 0, end: 2, quote: "点击", marks: ["todo"], note: "重叠的一条",
  } });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  /** 取被批注文字（块内 0..4 偏移）的中心坐标。 */
  const anchorPoint = () => page.evaluate((mid) => {
    const host = document.querySelector(`[data-message-id="${mid}"] [data-testid="message-text"]`);
    if (host === null) return null;
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      if (text.trim().length < 4) continue;
      const range = document.createRange();
      const at = Math.max(0, text.indexOf(text.trim()[0]));
      range.setStart(node, at);
      range.setEnd(node, Math.min(text.length, at + 4));
      const box = range.getBoundingClientRect();
      if (box.width < 4) continue;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    return null;
  }, messageId);

  const point = await anchorPoint();
  if (point === null) {
    check("能定位到被批注的文字", false, "块里找不到锚点");
  } else {
    // 1) 高亮常驻：不碰鼠标就应该在
    const hl = await page.evaluate(() => [...CSS.highlights.keys()]);
    check("高亮常驻（未悬停也在）", hl.length > 0, JSON.stringify(hl));

    // 2) hover 不弹卡（回归：2026-11-05 已删的旧行为）
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(500);
    check("悬停高亮文字不弹卡",
      (await page.locator('[data-testid="annotation-card"]').count()) === 0);

    // 3) 点到非高亮处不出卡
    const blank = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="message-text"]');
      const box = host?.getBoundingClientRect();
      return box === undefined ? null : { x: box.x + 4, y: box.bottom - 6 };
    });
    if (blank !== null) {
      await page.mouse.click(blank.x, blank.y);
      await page.waitForTimeout(400);
    }
    check("点非高亮文字不出卡",
      (await page.locator('[data-testid="annotation-card"]').count()) === 0);

    // 4) 单击高亮文字 → 出卡（同一处有两条重叠批注 → 都展开）
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(600);
    const opened = await page.evaluate(() => [...document.querySelectorAll('[data-testid="annotation-card"]')]
      .map((c) => c.dataset.anno ?? ""));
    check("单击高亮文字 → 出批注框", opened.length >= 1, JSON.stringify(opened));
    check("重叠的两条都展开", opened.includes("ck1") && opened.includes("ck2"), JSON.stringify(opened));

    // 5) 移开鼠标仍在（点击打开 = 钉住常显，不靠 hover 维持）
    await page.mouse.move(10, 10);
    await page.waitForTimeout(800);
    check("移开鼠标后框仍在",
      (await page.locator('[data-testid="annotation-card"]').count()) >= 1);

    // 6) 再点一次同一处 → 收起
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(500);
    check("再点同一处 → 收起",
      (await page.locator('[data-testid="annotation-card"]').count()) === 0);
  }
} finally {
  await restore(sid, snapshot);   // 不把验收夹具弄丢
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `\n批注点击契约通过（${results.length} 项）` : `\n批注点击契约失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
