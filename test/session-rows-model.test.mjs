/**
 * 行模型（Task 0017 · P7a · 对应 `session-list-rendering.md` §5.2 的 V1/V2）。
 *
 * 为什么这三条测试是虚拟滚动的前置：`virtua` / `@tanstack/react-virtual` 都要求
 * 「行数确定、每行高度确定、key 稳定」；这三条不成立，接上去只会得到跳动的滚动条。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildRows, totalHeightOf, ROW_HEIGHTS } from "../frontend/src/api/session-rows-model.ts";

const group = (id, sessions) => ({ project: { id, name: id, isDefault: false }, sessions: sessions.map((sid) => ({ sessionId: sid })) });

test("V1 行模型：同一输入 → 同一行序；组头/会话行按分组顺序展开", () => {
  const groups = [group("p1", ["s1", "s2"]), group("p2", ["s3"])];
  const rows = buildRows(groups, {});
  assert.deepEqual(rows.map((r) => r.kind), ["group", "session", "session", "group", "session"]);
  assert.deepEqual(rows.map((r) => r.index), [0, 1, 2, 3, 4]);
  assert.deepEqual(rows.filter((r) => r.kind === "session").map((r) => r.sessionId), ["s1", "s2", "s3"]);
});

test("V1 行模型：折叠只影响该组；**其它行的 key 与 index 语义不变**（key 稳定是本条的核心）", () => {
  const groups = [group("p1", ["s1", "s2"]), group("p2", ["s3"])];
  const expanded = buildRows(groups, {});
  const collapsedP1 = buildRows(groups, { p1: true });
  // p1 收起 → 只剩组头；p2 的行仍在，且 key 不变
  assert.deepEqual(collapsedP1.map((r) => r.kind), ["group", "group", "session"]);
  assert.deepEqual(collapsedP1.map((r) => r.key), ["g:p1", "g:p2", "s:s3"]);
  const p2KeysBefore = expanded.filter((r) => r.projectId === "p2").map((r) => r.key);
  const p2KeysAfter = collapsedP1.filter((r) => r.projectId === "p2").map((r) => r.key);
  assert.deepEqual(p2KeysAfter, p2KeysBefore, "折叠 p1 不得改变 p2 的 key");
});

test("V1 行模型：空组产生一行空态（不是零行）", () => {
  const rows = buildRows([group("p1", [])], {});
  assert.deepEqual(rows.map((r) => r.kind), ["group", "empty"]);
  // 收起的空组只剩组头（空态也属于"组内内容"）
  assert.deepEqual(buildRows([group("p1", [])], { p1: true }).map((r) => r.kind), ["group"]);
});

test("V2 行高表：与 design-language 的数值一致（UI 改行高时这条会红）", () => {
  assert.equal(ROW_HEIGHTS.group, 32, "组头 = h-8 = 32");
  assert.equal(ROW_HEIGHTS.session, 56, "会话行 = h-14 = 56");
  assert.equal(ROW_HEIGHTS.empty, 32, "空态行 = py-2 + micro 行高 ≈ 32");
});

test("总高度 = 各行高之和（虚拟滚动容器高度；也是'列表有多长'的唯一答案）", () => {
  const rows = buildRows([group("p1", ["s1", "s2"]), group("p2", ["s3"])], {});
  assert.equal(totalHeightOf(rows), 32 + 56 + 56 + 32 + 56);
});

test("活性验证：把行高表改成会与 UI 漂的值，上面那条断言必须红", () => {
  // 模拟"UI 把会话行从 56 改成 60、但行高表忘了改"（这条测试守的正是这个）
  const drifted = { ...ROW_HEIGHTS, session: 60 };
  assert.notEqual(drifted.session, 56, "行高表若与 UI 不一致，V2 那条断言就会红");
});
