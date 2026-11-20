/**
 * 导航条的几何（Task 0020 · P2 改横条）。**纯函数，可穷举单测。**
 *
 * ## 形态（2026-11-19 用户第二轮裁决）
 *
 * **位置仍是对话区左缘的竖向区域，但每条刻度是横条**：
 *
 * ```
 *  ▁▁▁▁            ← 用户消息（宽度 = 内容量）
 *  ▁▁▁▁▁▁▁▁▁▁▁▁    ← 轮末回复（更长）
 *  ▁▁▁▁▁
 *  ▁▁▁▁▁▁▁▁▁
 * ```
 *
 * 所以"长度"从**高**变成了**宽**：
 *  - 竖条时代：高度表示内容量；装不下时只能"只画附近一段"（窗口），被裁掉的那些**看不见也点不到**
 *    （实测 548 条里丢 380 条）；
 *  - 横条时代：**宽度**表示内容量，纵向是一列行；装不下时**整列滚动** ——
 *    每条仍然存在、仍然可点，只是**一屏看不全**。
 *
 * **"装不下"没有消失**（用户 2026-11-19 追问过这一点，问得对）：它换成了"要滚一下这一列"。
 * 差别在于**代价的性质**：从"内容丢失"变成"多看一步"。同时行高不必再压到 2px ——
 * 但**仍然会压到 12px**，那依然低于 WCAG 2.5.8 的 24px（短会话才达标）。这条账只还了一半，
 * 见 `ROW_HEIGHT_MIN` 的注释与 todo#3（两级导航才是真解法）。
 *
 * 用户原话：「我们就默认一个最大的高度，如果对话太长了，用户可以滑动这个对话预览」。
 *
 * ## 数值来源
 *
 * | 常量 | 值 | 来源 |
 * |---|---|---|
 * | `BAR_WIDTH_MIN` / `BAR_WIDTH_MAX` | 6 / 32 px | 形制取自 **lobe-chat** `src/features/ChatMiniMap/utils.ts:5-6`（`MIN_WIDTH=5`、`MAX_WIDTH=16`，横向 dash 按内容量变宽）；我们放大到 6–32 是因为左缘空白最多有 242px，不必挤在 16px 里 |
 * | `ROW_HEIGHT_MIN` / `MAX` | 12 / 24 px | `MAX=24` = WCAG 2.5.8 指针下限（短会话用舒适的 24px 行高）；`MIN=12` 是"能指到 + 不糊成一片"的下限（长会话靠滚动，不再压行高）。**12 仍低于 24**，见 `ROW_HEIGHT_MIN` 的注释 |
 * | `BAR_HEIGHT` / `BAR_HEIGHT_HOVER` | 3 / 6 px | 用户 2026-11-04「原始的竖线的宽度也可以再稍微宽点儿」的同一条诉求，横条时代对应"厚度" |
 * | `RAIL_MAX_RATIO` | 0.62 | 整列最多占对话区高度的 62%（留出 header / composer 的呼吸；lobe-chat 的 `max-height: 50vh` 是同一意图，我们用容器高度而非视口高度算，见下） |
 * | `CARD_GAP` / `CARD_PADDING` | 20 / 8 px | 卡片贴轨道右侧（`frontend-spec` 的浮层间距档）；8px 与 `design/popover.ts` 的 `POPOVER_VIEWPORT_PADDING` 同值 |
 *
 * ## 为什么可见性判据用**容器**宽度
 *
 * 原型写的是 `viewport < 864px` 隐藏。但轨道贴的是**对话区左缘**，对话区宽度由 `layout()` 按左右列与面板算出，
 * 与视口不是一回事（`specs/code/frontend/code.md` 2.21）。实测（真实 `layout()`，`DEFAULT_WIDTHS`）：
 *
 * | 视口 | 左两列展开 | 左两列收起 |
 * |---|---|---|
 * | 1280 | 空白 24px | 188px |
 * | 1440 | 空白 24px | 268px |
 * | 1536 | 空白 50px | 316px |
 * | 1600 | 空白 82px | 348px |
 * | 1920 | 空白 242px | 508px |
 *
 * 原型那条 `< 864px 隐藏` 会把「1280/1440 + 左列展开」整个场景误杀 —— 而那正是笔记本上的常态。
 * 所以：空白 ≥ 24 就出现，轨道宽度 = `min(RAIL_WIDTH_MAX, 空白)`，横条按轨道宽度定标。
 */

