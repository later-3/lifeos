// 删除未读会话的**端到端**闭环（Task 0005 · P8 补）。
//
// 为什么要单独一个文件：上一版只在服务端测了"删了索引之后 aggregateStatus 会少一个"，
// 却漏了**客户端拿到补丁之后有没有把 UI 数字减掉**。用户实测就是这一层坏的：
// 「我刚刚删除了 life agent 一个未读的 session，数量没有减少」。
// 教训：删除/新增这类"有副作用 + 有跨端通知"的场景，必须测到"通知里带了什么、
// 收到的一方据此做了什么"，而不是只测源头状态变了。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { start } from "./server-harness.mjs";

/** 读 SSE 第一帧（快照）。 */
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
    const line = buf.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(line.slice(5));
  } finally { clearTimeout(timer); }
}

/**
 * 读快照**但保持连接打开**：`markViewed` 只在 focus 上报时发生，
 * 而 focus 需要 connectionId 对应的连接仍然存活（实测：cancel 之后再 PUT 会 404）。
 */
async function snapshotKeepOpen(base) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
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
  return {
    snap,
    close: () => { reader.cancel().catch(() => {}); clearTimeout(timer); ctrl.abort(); },
  };
}

/** 造一条"已完成未读"的会话：写文件 + 写索引，与真实链路同形。 */
async function makeUnreadSession(home, agentId, sessionId, outcome) {
  const dir = join(home, "agents", agentId, "projects", "workspace", "sessions");
  await mkdir(dir, { recursive: true });
  const at = new Date().toISOString();
  const assistant = outcome === "error"
    ? { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "error", errorMessage: "401 Unauthorized" }
    : { role: "assistant", content: [{ type: "text", text: "完成了" }], stopReason: "stop" };
  const lines = [
    { type: "session", version: 3, id: sessionId, timestamp: at, cwd: "/tmp" },
    { type: "session_info", id: "si", timestamp: at, name: `测试-${sessionId}` },
    { type: "message", timestamp: at, message: { role: "user", content: [{ type: "text", text: "跑一下" }] } },
    { type: "message", timestamp: at, message: assistant },
  ];
  await writeFile(join(dir, `2026-11-04T00-00-00-000Z_${sessionId}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");

  const { sessionViewsOf } = await import("../src/session-views.ts");
  await sessionViewsOf().load();
  sessionViewsOf().markCompleted(agentId, sessionId, at, "workspace",
    outcome === "error" ? { state: "error", failureKind: "auth" } : { state: "done" });
  return sessionId;
}

test("E2E 删除一条未读会话：DELETE 之后快照里的数字必须减一（行消失 + 数字减少）", async () => {
  const { server, base, home } = await start();
  const AID = "lifeosagent";
  try {
    const sid = await makeUnreadSession(home, AID, "del-done-1", "done");
    await makeUnreadSession(home, AID, "keep-1", "done");

    const before = await snapshot(base);
    const b = before.aggregate.find((x) => x.agentId === AID);
    assert.equal(b?.unreadDone, 2, "删除前：2 条未读完成");

    const del = await fetch(`${base}/api/agents/${AID}/sessions/${sid}`, { method: "DELETE" });
    assert.equal(del.status, 200);

    const after = await snapshot(base);
    const a = after.aggregate.find((x) => x.agentId === AID);
    assert.equal(a?.unreadDone, 1, "删除后：未读完成数必须减一（不能还是 2）");
    assert.ok(!after.unread.some((u) => u.sessionId === sid), "已删会话不在未读列表里");
  } finally { server.close(); }
});

test("E2E 删除一条**失败的**未读会话：unreadError 减一，unreadDone 不受影响", async () => {
  const { server, base, home } = await start();
  const AID = "lifeosagent";
  try {
    const sid = await makeUnreadSession(home, AID, "del-err-1", "error");
    await makeUnreadSession(home, AID, "keep-done-1", "done");

    const before = await snapshot(base);
    const b = before.aggregate.find((x) => x.agentId === AID);
    assert.deepEqual({ d: b?.unreadDone, e: b?.unreadError }, { d: 1, e: 1 }, "删除前：1 完成 + 1 失败");

    await fetch(`${base}/api/agents/${AID}/sessions/${sid}`, { method: "DELETE" });

    const after = await snapshot(base);
    const a = after.aggregate.find((x) => x.agentId === AID);
    assert.deepEqual({ d: a?.unreadDone, e: a?.unreadError }, { d: 1, e: 0 }, "只有失败数减一，完成数不动");
  } finally { server.close(); }
});

test("E2E 删到一条不剩：该 Agent 从聚合里消失（零值分组不占位）", async () => {
  const { server, base, home } = await start();
  const AID = "lifeosagent";
  try {
    const sid = await makeUnreadSession(home, AID, "only-one", "done");
    assert.equal((await snapshot(base)).aggregate.find((x) => x.agentId === AID)?.unreadDone, 1);
    await fetch(`${base}/api/agents/${AID}/sessions/${sid}`, { method: "DELETE" });
    const after = await snapshot(base);
    assert.equal(after.aggregate.find((x) => x.agentId === AID), undefined, "全删光 → 分组消失");
  } finally { server.close(); }
});

test("E2E 删除的会话如果**已经看过**，聚合数字不该变（它本来就没计）", async () => {
  const { server, base, home } = await start();
  const AID = "lifeosagent";
  try {
    const sid = await makeUnreadSession(home, AID, "viewed-1", "done");
    const { sessionViewsOf } = await import("../src/session-views.ts");
    sessionViewsOf().markViewed(AID, sid, new Date().toISOString());
    const before = await snapshot(base);
    assert.equal(before.aggregate.find((x) => x.agentId === AID)?.unreadDone ?? 0, 0, "看过了 → 删除前就不计");

    await fetch(`${base}/api/agents/${AID}/sessions/${sid}`, { method: "DELETE" });
    const after = await snapshot(base);
    assert.equal(after.aggregate.find((x) => x.agentId === AID)?.unreadDone ?? 0, 0, "删它不该把数字减成负数");
  } finally { server.close(); }
});

// —— 查看后数字必须减少（Task 0005 · 2026-11-04 用户实测「1 始终不消失」）——
// 服务端 markSessionViewed() 会发 {unread: null} 补丁；
// 前端此前只清了行的 activity，没动 agentAggregate → 徽标数字一直留着。
test("E2E 查看会话后，快照里的未读数必须减少（查看会清未读）", async () => {
  const { server, base, home } = await start();
  const AID = "lifeosagent";
  try {
    const sid = await makeUnreadSession(home, AID, "view-me-1", "done");
    const conn = await snapshotKeepOpen(base);
    const before = conn.snap;
    assert.equal(before.aggregate.find((x) => x.agentId === AID)?.unreadDone, 1, "看之前：1 条未读完成");

    // 真实链路：在同一连接上报焦点（服务端会 markViewed 并推 {unread:null} 补丁）
    const put = await fetch(`${base}/api/events/focus`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: before.connectionId, agentId: AID, sessionId: sid, visible: true }),
    });
    assert.equal(put.status, 200);
    conn.close();

    const after = await snapshot(base);
    assert.equal(after.aggregate.find((x) => x.agentId === AID)?.unreadDone ?? 0, 0, "看过之后：未读数归零");
  } finally { server.close(); }
});

test("E2E 失败的会话查看后也归零（失败与成功同一规则）", async () => {
  const { server, base, home } = await start();
  const AID = "lifeosagent";
  try {
    const sid = await makeUnreadSession(home, AID, "view-err-1", "error");
    const conn = await snapshotKeepOpen(base);
    const before = conn.snap;
    assert.equal(before.aggregate.find((x) => x.agentId === AID)?.unreadError, 1);

    await fetch(`${base}/api/events/focus`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: before.connectionId, agentId: AID, sessionId: sid, visible: true }),
    });
    conn.close();
    const after = await snapshot(base);
    assert.equal(after.aggregate.find((x) => x.agentId === AID)?.unreadError ?? 0, 0);
  } finally { server.close(); }
});
