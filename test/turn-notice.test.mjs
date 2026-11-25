// 回合提示（Task 0006 B2 起，Task 0007 改判据，Task 0040 收紧"生成中"）。
//
// 2026-11-03 契约变更（Task 0007）：`lostNoticeFor()` 改成 `turnNoticeOf({ outcome, busy })`，
// 变的是**接口**，理由是判据必须与"重新发送"按钮同源（用户实测：提示条说可以点重新发送、按钮不出现）。
// 因此本文件多了一组"提示与按钮必须一致"的用例——那是这次修改真正要守住的东西。
//
// 2026-11-25 契约变更（Task 0040）：**busy 时不再输出任何结论**。
// 原因（实测 `evidence/probe-notice.out.txt`）：那句「正在生成中…（上一轮曾被中断，…）」的主语是
// 「上一轮」，而输入是 `turnOutcomeOfMessages()` = **正在跑的这一轮**；本轮尾段停在 `toolUse`（Pi 中间态），
// 与"被中断"同值 → 只要在跑且用过工具，这句就恒亮；连"刚发出第一句"都会被告知"上一轮曾被中断"。
// 所以现在 busy 时返回 undefined（生成中的动态状态由 SessionBar 的「当前回合」承担）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { outcomeOfTurn, turnNoticeOf } from "../frontend/src/api/turn-notice.ts";
import { resendPlan, turnOutcomeOfMessages } from "../frontend/src/api/resend.ts";

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

// ── Task 0040：生成中不写结论 ────────────────────────────────────────────────
test("T0040-16 生成中**不输出任何回合结论**（本轮结局还没产生，说了就是猜）", () => {
  for (const outcome of ["done", "lost"]) {
    assert.equal(turnNoticeOf({ outcome, busy: true }), undefined, outcome);
  }
});

test("T0040-17 回归：正在跑的一轮（尾段 toolUse）不再被说成「上一轮曾被中断」", () => {
  // 现场：这一轮 200 段工具调用，最后一段在跑 → stopReason=toolUse（中间态）→ 旧判据 = lost。
  // 旧实现 busy=true 时于是恒输出「正在生成中…（上一轮曾被中断，…）」，被用户截图 200 次。
  const running = [user("做事"), asst("", "toolUse"), asst("", "toolUse")];
  assert.equal(turnOutcomeOfMessages(running), "lost", "中间态本身仍算 lost（别的场景要用这个语义）");
  assert.equal(turnNoticeOf({ outcome: turnOutcomeOfMessages(running), busy: true }), undefined,
    "但生成中不把它当结论说出来");
});

test("T0040-18 回归：刚发出第一句（还没回复）不再被告知「上一轮曾被中断」", () => {
  const justSent = [user("你好")];
  assert.equal(turnOutcomeOfMessages(justSent), "lost", "只有 user → 未跑完（判据本身不变）");
  assert.equal(turnNoticeOf({ outcome: turnOutcomeOfMessages(justSent), busy: true }), undefined);
});

// ── Task 0007：提示与按钮必须说同一件事 ────────────────────────────────────
test("生成中（busy）：无结论，且按钮也不在（两者同为 absent）", () => {
  const messages = [user("hi"), asst("", "toolUse")];
  assert.equal(turnNoticeOf({ outcome: turnOutcomeOfMessages(messages), busy: true }), undefined);
  assert.equal(resendPlan(messages, true), undefined);
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

test("一致性总则：任意 (messages, busy) 组合下，提示提「重新发送」⇒ 按钮存在", () => {
  const cases = [
    [[user("hi"), asst("好了", "stop")], false],
    [[user("hi"), asst("好了", "stop")], true],
    [[user("hi"), asst("", "error")], false],
    [[user("hi"), asst("", "error")], true],
    [[user("hi"), asst("有正文", "toolUse")], false],
    [[user("hi"), asst("有正文", "toolUse")], true],
    [[user("hi"), asst("", "aborted")], false],
    [[user("hi"), asst("", "aborted")], true],
    [[user("hi")], false],
    [[user("hi")], true],
  ];
  for (const [messages, busy] of cases) {
    const notice = turnNoticeOf({ outcome: turnOutcomeOfMessages(messages), busy });
    const mentionsRetry = notice !== undefined && /可以点「重新发送」/.test(notice.text);
    const hasButton = resendPlan(messages, busy) !== undefined;
    // 方向是"提按钮 ⇒ 有按钮"。反向不必成立：`resendPlan` 只对**最后一条**用户消息给按钮，
    // 而提示判断的是"最后一条 assistant 的终态"——两者在"尾部是 user 但历史里有 lost 轮"这类
    // 夹具上可以不同向，那属于 resend 的既有语义，不是提示的缺陷。
    if (mentionsRetry) {
      assert.equal(hasButton, true,
        `busy=${busy} 消息=${JSON.stringify(messages.map((m) => [m.role, m.stopReason]))} 提示提按钮但按钮不在`);
    }
  }
});
