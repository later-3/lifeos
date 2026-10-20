import test from "node:test";
import assert from "node:assert/strict";
import { toolState } from "../frontend/src/tool-state.ts";

test("有结果：成功=完成、isError=出错", () => {
  assert.equal(toolState({ hasResult: true, live: false }), "done");
  assert.equal(toolState({ hasResult: true, isError: true, live: false }), "error");
});

test("没有结果：这一轮还在跑=执行中；这一轮已结束=未完成（不能继续转圈）", () => {
  assert.equal(toolState({ hasResult: false, live: true }), "running");
  assert.equal(toolState({ hasResult: false, live: false }), "missing", "历史里没配到结果的调用不能显示执行中");
});
