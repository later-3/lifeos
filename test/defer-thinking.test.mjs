/**
 * 思考正文按需取（Task 0016 · P8 / B2）。
 *
 * 实测动机：200 条消息的窗口里 thinking 占 **999 KB / 1475 KB（68%）**，而首屏思考块默认折叠
 * （`useAutoOpen` 完成后收起）—— 用户当场看不到那 68%，却要先把它传下来。
 *
 * 两个端点都要锁：
 *  - `messagesOf({deferThinking:true})` 把正文置空并标 `deferred`，**不**动别的块；
 *  - `GET …/entries/:entryId/thinking?blockIndex=N` 能把它取回来（含非思考块 / 越界的拒绝）。
 *
 * 活性验证：把 `deferThinking === true &&` 删掉 → T10-1 立刻红（正文没被置空）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { messagesOf } from "../src/agent-host.ts";

const msg = (id, role, content, prevId = null, extra = {}) => ({
  type: "message", id, parentId: prevId, timestamp: "2026-01-01T00:00:01.000Z",
  message: { role, content, timestamp: 1, ...extra },
});

async function makeSession(entries) {
  const dir = await mkdtemp(join(tmpdir(), "defer-thinking-"));
  const file = join(dir, "2026-01-01T00-00-00-000Z_test.jsonl");
  const lines = [
    { type: "session", version: 3, id: "test-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir },
    ...entries,
  ];
  await writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  return { dir, file };
}
const stateOf = (file, dir) => ({ session: { sessionManager: SessionManager.open(file, dir, dir) } });

const entries = () => [
  msg("u1", "user", [{ type: "text", text: "提问" }]),
  msg("a1", "assistant", [
    { type: "thinking", thinking: "我想了很久" },
    { type: "text", text: "回复" },
    { type: "toolCall", id: "c1", name: "read", arguments: {} },
  ], "u1", { stopReason: "end" }),
];

test("T10-1 deferThinking：思考正文置空并标 deferred，其余块不受影响", async () => {
  const { dir, file } = await makeSession(entries());
  const out = messagesOf(stateOf(file, dir), { deferThinking: true });
  const assistant = out.find((m) => m.role === "assistant");
  const thinking = assistant.blocks.find((b) => b.type === "thinking");
  assert.equal(thinking.text, "", "思考正文必须置空");
  assert.equal(thinking.deferred, true, "必须标 deferred（前端据此决定去取）");
  assert.ok(assistant.blocks.some((b) => b.type === "text"), "文本块保留");
  assert.ok(assistant.blocks.some((b) => b.type === "toolCall"), "工具块保留");
});

test("T10-2 默认（不传 options）：思考正文照旧下发（peer / 计数路径不能被瘦身）", async () => {
  const { dir, file } = await makeSession(entries());
  const out = messagesOf(stateOf(file, dir));
  const thinking = out.find((m) => m.role === "assistant").blocks.find((b) => b.type === "thinking");
  assert.equal(thinking.text, "我想了很久");
  assert.equal(thinking.deferred, undefined, "不该出现 deferred 标记");
});

test("T10-3 空思考不标 deferred（没有正文可省，别让前端白跑一次请求）", async () => {
  const { dir, file } = await makeSession([
    msg("u1", "user", [{ type: "text", text: "提问" }]),
    msg("a1", "assistant", [
      { type: "thinking", thinking: "   " },
      { type: "text", text: "回复" },
    ], "u1", { stopReason: "end" }),
  ]);
  const out = messagesOf(stateOf(file, dir), { deferThinking: true });
  const thinking = out.find((m) => m.role === "assistant").blocks.find((b) => b.type === "thinking");
  assert.equal(thinking.deferred, undefined, "空白思考不值得一次往返");
});

test("T10-4 字节量：defer 后的 JSON 明显小于完整版（同一条会话）", async () => {
  const { dir, file } = await makeSession([
    msg("u1", "user", [{ type: "text", text: "提问" }]),
    msg("a1", "assistant", [
      { type: "thinking", thinking: "很长的思考".repeat(500) },
      { type: "text", text: "回复" },
    ], "u1", { stopReason: "end" }),
  ]);
  const full = JSON.stringify(messagesOf(stateOf(file, dir)));
  const deferred = JSON.stringify(messagesOf(stateOf(file, dir), { deferThinking: true }));
  assert.ok(deferred.length * 4 < full.length, `defer 后应显著更小：${deferred.length} vs ${full.length}`);
});
