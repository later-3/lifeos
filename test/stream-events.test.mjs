import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_RESULT_CHARS, toStreamEvent, toolResultText } from "../src/stream-events.ts";

/**
 * 流事件映射的判据：只映射"会话区要实时画的东西"，未知类型一律 undefined（不猜、不造）。
 * 事实源仍是会话 JSONL（run 结束后前端全量刷新），所以这里允许工具结果截断（有 truncated 标记）。
 */

const update = (assistantMessageEvent) => ({ type: "message_update", assistantMessageEvent });

test("思考/文本增量 → thinking / delta（带 contentIndex 槽位）", () => {
  assert.deepEqual(toStreamEvent(update({ type: "thinking_start", contentIndex: 0 })), { type: "thinking", index: 0, text: "" });
  assert.deepEqual(toStreamEvent(update({ type: "thinking_delta", contentIndex: 0, delta: "先看目录" })), { type: "thinking", index: 0, text: "先看目录" });
  assert.deepEqual(toStreamEvent(update({ type: "thinking_end", contentIndex: 0 })), { type: "thinking_end", index: 0 });
  assert.deepEqual(toStreamEvent(update({ type: "text_delta", contentIndex: 1, delta: "好了" })), { type: "delta", index: 1, text: "好了" });
});

test("工具调用在 toolcall_end 才发布（缺 id/name 就不发，避免画半个壳）", () => {
  assert.deepEqual(
    toStreamEvent(update({ type: "toolcall_end", contentIndex: 2, toolCall: { id: "call_1", name: "read", arguments: { path: "a.md" } } })),
    { type: "tool_call", index: 2, id: "call_1", name: "read", arguments: { path: "a.md" } },
  );
  assert.equal(toStreamEvent(update({ type: "toolcall_end", contentIndex: 2, toolCall: { name: "read" } })), undefined);
  assert.equal(toStreamEvent(update({ type: "toolcall_delta", contentIndex: 2, delta: "{" })), undefined);
});

test("工具结果：取 text 块、带 isError/durationMs；超长截断并标记", () => {
  const result = { content: [{ type: "text", text: "第一行" }, { type: "image", data: "…" }, { type: "text", text: "第二行" }] };
  assert.deepEqual(
    toStreamEvent({ type: "tool_execution_end", toolCallId: "call_1", result, isError: false, durationMs: 1234 }),
    { type: "tool_result", id: "call_1", isError: false, text: "第一行\n第二行", truncated: false, durationMs: 1234 },
  );
  assert.equal(toolResultText("裸字符串").text, "裸字符串");
  const long = toolResultText({ content: [{ type: "text", text: "x".repeat(MAX_RESULT_CHARS + 10) }] });
  assert.equal(long.truncated, true);
  assert.equal(long.text.length, MAX_RESULT_CHARS);
});

test("不关心的事件一律 undefined（生命周期/重试/压缩/队列都不该变成界面事件）", () => {
  for (const event of [
    { type: "agent_start" }, { type: "agent_end", messages: [] }, { type: "turn_start" },
    { type: "tool_execution_start", toolCallId: "x", toolName: "read", args: {} },
    { type: "tool_execution_update", toolCallId: "x", toolName: "read", partialResult: {} },
    { type: "compaction_start", reason: "threshold" },
    { type: "bash_execution_update", delta: "…" }, { type: "message_start", message: {} },
    { type: "message_update" }, { type: "message_update", assistantMessageEvent: { type: "done" } },
    {}, undefined, null,
  ]) {
    assert.equal(toStreamEvent(event), undefined, JSON.stringify(event));
  }
});


test("自动重试也映射（界面上要能显示失败原因与第几次）", () => {
  assert.deepEqual(
    toStreamEvent({ type: "auto_retry_start", attempt: 2, maxAttempts: 3, delayMs: 4000, errorMessage: "Request timed out." }),
    { type: "retrying", attempt: 2, maxAttempts: 3, delayMs: 4000, message: "Request timed out." },
  );
  assert.deepEqual(toStreamEvent({ type: "auto_retry_end", success: false }), { type: "retry_end", success: false });
  // 缺字段时给安全默认值（不崩、不造假）
  assert.deepEqual(toStreamEvent({ type: "auto_retry_start" }), { type: "retrying", attempt: 0, maxAttempts: 0, delayMs: 0, message: "" });
});
