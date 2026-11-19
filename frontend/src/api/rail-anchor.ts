/**
 * 竖条的**当前阅读位置**与**每条的定位**（Task 0020 · P5）。
 *
 * 为什么需要它：内容区只有一个 `scrollTop`，而刻度列表是"一条消息一条刻度"。
 * 要把两者对上，必须先知道每条消息在滚动内容里的偏移，再按"视口中线落在哪两条之间"取最近的。
 *
 * 参考实现：pi-web 上游 `components/ChatMinimap.tsx:283-311` 的 `syncActiveNode()` ——
 * 它把 `scrollTop + clientHeight * 0.3` 当焦点线、取距离最近的那个轮次节点。
 * 借它的是**这个算法**（线性扫描 + 中线偏上），不借它的"每轮一个节点"（我们是每消息一条刻度）。
 *
 * 两个细节是实测/推理来的，不是随手取的：
 * - **焦点线在 30% 而不是 50%**：用户视线的落点偏上（同一屏里"刚读到的东西"在中上），
 *   30% 让"我在读这一条"更符合直觉；pi-web 也用 0.3。
 * - **跳转锁定 1600ms**（`RAIL_ACTIVE_LOCK_MS`）：平滑滚动的过程中，中线会一路扫过中间的刻度，
 *   不锁的话高亮会在动画里连环跳，落地后才定住——看起来像"抖"。pi-web 同值。
 */

/** 跳转后高亮锁定的时长（ms）。平滑滚动途中不让中线重新选中。 */
export const RAIL_ACTIVE_LOCK_MS = 1600;

/**
 * 焦点线在视口中的比例位置（0.5 = 正中）。
 *
 * **这条是实测改过的**（2026-11-19，第一次跑真界面）：初版取 0.3（照 pi-web 上游
 * `ChatMinimap.tsx:296` 的 `scrollTop + clientHeight * 0.3`），但我们的跳转用的是
 * `scrollIntoView({ block: "center" })`（**用户裁决：滚到视口中央**）。
 * 两者不一致的后果实测到了：点 `u214` 之后 `u214` 停在正中，而 0.3 的焦点线落在它**上面**那条，
 * 高亮跳到 `a213` —— 用户看到"我点这条，亮的却是上一条"。
 *
 * 参考实现能用 0.3 是因为它**跳转也滚到 0.3**（`targetTop - clientHeight * 0.3`，同文件 `:396`）：
 * 焦点线与落点是同一个常量，所以永远对得上。我们选了"居中"，就必须把焦点线也放到 0.5 ——
 * **焦点线必须与落点一致**，具体取哪个值是次要的。
 *
 * 另外补了两端吸附（`railActivePick` 的 `atEdge`）：贴顶 = 第一条、贴底 = 最后一条。
 * 不然在会话末尾（最常停留的位置）高亮会停在屏幕正中那条，而用户眼睛在最底下。
 */
export const RAIL_FOCUS_RATIO = 0.5;

/** 贴顶/贴底的容差（px）：在这个范围内视为"在端点"。 */
export const RAIL_EDGE_TOLERANCE = 8;

export type RailAnchor = { id: string; top: number };

/**
 * 视口焦点线落在哪一条刻度上。
 *
 * @param anchors 每条刻度对应消息的偏移（**按文档顺序**，top 递增）
 * @param scrollTop 滚动容器的 `scrollTop`
 * @param clientHeight 滚动容器的可视高度
 * @returns 最近的那条刻度在 `anchors` 里的下标；没有任何锚点时返回 `undefined`
 */
export function railAnchorIndexAt(
  anchors: readonly RailAnchor[],
  scrollTop: number,
  clientHeight: number,
): number | undefined {
  if (anchors.length === 0) return undefined;
  const focus = scrollTop + clientHeight * RAIL_FOCUS_RATIO;
  let best = 0;
  let bestDistance = Math.abs(anchors[0].top - focus);
  for (let index = 1; index < anchors.length; index += 1) {
    const distance = Math.abs(anchors[index].top - focus);
    if (distance < bestDistance) { best = index; bestDistance = distance; }
  }
  return best;
}

