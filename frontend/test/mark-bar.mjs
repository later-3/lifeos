#!/usr/bin/env node
/**
 * MarkBar 契约（Task 0008 · P2）。
 *
 * MarkBar = 挂在**被批注的那条消息**底部的批注信息条（用户 2026-11-04 定案：
 * "标注信息 bar 是放到被批注的那个信息上的"）。替代旧版挂在输入框上方的 annotation-panel。
 *
 * 每条都验"数据真的在服务端"（刷新 + 查接口），只看 DOM 不算数——
 * P1 的"清空全部不落盘" bug 就是只看 DOM 漏掉的。
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

const api = {
  async sessions() {
    return (await (await fetch(`${API}/api/agents/${AGENT}/projects/${PROJECT}/sessions`)).json()).items ?? [];
  },
  async list(sid) {
    return (await (await fetch(`${API}/api/agents/${AGENT}/sessions/${sid}/annotations`)).json()).annotations ?? [];
  },
  async post(sid, body) {
    return fetch(`${API}/api/agents/${AGENT}/sessions/${sid}/annotations`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
  },
};

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

/** 选一个有 assistant 消息的会话，返回 {sid, messageId}。 */
async function pickTarget() {
  for (const s of await api.sessions()) {
    const annos = await api.list(s.sessionId);
    if (annos.length === 0) continue;
    const mid = annos[0]?.messageId;
    if (mid !== undefined) return { sid: s.sessionId, messageId: mid, existing: annos };
  }
  return undefined;
}

const target = await pickTarget();
if (target === undefined) {
  console.log("✖ 没有找到带批注的会话（先造数据或换会话）");
  process.exit(1);
}
const { sid, messageId } = target;
const url = `${ENTRY}/?agent=${AGENT}&project=${PROJECT}&session=${sid}`;
const open = async () => { await page.goto(url, { waitUntil: "networkidle" }); await page.waitForTimeout(1500); };

// —— 准备固定数据：清掉旧的，加两条（一条待发送、一条已发送）——
for (const a of await api.list(sid)) await api.post(sid, { op: "remove", annotation: { id: a.id } });
await api.post(sid, { op: "add", annotation: {
  id: "mb1", author: { kind: "user", id: "u" }, messageId, blockIndex: 0,
  start: 6, end: 11, quote: "测试原文", marks: ["critic"], note: "待发送的批注",
}});
await api.post(sid, { op: "add", annotation: {
  id: "mb2", author: { kind: "user", id: "u" }, messageId, blockIndex: 0,
  start: 20, end: 24, quote: "另一段", marks: ["todo"], note: "",
}});
await api.post(sid, { op: "consume", ids: ["mb2"], consumedBy: "send-test" });
await open();

// 1) 挂在被批注的消息内部（不是全局底部）
const pos = await page.evaluate(() => {
  const bar = document.querySelector('[data-testid="mark-bar"]');
  const msg = bar?.closest('[data-testid="message"]');
  return { onMessage: msg?.dataset.role ?? null, count: bar?.dataset.markCount };
});
check("MarkBar 挂在 assistant 消息内部", pos.onMessage === "assistant", JSON.stringify(pos));

// 2) 默认折叠：标题可见、行不可见
check("默认折叠（标题在、行不在）",
  (await page.locator('[data-testid="mark-bar-rows"]').count()) === 0
  && (await page.locator('[data-testid="mark-bar-count"]').textContent()) === "2");

// 3) 标题行显示待发送概览（折叠态下 innerText 可能不完整，用 querySelector 逐个取）
const headParts = await page.evaluate(() => [...(document.querySelector('[data-testid="mark-bar"]')?.querySelectorAll("span") ?? [])].map((s) => s.textContent ?? "").join(" "));
check("标题含数量与待发送概览", headParts.includes("2") && headParts.includes("1 条待发送"), headParts);

// 4) 展开后：两条都在，已发送的带标记
await page.click('[data-testid="mark-bar"] button[aria-controls="mark-bar-rows"]');
await page.waitForTimeout(300);
const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid="mark-row"]')].map((r) => ({
  consumed: r.dataset.consumed, text: r.innerText.replace(/\s+/g, " ").trim().slice(0, 60),
})));
check("展开后 2 行", rows.length === 2, JSON.stringify(rows));
check("已发送的行带「已发」标记（6 列后标记在序号格）", rows.some((r) => r.consumed === "true" && r.text.includes("已发")), JSON.stringify(rows));
check("待发送的行显示发送文本", rows.some((r) => r.consumed === "false" && r.text.includes("我是批评的语气！")), JSON.stringify(rows));

// 5) 删除单条：行消失 + 落盘
await page.click('[data-testid="mark-remove"][data-anno="mb1"]');
await page.waitForTimeout(900);
check("删除后行消失", (await page.locator('[data-testid="mark-row"][data-anno="mb1"]').count()) === 0);
await open();
check("删除已落盘（刷新后仍不在）", !(await api.list(sid)).some((a) => a.id === "mb1"));

// 6) 清空这条消息的全部批注
await page.click('[data-testid="mark-bar-clear"]');
await page.waitForTimeout(900);
check("清空后 MarkBar 消失（0 条不渲染）", (await page.locator('[data-testid="mark-bar"]').count()) === 0);
check("清空已落盘", (await api.list(sid)).length === 0);

// 7) 无批注的消息不渲染 MarkBar（用同一会话另一条消息验证）
check("无批注时不渲染 MarkBar", (await page.locator('[data-testid="mark-bar"]').count()) === 0);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `\nMarkBar 契约通过（${results.length} 项）` : `\nMarkBar 契约失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
