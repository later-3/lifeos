// 头部 task 段缓存的请求守卫（Task 0008）：锁住"每个 key 只请求一次"。
//
// 这些断言来自一次真实事故：`{"items":[]}` 的应答让页面 3 秒发了 2664 次 /tasks，
// 当天后端日志 96% 是这一个端点。测的不是"代码看起来对"，是"不会无限请求"。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTaskTitles, shouldRequest } from "../frontend/src/task-title-cache.ts";

test("没请求过的 key 要请求", () => {
  assert.equal(shouldRequest(new Set(), "a\u0000p\u00000008"), true);
});

test("请求过的 key 不再请求 —— 即使清单里没有它（死循环的根源）", () => {
  // 关键：请求成功后要记"这个 key 试过了"，而不是"缓存里有值了"。
  // 清单里没有该 taskId 时缓存永远补不上，用"有值"当守卫就是无限循环。
  const attempted = new Set(["a\u0000p\u00000008"]);
  assert.equal(shouldRequest(attempted, "a\u0000p\u00000008"), false);
});

test("不同 agent / 不同 project 的同号 Task 互不影响（C120：切 Agent 串标题）", () => {
  const attempted = new Set(["coder\u0000workspace\u00000008"]);
  assert.equal(shouldRequest(attempted, "lifeosagent\u0000workspace\u00000008"), true);
  assert.equal(shouldRequest(attempted, "coder\u0000lifeos\u00000008"), true);
});

test("合并清单：新 key 进缓存，已有 key 的标题不被覆盖", () => {
  const keys = (id) => `coder\u0000workspace\u0000${id}`;
  const merged = mergeTaskTitles(
    { "coder\u0000workspace\u00000001": "默认" },
    keys,
    [{ id: "0001", title: "被改过名字" }, { id: "0008", title: "批注面板展示逻辑优化" }],
  );
  assert.equal(merged["coder\u0000workspace\u00000001"], "默认", "已有标题更可信，不覆盖");
  assert.equal(merged["coder\u0000workspace\u00000008"], "批注面板展示逻辑优化");
});

test("空清单不产生新条目，也不清掉已有条目", () => {
  const before = { "coder\u0000workspace\u00000001": "默认" };
  const merged = mergeTaskTitles(before, (id) => id, []);
  assert.deepEqual(merged, before);
});
