/**
 * 导航竖条的几何（Task 0020 · P2）。**纯函数，可穷举单测。**
 *
 * 为什么单独一个模块：竖条唯一"算出来的东西"就是长度与缩放，它错了整条就没有信息量
 * （原型实测：线性映射会让中位数只占 2.5%，见下）。组件只负责把它画出来。
 *
 * ## 数值来源（逐个写明，不自己发明）
 *
 * | 常量 | 值 | 来源 |
 * |---|---|---|
 * | `RAIL_MIN` / `MAX_USER` / `MAX_AGENT` | 4 / 26 / 40 px | 用户认可的交互原型 `tools/nav-demo/index.html:118`（实测调出来的） |
 * | `RAIL_GAP` | 2 px | 同上：让相邻两条独立可辨 |
 * | `RAIL_HIT_MAX` | 72 px | 用户 2026-11-04 裁决「感知区域范围再扩展两倍…移动上去极其费劲」（原 36 → 72） |
 * | `RAIL_HIT_MIN` | 24 px | WCAG 2.5.8 指针目标下限（`frontend-spec` §2 尺寸/命中区一节同口径） |
 * | `RAIL_BAR` / `BAR_HOVER` | 3 / 8 px | 用户：「原始的竖线的宽度也可以再稍微宽点儿」 |
 * | `RAIL_MIN_PITCH` | 6 px | 原型自行给出的窗口阈值：「缩到单段 < 6px 时改滑动窗口」 |
 *
 * ### 关于 `RAIL_MIN_PITCH = 6` 的诚实说明
 *
 * 本文件的前一版曾把它推成 8px，理由是「72 × 8 = 576 = 24×24」，即命中面积等于 WCAG 的最小面积。
 * **那个推导是错的**：WCAG 2.5.8 判的是宽高各 ≥24px（或 24px 圆不与他人重叠），不是面积；
 * 面积相等既不是充分条件也不是必要条件。所以这里回到**原型已认可的值 6px**，并如实记录它的代价：
 *
 * - 6px 间距下单个目标是 72×6 = 432 px²，确实低于 24×24；
 * - 这一类"密集导航条"普遍如此：pi-web 上游的 `ChatMinimap.tsx:28` 是 8×8 节点 + `MAX_NODE_GAP = 50`、
 *   相邻间距可低到个位数；ZCode 与 DeepSeek Harness 都是定距 10px 的小刻度。
 * - 结论：这是**已知并接受的偏离**，不是"符合 WCAG"。补偿手段是命中区放宽到 72px 宽
 *   （用户只需横向随便指），以及窗口模式下每条仍保住 6px 的纵向可分辨间距。
 */

/** 竖条的客观尺寸（px）。 */
export const RAIL_HIT_MAX = 72;
export const RAIL_HIT_MIN = 24;
export const RAIL_BAR = 3;
export const RAIL_BAR_HOVER = 8;
export const RAIL_GAP = 2;
export const RAIL_MIN = 4;
export const RAIL_MAX_USER = 26;
export const RAIL_MAX_AGENT = 40;

/**
 * 窗口模式的触发间距（px）。低于它时一条刻度自己占不到一个可分辨的像素带，
 * 相邻两条在视觉上糊成一整片（2px 下限 + 2px 间隙 = 4px 的量化误差已经和它同量级）。
 */
export const RAIL_MIN_PITCH = 6;

/** 刻度只需要这两个字段（不绑死 `RailTick`，测试可以随便造）。 */
export type RailTickShape = { role: string; chars: number };

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * sqrt 压缩映射（原型 `zip()`，`tools/nav-demo/index.html:127`）。
 *
 * **为什么必须是 sqrt**：实测同一会话里轮末回复的字符数最大值是最小值的 100 倍以上。
 * 原型对比过三种：线性 → 中位数只剩 **2.5%**（其余全被压平）；sqrt → 中位数 **15.9%**；
 * log2 → 70%（太平，看不出差别）。所以用 sqrt。
 *
 * @param values 同一角色在**当前会话内**的全部取值（min/max 取自这里，不跨会话）
 * @param value  这一条的值
 * @param peak   这个角色的峰值高度
 */
