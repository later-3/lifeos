/**
 * 会话累计事实的口径（Task 0008 · P3 修订）—— 纯函数单测。
 *
 * 用户 2026-11-05 要求 SessionBar 换成累计信息：轮次、工具调用、时间、token、平均速度。
 * 这些数字一旦口径漂，界面上没人看得出对错（"38 轮"到底数的是什么？），
 * 所以每条口径都锁在这里。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionTotalsOf } from "../frontend/src/session-totals.ts";

const tool = { type: "toolCall", id: "t", name: "read", arguments: {} };
const text = (s) => ({ type: "text", text: s });

test("轮次 = 用户消息条数（不是 assistant 条数，也不是 entry 数）", () => {
  const totals = sessionTotalsOf([
    { role: "user" },
    { role: "assistant", blocks: [text("a")] },
    { role: "assistant", blocks: [text("b")] },   // 一轮里的第二段
    { role: "user" },
    { role: "assistant", blocks: [text("c")] },
  ]);
  assert.equal(totals.turns, 2);
});

test("工具调用 = 所有 assistant 消息里的 toolCall 块合计", () => {
  const totals = sessionTotalsOf([
    { role: "user" },
    { role: "assistant", blocks: [tool, text("a")] },
    { role: "assistant", blocks: [tool, tool] },
    { role: "user" },
    { role: "assistant", blocks: [tool] },
  ]);
  assert.equal(totals.toolCalls, 4);
});

test("耗时 = 每条 assistant 的 durationMs 合计（不是墙钟跨度）", () => {
  const totals = sessionTotalsOf([
    { role: "user" },
    { role: "assistant", durationMs: 11_000 },
    { role: "assistant", durationMs: 2500 },
    { role: "user" },
    { role: "assistant" },                    // 老会话没有 durationMs：跳过，不当 0 计入
  ]);
  assert.equal(totals.durationMs, 13_500);
});

test("token 与平均速度来自后端 usage（输出 ÷ 生成秒数）", () => {
  const totals = sessionTotalsOf(
    [{ role: "user" }, { role: "assistant", durationMs: 10_000 }],
    { input: 1000, output: 500, totalTokens: 1500 },
  );
  assert.equal(totals.input, 1000);
  assert.equal(totals.output, 500);
  assert.equal(totals.tokens, 1500);
  // 500 tokens / 10 秒
  assert.equal(totals.avgTokPerSecond, 50);
});

test("没有 usage 就不编数字（token/速度留空，不写 0 tok/s）", () => {
  const totals = sessionTotalsOf([{ role: "user" }, { role: "assistant", durationMs: 10_000 }]);
  assert.equal(totals.tokens, 0);
  assert.equal(totals.avgTokPerSecond, undefined);
});

test("总耗时不足 1 秒不算平均速度（0.3 秒写 200 tokens 会算成 666 tok/s）", () => {
  const totals = sessionTotalsOf(
    [{ role: "user" }, { role: "assistant", durationMs: 300 }],
    { input: 100, output: 200, totalTokens: 300 },
  );
  assert.equal(totals.avgTokPerSecond, undefined);
});

test("空会话全是 0（不抛错、不出现 NaN）", () => {
  const totals = sessionTotalsOf([]);
  assert.deepEqual({ turns: totals.turns, toolCalls: totals.toolCalls, durationMs: totals.durationMs, tokens: totals.tokens },
    { turns: 0, toolCalls: 0, durationMs: 0, tokens: 0 });
  assert.equal(totals.avgTokPerSecond, undefined);
});

test("负数/NaN 的 durationMs 不计入（坏数据不能污染合计）", () => {
  const totals = sessionTotalsOf([
    { role: "assistant", durationMs: -5 },
    { role: "assistant", durationMs: Number.NaN },
    { role: "assistant", durationMs: 2000 },
  ]);
  assert.equal(totals.durationMs, 2000);
});