/** 横条宽度的上下限（px）。 */
export const BAR_WIDTH_MIN = 6;
export const BAR_WIDTH_MAX = 32;

/** 轨道自身宽度上限（横条最长 32 + 左右各 2px 余量，不压到正文）。 */
export const RAIL_WIDTH_MAX = 36;
/** 轨道可见的最小空白（= WCAG 2.5.8 指针目标下限）。低于它不渲染（手机上自然会走这条）。 */
export const RAIL_WIDTH_MIN = 24;

/** 横条厚度（px）：静止 / 悬停（"当前"与悬停同档）。 */
export const BAR_HEIGHT = 3;
export const BAR_HEIGHT_HOVER = 6;

/** 行高（px）：短会话用 24（舒适 + 满足 WCAG 2.5.8 的 24px 指针下限），长会话压到 12 并改为滚动。 */
export const ROW_HEIGHT_MAX = 24;
/**
 * 行高下限（px）。
 *
 * **它仍然低于 WCAG 2.5.8 的 24px 指针下限**，这条账只还了一半，如实记在这里：
 * - 短会话（行高算出来 ≥ 24）达标；
 * - 长会话压到 12px —— 是一屏能看多少条与"点得准不准"的折中。
 *
 * 为什么不再往下压（上一版竖条压到 6px）：再压就点不准了。真正解决要**两级导航**
 * （整列画"轮"这个粗粒度、悬停展开轮内细刻度），已登记 todo#3，不在本任务里硬上。
 *
 * 12 的依据：`.rail-tick` 是 3px 厚的横条 + 12px 行高 = 上下各 4.5px 余量，
 * 相邻两条的视觉间隙清晰可辨；实测截图可区分。
 */
export const ROW_HEIGHT_MIN = 12;

/** 整列最多占可用高度的比例。 */
export const RAIL_MAX_RATIO = 0.62;

/**
 * 滑块的最小高度（px）。取自 VSCode `scrollbarState.ts:10` 的 `MINIMUM_SLIDER_SIZE = 20`
 * （注释原文："The minimal size of the slider (such that it can still be clickable) -- it is artificially enlarged."）。
 * 会话再长，滑块也不会细到点不住。
 */
export const RAIL_SLIDER_MIN = 20;

/** 卡片与轨道的间距、与视口边缘的最小距离（px）。 */
export const CARD_GAP = 20;
export const CARD_PADDING = 8;

/** 刻度只需要这两个字段（不绑死 `RailTick`，测试可以随便造）。 */
export type RailTickShape = { role: string; chars: number };

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * sqrt 压缩映射（原型 `tools/nav-demo/index.html:127` 的 `zip()`，横条时代只是把结果当**宽度**用）。
 *
 * **为什么必须是 sqrt**：实测同一会话里轮末回复的字符数最大值是最小值的 100 倍以上。
 * 原型对比过三种映射：线性 → 中位数只剩 **2.5%**（其余全被压平）；sqrt → 中位数 **15.9%**；
 * log2 → 70%（太平，看不出差别）。
 *
 * 另一家（lobe-chat `ChatMiniMap/utils.ts:12-15`）用的是 `sqrt(length / 80)` 再夹到 1 ——
 * 同一思路（平方根压缩），但它的归一化分母是固定常数；我们按**本会话内**的 min/max 归一化，
 * 因为我们的字符数跨会话差两个数量级（短的几十字、长的上万字），固定分母会让长会话全部顶到满宽。
 *
 * @param values 同一角色在**当前会话内**的全部取值
 * @param value  这一条的值
 * @param peak   这个角色的峰值宽度
 * @param floor  下限宽度
 */
export function zipWidthOf(
  values: readonly number[],
  value: number,
  peak: number = BAR_WIDTH_MAX,
  floor: number = BAR_WIDTH_MIN,
): number {
  const positives = values.filter((candidate) => Number.isFinite(candidate) && candidate > 0);
  if (positives.length === 0 || !Number.isFinite(value) || value <= 0) return floor;
  const max = Math.max(...positives);
  const min = Math.min(...positives);
  if (max === min) return (floor + peak) / 2;
  const ratio = (Math.sqrt(value) - Math.sqrt(min)) / (Math.sqrt(max) - Math.sqrt(min));
  return floor + clamp01(ratio) * (peak - floor);
}

