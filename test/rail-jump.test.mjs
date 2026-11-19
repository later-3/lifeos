/**
 * 点击跳转的判定（Task 0020 · P4）。
 *
 * 三条结局穷举 + 边界。这一组断言的价值在于：**"点了没反应"是本功能最可能的失败形态**，
 * 而它不会报错、不会留日志，只表现为"用户点了，界面不动"。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  RAIL_JUMP_MAX_PAGES, railJumpFailureText, railJumpOf,
} from "../frontend/src/api/rail-jump.ts";

const order = ["u1", "a1", "u2", "a2", "u3", "a3"];

test("在渲染窗口里 → visible（直接滚）", () => {
  assert.deepEqual(railJumpOf("a3", order, 0), { kind: "visible" });
  assert.deepEqual(railJumpOf("u1", order, 0), { kind: "visible" });
});

test("在已下载但在渲染窗口之外 → inWindow（先放大窗口，再滚）", () => {
  assert.deepEqual(railJumpOf("u1", order, 4), { kind: "inWindow", index: 0 });
  assert.deepEqual(railJumpOf("a2", order, 4), { kind: "inWindow", index: 3 });
});

test("窗口起点恰好等于该下标 → visible（边界不误判成 inWindow）", () => {
  assert.deepEqual(railJumpOf("u3", order, 4), { kind: "visible" });
});

test("还没下载 → notLoaded（要先补取）", () => {
  assert.deepEqual(railJumpOf("nope", order, 0), { kind: "notLoaded" });
  assert.deepEqual(railJumpOf("u1", [], 0), { kind: "notLoaded" }, "空会话");
});

test("id 缺失的消息（客户端刚插入的那条）不会误命中", () => {
  const withUndefined = ["u1", undefined, "a1"];
  assert.deepEqual(railJumpOf("a1", withUndefined, 0), { kind: "visible" });
  assert.deepEqual(railJumpOf("", withUndefined, 0), { kind: "notLoaded" });
});

test("补取页数上限来自实测：最长会话 2290 条 entry / 200 每页 = 12 页，取 20 留余量", () => {
  assert.equal(RAIL_JUMP_MAX_PAGES, 20);
  assert.ok(RAIL_JUMP_MAX_PAGES * 200 > 2290, "上限必须覆盖最长会话");
});

test("四种失败原因各有各的文案，且都指向下一步动作", () => {
  const texts = (["cursor_not_found", "network", "page_limit", "no_more"]).map(railJumpFailureText);
  assert.equal(new Set(texts).size, 4, "四种原因不能共用一句话（那就等于没解释）");
  assert.match(texts[0], /压缩/, "游标失效要说清是压缩导致");
  assert.match(texts[1], /网络/, "网络失败要说网络");
  assert.match(texts[2], /完整历史/, "到上限要给出替代出路");
  assert.match(texts[3], /不在当前会话/);
  for (const text of texts) assert.equal(text.includes("找不到"), false, "不许用『找不到』糊住（api.md 2.3）");
});