/**
 * 从"这一屏能看见的消息"里选当前刻度。
 *
 * 这是本模块**唯一**给组件用的入口：它同时给出"当前刻度下标"和"窗口锚点下标"，
 * 两者由同一次测量得出，不会出现"高亮用的是新值、窗口用的是旧值"。
 *
 * ## 为什么要分两层（实测教训）
 *
 * 消息区只渲染最近 50 条所在整轮。滚到会话中段时：
 *  - 能看见的消息**没有渲染**（`querySelector` 找不到）→ 一个锚点都没有；
 *  - 已渲染的那些全在视口外很远；
 *  - 而"按滚动比例估"只在**整段都渲染了**时才准（否则 `scrollHeight` 只反映已渲染的部分）。
 *
 * 所以：**有可见锚点就用它**（准），**没有就用"已下载消息里的最后一条可见者"兜底**，
 * 两者都没有才退回比例。三种来源都标在返回值里，便于断言与排障。
 *
 * @param anchors 已渲染消息的锚点（`top` 是内容坐标系里的偏移）
 * @param band    视口在内容坐标系里的范围
 * @param visible 这些锚点里哪些真的落在视口内（由调用方用同一批 DOM 判定）
 * @param fallbackIndex 兜底下标（调用方按"已下载里最后一条可见刻度"算）
 */
export function railActivePick(
  anchors: readonly RailAnchor[],
  scrollTop: number,
  clientHeight: number,
  fallbackIndex: number | undefined,
  fractionIndex: number,
  /** `loadedFrom` = 已下载部分对应的最小刻度下标（0 = 全下载完）。 */
  bounds?: { lastIndex: number; scrollHeight: number; loadedFrom: number },
): { index: number | undefined; source: "anchor" | "fallback" | "fraction" | "edge" } {
  /*
   * 两端吸附：贴底 = 最后一条（会话末尾是最常停留的位置，不吸附的话高亮会停在屏幕正中那条，
   * 而用户眼睛在最底下）；贴顶 = 第一条，**但只在整段都下载完时**成立 ——
   * 还有更早的没下载时，用户贴的是"已下载部分的顶"，标成第 0 条等于说他读到了开头（没这回事）。
   */
  if (bounds !== undefined) {
    if (bounds.loadedFrom === 0 && scrollTop <= RAIL_EDGE_TOLERANCE) return { index: 0, source: "edge" };
    const maxScroll = bounds.scrollHeight - clientHeight;
    if (maxScroll > 0 && scrollTop >= maxScroll - RAIL_EDGE_TOLERANCE) return { index: bounds.lastIndex, source: "edge" };
  }
  if (anchors.length > 0) {
    const index = railAnchorIndexAt(anchors, scrollTop, clientHeight);
    if (index !== undefined) return { index, source: "anchor" };
  }
  if (fallbackIndex !== undefined) return { index: fallbackIndex, source: "fallback" };
  return { index: fractionIndex, source: "fraction" };
}

/**
 * 选当前刻度：**优先用能看见的锚点，看不见就退回比例估算**。
 *
 * 为什么不能只用锚点：消息区有渲染窗口（只渲染最近 50 条所在整轮），滚到会话中部时
 * 可见的那几条消息**根本没渲染**，量到的锚点全在视口外。实测（560 条刻度的会话）：
 * 滚到 50% 位置时，唯一能用的锚点是尾部的 `u256`，纯锚点算法会把高亮定到尾部，
 * 而用户眼前是中段的内容 —— 高亮和内容完全对不上。
 *
 * @param anchors     已量到的锚点（可能只覆盖一小段）
 * @param band        当前视口在滚动内容里的范围 `[top, bottom]`
 * @param fractionIndex 按滚动比例估出来的下标（零成本的兜底）
 */
export function railActiveIndexOf(
  anchors: readonly RailAnchor[],
  band: { top: number; bottom: number },
  scrollTop: number,
  clientHeight: number,
  fractionIndex: number,
): { index: number; source: "anchor" | "fraction" } {
  const visible = anchors.filter((anchor) => anchor.top >= band.top - clientHeight && anchor.top <= band.bottom + clientHeight);
  if (visible.length === 0) return { index: fractionIndex, source: "fraction" };
  const index = railAnchorIndexAt(visible, scrollTop, clientHeight);
  return { index: index ?? fractionIndex, source: "anchor" };
}

/**
 * 高亮锁是否还有效（跳转后的平滑滚动期间用它压住中线重算）。
 *
 * @param lock 上一次跳转的锁定记录（`undefined` = 没锁过）
 */
export function railLockActive(
  lock: { index: number; until: number } | undefined,
  now: number,
): lock is { index: number; until: number } {
  return lock !== undefined && now < lock.until;
}