/**
 * 每条刻度的宽度。用户与 Agent **各自归一化**：两侧字数量级差一个量级
 * （用户一句话几十字、回复几百到几千字），混在一起算 min/max 会让用户刻度全部贴底。
 *
 * @param maxWidth 可用宽度上限（由轨道宽度决定，`min(BAR_WIDTH_MAX, 空白)`）
 */
export function railWidthsOf(ticks: readonly RailTickShape[], maxWidth: number = BAR_WIDTH_MAX): number[] {
  const peak = Math.max(BAR_WIDTH_MIN, maxWidth);
  const userValues = ticks.filter((tick) => tick.role === "user").map((tick) => tick.chars);
  const agentValues = ticks.filter((tick) => tick.role !== "user").map((tick) => tick.chars);
  return ticks.map((tick) => (tick.role === "user"
    ? zipWidthOf(userValues, tick.chars, peak)
    : zipWidthOf(agentValues, tick.chars, peak)));
}

/**
 * 整列的排布：行高、总高、要不要滚动。
 *
 * **行高随条数自适应**（这是"不僵"的第一个机制）：条少 → 24px 舒适行高（达到 WCAG 24px 指针下限）；
 * 条多 → 压到 12px 并**改为滚动**。压到 12px 就不再往下压 —— 再压就点不准了，
 * 而竖条时代正是"继续压到 2px"才丢掉了可点性。
 *
 * **"装不下"没有消失，只是换了表现形式**：竖条时代装不下 = 刻度被裁掉（看不见也点不到）；
 * 横条时代装不下 = 一屏看不全，需要滚动这一列。差别在于**每条仍然存在、仍然可点**。
 * `scrollable` 就是这个区别的标志，`visibleRows` 告诉调用方"一屏能看几条"。
 *
 * @param count 条数
 * @param avail 可用高度（对话区高度）
 */
export function railRowsOf(count: number, avail: number): {
  rowHeight: number; height: number; scrollable: boolean; visibleRows: number;
} {
  if (count <= 0 || !(avail > 0)) return { rowHeight: ROW_HEIGHT_MAX, height: 0, scrollable: false, visibleRows: 0 };
  const cap = Math.max(0, avail * RAIL_MAX_RATIO);
  // 让全部条刚好占满上限时的行高；夹在 [MIN, MAX]
  const ideal = cap / count;
  const rowHeight = Math.min(ROW_HEIGHT_MAX, Math.max(ROW_HEIGHT_MIN, ideal));
  const height = count * rowHeight;
  const scrollable = height > cap + 0.5;
  return {
    rowHeight,
    height: scrollable ? cap : height,
    scrollable,
    visibleRows: Math.floor((scrollable ? cap : height) / rowHeight),
  };
}

/** 轨道宽度与可见性：空白够 24 就出现，宽度 = min(36, 空白)。 */
export function railSlotOf(gutter: number): { visible: boolean; width: number; gutter: number } {
  if (!(gutter >= RAIL_WIDTH_MIN)) return { visible: false, width: 0, gutter: Math.max(0, gutter) };
  return { visible: true, width: Math.min(RAIL_WIDTH_MAX, gutter), gutter };
}

/**
 * 让某一行留在可视区内需要的最小滚动量（用于"跟着正文滚动，自动把当前行滚进来"）。
 *
 * 与 `scrollIntoView({block:"nearest"})` 的区别：那个会**连带滚动所有祖先**，
 * 包括正文容器 —— 条一动，正文跟着跳。这里只算自己的 `scrollTop`。
 *
 * **两端都留余量**（默认 3 行的"安全边"）：贴着上下边缘的那一行看起来像被切掉一半，
 * 而且用户滚动时"当前行"会一直在边缘闪。留出余量后它总是落在舒适的可见区里。
 *
 * @param margin 上下各留多少行（默认 3）
 * @returns 应该设置的 `scrollTop`（已夹在合法区间内；不需要动时返回原值）
 */
export function railEnsureVisible(
  itemTop: number,
  itemHeight: number,
  scrollTop: number,
  viewHeight: number,
  margin: number = 3,
): number {
  if (!(viewHeight > 0)) return scrollTop;
  const pad = Math.min(itemHeight * margin, Math.max(0, (viewHeight - itemHeight) / 2));
  const top = scrollTop + pad;
  const bottom = scrollTop + viewHeight - pad;
  // 上面被裁：把它顶到"上沿 + 余量"
  if (itemTop < top) return Math.max(0, itemTop - pad);
  // 下面被裁：把它顶到"下沿 - 余量"
  if (itemTop + itemHeight > bottom) return Math.max(0, itemTop + itemHeight - viewHeight + pad);
  return scrollTop;
}

