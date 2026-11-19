/**
 * 点击刻度的跳转判定（Task 0020 · P4）。**纯函数，可穷举单测。**
 *
 * ## 为什么这不是一句 `scrollIntoView`
 *
 * 消息区有两层"不是全都在"：
 *  1. **渲染窗口**（`frontend/src/chat-lazy-load.ts` 的 `visibleStartOf`）：默认只渲染最近 50 条
 *     所在的整轮，更早的 `return null`；
 *  2. **服务端分页**（`src/server.ts` 的 `?tail=200` + `?before=` 游标）：首屏只下载最后 200 条。
 *
 * 实测最长会话 2290 条 entry：最上面那条刻度对应的消息**根本没下载**。
 * 所以点一条刻度有三种结局，而且第三种（要补取）是常态而不是边界。
 *
 * ```text
 * visible    → 直接在已渲染的 DOM 里滚过去
 * inWindow   → 先放大渲染窗口，等一帧再滚
 * notLoaded  → 先补取若干页（有上限），取到再滚；取不到要给用户一个说法
 * ```
 */

/** 一次跳转的结局。 */
export type RailJump =
  | { kind: "visible" }
  | { kind: "inWindow"; index: number }
  | { kind: "notLoaded" };

/**
 * 判定该刻度对应的消息在哪一层。
 *
 * @param tickId     刻度指向的消息 id
 * @param order      当前已下载消息的 id 顺序（`messages.map(m => m.id)`）
 * @param windowStart 渲染窗口的起始下标（`visibleStartOf().startIndex`）
 */
export function railJumpOf(
  tickId: string,
  order: readonly (string | undefined)[],
  windowStart: number,
): RailJump {
  const index = order.indexOf(tickId);
  if (index < 0) return { kind: "notLoaded" };
  if (index < windowStart) return { kind: "inWindow", index };
  return { kind: "visible" };
}

/**
 * 补取一页的上限（页数）。
 *
 * 依据（实测，不是"通常够用"）：最长会话 2290 条 entry（`?tail` 之外的更早部分按 200/页取），
 * 从最后一条跳到第一条最多需要 **12 页**。取 20 页 = 1.7 倍余量。
 *
 * 为什么必须有上限：游标一旦失效（压缩后 id 全变）就会一直取到空页；
 * 没有上限的话点击会变成"无限转圈"，而这正是 `specs/code/frontend/code.md` 2.33
 * 要防的那种"没有出口的等待"。
 */
export const RAIL_JUMP_MAX_PAGES = 20;

/**
 * 补取结束后该给用户什么结论。
 *
 * @param found     是否找到了目标消息
 * @param reason    找不到的原因（用于文案，见下）
 */
export type RailJumpFailure = "cursor_not_found" | "network" | "page_limit" | "no_more";

/** 失败原因 → 用户能看懂的一句话（`specs/review/review.md` §4：错误要说"发生了什么 + 怎么恢复"）。 */
export function railJumpFailureText(reason: RailJumpFailure): string {
  switch (reason) {
    case "cursor_not_found":
      return "这条消息在当前会话里已不可达（会话可能刚发生过压缩），请刷新后再试";
    case "network":
      return "取更早的消息时网络失败，请检查连接后重试";
    case "page_limit":
      return `这条消息太靠前了（已连续取 ${RAIL_JUMP_MAX_PAGES} 页还没到），请改用「完整历史」查看`;
    case "no_more":
      return "这条消息不在当前会话里（可能所属分支已被替换）";
  }
}
