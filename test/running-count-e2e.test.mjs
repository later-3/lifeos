// 运行中的数字：完整生命周期（Task 0005 · 2026-11-04 用户实测缺的那条）。
//
// 用户原话：「我发起一个 session，然后我就在这个 session 上，agent 正在回复，
// 这时候就应该有正在跑的统计了啊？你这个测试下」
//
// 这一层此前**完全没测**：我测了删除、测了服务端聚合，却没测"会话开跑之后数字会不会出现"。
// 而它恰恰是用户最先看到的场景。
//
// 为什么必须端到端测：`aggregate` 只在快照里下发，开跑/结束只发 `row` 补丁。
// "前端有没有据此更新数字"是组件层行为，服务端单测看不见。
import { test } from "node:test";
import assert from "node:assert/strict";
import { start } from "./server-harness.mjs";

async function snapshot(base) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (!buf.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    return JSON.parse(buf.split("\n").find((l) => l.startsWith("data:")).slice(5));
  } finally { clearTimeout(timer); }
}

/** 收集一段时间内的 row 补丁（看窗口内收到了什么）。 */
async function rowsDuring(base, action, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms + 3000);
  const seen = [];
  const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + ms;
  const pump = (async () => {
    try {
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.includes("event: row")) continue;
          const line = part.split("\n").find((l) => l.startsWith("data:"));
          if (line) seen.push(JSON.parse(line.slice(5)));
        }
      }
    } catch { /* abort 正常 */ }
  })();
  await action();
  await pump;
  reader.cancel().catch(() => {});
  clearTimeout(timer);
  return seen;
}

test("E2E 会话开跑 → 收到带 running 的补丁；结束 → 收到 running:null + unread", async () => {
  const { server, base, home } = await start();
  try {
    const created = await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`, { method: "POST" }).then((r) => r.json());

    const seen = await rowsDuring(base, async () => {
      await fetch(`${base}/api/agents/lifeosagent/sessions/${created.sessionId}/messages`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }),
      });
    });

    const startPatch = seen.find((e) => e.patch?.running !== undefined && e.patch?.running !== null);
    assert.ok(startPatch !== undefined, "开跑必须推一条带 running 的补丁（前端据此让数字 +1）");
    assert.equal(startPatch.sessionId, created.sessionId);
    assert.ok(startPatch.projectId !== undefined, "要带 projectId，前端才知道加到哪个项目行");

    const endPatch = seen.find((e) => e.patch?.running === null);
    assert.ok(endPatch !== undefined, "结束必须推 running:null（前端据此 -1）");
    // 终态要么是 unread（正常结束），要么带 failure（异常）——两者都要能让前端定位到某一格
    const hasTerminal = endPatch.patch.unread !== undefined || endPatch.patch.failure !== undefined;
    assert.ok(hasTerminal, "终态补丁要带 unread 或 failure，前端才知道进 unreadDone 还是 unreadError");

    void home;
  } finally { server.close(); }
});

test("E2E 最后的快照与补丁一致：跑完之后 running 归零、未读计入", async () => {
  const { server, base } = await start();
  try {
    const created = await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`, { method: "POST" }).then((r) => r.json());
    await fetch(`${base}/api/agents/lifeosagent/sessions/${created.sessionId}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }),
    });
    // 等回合结束（这个家目录没配模型，很快就结束）
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const snap = await snapshot(base);
      if ((snap.running ?? []).length === 0 && (snap.aggregate ?? []).some((a) => a.agentId === "lifeosagent")) break;
    }
    const snap = await snapshot(base);
    const agg = (snap.aggregate ?? []).find((a) => a.agentId === "lifeosagent");
    assert.equal(agg?.running ?? 0, 0, "跑完之后 running 必须归零");
    assert.ok((agg?.unreadDone ?? 0) + (agg?.unreadError ?? 0) >= 1, "这一回合要么进完成待看、要么进失败待看");
  } finally { server.close(); }
});