/**
 * 可视范围带（滑块）—— **它是滚动条的 thumb，不是"内容里的一截"**。
 *
 * ## 坐标系（这是本文件最容易搞错的一处，2026-11-19 用户指出后重写）
 *
 * 滑块必须画在**列的可视框**坐标系里（`viewHeight`），**不是**可滚内容的坐标系。
 * 早先版本把它画在内容坐标系（`absolute` 在 6720px 的可滚列表里），后果是：
 *  - **拖动刻度列 / 跳到靠上的消息后，滑块滚出视口 → 整个消失**；
 *  - 它的高度按"已下载段"折算，结果 214px —— 一条很长的带子，不像滚动条。
 *
 * 滚动条的正确语义（VSCode `scrollbarState.ts:126-156`）：
 *  - **长度** = 视口占内容的比例；
 *  - **位置** = 当前位置占可滚动范围的比例；
 *  - 两者都在**同一个可视坐标系**里，所以滑块**永远可见**。
 *
 * ## 我们的两处折算
 *
 * 1. **长度**：一屏能看到 `visibleTicks` 条刻度，全会话 `totalTicks` 条 →
 *    滑块占 `visibleTicks / totalTicks`。这样长会话的滑块很短（像滚动条），短会话占满。
 * 2. **位置**：用 `activeIndex / totalTicks`（当前读到第几条刻度 ÷ 总数）。
 *    `activeIndex` 有比例兜底（`railActivePick`），覆盖整个会话，不依赖"已渲染的那一段"。
 *
 * ## 与拖动必须互逆
 *
 * 拖动要改的是正文 `scrollTop`，而滑块位置跟的是 `activeIndex`。两者由"每屏多少刻度"换算：
 *
 * ```
 *   每条刻度 ≈ clientHeight / visibleTicks 像素正文
 *   全会话正文高 ≈ totalTicks × (clientHeight / visibleTicks)
 * ```
 *
 * `ratio` 就是"滑块走 1px 对应正文滚多少 px"，位置与拖动共用它 —— 这样指针走 `d` px，
 * 滑块也走 `d` px。**估算的绝对量可以不准，互逆性必须准**（这是"跟手"的唯一要求）。
 *
 * @param viewHeight   列的可视框高度（px）
 * @param clientHeight 正文可视高（px）
 * @param visibleTicks 一屏能看到几条刻度（实测，只用于估算每屏多少）
 */
export function railOverviewOf(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  viewHeight: number;
}): { top: number; height: number; ratio: number } {
  const { scrollTop, scrollHeight, clientHeight, viewHeight } = input;
  if (!(viewHeight > 0) || !(scrollHeight > 0)) return { top: 0, height: 0, ratio: 1 };
  if (scrollHeight <= clientHeight) return { top: 0, height: viewHeight, ratio: 1 };   // 不可滚 → 占满

  // 长度 = 一屏占内容的比例（VSCode `scrollbarState.ts:144` 同一条）
  const height = Math.min(viewHeight, Math.max(RAIL_SLIDER_MIN, Math.round(viewHeight * clientHeight / scrollHeight)));
  const maxTop = Math.max(0, viewHeight - height);
  if (maxTop <= 0) return { top: 0, height: viewHeight, ratio: 1 };

  /*
   * 位置 = `scrollTop × ratio`（VSCode `minimap.ts:391` **逐字**同一条）。
   *
   * 早先版本用"当前读第几条刻度（activeIndex）"反推位置，那是**多余的绕路**：
   * activeIndex 是离散的、还经过锚点估算，而滚动是连续的 —— 两者不可能 1:1，
   * 表现就是"指针走 10px、滑块走 6px"（实测）。`scrollTop` 是唯一连续且精确的来源。
   */
  const ratio = maxTop / (scrollHeight - clientHeight);
  if (!Number.isFinite(ratio) || ratio <= 0) return { top: 0, height, ratio: 1 };
  return { top: railBandTopOf(scrollTop, ratio, maxTop), height, ratio };
}

