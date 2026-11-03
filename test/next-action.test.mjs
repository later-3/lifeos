// 「接下来能做什么」的判据（Task 0007 · 阶段一 C+D）。
//
// 这张表就是需求里确认过的 14 个场景。每个用例都标了依据，不是凭感觉定的。
import test from "node:test";
import assert from "node:assert/strict";
import { nextActionOf } from "../src/next-action.ts";
import { resendPlan as resendPlanForTest } from "../frontend/src/resend.ts";

const at = (outcome, failure) => nextActionOf({ outcome, ...(failure === undefined ? {} : { failure }) });

// ── 没跑完（lost）：重发是唯一恢复手段 ──────────────────────────────────────
test("lost + 无 failure（进程死/断线/只有 user）：给重发", () => {
  assert.deepEqual(at("lost", undefined), { kind: "resend", reason: "turn-lost" });
});

test("lost + toolUse（工具跑到一半）归入 turn-lost：给重发", () => {
  // turn-verdict 把 toolUse/pending/deferred 都判成 lost；failure 可能为空
  assert.deepEqual(at("lost", undefined), { kind: "resend", reason: "turn-lost" });
});

test("lost + aborted（用户自己打断）：仍给重发，但理由不同", () => {
  assert.deepEqual(at("lost", "aborted"), { kind: "resend", reason: "user-aborted" });
});

test("lost + 网络错误：给重发（先恢复，再谈错误类型）", () => {
  assert.deepEqual(at("lost", "network"), { kind: "resend", reason: "turn-lost" });
});

// ── 跑完了、没失败：不给动作 ───────────────────────────────────────────────
test("done + 无 failure（正常完成，stopReason=stop）：不给动作", () => {
  assert.deepEqual(at("done", undefined), { kind: "none" });
});

// ── 跑完了但失败：能救的给重发（Pi 已重试 3 次仍失败） ─────────────────────
test("done + network：给重发（Pi 判可重试，短退避扛不住长断网）", () => {
  assert.deepEqual(at("done", "network"), { kind: "resend", reason: "retries-exhausted" });
});

test("done + timeout：给重发", () => {
  assert.deepEqual(at("done", "timeout"), { kind: "resend", reason: "retries-exhausted" });
});

test("done + server（5xx/503）：给重发", () => {
  assert.deepEqual(at("done", "server"), { kind: "resend", reason: "retries-exhausted" });
});

test("done + rate_limit（429）：给重发（限流有窗口）", () => {
  assert.deepEqual(at("done", "rate_limit"), { kind: "resend", reason: "retries-exhausted" });
});

test("done + empty（重试 3 次仍空）：给重发", () => {
  assert.deepEqual(at("done", "empty"), { kind: "resend", reason: "retries-exhausted" });
});

test("done + unknown：给重发（判不出来时宁可让用户试一次，不要没有出口）", () => {
  assert.deepEqual(at("done", "unknown"), { kind: "resend", reason: "retries-exhausted" });
});

// ── 跑完了但失败：重发一定没用的三类，给可执行出口 ─────────────────────────
test("done + auth（401）：不给重发，给「检查 API key」", () => {
  assert.deepEqual(at("done", "auth"), { kind: "fix", fix: "fix-auth", reason: "not-retryable" });
});

test("done + quota（额度耗尽）：不给重发，给「换模型/充值」", () => {
  // Pi 的 NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN（retry.ts:7-28）明确不重试这一类
  assert.deepEqual(at("done", "quota"), { kind: "fix", fix: "fix-quota", reason: "not-retryable" });
});

test("done + payload_too_large（413）：不给重发，给「删图片/新建会话」", () => {
  assert.deepEqual(at("done", "payload_too_large"), { kind: "fix", fix: "fix-payload", reason: "not-retryable" });
});

// ── 截断：这一轮正常结束了，重发会再撞同一个上限 ───────────────────────────
test("done + truncated（max tokens）：不给动作（重发会再撞上限）", () => {
  assert.deepEqual(at("done", "truncated"), { kind: "none" });
});

// ── 不变量：任何组合都有确定结果（不抛、不返回 undefined） ──────────────────
test("穷举：所有 (outcome, failure) 组合都有确定结果", () => {
  const outcomes = ["done", "lost"];
  const failures = [
    undefined, "aborted", "truncated", "empty", "timeout", "network",
    "auth", "rate_limit", "quota", "server", "payload_too_large", "unknown",
  ];
  for (const outcome of outcomes) {
    for (const failure of failures) {
      const result = at(outcome, failure);
      assert.ok(result !== undefined && typeof result.kind === "string",
        `${outcome}/${String(failure)} 没有结果`);
      if (result.kind === "fix") assert.ok(typeof result.fix === "string");
    }
  }
});

test("不变量：lost 一律给重发（任何 failure 下都不能让用户无路可走）", () => {
  const failures = [
    undefined, "aborted", "truncated", "empty", "timeout", "network",
    "auth", "rate_limit", "quota", "server", "payload_too_large", "unknown",
  ];
  for (const failure of failures) {
    assert.equal(at("lost", failure).kind, "resend", `lost/${String(failure)} 必须给重发`);
  }
});

// ── Task 0007 · A2：Esc 在重试中只取消重试（判据侧） ─────────────────────────
test("A2 判据：重试期间（busy）不给重发按钮 —— 用户此刻的出口是 Esc 取消重试", () => {
  // 这一条锁住"重试中"的界面契约：按钮不出现（resendPlan busy → undefined），
  // 而 Esc 只取消重试、不打断整轮（前端 stop() 在 retry !== undefined 时走 /retry/abort）。
  // 端到端验证需要真实的 auto_retry 事件，见 log.md 的"待用户实测"。
  const messages = [
    { role: "user", text: "hi", blocks: [] },
    { role: "assistant", text: "", blocks: [], stopReason: "error", failure: "network" },
  ];
  assert.equal(resendPlanForTest(messages, true), undefined, "重试中不给按钮");
  assert.deepEqual(resendPlanForTest(messages, false), { index: 0, text: "hi" }, "结束后给按钮");
});

