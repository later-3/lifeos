// 浮层定位的穷举单测（C190：第一版气泡离锚点 524px，因为用了写死的 fixed 定位）。
//
// 用例对齐 difit 的 floating-ui 配置（`DiffQuickMenu.tsx:119-131`）：
//   offset(6) / flip() / shift({ padding: 8 }) —— 贴 6px、空间不足翻转、贴边平移留 8px。
import test from "node:test";
import assert from "node:assert/strict";
import { POPOVER_GAP, POPOVER_VIEWPORT_PADDING, placePopover } from "../frontend/src/design/popover.ts";

const rect = (top, left, w, h) => ({ top, left, right: left + w, bottom: top + h, width: w, height: h });
const VP = { width: 1680, height: 1000 };
const SIZE = { width: 288, height: 80 };

test("P1·1 空间充足 → 出现在锚点下方，间距 = POPOVER_GAP(6)", () => {
  const anchor = rect(300, 1600, 16, 16);   // 行末头像：靠右
  const p = placePopover(anchor, SIZE, VP);
  assert.equal(p.side, "below");
  assert.equal(p.top, anchor.bottom + POPOVER_GAP, "下方 6px");
});

test("P1·2 水平**右缘对齐**锚点右缘（difit placement: bottom-end）", () => {
  const anchor = rect(300, 1600, 16, 16);
  const p = placePopover(anchor, SIZE, VP);
  assert.equal(p.left + SIZE.width, anchor.right, "气泡右缘 = 锚点右缘");
  assert.equal(p.shifted, false);
});

test("P1·3 下方放不下 → **翻到上方**（flip）", () => {
  const anchor = rect(940, 800, 16, 16);    // 距底 44px，放不下 80px 气泡
  const p = placePopover(anchor, SIZE, VP);
  assert.equal(p.side, "above");
  assert.equal(p.top, anchor.top - POPOVER_GAP - SIZE.height);
});

test("P1·4 太靠右（锚点右缘超出视口）→ 左移进视口，留 8px（shift）", () => {
  const anchor = rect(300, 1700, 16, 16);   // right = 1716 > 1680
  const p = placePopover(anchor, SIZE, VP);
  assert.equal(p.left + SIZE.width, VP.width - POPOVER_VIEWPORT_PADDING, "右缘留 8px");
  assert.equal(p.shifted, true);
});

test("P1·5 太靠左（锚点右缘 < 气泡宽）→ 左缘夹到 8px", () => {
  const anchor = rect(300, 10, 16, 16);
  const p = placePopover(anchor, SIZE, VP);
  assert.equal(p.left, POPOVER_VIEWPORT_PADDING);
  assert.equal(p.shifted, true);
});

test("P1·6 上下都放不下（视口比气泡矮）→ 取空间大的一侧且夹进视口", () => {
  const small = { width: 400, height: 120 };
  const anchor = rect(50, 100, 16, 16);
  const p = placePopover(anchor, { width: 288, height: 100 }, small);
  assert.ok(p.top >= POPOVER_VIEWPORT_PADDING, `top=${p.top}`);
  assert.ok(p.top + 100 <= small.height, `底边 ${p.top + 100} 不超过视口 ${small.height}`);
});

test("P1·7 锚点在视口顶部 → 一定在下方（上方没空间）", () => {
  const anchor = rect(0, 800, 16, 16);
  const p = placePopover(anchor, SIZE, VP);
  assert.equal(p.side, "below");
});

test("P1·8 常量与参考一致：gap=6（difit offset(6)）、padding=8（difit shift padding 8）", () => {
  assert.equal(POPOVER_GAP, 6);
  assert.equal(POPOVER_VIEWPORT_PADDING, 8);
});

test("P1·9 返回值永远是有限数（不会 NaN——锚点/尺寸任一为 0 也不能崩）", () => {
  const p = placePopover(rect(0, 0, 0, 0), { width: 0, height: 0 }, { width: 0, height: 0 });
  assert.ok(Number.isFinite(p.top) && Number.isFinite(p.left));
});

// 回归：C190 的实测场景（锚点在右侧行末、气泡 288×96、视口 1680×1000）
test("P1·10 回归 C190：右侧行末头像 → 气泡在正下方 6px、右缘对齐（不是视口右下角）", () => {
  const anchor = rect(316, 1652, 16, 16);
  const p = placePopover(anchor, { width: 288, height: 96 }, VP);
  assert.equal(p.side, "below");
  assert.equal(p.top - anchor.bottom, 6, "垂直间距 6px");
  assert.equal(p.left + 288, anchor.right, "右缘对齐");
  // 旧实现是 fixed bottom-20 right-6 → y 差 524px，这里必须远离那个值
  assert.ok(Math.abs(p.top - 840) > 400, `不能回到旧的 840（实际 ${p.top}）`);
});
