/**
 * 批注框的纯逻辑单测（Task 0003 · P3）。
 *
 * 这里只测**能脱离 DOM 的部分**（位置计算、store 的状态迁移）。
 * 真实交互（拖选、悬停、拖动、关闭/删除）靠 Playwright 手测 + ui-contract，
 * 因为它们的正确性依赖真实布局与事件时序。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { popupPosition } from "../frontend/src/annotation-position.ts";

/** 造一个 DOMRect 形状的对象（只需用到 left/right/top/bottom）。 */
const rect = (left, top, width, height) => ({
  left, top, right: left + width, bottom: top + height,
  width, height, x: left, y: top, toJSON() { return this; },
});
const host = (width = 800, height = 1000) => rect(0, 0, width, height);

test("位置：默认在文字下方 8px、水平居中", () => {
  const sel = [rect(300, 100, 100, 20)];
  const pos = popupPosition(sel, host(), 1000, { width: 300, height: 120 });
  assert.equal(pos.top, 128, "top = 选区底 120 + 8");
  assert.equal(pos.left, 200, "水平居中：(300+400)/2 - 300/2 = 200");
});

test("位置：下方放不下时转到文字上方", () => {
  // 选区贴近容器底部，下方放不下 120 高的框
  const sel = [rect(300, 950, 100, 20)];
  const pos = popupPosition(sel, host(), 1000, { width: 300, height: 120 });
  assert.equal(pos.top, 950 - 120 - 8, "应放到选区上方（top - 框高 - 8）");
});

test("位置：水平不越界（左边夹到 8，右边留 8）", () => {
  const left = popupPosition([rect(0, 100, 20, 20)], host(), 1000, { width: 300, height: 100 });
  assert.equal(left.left, 8, "贴左边时夹到 8px");
  const right = popupPosition([rect(780, 100, 20, 20)], host(), 1000, { width: 300, height: 100 });
  assert.equal(right.left, 800 - 300 - 8, "贴右边时留 8px");
});

test("位置：多行选区取外接矩形（跨行居中）", () => {
  const sel = [rect(100, 100, 200, 20), rect(100, 130, 300, 20)];
  const pos = popupPosition(sel, host(), 1000, { width: 300, height: 120 });
  // 左 100、右 400 → 中心 250；top = 最大 bottom(150) + 8
  assert.equal(pos.left, 250 - 150);
  assert.equal(pos.top, 158);
});

test("位置：拖动偏移以**默认位置**为基准（不是第一行矩形）", () => {
  // 关键：基准必须与"未拖动时的位置"同一个公式，否则刚开始拖第一像素会跳。
  const sel = [rect(300, 100, 100, 20)];
  const size = { width: 300, height: 120 };
  const base = popupPosition(sel, host(), 1000, size);            // 默认位置
  const dragged = popupPosition(sel, host(), 1000, size, { dx: -50, dy: 30 });
  assert.equal(dragged.left, base.left - 50, "left = 默认 left + dx");
  assert.equal(dragged.top, base.top + 30, "top = 默认 top + dy");
});

test("位置：拖动位移为 0 时与默认位置完全一致（无跳变）", () => {
  const sel = [rect(300, 100, 100, 20)];
  const size = { width: 300, height: 120 };
  const base = popupPosition(sel, host(), 1000, size);
  // moved=true 但还没动（刚按下）：必须和默认位置一模一样
  const justPressed = popupPosition(sel, host(), 1000, size, { dx: 0, dy: 0, moved: true });
  assert.deepEqual(justPressed, base, "按下但未移动时不能跳");
});

test("位置：拖回原点（dx=dy=0 且 moved）仍是默认位置", () => {
  const sel = [rect(300, 100, 100, 20)];
  const size = { width: 300, height: 120 };
  const base = popupPosition(sel, host(), 1000, size);
  assert.deepEqual(popupPosition(sel, host(), 1000, size, { dx: 0, dy: 0, moved: true }), base);
});

test("位置：空选区不崩，给一个安全值", () => {
  assert.deepEqual(popupPosition([], host(), 1000, { width: 300, height: 100 }), { left: 8, top: 8 });
});

test("多条批注：与已占用的框错开（不完全重叠）", () => {
  const sel = [rect(300, 100, 100, 20)];
  const size = { width: 320, height: 175 };
  const first = popupPosition(sel, host(), 2000, size);
  // 第二条与第一条同一选区（最坏情况：同一段文字上的两条批注）
  const second = popupPosition(sel, host(), 2000, size, { dx: 0, dy: 0 }, [
    { left: first.left, top: first.top, width: size.width, height: size.height },
  ]);
  assert.equal(second.left, first.left, "横向保持对齐");
  assert.ok(second.top >= first.top + size.height + 8,
    `第二条必须推到第一条下方（first.top=${first.top}, second.top=${second.top}）`);
});

test("多条批注：第三条依次往下排", () => {
  const sel = [rect(300, 100, 100, 20)];
  const size = { width: 320, height: 175 };
  const p1 = popupPosition(sel, host(), 3000, size);
  const p2 = popupPosition(sel, host(), 3000, size, { dx: 0, dy: 0 }, [{ left: p1.left, top: p1.top, width: size.width, height: size.height }]);
  const p3 = popupPosition(sel, host(), 3000, size, { dx: 0, dy: 0 }, [
    { left: p1.left, top: p1.top, width: size.width, height: size.height },
    { left: p2.left, top: p2.top, width: size.width, height: size.height },
  ]);
  assert.ok(p2.top >= p1.top + size.height + 8);
  assert.ok(p3.top >= p2.top + size.height + 8, `第三条继续下移（p2=${p2.top}, p3=${p3.top}）`);
});
