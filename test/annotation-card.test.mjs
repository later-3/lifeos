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

test("位置：拖动过的（dx/dy 非零）以第一行矩形为基准加偏移", () => {
  const sel = [rect(300, 100, 100, 20)];
  const pos = popupPosition(sel, host(), 1000, { width: 300, height: 120 }, { dx: -50, dy: 30 });
  assert.equal(pos.left, 300 - 50, "第一行左边 + dx");
  assert.equal(pos.top, 120 + 8 + 30, "第一行底 + 8 + dy");
});

test("位置：空选区不崩，给一个安全值", () => {
  assert.deepEqual(popupPosition([], host(), 1000, { width: 300, height: 100 }), { left: 8, top: 8 });
});
