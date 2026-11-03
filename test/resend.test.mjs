// "重新发送"的挂载位置（渲染决策）：动作挂在**被重发的那条用户消息**上。
//
// 2026-11-03 改（Task 0007）：**是否算失败**不再由本文件判定（旧实现看"尾部文本是否为空/带 error"），
// 改为只看 `turnOutcomeOf()`（`src/turn-state.ts`，与后端 `src/turn-verdict.ts` 共用）。
// 因此本文件的用例都显式给出 `stopReason`——那是唯一判据的输入。
// 判据本身的用例在 `test/turn-state.test.mjs`；提示与按钮一致性在 `test/turn-notice.test.mjs`。
import test from "node:test";
import assert from "node:assert/strict";
import { resendPlan } from "../frontend/src/resend.ts";

const user = (text) => ({ role: "user", text, blocks: [{ type: "text", text }] });
/** 显式给 stopReason：这是"这一轮算不算失败"的唯一输入（Task 0007）。 */
const assistant = (text, stopReason = "stop") => ({
  role: "assistant", text, blocks: text === "" ? [] : [{ type: "text", text }], stopReason,
});

test("生成中不给重发（与动作条规则一致）", () => {
  assert.equal(resendPlan([user("hi"), assistant("", "error")], true), undefined);
});

test("正常完成的一轮：没有重发", () => {
  assert.equal(resendPlan([user("hi"), assistant("你好", "stop")], false), undefined);
});

test("模型失败（stopReason=error 但这一轮结束了）：不算 lost，不给重发", () => {
  // 语义澄清（Task 0007）：error 是**终态**，这一轮有结论地结束了；失败原因已在助手消息里显示。
  // "重新发送"针对的是**没跑完**的回合（lost），不是"跑完但失败了"。
  assert.equal(resendPlan([user("hi"), assistant("", "error")], false), undefined);
});

test("被中断（aborted）：给重发，动作挂在**用户消息**上", () => {
  assert.deepEqual(resendPlan([user("hi"), assistant("", "aborted")], false), { index: 0, text: "hi" });
});

test("停在中间态（toolUse）：给重发 —— 还要继续却没了", () => {
  assert.deepEqual(resendPlan([user("hi"), assistant("", "toolUse")], false), { index: 0, text: "hi" });
});

test("回归：toolUse 但那一轮**有正文**，仍然给重发（旧判据在这里不给，正是用户报的 bug）", () => {
  assert.deepEqual(resendPlan([user("hi"), assistant("定位正确但工具没回来", "toolUse")], false),
    { index: 0, text: "hi" });
});

test("尾部是用户消息（整轮没落结果）：挂在这条用户消息上", () => {
  assert.deepEqual(resendPlan([user("hi")], false), { index: 0, text: "hi" });
});

test("多轮对话：挂到**最后一条用户消息**，不是第一条", () => {
  const messages = [user("第一轮"), assistant("好", "stop"), user("第二轮"), assistant("", "aborted")];
  assert.deepEqual(resendPlan(messages, false), { index: 2, text: "第二轮" });
});

test("多轮里最后一轮成功：不出现重发（历史失败不挂按钮）", () => {
  const messages = [user("第一轮"), assistant("", "aborted"), user("第二轮"), assistant("好了", "stop")];
  assert.equal(resendPlan(messages, false), undefined);
});

test("没有用户消息 / 用户消息为空：不出现重发", () => {
  assert.equal(resendPlan([assistant("", "aborted")], false), undefined);
  assert.equal(resendPlan([user("   ")], false), undefined);
  assert.equal(resendPlan([], false), undefined);
});

test("取的是**最后一条** assistant 的终态：中途 toolUse、末尾 stop → 不给重发", () => {
  const messages = [user("hi"), assistant("", "toolUse"), assistant("完成", "stop")];
  assert.equal(resendPlan(messages, false), undefined);
});
