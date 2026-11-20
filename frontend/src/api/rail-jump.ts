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
 * ## 第三种"不在"：**下载了、也渲染了，但被过程条折叠**
 *
 * 2026-11-19 用户实测："点答的话，是没有跳转的"。复现数据：
 *
 * ```
 * 最近的用户刻度: u38 ✓在DOM  u39 ✓在DOM  u40 ✓在DOM
 * 最近的助手刻度: a38 ✗不在   a39 ✗不在   a40 ✗不在
 * 点助手刻度 a40：scrollTop 6844 → 6844  ❌ 没跳
 * ```
 *
 * 根因：轮末回复被折进**过程条**（`frontend/src/App.tsx` 的 `folded.add(i)`，条挂在这一轮
 * **第一条回复**上），于是轮末那条的 `data-message-id` 从没进 DOM，`querySelector` 找不到锚点。
 *
 * 这不是"没下载"，而是"下载了、有内容、只是挂在别人身上"。所以第 4 种结局：
 *
 * ```text
 * host       → 用这一轮第一条回复的 id 定位（过程条就在那），滚过去并**展开过程区**
 * ```
 *
 * 服务端在刻度里直接给出 `host`（`src/rail-ticks.ts` 的 `RailTick.host`），
 * 不让前端按渲染规则再推一遍 —— 渲染规则会变，投影是事实。
 */

/** 一次跳转的结局。 */
export type RailJump =
  | { kind: "visible" }
  | { kind: "inWindow"; index: number }
  | { kind: "notLoaded" };

/**
 * 判定该刻度对应的消息在哪一层。
 *
 * `host` 的判定不在这里：服务端已经给出回落 id，前端只需在 `visible` 之后多试一次
 * （见组件里的 `scrollToTick()`）。
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
 * 跳转时要试的锚点顺序：先试目标本身，不行再试回落锚点。
 *
 * 为什么要**按顺序试**而不是"有 host 就用 host"：轮末回复在**没被折叠**时也在 DOM 里
 * （一轮里只有一段纯文字回复时它自己就是宿主），那时应该停在它自己身上，而不是这一轮的开头。
 */
export function railAnchorCandidates(tickId: string, host: string | undefined): string[] {
  return host === undefined || host === tickId ? [tickId] : [tickId, host];
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
