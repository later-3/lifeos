// 松手动作组合 selectionAction（Task 0018）的穷举测试：
// 设置（copyOnSelect 开/关）× 选区事实（可批注与否）→ 复制与否 + 弹条与否 + 按钮组合。
// 状态矩阵见任务 02-design.md §1（D7-D12）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectionAction } from "../src/copy-on-select.ts";

const base = { insideZone: true, collapsed: false, text: "一段话", inFormField: false };

test("无效选区（-zone/空选区/表单内/纯空白）→ 什么都不做", () => {
  for (const facts of [
    { ...base, insideZone: false, annotatable: true },
    { ...base, collapsed: true, annotatable: true },
    { ...base, inFormField: true, annotatable: true },
    { ...base, text: "   ", annotatable: true },
  ]) {
    const action = selectionAction(facts, { copyOnSelect: true });
    assert.deepEqual(action, { copyNow: false, showToolbar: false, toolbar: { copy: false, annotate: false, quote: false } }, JSON.stringify(facts));
  }
});

test("设置开：松手即复制 + 条上没有复制按钮（D8）", () => {
  const action = selectionAction({ ...base, annotatable: true }, { copyOnSelect: true });
  assert.equal(action.copyNow, true);
  assert.equal(action.showToolbar, true);
  assert.deepEqual(action.toolbar, { copy: false, annotate: true, quote: true });
});

test("设置开 + 不可批注选区：条上只有引用（批注按钮隐藏，D12）", () => {
  const action = selectionAction({ ...base, annotatable: false }, { copyOnSelect: true });
  assert.deepEqual(action.toolbar, { copy: false, annotate: false, quote: true });
});

test("设置关：不自动复制，条上有复制按钮（D9）；批注按事实、引用恒有", () => {
  const on = selectionAction({ ...base, annotatable: true }, { copyOnSelect: false });
  assert.equal(on.copyNow, false);
  assert.deepEqual(on.toolbar, { copy: true, annotate: true, quote: true });

  const off = selectionAction({ ...base, annotatable: false }, { copyOnSelect: false });
  assert.deepEqual(off.toolbar, { copy: true, annotate: false, quote: true });
});


test("流式生成中的选区：不弹功能条，复制链照常（0018 用户）", () => {
  // 开态：松手即复制照常、条不弹
  const on = selectionAction({ ...base, annotatable: false, inStreamingBlock: true }, { copyOnSelect: true });
  assert.equal(on.copyNow, true);
  assert.equal(on.showToolbar, false);
  // 关态：复制没有条入口（生成中的文字在变，Cmd+C 兜底）
  const off = selectionAction({ ...base, annotatable: true, inStreamingBlock: true }, { copyOnSelect: false });
  assert.equal(off.copyNow, false);
  assert.equal(off.showToolbar, false);
  // 非流式不受影响
  const idle = selectionAction({ ...base, annotatable: true, inStreamingBlock: false }, { copyOnSelect: true });
  assert.equal(idle.showToolbar, true);
});
