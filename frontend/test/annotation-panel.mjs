#!/usr/bin/env node
/**
 * 批注面板契约（Task 0003 · 2026-11-04）。
 *
 * 为什么单独建这个文件：面板此前**零测试覆盖**——
 * 删除、整行点击、折叠、清空全部都只在浏览器里手点过，没有可重复的断言。
 * 用户 2026-11-03 追问"删除啥的功能都测试了吗"，答案是没有，这里补上。
 *
 * 每条都用真实后端（边标边存），并**刷新页面**验证是否真的落盘——
 * 只看 DOM 变化不算数（P5 就有一次"删了但没存"的 bug）。
 */
import pw from "/Users/xulater/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js";

const ENTRY = process.env.APP_URL ?? "http://127.0.0.1:5175";
const AGENT = "lifeosagent";
const PROJECT = "workspace";
const SESSION = "01a1a3eb-9979-717b-863a-e26331dc14f9";
const API = process.env.API_URL ?? "http://127.0.0.1:43132";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
};

/** 直接调后端接口：断言"服务端真的是这么存的"，不只信 DOM。 */
const api = {
  async list() {
    const r = await fetch(`${API}/api/agents/${AGENT}/sessions/${SESSION}/annotations`);
    return (await r.json()).annotations ?? [];
  },
  async add(anno) {
    await fetch(`${API}/api/agents/${AGENT}/sessions/${SESSION}/annotations`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "add", annotation: anno }),
    });
  },
  async remove(id) {
    await fetch(`${API}/api/agents/${AGENT}/sessions/${SESSION}/annotations`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "remove", annotation: { id } }),
    });
  },
};

const url = `${ENTRY}/?agent=${AGENT}&project=${PROJECT}&session=${SESSION}`;
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
const open = async () => {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
};
const rowIds = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="annotation-row"]')].map((r) => r.dataset.anno));

// —— 准备固定数据（每次都造，避免受上一次运行影响）——
for (const a of await api.list()) await api.remove(a.id);
await api.add({ id: "t1", author: { kind: "user", id: "u" }, messageId: "seed-asis-0001",
  blockIndex: 0, start: 6, end: 11, quote: "加粗的重点", marks: ["critic"], note: "第一句话" });
await api.add({ id: "t2", author: { kind: "user", id: "u" }, messageId: "seed-asis-0001",
  blockIndex: 0, start: 20, end: 24, quote: "数据1", marks: ["todo"], note: "" });

await open();

// 1) 表头 6 列：保留基础信息 + 新增「发送的信息」
const headers = await page.evaluate(() => [...document.querySelectorAll('[data-testid="annotation-panel-rows"] thead th')]
  .map((th) => th.textContent.trim()).filter((t) => t !== ""));
check("表头保留基础列并新增发送列",
  JSON.stringify(headers) === JSON.stringify(["被批注的原文", "用户的话", "语气", "发送的信息"]), JSON.stringify(headers));

// 2) 数据行：基础信息都在（不是只留发送信息）
const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid="annotation-row"]')]
  .map((r) => [...r.querySelectorAll("td")].map((td) => td.innerText.replace(/\s+/g, " ").trim())));
check("行包含 序号/原文/话/语气/发送信息/删除 六列", rows.every((cells) => cells.length === 6), JSON.stringify(rows[0]));
check("原文列在", rows[0][1] === "「加粗的重点」", rows[0][1]);
check("用户的话在", rows[0][2] === "第一句话", rows[0][2]);
// 没写话就留空：不能补「（没写话）」这类占位文字（用户 2026-11-04："你不要画蛇添足"）
check("没写话时该列为空（不补占位文字）", rows[1][2] === "", JSON.stringify(rows[1][2]));
check("语气列在", rows[0][3] === "批评", rows[0][3]);

// 3) 发送列内容 == annotationLine 的输出（与真正发出去的同源）
check("发送列显示转换后的完整一行",
  rows[0][4] === "1、你说的：「加粗的重点」 -> 第一句话 （我是批评的语气！）", rows[0][4]);

// 4) 只有功能标记的行：标明不发送
check("只有功能标记的行标明「仅分类，不发送」",
  rows[1].some((c) => c.includes("仅分类，不发送")), JSON.stringify(rows[1]));

