import test from "node:test";
import assert from "node:assert/strict";
import { resendPlan } from "../frontend/src/resend.ts";

const user = (text) => ({ role: "user", text, blocks: [{ type: "text", text }] });
const assistant = (text, error) => ({
  role: "assistant", text, blocks: text === "" ? [] : [{ type: "text", text }],
  ...(error === undefined ? {} : { error }),
});

test("生成中不给重发（与动作条规则一致）", () => {
  assert.equal(resendPlan([user("hi"), assistant("", "boom")], true), undefined);
});

test("正常完成的一轮：没有重发", () => {
  assert.equal(resendPlan([user("hi"), assistant("你好")], false), undefined);
});

test("模型失败：动作挂在**用户消息**上（不是助手的错误提示），原因已在助手消息里就不再说一遍", () => {
  assert.deepEqual(resendPlan([user("hi"), assistant("", "Request timed out.")], false), { index: 0, text: "hi" });
});

test("空回复（进程被杀）：挂用户消息并带一句说明", () => {
  assert.deepEqual(resendPlan([user("hi"), assistant("")], false), { index: 0, text: "hi", note: "本轮没有回复（可能被中断）。" });
});

test("尾部是用户消息（整轮没落结果）：挂在这条用户消息上", () => {
  assert.deepEqual(resendPlan([user("hi")], false), { index: 0, text: "hi", note: "本轮没有回复（可能被中断）。" });
});

test("多轮对话：挂到**最后一条用户消息**，不是第一条", () => {
  const messages = [user("第一轮"), assistant("好"), user("第二轮"), assistant("", "boom")];
  assert.deepEqual(resendPlan(messages, false), { index: 2, text: "第二轮" });
});

test("多轮里最后一轮成功：不出现重发（历史失败不挂按钮）", () => {
  const messages = [user("第一轮"), assistant("", "boom"), user("第二轮"), assistant("好了")];
  assert.equal(resendPlan(messages, false), undefined);
});

test("没有用户消息 / 用户消息为空：不出现重发", () => {
  assert.equal(resendPlan([assistant("")], false), undefined);
  assert.equal(resendPlan([user("   ")], false), undefined);
  assert.equal(resendPlan([], false), undefined);
});
