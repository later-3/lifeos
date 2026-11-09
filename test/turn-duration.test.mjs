/**
 * 一轮的耗时口径（Task 0015 · P4）—— 纯函数单测。
 *
 * 用户 2026-11-07 报："两个 bar 里面的时间统计看起来不是一样的呢？"——实测确实是两个口径：
 * SessionBar 用服务端 startedAt（墙钟），ResponseBar 用组件挂载时刻。
 * 更糟的是"耗时"本身用 Σassistant.durationMs，那是**纯模型时间**，不含工具执行
 *（Pi 官方 `pi/packages/ai/src/types.ts:616-624`），于是"跑的时候 20s、结束后 11 秒"。
 *
 * 本文件锁住**唯一**的口径：
 *  - 墙钟 = 用户消息 at → 该轮最后一条消息（含 toolResult 的 resultAt）；
 *  - 模型时间 = Σassistant.durationMs，只给速度当分母；
 *  - 进行中与完成后用**同一个锚点**，所以数字不会往回跳。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lastUserAtMs, turnModelMsOf, turnWallMsOf } from "../frontend/src/turn-duration.ts";

const span = (userIndex, ...replies) => ({ userIndex, replyIndexes: replies });

test("墙钟：用户消息 → 本轮最后一条消息（含工具执行）", () => {
  // 与 pi-web upstream/main@f130910 `lib/turn-duration.ts` 的 getTurnDurationMs 同语义
  const messages = [
    { role: "user", at: 1_000 },
    { role: "assistant", at: 12_000, durationMs: 11_000 },
    { role: "assistant", at: 14_500, durationMs: 2_500 },
  ];
  assert.equal(turnWallMsOf(messages, span(0, 1, 2)), 13_500);
});

test("墙钟包含工具执行时间：工具结果的 resultAt 是最晚终点", () => {
  const messages = [
    { role: "user", at: 0 },
    { role: "assistant", at: 3_000, durationMs: 3_000,
      blocks: [{ type: "toolCall", name: "bash", arguments: {}, resultAt: 9_000 }] },
    { role: "assistant", at: 12_000, durationMs: 3_000 },
  ];
  // 工具在 9s 结束，最后一条 assistant 在 12s 结束 → 墙钟 12s（不是 6s 模型时间）
  assert.equal(turnWallMsOf(messages, span(0, 1, 2)), 12_000);
  assert.equal(turnModelMsOf(messages, span(0, 1, 2)), 6_000, "模型时间不含工具");
});

test("进行中：终点取 now（与完成后同一个锚点，数字不往回跳）", () => {
  const messages = [
    { role: "user", at: 1_000 },
    { role: "assistant", at: 5_000, durationMs: 4_000 },
  ];
  const inProgress = turnWallMsOf(messages, span(0, 1), 8_000);
  const finished = turnWallMsOf(messages, span(0, 1));
  assert.equal(inProgress, 7_000, "进行中 = now - user.at");
  assert.equal(finished, 4_000, "完成后 = 最后一条消息 at - user.at");
  // 两者只差"最后这一段的尾巴"，不会出现 20s → 11s 这种回跳
  assert.ok(finished <= inProgress);
});

test("只属于这一轮：下一条用户消息之后的时间不算进来", () => {
  const messages = [
    { role: "user", at: 1_000 },
    { role: "assistant", at: 4_000, durationMs: 3_000 },
    { role: "user", at: 60_000 },
    { role: "assistant", at: 63_000, durationMs: 3_000 },
  ];
  assert.equal(turnWallMsOf(messages, span(0, 1)), 3_000, "第一轮只到 4s");
  assert.equal(turnWallMsOf(messages, span(2, 3)), 3_000, "第二轮从那句用户消息起算");
});

test("缺时间戳（老会话）返回 undefined，不编数字", () => {
  const messages = [{ role: "user" }, { role: "assistant", at: 4_000, durationMs: 3_000 }];
  assert.equal(turnWallMsOf(messages, span(0, 1)), undefined, "无锚点时间就算不出来");
  assert.equal(turnModelMsOf(messages, span(0, 1)), 3_000, "模型时间仍可用（速度分母）");
});

test("孤儿助手消息（前面没有 user）不算一轮", () => {
  const messages = [{ role: "assistant", at: 4_000, durationMs: 3_000 }];
  assert.equal(turnWallMsOf(messages, span(-1, 0)), undefined);
});

test("lastUserAtMs：取最后一条用户消息的时间（进行中那一轮的锚点）", () => {
  assert.equal(lastUserAtMs([
    { role: "user", at: 1_000 },
    { role: "assistant", at: 4_000 },
    { role: "user", at: 9_000 },
    { role: "assistant", at: 12_000 },
  ]), 9_000);
  assert.equal(lastUserAtMs([{ role: "assistant", at: 5_000 }]), undefined);
  assert.equal(lastUserAtMs([]), undefined);
});
