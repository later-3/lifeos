/**
 * ResponseBar 展开态规则（Task 0008 · P3）—— 纯函数单测。
 *
 * 用户 2026-11-04 定案："只要用户折叠了，那就是一直折叠，展开了一直展开，对于一个 session……
 * 不要一会儿是展开的一会儿是关闭的，没有做状态管理。"
 *
 * 所以规则只有三条，且 `folded` 必须**压过** live（这是 P3 前的老 bug：live 会强制展开，
 * 用户点了也白点）。界面上靠 frontend/test/response-bar.mjs 验，这里锁规则本身。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { processOpenOf } from "../frontend/src/response-fold.ts";

test("用户没点过：按 live（生成中展开、结束后折叠）", () => {
  assert.equal(processOpenOf(undefined, true), true);
  assert.equal(processOpenOf(undefined, false), false);
});

test("用户点开过：一直展开，即使已经不在生成", () => {
  assert.equal(processOpenOf("open", false), true);
  assert.equal(processOpenOf("open", true), true);
});

test("用户折叠过：一直折叠，**生成中也不强制展开**（老 bug 的回归点）", () => {
  assert.equal(processOpenOf("folded", true), false);
  assert.equal(processOpenOf("folded", false), false);
});
