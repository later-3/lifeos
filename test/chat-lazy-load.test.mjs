/**
 * 消息渲染窗口（Task 0016 · P4-S1）。
 *
 * 门禁要证明的三件事：
 *  1. **按整轮对齐**——按消息条切会把一轮劈成两半（过程条与最终正文分离）；
 *  2. 边界（空、恰好一页、多页、翻到底）；
 *  3. 滚动锚点：前置内容后"距底部距离"不变，视口内容不跑。
 *
 * 数字依据（实测，见 `frontend/src/chat-lazy-load.ts` 头注）：
 * 322 条消息 = 9036 DOM = 逐字输入 73 ms；50 条/页 ≈ 22 ms 的推算值。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VISIBLE_PAGE_SIZE, TAIL_TOLERANCE,
  captureScrollDistance, isScrollAtTail, nextVisibleCount, restoreScrollTop, visibleStartOf,
} from "../frontend/src/chat-lazy-load.ts";

/** 造一个"每条消息都属于某一轮"的 turnStartOf（id 形如 `0,0,0,3,3,3,6…`）。 */
function turnStartsOf(sizes) {
  const out = [];
  let cursor = 0;
  for (const size of sizes) {
    for (let i = 0; i < size; i += 1) out.push(cursor);
    cursor += size;
  }
  return out;
}

test("空消息 → 不渲染任何东西，也没有更多", () => {
  assert.deepEqual(visibleStartOf(0, VISIBLE_PAGE_SIZE, []), { startIndex: 0, hasMore: false });
});

test("消息少于页大小 → 全渲染", () => {
  const starts = turnStartsOf([1, 1, 1]);
  assert.deepEqual(visibleStartOf(3, 50, starts), { startIndex: 0, hasMore: false });
});

test("恰好一页 → 全渲染", () => {
  const starts = turnStartsOf(Array.from({ length: 10 }, () => 5));   // 50 条
  assert.deepEqual(visibleStartOf(50, 50, starts), { startIndex: 0, hasMore: false });
});

test("超过一页 → 只渲染最后几轮，且 hasMore", () => {
  const starts = turnStartsOf(Array.from({ length: 30 }, () => 5));   // 150 条，30 轮
  const result = visibleStartOf(150, 50, starts);
  assert.equal(result.hasMore, true);
  // 从 100 往前对齐到轮边界：第 100 条是第 21 轮的第一条（每轮 5 条）→ 正好 100
  assert.equal(result.startIndex, 100);
});

test("**按整轮对齐**：切点落在轮中间时，往前取到该轮起点（不劈成半轮）", () => {
  // 每轮 7 条：total=100, visible=50 → naive=50；50 % 7 = 1 → 第 50 条属于起点 49 的那一轮
  const starts = turnStartsOf(Array.from({ length: 15 }, () => 7).slice(0, 15));  // 105 条
  const result = visibleStartOf(105, 50, starts);
  assert.equal(result.startIndex % 7, 0, `起点 ${result.startIndex} 不是轮边界（会劈开一轮）`);
  assert.ok(result.startIndex <= 55, `起点太靠后（${result.startIndex}），可能劈开了轮`);
});

test("单轮超长（一轮 200 条）→ 至少渲染那一整轮，不劈开", () => {
  const starts = turnStartsOf([5, 200, 5]);   // 210 条
  const result = visibleStartOf(210, 50, starts);
  // naive = 160，落在 200 条的那一轮里（起点 5）→ 必须回到 5
  assert.equal(result.startIndex, 5);
});

test("翻页：连续加载直到覆盖全部", () => {
  let visible = VISIBLE_PAGE_SIZE;
  const starts = turnStartsOf(Array.from({ length: 40 }, () => 5));   // 200 条
  const seen = [];
  for (let i = 0; i < 10; i += 1) {
    const window = visibleStartOf(200, visible, starts);
    seen.push(window.startIndex);
    if (!window.hasMore) break;
    visible = nextVisibleCount(visible);
  }
  assert.equal(seen.at(-1), 0, "翻到底应该能覆盖到第 0 条");
  // 每次翻页起点单调不增（只会往前扩，不会来回跳）
  for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i] <= seen[i - 1], "起点没有单调往前");
});

test("滚动锚点：front-load 之后视口内容不跑（距底部距离保持不变）", () => {
  // 初始：scroller 高 2000、顶在 500 → 距底 1500
  const saved = captureScrollDistance(2000, 500);
  assert.equal(saved, 1500);
  // 前置了 800px 内容：新高 2800，按同一距底恢复 → top 应该是 2800-1500 = 1300
  assert.equal(restoreScrollTop(2800, saved), 1300);
  // 视口里相对内容的位置不变：原来底部还有 1500，现在也还有 1500
  assert.equal(2800 - 1300, 1500);
});

test("滚动锚点的边界：顶部不越界、底部不被裁", () => {
  assert.equal(restoreScrollTop(3000, captureScrollDistance(2000, 0)), 1000);
  assert.ok(restoreScrollTop(1000, captureScrollDistance(800, 800)) >= 0, "不能算出负的 scrollTop");
});

test("贴底判定：恰好贴底 / 容差内 / 离开底部", () => {
  assert.equal(isScrollAtTail(500, 300, 800), true);                              // 恰好贴底
  assert.equal(isScrollAtTail(500 - (TAIL_TOLERANCE - 1), 300, 800), true);        // 容差内
  assert.equal(isScrollAtTail(500 - (TAIL_TOLERANCE + 50), 300, 800), false);      // 离开了
});

test("活性验证：按消息条硬切会劈开一轮（说明「按轮对齐」不是白写的）", () => {
  const starts = turnStartsOf(Array.from({ length: 15 }, () => 7));   // 105 条，每轮 7
  const naive = 105 - 50;
  assert.notEqual(naive % 7, 0, "该用例需要 naive 落在轮中间才有意义");
  // 硬切直接用它 → 是轮中间；我们的实现会往前取整
  assert.equal(visibleStartOf(105, 50, starts).startIndex % 7, 0);
});
