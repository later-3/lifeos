// 协议 P1·1.2/1.3 红绿测试：回合账本、对账端点、SSE turn 事件、队列裁决（决策 b）。
// 测试编号：T3（完成判定）/T4(丢失判定)/T9(重启兜底一致性)/T2a/T2b/T2c（裁决矩阵）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { start, startOn } from "./server-harness.mjs";

// ---- 纯函数兜底判定（sessions JSONL 尾读，对账端点 used 当无内存账本时） ----


test("T3 兜底：JSONL 尾部完整回合（user…assistant）→ 对账=完成", async () => {
  const { home, server } = await start();
  const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
  await mkdir(dir, { recursive: true });
  const { readTurnVerdict } = await import("../src/turn-verdict.ts");
  const file = join(dir, "f-fake-id.jsonl");
  await writeFile(file, [
    JSON.stringify({ type: "session", version: 1, id: "f-id", cwd: join(home) }),
    JSON.stringify({ type: "message", timestamp: 1, message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
    JSON.stringify({ type: "message", timestamp: 2, message: { role: "assistant", content: [{ type: "text", text: "hi!" }], stopReason: "stop" } }),
  ].join("\n") + "\n");
  try {
    const r = await readTurnVerdict(file);
    assert.equal(r.state, "done");
  } finally { server.close(); }
});

test("T4 兜底：JSONL 只有 user 无收尾 → 对账=丢失", async () => {
  const { home, server } = await start();
  const file = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions", "f-fake-lost.jsonl");
  await mkdir(join(home, "agents", "lifeosagent", "projects", "workspace", "sessions"), { recursive: true });
  const { readTurnVerdict } = await import("../src/turn-verdict.ts");
  await writeFile(file, [
    JSON.stringify({ type: "session", version: 1, id: "f-fake-lost", cwd: join(home) }),
    JSON.stringify({ type: "message", timestamp: 1, message: { role: "user", content: [{ type: "text", text: "only me" }] } }),
  ].join("\n") + "\n");
  try {
    const r = await readTurnVerdict(file);
    assert.equal(r.state, "lost");
  } finally { server.close(); }
});

// T11/T12/T13：判定必须看 stopReason（2026-10-24 会话 01a16bd9 事故）
test("T11 兜底：toolUse 中间态（工具结果已到但无终态收尾）→ 对账=丢失", async () => {
  const { home, server } = await start();
  try {
    const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
    await mkdir(dir, { recursive: true });
    const { readTurnVerdict } = await import("../src/turn-verdict.ts");
    const file = join(dir, "f-tooluse.jsonl");
    await writeFile(file, [
      JSON.stringify({ type: "session", version: 1, id: "f-tooluse", cwd: home }),
      JSON.stringify({ type: "message", timestamp: 1, message: { role: "user", content: [{ type: "text", text: "查一下" }] } }),
      JSON.stringify({ type: "message", timestamp: 2, message: { role: "assistant", stopReason: "toolUse", content: [{ type: "text", text: "我查一下" }] } }),
      JSON.stringify({ type: "message", timestamp: 3, message: { role: "toolResult", content: [{ type: "text", text: "结果" }] } }),
    ].join("\n") + "\n");
    const r = await readTurnVerdict(file);
    assert.equal(r.state, "lost", "toolUse 是中间态，不能判 done");
  } finally { server.close(); }
});

test("T12 兜底：中间态之后出现终态 stop → 对账=完成（不误判 lost）", async () => {
  const { home, server } = await start();
  try {
    const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
    await mkdir(dir, { recursive: true });
    const { readTurnVerdict } = await import("../src/turn-verdict.ts");
    const file = join(dir, "f-tooluse-then-stop.jsonl");
    await writeFile(file, [
      JSON.stringify({ type: "session", version: 1, id: "f-tooluse-then-stop", cwd: home }),
      JSON.stringify({ type: "message", timestamp: 1, message: { role: "user", content: [{ type: "text", text: "查一下" }] } }),
      JSON.stringify({ type: "message", timestamp: 2, message: { role: "assistant", stopReason: "toolUse", content: [{ type: "text", text: "我查一下" }] } }),
      JSON.stringify({ type: "message", timestamp: 3, message: { role: "toolResult", content: [{ type: "text", text: "结果" }] } }),
      JSON.stringify({ type: "message", timestamp: 4, message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "结论" }] } }),
    ].join("\n") + "\n");
    const r = await readTurnVerdict(file);
    assert.equal(r.state, "done");
  } finally { server.close(); }
});

test("T13 兜底：aborted 终态（用户打断）→ 对账=丢失（FR-13 的“中断”分支）", async () => {
  const { home, server } = await start();
  try {
    const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
    await mkdir(dir, { recursive: true });
    const { readTurnVerdict } = await import("../src/turn-verdict.ts");
    const file = join(dir, "f-aborted.jsonl");
    await writeFile(file, [
      JSON.stringify({ type: "session", version: 1, id: "f-aborted", cwd: home }),
      JSON.stringify({ type: "message", timestamp: 1, message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
      JSON.stringify({ type: "message", timestamp: 2, message: { role: "assistant", stopReason: "aborted", content: [{ type: "text", text: "用到一半" }] } }),
    ].join("\n") + "\n");
    const r = await readTurnVerdict(file);
    assert.equal(r.state, "lost", "中断不能被说成已完成");
  } finally { server.close(); }
});

test("HTTP 端点：对账端点对未知会话 → 404 with原因", async () => {
  const { server, base } = await start();
  try {
    const response = await fetch(`${base}/api/agents/lifeosagent/sessions/nope/turns/last`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "session_not_found");
  } finally { server.close(); }
});

test("HTTP 端点：空闲（无回合）→ 200 {turn:null}（无回合不算错误）", async () => {
  const { server, base } = await start();
  try {
    const created = await (await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`, { method: "POST" })).json();
    const response = await fetch(`${base}/api/agents/lifeosagent/sessions/${created.sessionId}/turns/last`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).turn, null);
  } finally { server.close(); }
});

test("HTTP 端点 + 队列裁决（空转）：steer/followUp → 409 session_idle", async () => {
  const { server, base } = await start();
  try {
    const created = await (await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`, { method: "POST" })).json();
    const sid = created.sessionId;
    for (const behavior of ["steer", "followUp"]) {
      const response = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/messages`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x", behavior }),
      });
      assert.equal(response.status, 409, behavior);
      assert.equal((await response.json()).error.code, "session_idle", behavior);
    }
  } finally { server.close(); }
});
