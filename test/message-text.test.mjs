import test from "node:test";
import assert from "node:assert/strict";
import { copyTextOf } from "../frontend/src/message-text.ts";

test("只复制文本块：按出现顺序换行拼接，跳过思考与工具", () => {
  assert.equal(copyTextOf([
    { type: "text", text: "第一段" },
    { type: "thinking", text: "内部思考不该被复制" },
    { type: "toolCall", name: "ls" },
    { type: "text", text: "第二段" },
  ]), "第一段\n第二段");
});

test("没有文本块时为空（思考/工具不算消息内容）", () => {
  assert.equal(copyTextOf([{ type: "thinking", text: "想" }, { type: "toolCall", name: "read" }]), "");
});

test("去掉首尾空白", () => {
  assert.equal(copyTextOf([{ type: "text", text: "  有内容  " }]), "有内容");
});
