// 回合提示（Task 0006 B2 起，Task 0007 改判据）——lost 必须有原因，不能只剩"重新发送"按钮。
//
// 2026-11-03 契约变更（Task 0007）：`lostNoticeFor()` 改成 `turnNoticeOf({ outcome, busy })`。
// 变的是**接口**，理由是判据必须与"重新发送"按钮同源（用户实测：提示条说可以点重新发送、按钮不出现）。
// 因此本文件多了一组"提示与按钮必须一致"的用例——那是这次修改真正要守住的东西。
import { test } from "node:test";
import assert from "node:assert/strict";
import { outcomeOfTurn, turnNoticeOf } from "../frontend/src/turn-notice.ts";
import { resendPlan, turnOutcomeOfMessages } from "../frontend/src/resend.ts";

const user = (text) => ({ role: "user", text, blocks: [{ type: "text", text }] });
const asst = (text, stopReason) => ({
  role: "assistant", text, blocks: text === "" ? [] : [{ type: "text", text }],
  ...(stopReason === undefined ? {} : { stopReason }),
});

test("T53 最近回合 lost → 给出原因与重发引导；done/无回合 → 不给提示", async () => {
  const notice = turnNoticeOf({ outcome: outcomeOfTurn({ state: "lost" }), busy: false });
  assert.ok(notice && /未完成|中断/.test(notice.text), notice?.text);
  assert.ok(/重新发送/.test(notice.text));

  assert.equal(turnNoticeOf({ outcome: outcomeOfTurn({ state: "done" }), busy: false }), undefined);
  assert.equal(turnNoticeOf({ outcome: outcomeOfTurn(undefined), busy: false }), undefined);
});

test("outcomeOfTurn：只有 lost 是 lost，其余（done/running/未知）都按 done 处理", () => {
  assert.equal(outcomeOfTurn({ state: "lost" }), "lost");
  assert.equal(outcomeOfTurn({ state: "done" }), "done");
  assert.equal(outcomeOfTurn({ state: "running" }), "done");
  assert.equal(outcomeOfTurn(null), "done");
  assert.equal(outcomeOfTurn(undefined), "done");
});

// ── Task 0007：提示与按钮必须说同一件事 ────────────────────────────────────
test("生成中（busy）：提示**不提**重新发送 —— 因为按钮此时确实不出现", () => {
  const notice = turnNoticeOf({ outcome: "lost", busy: true });
  assert.ok(notice !== undefined);
  assert.ok(!/可以点「重新发送」/.test(notice.text), notice.text);
  // 同一 busy 下按钮确实不给
  assert.equal(resendPlan([user("hi"), asst("", "toolUse")], true), undefined);
});

test("空闲 + lost：提示提重新发送，且按钮一定在（用户报的那个 bug）", () => {
  const messages = [user("hi"), asst("定位本身完全正确", "toolUse")];
  const notice = turnNoticeOf({ outcome: turnOutcomeOfMessages(messages), busy: false });
  assert.ok(notice !== undefined && /可以点「重新发送」/.test(notice.text), notice?.text);
  assert.deepEqual(resendPlan(messages, false), { index: 0, text: "hi" }, "提示提按钮时按钮必须存在");
});

test("回归：stopReason=toolUse 且有正文 → 提示与按钮都是 lost（旧判据在这里判 done）", () => {
  const messages = [user("查一下"), asst("定位正确，但还要继续", "toolUse")];
  assert.equal(turnOutcomeOfMessages(messages), "lost");
  const notice = turnNoticeOf({ outcome: turnOutcomeOfMessages(messages), busy: false });
  assert.ok(notice !== undefined);
  assert.ok(resendPlan(messages, false) !== undefined);
});

test("正常完成（stop）：提示不出现，按钮也不出现", () => {
  const messages = [user("hi"), asst("好了", "stop")];
  assert.equal(turnNoticeOf({ outcome: turnOutcomeOfMessages(messages), busy: false }), undefined);
  assert.equal(resendPlan(messages, false), undefined);
});

test("一致性总则：任意 (messages, busy) 组合下，提示提「重新发送」⇔ 按钮存在", () => {
  const cases = [
    [[user("hi"), asst("好了", "stop")], false],
    [[user("hi"), asst("好了", "stop")], true],
    [[user("hi"), asst("", "error")], false],
    [[user("hi"), asst("", "error")], true],
    [[user("hi"), asst("有正文", "toolUse")], false],
    [[user("hi"), asst("有正文", "toolUse")], true],
    [[user("hi"), asst("", "aborted")], false],
    [[user("hi")], false],
    [[user("hi")], true],
  ];
  for (const [messages, busy] of cases) {
    const notice = turnNoticeOf({ outcome: turnOutcomeOfMessages(messages), busy });
    const mentionsRetry = notice !== undefined && /可以点「重新发送」/.test(notice.text);
    const hasButton = resendPlan(messages, busy) !== undefined;
    assert.equal(mentionsRetry, hasButton,
      `busy=${busy} 消息=${JSON.stringify(messages.map((m) => [m.role, m.stopReason]))} 提示提按钮=${mentionsRetry} 按钮存在=${hasButton}`);
  }
});