export function zipHeightOf(values: readonly number[], value: number, peak: number): number {
  const positives = values.filter((candidate) => Number.isFinite(candidate) && candidate > 0);
  if (positives.length === 0 || !Number.isFinite(value) || value <= 0) return RAIL_MIN;
  const max = Math.max(...positives);
  const min = Math.min(...positives);
  // 全是同一个值（或只有一个样本）：无法归一化，取中值——不假装有差别
  if (max === min) return (RAIL_MIN + peak) / 2;
  const ratio = (Math.sqrt(value) - Math.sqrt(min)) / (Math.sqrt(max) - Math.sqrt(min));
  return RAIL_MIN + clamp01(ratio) * (peak - RAIL_MIN);
}

/**
 * 每条刻度的原始高度（未缩放）。
 *
 * 用户与 Agent **各自归一化**：两侧的字数量级本来就不同（用户一句话几十字、回复几百到几千字），
 * 混在一起算 min/max 会让用户刻度全部贴底。
 */
export function railHeightsOf(ticks: readonly RailTickShape[]): number[] {
  const userValues = ticks.filter((tick) => tick.role === "user").map((tick) => tick.chars);
  const agentValues = ticks.filter((tick) => tick.role !== "user").map((tick) => tick.chars);
  return ticks.map((tick) => tick.role === "user"
    ? zipHeightOf(userValues, tick.chars, RAIL_MAX_USER)
    : zipHeightOf(agentValues, tick.chars, RAIL_MAX_AGENT));
}

/** 单条刻度的最小可画高度（px）。低于 2px 渲染不出来（1px 在高 dpi 上会消失）。 */
export const RAIL_TICK_FLOOR = 2;

/** 按某个 scale 排完之后的实际总高（**含** `RAIL_TICK_FLOOR` 的抬底）。 */
function railTotalAt(heights: readonly number[], scale: number): number {
  let total = 0;
  for (const height of heights) total += Math.max(RAIL_TICK_FLOOR, height * scale);
  return total + Math.max(0, heights.length - 1) * RAIL_GAP;
}

/**
 * 求能装下的最大缩放：装得下就不缩（scale = 1）。
 *
 * **为什么不是 `avail / natural` 一步除法**（原型就是这么写的，实测会溢出）：
 * 渲染时每条有 `Math.max(2, h*scale)` 的抬底，几条被抬底的刻度会让实际总高**超过**按比例算出来的值。
 * 本项目实测：80 条刻度、可用 804px，一步除法算出的 scale 让总高变成 887px ——
 * 首条刻度跑到 y=4（钻到 header 上方）、末条跑到 y=924（压到输入区下面），两头各漏一截。
 *
 * 总高随 scale **单调不减**，所以用二分找"还能装下的最大 scale"。
 * 20 次迭代足够（刻度最多几百条，一次迭代 O(n)，总计可忽略）。
 */
export function railScaleOf(heights: readonly number[], avail: number): { scale: number; total: number } {
  if (heights.length === 0) return { scale: 1, total: 0 };
  if (!(avail > 0)) return { scale: 0, total: railTotalAt(heights, 0) };
  const natural = railTotalAt(heights, 1);
  if (natural <= avail) return { scale: 1, total: natural };
  // 连最小高度都装不下 → 交给窗口模式（scale 给 0，调用方据此判断）
  if (railTotalAt(heights, 0) > avail) return { scale: 0, total: railTotalAt(heights, 0) };
  let low = 0;
  let high = 1;
  for (let step = 0; step < 20; step += 1) {
    const middle = (low + high) / 2;
    if (railTotalAt(heights, middle) <= avail) low = middle;
    else high = middle;
  }
  return { scale: low, total: railTotalAt(heights, low) };
}

/** 窗口能放几条刻度（至少 1 条，避免 0 容量的退化把整条算空）。 */
export function railCapacityOf(avail: number): number {
  return Math.max(1, Math.floor(avail / RAIL_MIN_PITCH));
}

/** 是否需要窗口模式：刻度多到即使压到最小间距也放不下。 */
export function needsRailWindow(count: number, avail: number): boolean {
  return count > railCapacityOf(avail);
}

