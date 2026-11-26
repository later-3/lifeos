// 压缩事件映射（Task 0041 · P2 / S4）。纯函数，不依赖真模型。
//
// 事件形状取自 Pi 的 `AgentSessionEvent`（`agent-session.d.ts:62-82`）：
//   { type: "compaction_start", reason: "manual" | "threshold" | "overflow" }
//   { type: "compaction_end", reason, result: CompactionResult | undefined,
//     aborted: boolean, willRetry: boolean, errorMessage?: string }
//
// 活性：把 toStreamEvent 里的这两个分支删掉，本文件必须全红。
import assert from "node:assert/strict";
import test from "node:test";
import { toStreamEvent } from "../src/stream-events.ts";

test("compaction_start：三种 reason 都映射成 phase=start", () => {
  for (const reason of ["manual", "threshold", "overflow"]) {
    const got = toStreamEvent({ type: "compaction_start", reason });
    assert.deepEqual(
      got,
      { type: "compaction", phase: "start", reason, ...(reason === "overflow" ? { overflow: true } : {}) },
      `reason=${reason}`,
    );
  }
});

test("compaction_start：overflow 带上 overflow 标记（界面要区分“前面已经出过问题”）", () => {
  const got = toStreamEvent({ type: "compaction_start", reason: "overflow" });
  assert.equal(got.overflow, true);
  const normal = toStreamEvent({ type: "compaction_start", reason: "threshold" });
  assert.equal(normal.overflow, undefined);
});

test("compaction_start：未知 reason 不猜，返回 undefined", () => {
  assert.equal(toStreamEvent({ type: "compaction_start", reason: "unknown" }), undefined);
  assert.equal(toStreamEvent({ type: "compaction_start" }), undefined);
  assert.equal(toStreamEvent({ type: "compaction_start", reason: 42 }), undefined);
});

test("compaction_end：成功（有 result）→ ok=true，并带 tokensBefore", () => {
  const got = toStreamEvent({
    type: "compaction_end",
    reason: "threshold",
    result: { summary: "## Goal...", firstKeptEntryId: "abc", tokensBefore: 902829, estimatedTokensAfter: 23000 },
    aborted: false,
    willRetry: false,
  });
  assert.deepEqual(got, {
    type: "compaction",
    phase: "end",
    reason: "threshold",
    ok: true,
    aborted: false,
    tokensBefore: 902829,
  });
});

test("compaction_end：失败（result 为 undefined，带 errorMessage）→ ok=false + 原因", () => {
  const got = toStreamEvent({
    type: "compaction_end",
    reason: "overflow",
    result: undefined,
    aborted: false,
    willRetry: false,
    errorMessage: "Summarization failed: generation hit the token cap and the summary is incomplete",
  });
  assert.deepEqual(got, {
    type: "compaction",
    phase: "end",
    reason: "overflow",
    ok: false,
    aborted: false,
    errorMessage: "Summarization failed: generation hit the token cap and the summary is incomplete",
  });
});

test("compaction_end：被中止 → aborted=true、ok=false、不报错（中止不是失败）", () => {
  const got = toStreamEvent({
    type: "compaction_end",
    reason: "manual",
    result: undefined,
    aborted: true,
    willRetry: false,
  });
  assert.deepEqual(got, {
    type: "compaction",
    phase: "end",
    reason: "manual",
    ok: false,
    aborted: true,
  });
  // 中止时不应有 errorMessage（否则界面会报一个不存在的错误）
  assert.equal(got.errorMessage, undefined);
});

test("compaction_end：空白 errorMessage 不当作原因（不把空串显示给用户）", () => {
  const got = toStreamEvent({
    type: "compaction_end",
    reason: "threshold",
    result: undefined,
    aborted: false,
    willRetry: false,
    errorMessage: "   ",
  });
  assert.equal(got.errorMessage, undefined);
  assert.equal(got.ok, false);
});

test("compaction_end：result 存在但 aborted 也为 true 时，以 aborted 为准（ok=false）", () => {
  // Pi 的契约里这两者互斥，但防御性处理：aborted 优先，避免把一次中止报成成功
  const got = toStreamEvent({
    type: "compaction_end",
    reason: "threshold",
    result: { tokensBefore: 100 },
    aborted: true,
    willRetry: false,
  });
  assert.equal(got.ok, false);
  assert.equal(got.aborted, true);
});

test("compaction_end：tokensBefore 非法时不带这个字段（不显示 NaN）", () => {
  for (const bad of [undefined, null, -1, "902829", Number.NaN, Number.POSITIVE_INFINITY]) {
    const got = toStreamEvent({
      type: "compaction_end",
      reason: "threshold",
      result: { tokensBefore: bad },
      aborted: false,
      willRetry: false,
    });
    assert.equal(got.tokensBefore, undefined, `tokensBefore=${String(bad)}`);
  }
});

test("compaction_end：未知 reason 不猜，返回 undefined", () => {
  assert.equal(toStreamEvent({ type: "compaction_end", reason: "bogus", aborted: false }), undefined);
});

test("不回归：其他事件仍然正常（压缩分支没吃掉别的类型）", () => {
  assert.deepEqual(toStreamEvent({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 100, errorMessage: "x" }),
    { type: "retrying", attempt: 1, maxAttempts: 3, delayMs: 100, message: "x" });
  assert.equal(toStreamEvent({ type: "auto_retry_end", success: true, attempt: 1 }).type, "retry_end");
  assert.equal(toStreamEvent({ type: "agent_end" }), undefined);
});

test("不回归：工具执行事件仍按原路径映射", () => {
  const start = toStreamEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { path: "a" } });
  assert.deepEqual(start, { type: "tool_start", id: "c1", name: "read", arguments: { path: "a" } });
  const end = toStreamEvent({
    type: "tool_execution_end", toolCallId: "c1", toolName: "read", isError: false,
    result: { content: [{ type: "text", text: "hi" }] }, durationMs: 5,
  });
  assert.equal(end.type, "tool_result");
  assert.equal(end.id, "c1");
  assert.equal(end.isError, false);
  assert.equal(end.text, "hi");
});
