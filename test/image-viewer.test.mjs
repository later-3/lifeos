// 图片查看器的缩放数学（组件只绑事件，规则全在这里，frontend 2.13）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampZoom, nextZoom, zoomPercent,
  fitSize, displaySize, clampPan,
} from "../frontend/src/design/image-zoom.ts";

test("缩放钳制：越界回界、非法值回到 1", () => {
  assert.equal(clampZoom(0.01), ZOOM_MIN);
  assert.equal(clampZoom(100), ZOOM_MAX);
  assert.equal(clampZoom(2), 2);
  assert.equal(clampZoom(Number.NaN), 1);
  assert.equal(clampZoom(Infinity), ZOOM_MAX);
});

test("缩放步进：连续放大不会超过上限，连续缩小不会低于下限", () => {
  let scale = 1;
  for (let i = 0; i < 20; i += 1) scale = nextZoom(scale, 1);
  assert.equal(scale, ZOOM_MAX);
  for (let i = 0; i < 30; i += 1) scale = nextZoom(scale, -1);
  assert.equal(scale, ZOOM_MIN);
  // 默认步长与显示一致：1 → 1.5 → 2.25
  assert.equal(nextZoom(1, 1), ZOOM_STEP);
  assert.equal(nextZoom(ZOOM_STEP, 1), 2.25);
  // 浮点不外溢：2.25 / 1.5 = 1.5 精确，反复放大缩小回到原值
  assert.equal(nextZoom(nextZoom(1, 1), -1), 1);
});

test("百分比显示取整（不会出现 149.999%）", () => {
  assert.equal(zoomPercent(1), "100%");
  assert.equal(zoomPercent(1.5), "150%");
  assert.equal(zoomPercent(0.5), "50%");
  assert.equal(zoomPercent(2.249), "225%");
});

test("适应尺寸：等比、不裁切、小图最多放到 2 倍（防糊）", () => {
  // 16:9 装进 800×600：按宽算 800×450
  assert.deepEqual(fitSize(1600, 900, 800, 600), { w: 800, h: 450 });
  // 竖图按高算
  assert.deepEqual(fitSize(900, 1600, 800, 600), { w: 338, h: 600 });
  // 很小的图：最多放大 2 倍，不糊成一片
  assert.deepEqual(fitSize(64, 64, 800, 600), { w: 128, h: 128 });
  // 非法输入不炸
  assert.deepEqual(fitSize(0, 0, 800, 600), { w: 0, h: 0 });
});

test("显示尺寸 = 适应尺寸 × 缩放", () => {
  assert.deepEqual(displaySize(800, 450, 2), { w: 1600, h: 900 });
  assert.deepEqual(displaySize(800, 450, 1), { w: 800, h: 450 });
});

test("平移钳制：图不够大不让拖；图放大后只能拖到「还看得见一半」", () => {
  assert.equal(clampPan(100, 800, 1000), 0, "没放大时平移必须为 0");
  assert.equal(clampPan(5000, 2000, 1000), (2000 - 1000) / 2 + Math.min(1000, 2000) / 2);
  assert.equal(clampPan(-5000, 2000, 1000), -1000);
  assert.equal(clampPan(50, 2000, 1000), 50, "在范围内不动");
});