/**
 * 窗口取哪一段。
 *
 * @param anchor 当前阅读位置对应的刻度下标（视口中线附近那条）；找不到时传最后一条
 * @returns `[from, to)` —— 与数组 `slice` 同语义
 *
 * 贴边而不是溢出：锚点靠头/靠尾时窗口整体平移进列表，用户不会看到"上面还空一块"。
 */
export function railWindowOf(count: number, avail: number, anchor: number): { from: number; to: number } {
  const capacity = railCapacityOf(avail);
  if (count <= capacity) return { from: 0, to: count };
  const size = Math.min(capacity, count);
  const centered = Math.floor(anchor - size / 2);
  const from = Math.max(0, Math.min(centered, count - size));
  return { from, to: from + size };
}

/**
 * 竖条在对话区左缘能占多宽（`RAIL_HIT_MIN`..`RAIL_HIT_MAX`），以及要不要出现。
 *
 * **为什么不能用视口断点**（原型写的是 `viewport < 864px` 隐藏）：轨道贴的是**对话区左缘**，
 * 对话区宽度由 `layout()` 按左右列与面板算出，与视口不是一回事
 * （`specs/code/frontend/code.md` 2.21：触发条件与容器宽度相关时不得用视口断点）。
 * 实测（2026-11-19，跑真实 `layout()`，`DEFAULT_WIDTHS`、无面板无历史列）：
 *
 * | 视口 | 左两列展开 | 左两列收起 |
 * |---|---|---|
 * | 1280 | 空白 24px | 188px |
 * | 1440 | 空白 24px | 268px |
 * | 1536 | 空白 50px | 316px |
 * | 1600 | 空白 82px | 348px |
 * | 1920 | 空白 242px | 508px |
 *
 * 原型那条 `< 864px 隐藏` 会把「1280/1440 + 左列展开」整个场景误杀（那里空白只有 24px），
 * 而那正是笔记本上最常见的形态。所以改成：够 72 用 72，不够就**收窄到可用空白**（下限 24），
 * 空白连 24 都不够才不渲染。
 *
 * @param chatWidth    对话区（`main` 的父容器）宽度
 * @param readingWidth 内容列宽度（`--container-reading`，用户可拖）
 * @param pad          对话区的水平内距（`px-4` = 16 / `sm:px-6` = 24）
 */
export function railSlotOf(
  chatWidth: number,
  readingWidth: number,
  pad: number,
): { visible: boolean; hit: number; gutter: number } {
  // 未挂载 / 宽度还没量出来：不可能是"有空白"，必须显式挡掉。
  // 不挡的话 `chatWidth = 0` 会算出 gutter = pad（24），凭空在 0 宽的容器里画一条竖条。
  if (!(chatWidth > 0)) return { visible: false, hit: 0, gutter: 0 };
  const inner = Math.max(0, chatWidth - pad * 2);
  const content = Math.min(inner, Math.max(0, readingWidth));
  return railSlotFromGutter(pad + (inner - content) / 2);
}

/* ── 预览卡片的定位（Task 0020 · P3）───────────────────────── */

/** 卡片与竖条的间距（px）。原型：卡片出现在竖条右侧、垂直与那条刻度对齐。 */
export const RAIL_CARD_GAP = 20;
/** 卡片与视口边缘的最小距离（px）。与 `design/popover.ts` 的 `POPOVER_VIEWPORT_PADDING` 同值。 */
export const RAIL_CARD_PADDING = 8;

export type RectLike = { top: number; left: number; right: number; bottom: number; width: number; height: number };

/**
 * 预览卡片的位置：**竖条右侧、与该刻度垂直居中**，并夹进视口。
 *
 * 为什么不复用 `design/popover.ts` 的 `placePopover`：它是"贴锚点下方/上方"的语义
 * （下拉面板、气泡），而竖条的卡片必须**横向**展开在轨道右侧、纵向与刻度对齐
 * （原型就是这样，也是唯一不被正文遮挡的方向）。两者的失败模式不同：
 * popover 要处理"下方放不下翻上方"，这里要处理"上方/下方夹紧"。
 * 共用只会让两边都长出用不到的分支。
 */
