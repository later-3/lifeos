// T16/T17：终态守卫必须"只认当前回合"，且不能把真完成挡掉（C119）
import { test } from "node:test";
import assert from "node:assert/strict";
import { busyBelongsTo, isStaleTerminal } from "../frontend/src/event-guards.ts";

test("T16 旧回合的 done 不得关闭当前回合（turnId 不匹配 → 丢弃）", async () => {
  assert.equal(isStaleTerminal("turn-old", "turn-current"), true);
});

test("T17 当前回合的 done / 无 turnId 的旧数据：必须放行（防过度修正）", async () => {
  assert.equal(isStaleTerminal("turn-current", "turn-current"), false);
  assert.equal(isStaleTerminal(undefined, "turn-current"), false);
  assert.equal(isStaleTerminal("turn-current", null), false);
});

test("T21 busy 归属：切到别的会话后，旧 busy 不得对账新会话", async () => {
  assert.equal(busyBelongsTo("session-a", "session-b"), false);
  assert.equal(busyBelongsTo("session-a", "session-a"), true);
  assert.equal(busyBelongsTo(undefined, "session-a"), false);
  assert.equal(busyBelongsTo("session-a", undefined), false);
});
