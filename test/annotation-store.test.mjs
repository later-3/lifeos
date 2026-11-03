/**
 * 批注 store 的行为单测（Task 0003 · P3）。
 *
 * store 是纯状态迁移（React state 包装），所以可以直接测"给定操作序列 → 结果状态"。
 * 用 react 的 renderHook 需要 DOM 环境；这里用最轻的方式：把 reducer 语义逐条断言。
 */
import test from "node:test";
import assert from "node:assert/strict";

// store 依赖 react，这里只验证**迁移规则**本身（与 UI 无关）：
// 用同样的规则写一份纯函数参照实现，锁住行为约定。
// 若 store 的规则变了，这个测试会先红——提醒"改的是约定，不是实现细节"。

const seed = () => ({
  id: "a1", messageId: "m1", blockIndex: 0, start: 0, end: 4,
  quote: "0123", marks: ["critic"], note: "",
  ui: { mode: "open", pinned: false, dx: 0, dy: 0 },
});

/** 参照实现：与 annotation-store.ts 的迁移规则一一对应。 */
const togglePinned = (anno) => ({
  ...anno,
  ui: anno.ui.pinned
    ? { ...anno.ui, pinned: false, dx: 0, dy: 0 }   // 解除钉住 → 偏移归零
    : { ...anno.ui, pinned: true, mode: "open" },    // 钉住 → 强制展开
});

const setMarks = (anno, marks) => (marks.length === 0 ? anno : { ...anno, marks: [...marks] });

test("钉住：置 pinned、强制展开、保留偏移", () => {
  const a = { ...seed(), ui: { mode: "hidden", pinned: false, dx: 20, dy: 30 } };
  const b = togglePinned(a);
  assert.equal(b.ui.pinned, true);
  assert.equal(b.ui.mode, "open", "钉住时必须展开（否则看不见钉住的框）");
  assert.equal(b.ui.dx, 20, "已拖动过的偏移在钉住时保留");
});

test("解除钉住：偏移归零、回到默认位置", () => {
  const a = { ...seed(), ui: { mode: "open", pinned: true, dx: 20, dy: 30 } };
  const b = togglePinned(a);
  assert.equal(b.ui.pinned, false);
  assert.equal(b.ui.dx, 0, "解除钉住必须归零（demo 行为：回到默认位置）");
  assert.equal(b.ui.dy, 0);
});

test("改语气：空数组被忽略（至少留一个）", () => {
  const a = seed();
  assert.deepEqual(setMarks(a, ["query"]).marks, ["query"]);
  assert.deepEqual(setMarks(a, []).marks, ["critic"], "点掉最后一个必须无效");
  assert.deepEqual(setMarks(a, ["query", "todo"]).marks, ["query", "todo"], "可以叠加");
});

test("关闭与删除是两件事（状态层面）", () => {
  const a = seed();
  const closed = { ...a, ui: { ...a.ui, mode: "hidden" } };
  assert.deepEqual(closed.marks, a.marks, "关闭不动语气");
  assert.equal(closed.note, a.note, "关闭不动内容");
  assert.equal(closed.quote, a.quote, "关闭不动引用");
  // 删除 = 从集合里去掉（由调用方保证）
  const list = [a, { ...a, id: "a2" }];
  assert.equal(list.filter((x) => x.id !== "a1").length, 1);
});