export function railCardPlaceOf(
  tick: RectLike,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const pad = RAIL_CARD_PADDING;
  const centered = tick.top + tick.height / 2 - size.height / 2;
  const maxTop = Math.max(pad, viewport.height - size.height - pad);
  const top = Math.min(Math.max(centered, pad), maxTop);
  const rawLeft = tick.right + RAIL_CARD_GAP;
  const maxLeft = Math.max(pad, viewport.width - size.width - pad);
  return { top, left: Math.min(Math.max(rawLeft, pad), maxLeft) };
}

/**
 * 由**实测**的空白宽度得出可用的命中区。
 *
 * 为什么运行时要量而不是套公式：`railSlotOf` 里的 `chatWidth / readingWidth / pad` 是
 * `layout()` 的计算值，而真实界面上还有滚动条宽度、浏览器缩放、用户拖过的列宽。
 * 运行时直接量「内容列左缘 − 容器左缘」得到的就是那个 gutter，不需要复现任何公式。
 * 两者共用同一档夹紧规则（[24, 72]，不足 24 不渲染），所以公式与实测不会分歧成两套判定。
 */
export function railSlotFromGutter(gutter: number): { visible: boolean; hit: number; gutter: number } {
  if (!(gutter >= RAIL_HIT_MIN)) return { visible: false, hit: 0, gutter: Math.max(0, gutter) };
  return { visible: true, hit: Math.min(RAIL_HIT_MAX, gutter), gutter };
}

/**
 * 会话还没全下载时，**已下载的那一段是刻度列表的尾巴**，不是全部。
 *
 * 由此得出"滚到哪儿 = 第几条刻度"的分段映射：
 *  - 滚到顶（ratio 0）→ 已下载部分的第一条刻度（`loadedFrom`），**不是刻度 0**；
 *  - 滚到底（ratio 1）→ 最后一条刻度。
 *
 * 为什么不能直接用"全列表比例"：首屏只下载最后 200 条消息，实测 560 条刻度的会话里
 * 已下载部分只覆盖最后 ~100 条。用全列表比例，滚到顶会算出"第 0 条"，
 * 于是窗口显示的是**一根都没下载的最前面几十条**，用户当前读的位置反倒不在窗口里。
 *
 * 反过来，滚到顶时把锚点放在 `loadedFrom`（已下载部分的第一条）有个额外好处：
 * 窗口以它为中心，**上半截正好是还没下载的那些** —— 用户可以点它们触发补取。
 *
 * @param loadedFrom 已下载消息对应的最小刻度下标（全下载完时是 0）
 */
export function railAnchorWithLoadedTail(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  total: number,
  loadedFrom: number,
): number {
  if (total <= 1) return 0;
  const from = Math.max(0, Math.min(loadedFrom, total - 1));
  const scrollable = scrollHeight - clientHeight;
  if (!(scrollable > 0) || !Number.isFinite(scrollTop)) return from;
  const ratio = Math.min(1, Math.max(0, scrollTop / scrollable));
  return Math.round(from + ratio * (total - 1 - from));
}

/**
 * 只按滚动比例估一个锚点（**零成本**的即时值，DOM 还没量出来时用它）。
 *
 * 为什么需要它：精确锚点要量每条消息的偏移（一次几十个 `getBoundingClientRect`），
 * 只能节流做（pi-web 上游 `ChatMinimap.tsx:329` 也是 150ms 节流）。两次测量之间用比例兜着，
 * 保证"滚到顶就一定显示最前面那些刻度"——单调性是对的，误差只在中间段。
 */
export function railAnchorByFraction(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  count: number,
): number {
  if (count <= 1) return 0;
  const scrollable = scrollHeight - clientHeight;
  if (!(scrollable > 0)) return 0;
  if (!Number.isFinite(scrollTop)) return 0;              // 量测还没就绪时传进来的是 NaN
  const ratio = Math.min(1, Math.max(0, scrollTop / scrollable));
  return Math.round(ratio * (count - 1));
}
