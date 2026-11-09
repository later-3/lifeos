import test from "node:test";
import assert from "node:assert/strict";
import { compactTokens, elapsedSeconds, retryRemainingSeconds, TURN_STEP_TOTAL, turnStepText } from "../frontend/src/working.ts";

test("重试倒计时：逐秒减少，到底夹到 0（不出现负数）", () => {
  assert.equal(retryRemainingSeconds(4000, 0), 4);
  assert.equal(retryRemainingSeconds(4000, 1000), 3);
  assert.equal(retryRemainingSeconds(4000, 3900), 1);
  assert.equal(retryRemainingSeconds(4000, 4000), 0);
  assert.equal(retryRemainingSeconds(4000, 9000), 0, "超过等待时间也不显示负数");
});

test("一轮固定 4 个大步骤，工具调用不另起步骤", () => {
  assert.equal(TURN_STEP_TOTAL, 4);
  assert.equal(turnStepText(1), "1/4 · 发送消息");
  assert.equal(turnStepText(2), "2/4 · 受理请求");
  assert.equal(turnStepText(3), "3/4 · 模型处理");
  assert.equal(turnStepText(4), "4/4 · 完成");
});

test("token 数字保持短，不挤占状态条", () => {
  assert.equal(compactTokens(999), "999");
  assert.equal(compactTokens(1200), "1.2k");
  assert.equal(compactTokens(12_400), "12k");
  assert.equal(compactTokens(1_200_000), "1.2M");
});

test("本轮已用秒数：从本轮开始时刻算（切会话不归零），时钟回拨夹到 0", () => {
  const start = Date.parse("2026-11-07T10:00:00.000Z");
  assert.equal(elapsedSeconds(start, start), 0);
  assert.equal(elapsedSeconds(start, start + 7_400), 7, "7.4 秒 → 7 秒（四舍五入到秒）");
  assert.equal(elapsedSeconds(start, start + 60_000), 60);
  assert.equal(elapsedSeconds(start, start - 5_000), 0, "时钟回拨不显示负数");
});
