/**
 * 消息渲染窗口（Task 0016 · P4-S1）：只渲染最近 N 条所在的那几**轮**。
 *
 * ## 为什么需要（实测拐点）
 *
 * 同一台机器、同一个 bundle、同一段输入代码，唯一变量是消息条数（CPU 4x 节流）：
 *
 * | 消息 | DOM | 逐字输入中位 |
 * |---|---|---|
 * | 0（草稿） | 85 | 16 ms |
 * | 10 | 415 | 24 ms |
 * | 61 | 1301 | 25 ms |
 * | **322** | **9036** | **73 ms** |
 *
 * 拐点在 61–322 之间。粗回归：边际 ≈0.12 ms/条、基数 ≈16 ms
 * → `16 + 50×0.12 ≈ 22 ms`；`16 + 30×0.12 ≈ 20 ms`。
 *
 * ## 为什么按"轮"切而不是按消息切
 *
 * `App.tsx` 的消息渲染以**轮**为单位（`groupIntoSpans`：一条 user + 它之后的所有 reply，
 * 折叠成一张过程条）。按消息条数直接切会把一轮劈成两半——过程条与它的最终正文分离，
 * 用户会看到"半轮"。所以窗口的单位是**轮**，`pageSize` 表示"至少保留多少条消息"，
 * 实际总是不低于它所在的整轮。
 *
 * ## 与 pi-web 的关系
 *
 * 形状照 `lib/chat-lazy-load.ts`（`getVisibleRenderWindow` / `captureScrollDistance` /
 * `restoreScrollTop` / `isScrollAtTail`），但多了"按轮取整"这一步——这是我们的渲染单位与它不同之处。
 */

/** 每页至少保留的消息条数。推导见文件头注（22 ms @ CPU 4x）。 */
export const VISIBLE_PAGE_SIZE = 50;

/** 贴底判定的容差（px）：与 `App.tsx` 的 `followTail` 同一口径。 */
export const TAIL_TOLERANCE = 60;

/** 一轮的下标范围（user 与其后的 reply）。 */
export type TurnRange = { start: number; end: number };

/**
 * 从消息列表尾部往前取，**按整轮对齐**，返回要渲染的起始下标。
 *
 * @param total            消息总条数
 * @param visibleCount     至少保留多少条（会向上取整到整轮边界）
 * @param turnStartOf      每条消息所属轮的起始下标（由 `groupIntoSpans` 派生）
 * @returns `startIndex`：首条要渲染的消息下标；`hasMore`：前面还有没有没渲染的
 */
export function visibleStartOf(
  total: number,
  visibleCount: number,
  turnStartOf: readonly number[],
): { startIndex: number; hasMore: boolean } {
  if (total <= 0) return { startIndex: 0, hasMore: false };
  const wanted = Math.min(Math.max(visibleCount, 1), total);
  const naive = total - wanted;
  if (naive <= 0) return { startIndex: 0, hasMore: false };
  // 向上取整到整轮边界：从 naive 往前找这一轮真正的起点
  const turnStart = turnStartOf[naive] ?? naive;
  return { startIndex: turnStart, hasMore: turnStart > 0 };
}

/** 再加载一页。 */
export function nextVisibleCount(current: number, pageSize: number = VISIBLE_PAGE_SIZE): number {
  return current + pageSize;
}

/**
 * 前置内容后保持滚动位置：用"距底部距离"做锚点。
 *
 * 为什么不是"距顶部"：新内容加在上面时 `scrollHeight` 变大、`scrollTop` 不变，
 * 视口里看到的内容会**整体下移**（内容"跑掉"）。距底部在追加到下方时不变，
 * 在前置内容时才是真正的锚点。
 */
export function captureScrollDistance(scrollHeight: number, scrollTop: number): number {
  return scrollHeight - scrollTop;
}

/** 恢复滚动位置（前置内容之后调用）。 */
export function restoreScrollTop(scrollHeight: number, savedDistance: number): number {
  return Math.max(0, scrollHeight - savedDistance);
}

/** 是否贴底（决定要不要跟随新消息）。 */
export function isScrollAtTail(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  tolerance: number = TAIL_TOLERANCE,
): boolean {
  return scrollTop + clientHeight >= scrollHeight - tolerance;
}
