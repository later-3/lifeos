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

test("耗时 = 墙钟合计（每轮 user.at → 该轮最后一条消息 at），不是 Σassistant.durationMs", () => {
  // 口径依据：pi-web upstream/main@f130910 `lib/turn-duration.ts` getTurnDurationMs
  //（起点=用户消息 timestamp，终点=最后一条 response/toolResult 的时间）。
  // 用户 2026-11-07 报"两个 bar 的时间不一样"，根因就是我们以前用 ΣdurationMs 当墙钟：
  // 一个含 sleep 6 的回合，墙钟 34417ms、ΣdurationMs 28323ms，差的正是工具执行（案例 C004）。
  const totals = sessionTotalsOf([
    { role: "user", at: 1_000 },
    { role: "assistant", at: 12_000, durationMs: 11_000 },
    { role: "assistant", at: 14_500, durationMs: 2_500 },
    { role: "user", at: 20_000 },
    { role: "assistant", at: 25_000 },        // 老会话没有 durationMs：墙钟仍可算
  ]);
  // 第一轮：1_000 → 14_500 = 13_500；第二轮：20_000 → 25_000 = 5_000
  assert.equal(totals.durationMs, 18_500);
});

test("墙钟包含工具执行时间（durationMs 不含它）", () => {
  // 真实形态：assistant 结束 → 工具跑 6 秒 → 下一条 assistant。墙钟必须把这 6 秒算进去。
  const totals = sessionTotalsOf([
    { role: "user", at: 0 },
    { role: "assistant", at: 3_000, durationMs: 3_000 },
    { role: "assistant", at: 12_000, durationMs: 3_000,
      blocks: [{ type: "toolCall", name: "bash", arguments: {}, resultAt: 9_000 }] },
  ]);
  assert.equal(totals.durationMs, 12_000, "墙钟 12 秒（含 6 秒工具），不是 6 秒模型时间");
});

test("没有时间戳的老会话：墙钟不编数字（算 0），也不抛错", () => {
  const totals = sessionTotalsOf([{ role: "user" }, { role: "assistant", durationMs: 5_000 }]);
  assert.equal(totals.durationMs, 0, "缺 at 就算不出来 —— 但 ΣdurationMs 仍可用于速度");
});

test("token 与平均速度来自后端 usage（输出 ÷ **纯模型**秒数，不是墙钟）", () => {
  // 速度的分母是模型时间：跑一次 sleep 20 不该让"模型多快"这个读数掉到 0.5 tok/s。
  const totals = sessionTotalsOf(
    [{ role: "user", at: 0 }, { role: "assistant", at: 30_000, durationMs: 10_000 }],
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

test("模型时间不足 1 秒不算平均速度（0.3 秒写 200 tokens 会算成 666 tok/s）", () => {
  const totals = sessionTotalsOf(
    [{ role: "user", at: 0 }, { role: "assistant", at: 20_000, durationMs: 300 }],
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

test("负数/NaN 的 durationMs 与缺失的 at 都不污染合计", () => {
  const totals = sessionTotalsOf([
    { role: "assistant", durationMs: -5 },
    { role: "assistant", durationMs: Number.NaN },
    { role: "assistant", durationMs: 2000 },
  ]);
  assert.equal(totals.durationMs, 0, "孤儿助手消息（前面没有 user）不构成一轮");
});