// 5) 标题行：功能行与标题同一行，清空按钮不嵌在折叠按钮里
const head = await page.evaluate(() => {
  const t = document.querySelector('[data-testid="annotation-panel-toggle"]');
  const c = document.querySelector('[data-testid="annotation-clear-all"]');
  return {
    title: t?.innerText.replace(/\s+/g, " ").trim(),
    sameRow: t !== null && c !== null && t.parentElement === c.parentElement,
    nested: t !== null && c !== null && t.contains(c),
  };
});
check("标题是「批注 N」", /^▶?\s*批注\s*2$/.test(head.title.replace("▼", "▶")), head.title);
check("清空按钮与标题同一行", head.sameRow);
check("清空按钮不嵌在折叠按钮内（button 套 button 非法）", head.nested === false);

// 3) 不再显示「第 N 条回复」（用户 2026-11-03 要求去掉）
check("没有「第 N 条回复」", !(await page.evaluate(() => document.body.innerText.includes("条回复"))));

// 4) 删除按钮不触发整行点击（stopPropagation）
const before = await rowIds();
const pinnedBefore = await page.evaluate(() => [...document.querySelectorAll('[data-testid="annotation-row"]')]
  .filter((r) => r.dataset.pinned === "true").length);
await page.click('[data-testid="annotation-remove"][data-anno="t1"]');
await page.waitForTimeout(900);
const afterDel = await rowIds();
check("删除按钮生效：行消失", !afterDel.includes("t1"), JSON.stringify(afterDel));
check("删除不连带触发整行的钉住", (await page.evaluate(() => [...document.querySelectorAll('[data-testid="annotation-row"]')]
  .filter((r) => r.dataset.pinned === "true").length)) === pinnedBefore - 0, "钉住数量未因删除而变化");

// 5) 删除真的落盘（刷新后仍然没有）
await open();
const afterReload = await rowIds();
check("删除已落盘（刷新后仍不存在）", !afterReload.includes("t1"), JSON.stringify(afterReload));
check("服务端也确认删掉了", (await api.list()).every((a) => a.id !== "t1"));

// 6) 单击一行 = 钉住；再点一次 = 取消（且位置不受影响）
await api.add({ id: "t3", author: { kind: "user", id: "u" }, messageId: "seed-asis-0001",
  blockIndex: 0, start: 6, end: 11, quote: "加粗的重点", marks: ["query"], note: "" });
await open();
const pinnedOf = (id) => page.evaluate((i) =>
  document.querySelector(`[data-testid="annotation-row"][data-anno="${i}"]`)?.dataset.pinned, id);
await page.click('[data-testid="annotation-row"][data-anno="t3"]');
await page.waitForTimeout(800);
check("单击整行 → 钉住", (await pinnedOf("t3")) === "true", await pinnedOf("t3"));
await page.click('[data-testid="annotation-row"][data-anno="t3"]');
await page.waitForTimeout(700);
check("再点一次 → 取消钉住", (await pinnedOf("t3")) === "false", await pinnedOf("t3"));

// 7) 折叠 / 展开
await page.click('[data-testid="annotation-panel-toggle"]');
await page.waitForTimeout(400);
check("折叠后内容区隐藏", (await page.locator('[data-testid="annotation-panel-rows"]').count()) === 0);
await page.click('[data-testid="annotation-panel-toggle"]');
await page.waitForTimeout(400);
check("再点展开", (await page.locator('[data-testid="annotation-panel-rows"]').count()) === 1);

// 8) 清空全部：行全消失 + 落盘
await page.click('[data-testid="annotation-clear-all"]');
await page.waitForTimeout(1200);
check("清空全部：表格空", (await rowIds()).length === 0, JSON.stringify(await rowIds()));
await open();
check("清空全部已落盘", (await rowIds()).length === 0 && (await api.list()).length === 0);

// 9) 一条批注都没有时，整个面板不出现（外层条件 annotations.length > 0）
check("无批注时面板不渲染", (await page.locator('[data-testid="annotation-panel"]').count()) === 0);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `\n批注面板契约通过（${results.length} 项）` : `\n批注面板契约失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
