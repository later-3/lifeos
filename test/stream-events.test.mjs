import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_RESULT_CHARS, toStreamEvent, toolResultText, MAX_TOOL_IMAGES, toolResultImages } from "../src/stream-events.ts";

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

test("消息边界：assistant message_start/end 带段键，非 assistant 不产生段", () => {
  assert.deepEqual(
    toStreamEvent({ type: "message_start", message: { role: "assistant", timestamp: 1000 } }),
    { type: "message_start", segment: "msg-1000" },
  );
  assert.deepEqual(
    toStreamEvent({ type: "message_end", message: { role: "assistant", timestamp: 1000 } }),
    { type: "message_end", segment: "msg-1000" },
  );
  assert.equal(toStreamEvent({ type: "message_start", message: { role: "user", timestamp: 1001 } }), undefined);
  assert.equal(toStreamEvent({ type: "message_end", message: { role: "toolResult", timestamp: 1002 } }), undefined);
});

test("message_update 的内容事件带段键；同一段内 contentIndex 不跨段", () => {
  assert.deepEqual(
    toStreamEvent({ type: "message_update", message: { role: "assistant", timestamp: 2000 }, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "a" } }),
    { type: "delta", index: 0, text: "a", segment: "msg-2000" },
  );
  assert.deepEqual(
    toStreamEvent({ type: "message_update", message: { role: "assistant", timestamp: 3000 }, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "b" } }),
    { type: "thinking", index: 0, text: "b", segment: "msg-3000" },
  );
});

test("工具执行 start/update 映射 running；end 才映射结果", () => {
  assert.deepEqual(
    toStreamEvent({ type: "tool_execution_start", toolCallId: "x", toolName: "read", args: { path: "a" } }),
    { type: "tool_start", id: "x", name: "read", arguments: { path: "a" } },
  );
  assert.deepEqual(
    toStreamEvent({ type: "tool_execution_update", toolCallId: "x", toolName: "read", partialResult: { text: "…" } }),
    { type: "tool_update", id: "x" },
  );
});

test("不关心的事件一律 undefined（生命周期/压缩/队列都不该变成界面事件）", () => {
  for (const event of [
    { type: "agent_start" }, { type: "agent_end", messages: [] }, { type: "turn_start" },
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

test("工具结果里的图片：按 image 块提取，非图片与超大图跳过，张数有上限", () => {
  const png = { type: "image", data: "A".repeat(400), mimeType: "image/png" };
  const got = toolResultImages({ content: [{ type: "text", text: "Read image file" }, png] });
  assert.deepEqual(got, [{ data: png.data, mimeType: "image/png" }]);
  // 非图片块 / 非法 mime / 缺字段都不算
  assert.deepEqual(toolResultImages({ content: [{ type: "text", text: "x" }, { type: "image", data: "A", mimeType: "text/plain" }, { type: "image" }] }), []);
  // 张数上限
  const many = toolResultImages({ content: Array.from({ length: MAX_TOOL_IMAGES + 3 }, () => png) });
  assert.equal(many.length, MAX_TOOL_IMAGES);
  // 非数组内容安全返回空
  assert.deepEqual(toolResultImages("plain string"), []);
});

test("tool_execution_end 把图片带进事件（否则界面永远看不到 read 的图）", () => {
  const png = { type: "image", data: "A".repeat(400), mimeType: "image/png" };
  const event = toStreamEvent({
    type: "tool_execution_end", toolCallId: "c1", isError: false,
    result: { content: [{ type: "text", text: "Read image file [image/png]" }, png] },
  });
  assert.equal(event.type, "tool_result");
  assert.match(event.text, /Read image file/);
  assert.deepEqual(event.images, [{ data: png.data, mimeType: "image/png" }]);
});