/**
 * 滑块位置 = `scrollTop × ratio`，夹在 `[0, maxTop]`（VSCode `minimap.ts:391` 同一行公式）。
 *
 * 单独抽出来是为了让**拖动中能用冻结的 `ratio`** 也算出位置：
 * 拖动时 `scrollTop` 每帧都在变、`visibleTicks` 也可能变（锚点每 150ms 重量一次），
 * 用每帧重算的 ratio 会让"指针走 10px、滑块走 7px"—— 实测就是这样，不跟手。
 */
export function railBandTopOf(scrollTop: number, ratio: number, maxTop: number): number {
  if (!Number.isFinite(scrollTop) || !Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(maxTop, scrollTop * ratio));
}

/** 已下载段之外（还没加载的历史）的滑块起点：用于画一条"上面还有"的虚线提示。 */
export function railLoadedBaseOf(loadedFrom: number, rowHeight: number): number {
  return Math.max(0, loadedFrom) * rowHeight;
}

/** 视口矩形（用于卡片定位的单测夹具）。 */
export type RectLike = { top: number; left: number; right: number; bottom: number; width: number; height: number };

/**
 * 预览卡片：**轨道右侧**、与该行垂直居中，并夹进视口。
 *
 * 为什么不复用 `design/popover.ts` 的 `placePopover`：它是"贴锚点下方/上方"的语义（下拉面板、气泡），
 * 而这里必须**横向**展开在轨道右侧、纵向与那一行对齐 —— 两者的失败模式不同
 * （那边处理"下方放不下翻上方"，这边处理"上下夹紧"），共用只会让两边都长出用不到的分支。
 */
export function railCardPlaceOf(
  row: RectLike,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const pad = CARD_PADDING;
  const centered = row.top + row.height / 2 - size.height / 2;
  const maxTop = Math.max(pad, viewport.height - size.height - pad);
  const top = Math.min(Math.max(centered, pad), maxTop);
  const rawLeft = row.right + CARD_GAP;
  const maxLeft = Math.max(pad, viewport.width - size.width - pad);
  return { top, left: Math.min(Math.max(rawLeft, pad), maxLeft) };
}

/* ── 拖动 scrub（Task 0020 · P7）────────────────────────── */

/**
 * 拖动时"正文该滚到哪"—— **`railBandOfViewport` 的逆运算**（同 VSCode `:254`）。
 *
 * ```ts
 * getDesiredScrollTopFromDelta(delta) { return this.scrollTop + delta / this.computedSliderRatio; }
 * ```
 *
 * 只有用**同一个 ratio** 才能保证"拖 100px → 滑块走 100px"。早先版本在这里自己算
 * `可滚动距离 ÷ 内容高`，与滑块位置的算法不互逆，于是用户看到的是"**正文在滑、块不动**"
 * （2026-11-19 用户报告，已按 VSCode 公式修正）。
 *
 * @param startScrollTop 按下那一刻正文的 `scrollTop`
 * @param deltaY         指针从按下到现在移动了多少 px（向下为正）
 * @param ratio          来自 `railBandOfViewport`（拖动期间应冻结）
 * @param scrollHeight   正文内容高（用于夹紧）
 * @param viewHeight     正文可视高（用于夹紧）
 */
export function railScrubTargetOf(
  startScrollTop: number,
  deltaY: number,
  ratio: number,
  scrollHeight: number,
  viewHeight: number,
): number {
  const scrollable = Math.max(0, scrollHeight - viewHeight);
  if (scrollable <= 0) return 0;
  if (!Number.isFinite(deltaY) || !Number.isFinite(ratio) || ratio <= 0) {
    return Math.max(0, Math.min(scrollable, startScrollTop));
  }
  return Math.max(0, Math.min(scrollable, startScrollTop + deltaY / ratio));
}

/**
 * 一次指针交互是"点击"还是"拖动"（阈值 4px）。
 *
 * 为什么需要区分：同一处按下既可能是"点这条跳过去"，也可能是"按住拖"。没有阈值的话，
 * 手抖 1px 就会把点击吃掉；阈值太大则短距离拖动失效。4px 与浏览器判定 click vs drag 的常规量级一致。
 */
export const RAIL_SCRUB_THRESHOLD = 4;

export function railGestureOf(deltaX: number, deltaY: number): "click" | "scrub" {
  return Math.abs(deltaX) > RAIL_SCRUB_THRESHOLD || Math.abs(deltaY) > RAIL_SCRUB_THRESHOLD ? "scrub" : "click";
}
