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

test("模型失败：重发挂在最后那条 assistant 上，原因已在气泡里就不再说一遍", () => {
  assert.deepEqual(resendPlan([user("hi"), assistant("", "Request timed out.")], false), { index: 1, text: "hi" });
});

test("空回复（进程被杀）：挂在 assistant 上并带一句说明", () => {
  assert.deepEqual(resendPlan([user("hi"), assistant("")], false), { index: 1, text: "hi", note: "本轮没有回复（可能被中断）。" });
});

test("尾部是用户消息（整轮没落结果）：挂在用户这条消息上", () => {
  assert.deepEqual(resendPlan([user("hi")], false), { index: 0, text: "hi", note: "本轮没有回复（可能被中断）。" });
});

test("没有用户消息 / 用户消息为空：不出现重发", () => {
  assert.equal(resendPlan([assistant("")], false), undefined);
  assert.equal(resendPlan([user("   ")], false), undefined);
  assert.equal(resendPlan([], false), undefined);
});
