/**
 * 边缘侧滑返回的判定（Task 0016 · P7-S8）。
 *
 * 缺陷来源（用户 2026-11-17 实测，原话）：
 *   「有些安卓手机屏幕左滑右滑是返回，但我们这里屏幕左滑右滑就直接相当于退出到桌面了」
 *
 * 根因不是"没适配系统手势"，而是**一次手势退了两层**：安卓系统返回先 `touchcancel`
 * 掉页面上的触摸、再发 `popstate`；我们此前把 `touchcancel` 注册在 `onEnd`（提交），
 * 于是「我们的 history.back()」+「系统的返回」各退一层，根级第二层 = 退出应用。
 *
 * 所以这里锁的是**语义**，不是实现：
 *  - 只有 `touchend` 才提交（`cancel` 一律不提交）；
 *  - 提交要同时满足"向右左拉够远"与"水平压过垂直"；
 *  - 不属于我们的触摸（多指 / 编辑区 / 不在边缘）根本不记起点。
 *
 * 活性验证（规范 2.4）：把 `edgeGestureCommits` 的 `if (input.end === "cancel") return false;`
 * 删掉 → 「cancel 不提交」那条立刻变红。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeGestureCommits, edgeGestureStartsAt } from "../frontend/src/mobile-platform.ts";

// ── edgeGestureStartsAt ─────────────────────────────────────────────────────

test("从右边缘开始 → 记为我们的手势", () => {
  assert.deepEqual(
    edgeGestureStartsAt({ clientX: 385, clientY: 400, viewportWidth: 390, touchCount: 1, onEditable: false }),
    { x: 385, y: 400 },
  );
});

test("从屏幕中间开始 → 不是我们的手势（不抢横向滚动）", () => {
  assert.equal(
    edgeGestureStartsAt({ clientX: 200, clientY: 400, viewportWidth: 390, touchCount: 1, onEditable: false }),
    undefined,
  );
});

test("双指 → 不是我们的手势（那是缩放）", () => {
  assert.equal(
    edgeGestureStartsAt({ clientX: 388, clientY: 400, viewportWidth: 390, touchCount: 2, onEditable: false }),
    undefined,
  );
});

test("输入框 / 可编辑区域 → 不是我们的手势（拖选不该退层）", () => {
  assert.equal(
    edgeGestureStartsAt({ clientX: 388, clientY: 400, viewportWidth: 390, touchCount: 1, onEditable: true }),
    undefined,
  );
});

test("边缘宽度是参数：默认 24，可以收紧", () => {
  const at = { clientX: 380, clientY: 400, viewportWidth: 390, touchCount: 1, onEditable: false };
  assert.deepEqual(edgeGestureStartsAt(at), { x: 380, y: 400 });             // 390-380 = 10 ≤ 24
  assert.equal(edgeGestureStartsAt({ ...at, edge: 5 }), undefined);           // 10 > 5
});

// ── edgeGestureCommits（这条是本缺陷的核心）───────────────────────────────────

test("**touchcancel 一律不提交**（系统接管了手势 → 交给系统，我们不动）", () => {
  // 同样的位移：touchend 提交、touchcancel 不提交 —— 这一对是整条缺陷的判据
  assert.equal(edgeGestureCommits({ end: "end", dx: -140, dy: 5 }), true);
  assert.equal(edgeGestureCommits({ end: "cancel", dx: -140, dy: 5 }), false);
});

test("向左拉够远 + 水平为主 → 提交", () => {
  assert.equal(edgeGestureCommits({ end: "end", dx: -48, dy: 0 }), true);
  assert.equal(edgeGestureCommits({ end: "end", dx: -200, dy: 30 }), true);
});

test("拉得不够远 → 不提交（阈值 48）", () => {
  assert.equal(edgeGestureCommits({ end: "end", dx: -47, dy: 0 }), false);
  assert.equal(edgeGestureCommits({ end: "end", dx: 0, dy: 0 }), false);
});

test("向右拖 → 不提交（方向单向：右缘 → 左）", () => {
  assert.equal(edgeGestureCommits({ end: "end", dx: 140, dy: 0 }), false);
});

test("斜着划（垂直占优）→ 不提交（那是滚动）", () => {
  assert.equal(edgeGestureCommits({ end: "end", dx: -60, dy: 60 }), false);
  assert.equal(edgeGestureCommits({ end: "end", dx: -60, dy: 300 }), false);
});

test("轴比判据的边界：|dx| > |dy| × 1.2（等于不算）", () => {
  assert.equal(edgeGestureCommits({ end: "end", dx: -120, dy: 100 }), false);  // 120 > 120 不成立
  assert.equal(edgeGestureCommits({ end: "end", dx: -121, dy: 100 }), true);   // 121 > 120
});

test("阈值与轴比可调（测试与调试用，生产用默认）", () => {
  assert.equal(edgeGestureCommits({ end: "end", dx: -20, dy: 0, commitDistance: 10 }), true);
  assert.equal(edgeGestureCommits({ end: "end", dx: -60, dy: 50, axisRatio: 1 }), true);
});
