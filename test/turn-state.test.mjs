// 回合终态的单一判据（Task 0007）。
//
// 背景：同一个问题"这一轮算不算失败"曾经有两份实现——后端 `src/turn-verdict.ts` 按 stopReason 终态判，
// 前端 `frontend/src/resend.ts` 按"尾部文本是否为空/带 error"猜。口径不一致时会同时出现
// "提示条说可以点重新发送、按钮不出现"（实测：stopReason=toolUse 且那轮有文本）与
// "提示条不提但按钮在"。本文件是唯一的判据，前后端都调它（先例：src/session-title.ts）。
//
// 判据本身不是新发明的，它照抄 `src/turn-verdict.ts` 原有的表（pi/packages/ai/src/types.ts:474）：
//   终态：stop / length / error / aborted
//   中间态：pending / toolUse / deferred
// 只有终态才代表这一轮结束；文件停在中间态 = 被中断。
import test from "node:test";
import assert from "node:assert/strict";
import { isStopTerminal, turnOutcomeOf } from "../src/turn-state.ts";

// ── isStopTerminal：终态 vs 中间态 ──────────────────────────────────────────
test("终态：stop / length / error / aborted 都是这一轮结束了", () => {
  for (const stop of ["stop", "length", "error", "aborted"]) {
    assert.equal(isStopTerminal(stop), true, stop);
  }
});

test("中间态：toolUse / pending / deferred 都还没结束（停在这里就是被中断）", () => {
  for (const stop of ["toolUse", "pending", "deferred"]) {
    assert.equal(isStopTerminal(stop), false, stop);
  }
});

test("无字段（老条目）不算终态，由调用方决定怎么兼容", () => {
  assert.equal(isStopTerminal(undefined), false);
  assert.equal(isStopTerminal(""), false);
});

// ── turnOutcomeOf：一轮的结局 ──────────────────────────────────────────────
test("没有 assistant 消息：lost（只有 user，没跑起来/被掐断）", () => {
  assert.equal(turnOutcomeOf({ sawAssistant: false }), "lost");
});

test("老条目没有 stopReason 字段：按完成处理（兼容既有文件，改前行为不变）", () => {
  assert.equal(turnOutcomeOf({ sawAssistant: true }), "done");
});

test("终态且正常结束：done", () => {
  for (const stop of ["stop", "length", "error"]) {
    assert.equal(turnOutcomeOf({ sawAssistant: true, lastStop: stop }), "done", stop);
  }
});

test("用户打断（aborted）：lost —— 中断不是完成", () => {
  assert.equal(turnOutcomeOf({ sawAssistant: true, lastStop: "aborted" }), "lost");
});

test("停在中间态（toolUse / pending / deferred）：lost —— 还要继续却没了", () => {
  for (const stop of ["toolUse", "pending", "deferred"]) {
    assert.equal(turnOutcomeOf({ sawAssistant: true, lastStop: stop }), "lost", stop);
  }
});

test("回归：stopReason=toolUse 的一轮即使有文本，也算 lost（用户实测的 bug）", () => {
  // 真实案例 coder/projects/workspace/sessions/2026-11-01T14-08-22-429Z_01a19770-...jsonl：
  // 尾部 assistant 有正文，但 stopReason=toolUse（未到终态）。旧前端判据 = "有文本 → 不算失败" → 不给按钮，
  // 而后端判 lost → 提示条说"可以点重新发送"。本判据必须让两边都判 lost。
  assert.equal(turnOutcomeOf({ sawAssistant: true, lastStop: "toolUse" }), "lost");
});
