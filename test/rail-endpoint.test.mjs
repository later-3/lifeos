/**
 * `GET /api/agents/:id/sessions/:sessionId/rail`（Task 0020 · P1）。
 *
 * 只测端点行为，不重复测纯函数（那边在 `rail-ticks.test.mjs`）。这里要证明的是：
 *  - 形状是 `{items}`（`specs/code/api/api.md` 2.1）；
 *  - 与会话详情**同一份投影**（同一组 id、同样的轮次边界）——这是本条接口存在的全部理由；
 *  - 失败路径各有自己的 code（`agent_not_found` / `session_not_found`），不混成一种。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { start, startOn } from "./server-harness.mjs";

/** 写一个已有历史的会话文件（Pi 对"没有消息的会话"延迟落盘，测试要的正是已有历史）。 */
async function writeSession(home, sessionId, messages) {
  const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
  await mkdir(dir, { recursive: true });
  let parentId = sessionId;
  const entries = [{ type: "session", version: 3, id: sessionId, timestamp: "2026-11-19T00:00:00.000Z", cwd: "" }];
  messages.forEach((message, index) => {
    const id = message.id ?? `e${index}`;
    entries.push({
      type: "message", id, parentId,
      timestamp: new Date(Date.parse("2026-11-19T00:00:01.000Z") + index * 1000).toISOString(),
      message: message.body,
    });
    parentId = id;
  });
  await writeFile(join(dir, `2026-11-19T00-00-00-000Z_${sessionId}.jsonl`),
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

const text = (value) => [{ type: "text", text: value }];

test("GET rail：形状是 {items}，一轮两条（问一条、答一条）", async () => {
  const { server, base, home } = await start();
  try {
    const sid = "01a20000-0000-7000-8000-000000000001";
    await writeSession(home, sid, [
      { id: "u1", body: { role: "user", content: "第一问" } },
      { id: "a1", body: { role: "assistant", content: text("第一答") } },
      { id: "u2", body: { role: "user", content: "第二问" } },
      { id: "a2", body: { role: "assistant", content: text("第二答") } },
    ]);

    const response = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/rail`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ["items"], "列表接口只包一层 items");
    assert.deepEqual(body.items.map((tick) => [tick.id, tick.role]), [
      ["u1", "user"], ["a1", "assistant"], ["u2", "user"], ["a2", "assistant"],
    ]);
    assert.equal(body.items[0].chars, 3, "长度就是字符数");
    assert.equal(body.items[0].preview, "第一问");
  } finally { server.close(); }
});

test("GET rail：与会话详情同一份投影（id 与顺序完全一致）", async () => {
  const { server, base, home } = await start();
  try {
    const sid = "01a20000-0000-7000-8000-000000000002";
    await writeSession(home, sid, [
      { id: "u1", body: { role: "user", content: "查一下目录" } },
      // 一轮里：带工具过程的空文字段 → 工具结果（不进顶层）→ 两段带文字的回复
      { id: "a1", body: { role: "assistant", content: [
        { type: "thinking", thinking: "先看看" },
        { type: "toolCall", id: "c1", name: "ls", arguments: { path: "." } },
      ] } },
      { id: "t1", body: { role: "toolResult", toolCallId: "c1", toolName: "ls", isError: false, content: text("a.ts") } },
      { id: "a2", body: { role: "assistant", content: text("再看看") } },
      { id: "a3", body: { role: "assistant", content: text("最终答案") } },
      { id: "u2", body: { role: "user", content: "第二问" } },
      { id: "a4", body: { role: "assistant", content: text("第二答") } },
    ]);

    const rail = await (await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/rail`)).json();
    const detail = await (await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}`)).json();

    assert.deepEqual(rail.items.map((tick) => tick.id), ["u1", "a3", "u2", "a4"]);
    // 每一条刻度的 id 都必须真的在对话详情的消息里（同一个 id 空间）
    const messageIds = new Set(detail.messages.map((message) => message.id));
    for (const tick of rail.items) assert.ok(messageIds.has(tick.id), `刻度 ${tick.id} 不在会话详情里`);
    // 且长度与详情里对应消息的 text 长度一致（同一份投影的必然结果）
    for (const tick of rail.items) {
      const message = detail.messages.find((candidate) => candidate.id === tick.id);
      assert.equal(tick.chars, message.text.length, `${tick.id} 的 chars 与会话详情的 text 长度不一致`);
    }
  } finally { server.close(); }
});

test("GET rail：失败路径各有各的 code（不混成一种）", async () => {
  const { server, base } = await start();
  try {
    const noAgent = await fetch(`${base}/api/agents/nobody/sessions/x/rail`);
    assert.equal(noAgent.status, 404);
    assert.equal((await noAgent.json()).error.code, "agent_not_found");

    const noSession = await fetch(`${base}/api/agents/lifeosagent/sessions/no-such-session/rail`);
    assert.equal(noSession.status, 404);
    assert.equal((await noSession.json()).error.code, "session_not_found");
  } finally { server.close(); }
});

test("GET rail：空会话返回空列表，不是 404", async () => {
  const { server, base, home } = await start();
  try {
    const sid = "01a20000-0000-7000-8000-000000000003";
    const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `2026-11-19T00-00-00-000Z_${sid}.jsonl`),
      JSON.stringify({ type: "session", version: 3, id: sid, timestamp: "2026-11-19T00:00:00.000Z", cwd: "" }) + "\n");
    const response = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/rail`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).items, []);
  } finally { server.close(); }
});
