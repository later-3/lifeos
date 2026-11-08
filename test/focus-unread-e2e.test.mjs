// 「停在哪个会话 = 看过」的端到端验证（Task 0005 · 2026-11-08 用户裁决）。
//
// 用户原话：
// > 他只要当前在这个 session 上，你就不要管他去干嘛了，我们只做我们自己的逻辑……
// > 你不可能管到他到底看没看呀。
//
// 修之前：`isFocusedVisible()` 要求 `focus.visible === true`。
// 回合结束时标签页恰好不可见 → 记成未读 → 用户切走 → **服务端再也不会清** →
// "我明明在这个会话里，绿点却一直挂着，还非得再切回去再切出来才消失"（用户实测）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { start } from "./server-harness.mjs";

/** 连 SSE 并保持连接打开（focus 需要 connectionId 对应的连接存活）。 */
async function openStream(base) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (!buf.includes("\n\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  const snap = JSON.parse(buf.split("\n").find((l) => l.startsWith("data:")).slice(5));
  return { snap, close: () => { reader.cancel().catch(() => undefined); clearTimeout(timer); ctrl.abort(); } };
}

/** 造一条会话文件（只为让 sessionExists 认得）。 */
async function makeSession(home, agentId, sessionId) {
  const dir = join(home, "agents", agentId, "projects", "workspace", "sessions");
  await mkdir(dir, { recursive: true });
  const at = new Date().toISOString();
  await writeFile(join(dir, `2026-11-08T00-00-00-000Z_${sessionId}.jsonl`),
    [
      { type: "session", version: 3, id: sessionId, timestamp: at, cwd: "/tmp" },
      { type: "session_info", id: "si", timestamp: at, name: `测试-${sessionId}` },
      { type: "message", timestamp: at, message: { role: "user", content: [{ type: "text", text: "跑" }] } },
    ].map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  return sessionId;
}

test("E2E focus 上报时 visible=false（标签页不可见）也必须标已读", async () => {
  const { server, base, home } = await start();
  const AID = "lifeosagent";
  try {
    const sid = await makeSession(home, AID, "focus-hidden-1");
    const { sessionViewsOf } = await import("../src/session-views.ts");
    await sessionViewsOf().load();
    // 造一条"完成未读"
    const at = new Date(Date.now() - 60_000).toISOString();
    sessionViewsOf().markCompleted(AID, sid, at, "workspace", { state: "done" });
    assert.ok(sessionViewsOf().unread().some((u) => u.sessionId === sid), "前提：它现在是未读");

    const stream = await openStream(base);
    try {
      const res = await fetch(`${base}/api/events/focus`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: stream.snap.connectionId, agentId: AID, sessionId: sid, visible: false }),
      });
      assert.equal(res.status, 200);
      await sessionViewsOf().flush();

      assert.ok(!sessionViewsOf().unread().some((u) => u.sessionId === sid),
        "停在它上面（哪怕标签页不可见）就该算已读 —— 否则「切走也不清」");
    } finally { stream.close(); }
  } finally { server.close(); }
});
