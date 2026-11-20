/**
 * 对话区左缘的消息导航条（Task 0020）。
 *
 * ## 它是什么（2026-11-19 用户第二轮裁决后的形态）
 *
 * **位置没变**：仍在对话区左缘那条竖向空白里。
 * **每条刻度变成了横条**：宽度 = 内容量。
 *
 * ```
 *  ▁▁▁▁            ← 用户消息
 *  ▁▁▁▁▁▁▁▁▁▁▁▁    ← 轮末回复（更长）
 *  ▁▁▁▁▁
 * ```
 *
 * 用户原话：「我们把竖条改为横条吧，然后就默认一个最大的一个高度，如果对话太长了，
 * 用户可以滑动这个对话预览」。
 *
 * 这个改动带来三个**实质**变化（不是换个方向那么简单）：
 *  1. **不再需要滑动窗口**：竖条靠高度，装不下只能"只画附近一段"（并为此接受单条 6px、低于 WCAG）；
 *     横条靠宽度，纵向是一列行，装不下就**整列滚动** —— 每条永远有真实的宽度与行高；
 *  2. **行高能自适应**：条少给 24px（WCAG 指针下限），条多压到 10px 再改为滚动（`railRowsOf()`）；
 *  3. **多了一个"可视范围带"**：整列是"整段对话的缩略图"，半透明带告诉你现在读的是哪一段 ——
 *     它连续移动，这就是"不死板"的来源。
 *
 * ## 本质
 *
 * 这是 **timeline scrubber / minimap**（音频波形、视频进度条、图片缩略图都是同一族），
 * 与 agent 无关。所以参考也只取这一族的实现：
 * - lobe-chat `ChatMiniMap/`（横条缩略图：`width = MIN + (MAX-MIN)*sqrt(len/80)`、悬浮淡出、预览面板 scale 入场）；
 * - lobe-chat `AudioPlayer/`（两档色：已播 / 未播，`transition: background 120ms`）；
 * - lobe-chat `RangeLane.tsx`（拖动 scrub：`setPointerCapture` + `timeAt(el, clientX)`）。
 *
 * ## 四条不能破的纪律
 *
 * 1. **不吞正文的点击**：轨道容器 `pointer-events: none`，只有行与卡片 `pointer-events: auto`。
 * 2. **条自己的滚动 ≠ 正文滚动**（两件事）：条滚动只改"显示哪一段刻度"；
 *    正文滚动改"当前是第几条"（active）与"可视范围带"。
 * 3. **不在滚动路径里重建列表**（`specs/code/frontend/code.md` 2.19）：量测节流，只更新少量数值。
 * 4. **颜色/过渡只用 token**：数值在 `api/rail-geometry.ts`，样式在 `tokens.css` 的 `.rail-tick`。
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { LAYER_CLASS, surfaceClass, surfaceStyle } from "../design/surface";
import {
  RAIL_ACTIVE_LOCK_MS,
  railActivePick,
  railAnchorWithLoadedTail,
  railLockActive,
} from "../api/rail-anchor";
import {
  BAR_HEIGHT,
  BAR_HEIGHT_HOVER,
  BAR_WIDTH_MIN,
  RAIL_MAX_RATIO,
  railOverviewOf,
  railBandTopOf,
  railCardPlaceOf,
  railEnsureVisible,
  railGestureOf,
  railRowsOf,
  railScrubTargetOf,
  railSlotOf,
  railWidthsOf,
} from "../api/rail-geometry";

/** `/rail` 端点返回的一条刻度（与服务端 `src/rail-ticks.ts` 的 `RailTick` 同形）。 */
export type RailTickView = {
  id: string;
  role: "user" | "assistant";
  chars: number;
  preview: string;
  /** 回落锚点：这条被过程条折叠时，界面上唯一的锚点是这一轮第一条回复的 id。 */
  host?: string;
};

/** 卡片收起前的宽限（ms）。与原型 90ms 同档：够在行与卡片之间横移。 */
const CARD_HIDE_DELAY = 90;
/** 量测节流（ms）。与 pi-web `ChatMinimap.tsx` 的 150ms 同值。 */
const MEASURE_THROTTLE = 150;
/** 平滑滚动结束后补量一次的延迟（ms）。 */
const SETTLE_DELAY = 220;
/** 卡片宽度（px）：原型 340，与批注浮框上限同档。 */
const CARD_WIDTH = 340;
/** 轨道上下留白（px）：让整列不贴死在对话区上下边缘。 */
const RAIL_VERTICAL_PADDING = 12;

export type MessageRailProps = {
  ticks: readonly RailTickView[];
  /** 正文滚动容器。 */
  scrollContainer: React.RefObject<HTMLElement | null>;
  /** 内容列（`max-w-reading` 那一层）：量它的左缘 × 才知道轨道能用多宽。 */
  contentRef: React.RefObject<HTMLElement | null>;
  /** 点击某条刻度。 */
  onJump: (tick: RailTickView) => void;
  /** 已下载消息的 id 顺序（判"已下载到哪一条"）。 */
  loadedIds: readonly (string | undefined)[];
  /**
   * 拖动开始/结束的通知。调用方（App）用它**暂停"滚到顶自动加载"** ——
   * 否则拖到顶会加载并弹回，看起来是"拖不到最顶"（实测 2026-11-19）。
   */
  onScrubbingChange?: (scrubbing: boolean) => void;

};

/**
 * 已渲染消息的锚点（内容坐标系里的 top）。
 *
 * 只量**有刻度的**消息：长会话里几千条消息，量全部会让滚动变卡。
 * `data-message-id` 由 `views/Message.tsx` 挂在每条消息上（与批注定位同一个锚点体系）。
 */
function measureAnchors(container: HTMLElement, ticks: readonly RailTickView[]): Array<{ id: string; top: number }> {
  const containerTop = container.getBoundingClientRect().top;
  const offset = container.scrollTop - containerTop;
  /*
   * **一次** `querySelectorAll` 建索引，再按刻度的顺序取 —— 而不是对每条刻度各来一次 `querySelector`。
   * 实测代价：560 条刻度的会话里，逐条查是 560 次选择器解析 + 560 次布局读取，
   * 耳朵贴在滚动路径上（`frontend/code.md` 2.19 反对"滚动时做与数据量成正比的工作"）。
   * 这里只量**已渲染**的那些（几十条），没渲染的根本不在 DOM 里，跳过不猜位置。
   */
  const topOf = new Map<string, number>();
  for (const node of container.querySelectorAll<HTMLElement>("[data-message-id]")) {
    const id = node.getAttribute("data-message-id");
    if (id === null || topOf.has(id)) continue;
    topOf.set(id, node.getBoundingClientRect().top + offset);
  }
  const anchors: Array<{ id: string; top: number }> = [];
  for (const tick of ticks) {
    const top = topOf.get(tick.id);
    if (top === undefined) continue;
    anchors.push({ id: tick.id, top });
  }
  return anchors;
}

/** 已下载消息对应的最小刻度下标（0 = 整段都下载了）。 */
function firstLoadedTickIndex(loadedIds: readonly (string | undefined)[], ticks: readonly RailTickView[]): number {
  if (loadedIds.length === 0) return 0;
  const ids = new Set<string>();
  for (const id of loadedIds) if (id !== undefined) ids.add(id);
  const index = ticks.findIndex((tick) => ids.has(tick.id));
  return index >= 0 ? index : 0;
}

export const MessageRail = memo(function MessageRail({
  ticks,
  scrollContainer,
  contentRef,
  onJump,
  loadedIds,
  onScrubbingChange,
}: MessageRailProps) {
  const [slot, setSlot] = useState<{ visible: boolean; width: number; gutter: number }>({ visible: false, width: 0, gutter: 0 });
  /** 可用高度（= 对话区高度）。 */
  const [avail, setAvail] = useState(0);
  /** 列的可视框高度（滑块坐标系的高度；也是 `maxHeight` 落到的那个值）。 */
  const [listViewHeight, setListViewHeight] = useState(0);
  /** 精确锚点（量 DOM）；空时用比例兜底。 */
  const [anchors, setAnchors] = useState<Array<{ id: string; top: number }>>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [metrics, setMetrics] = useState({ scrollHeight: 0, clientHeight: 0 });
  const [hovered, setHovered] = useState<string | undefined>(undefined);
  const [active, setActive] = useState<string | undefined>(undefined);
  const [card, setCard] = useState<{ tick: RailTickView; top: number; left: number } | undefined>(undefined);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const measureTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lockRef = useRef<{ index: number; until: number } | undefined>(undefined);
  const loadedFromRef = useRef(0);
  const measureRef = useRef<() => void>(() => {});
  const pendingCardRef = useRef<{ tick: RailTickView; rowRect: DOMRect; railRight: number } | undefined>(undefined);
  /** 最近一次由"正文滚动"驱动的高亮行 —— 用它把条自己滚到可见（而不是用 scrollIntoView）。 */
  const followRef = useRef<{ index: number } | undefined>(undefined);
  /**
   * 拖动 scrub 的状态（Task 0020 · P7）。
   *
   * 形态参照 **VSCode / Sublime 的 minimap**：在缩略图上按住拖动，编辑器内容跟着滚。
   * 语义是**相对位移**（`railScrubTargetOf`）：按下时记 `scrollTop`，之后只按"指针移动了多少"换算
   * ——不是"指针的绝对位置 → 内容比例"。后者在可滚的列上会打架：列自己也在跟着滚，
   * 映射基准每帧都变，指针不动正文却在加速跑。
   */
  const scrubRef = useRef<{
    pointerId: number; startY: number; startScrollTop: number;
    /** 按下那一刻的滑块比例（拖动中冻结：位置与拖动必须共用同一个） */
    ratio: number; moved: boolean;
  } | undefined>(undefined);
  /** 拖完之后浏览器仍会补一个 `click`：用它把那次点击吃掉，否则松手会额外跳一次。 */
  const suppressClickRef = useRef(false);
  const [scrubbing, setScrubbing] = useState(false);

  /*
   * 通知调用方"开始/结束拖动"→ App 用它暂停"滚到顶自动加载"。
   *
   * **必须同步调**（不能用 useEffect 跟着 state 走）：`setScrubbing` 是异步的，
   * 而拖动时 `container.scrollTop = 0` 是同步的 —— 哨兵会在 effect 之前就触发加载，
   * 于是"拖到顶 → 加载 → 位置被弹回 → 看起来拖不动"（2026-11-19 实测）。
   */
  const notifyScrubbing = useCallback((active: boolean) => {
    onScrubbingChange?.(active);
  }, [onScrubbingChange]);

  /* ── 1. 量容器 ─────────────────────────────────────────── */

  useLayoutEffect(() => {
    const container = scrollContainer.current;
    const content = contentRef.current;
    const rail = containerRef.current;
    if (container === null || content === null) return;

    const measure = () => {
      const containerRect = container.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      // 内容列左缘到容器左缘 = 这块空白。比复现 layout() 的公式可靠（真实界面还有滚动条与缩放）。
      setSlot(railSlotOf(contentRect.left - containerRect.left));
      /*
       * 可用高度 = 轨道容器的高度（它就是 `absolute inset-y-0`，等于对话区高度）。
       * **不能**用它的第一个子元素（那是可滚列表本身）：列表高度由这里算出来的 `avail` 决定，
       * 量它就成了循环依赖 —— 实测第一版量出 12px，整列被压成一条。
       */
      const railHeight = rail instanceof HTMLElement ? rail.clientHeight : containerRect.height;
      setAvail(Math.max(0, railHeight - 2 * RAIL_VERTICAL_PADDING));
      // 可视框高 = 整列的可视高度（滑块在这个坐标系里定位）
      const listEl = listRef.current;
      if (listEl !== null) setListViewHeight(Math.round(listEl.clientHeight));
      setMetrics({ scrollHeight: container.scrollHeight, clientHeight: container.clientHeight });
      setScrollTop(container.scrollTop);
      setAnchors(measureAnchors(container, ticks));
      loadedFromRef.current = firstLoadedTickIndex(loadedIds, ticks);
    };
    measureRef.current = measure;
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(content);
    if (rail !== null) observer.observe(rail);
    return () => observer.disconnect();
  }, [scrollContainer, contentRef, ticks, loadedIds]);

  /* ── 2. 正文滚动 ──────────────────────────────────────── */

  useEffect(() => {
    const container = scrollContainer.current;
    if (container === null) return;
    let raf = 0;
    let lastCommitted = container.scrollTop;
    const onScroll = () => {
      /*
       * 滚动期间**每帧只提交一次**、且只在值真的变了时提交（`frontend/code.md` 2.19：
       * 连续手势不驱动 React 状态）。直接 `setScrollTop(...)` 会让滚动事件频率（~120Hz）
       * 带着整棵子树重渲染 —— 尽管这里只更新一个数，"每帧一次 commit"本身就是滚动抖动的来源。
       */
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = container.scrollTop;
        if (next === lastCommitted) return;
        lastCommitted = next;
        setScrollTop(next);
      });
      if (measureTimerRef.current !== undefined) return;
      measureTimerRef.current = setTimeout(() => {
        measureTimerRef.current = undefined;
        measureRef.current();
        // 平滑滚动结束后补量一次：节流窗口里那次可能在动画中途量到
        settleTimerRef.current = setTimeout(() => {
          settleTimerRef.current = undefined;
          measureRef.current();
        }, SETTLE_DELAY);
      }, MEASURE_THROTTLE);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (raf !== 0) cancelAnimationFrame(raf);
      if (measureTimerRef.current !== undefined) { clearTimeout(measureTimerRef.current); measureTimerRef.current = undefined; }
      if (settleTimerRef.current !== undefined) { clearTimeout(settleTimerRef.current); settleTimerRef.current = undefined; }
    };
  }, [scrollContainer]);

  /* ── 3. 当前行 + 可视范围 ──────────────────────────────── */

  const activePick = useMemo(() => {
    if (railLockActive(lockRef.current, Date.now())) return { index: lockRef.current!.index, source: "locked" as const };
    const fraction = railAnchorWithLoadedTail(
      scrollTop, metrics.scrollHeight, metrics.clientHeight, ticks.length, loadedFromRef.current,
    );
    const picked = railActivePick(
      anchors, scrollTop, metrics.clientHeight, undefined, fraction,
      { lastIndex: Math.max(0, ticks.length - 1), scrollHeight: metrics.scrollHeight, loadedFrom: loadedFromRef.current },
    );
    if (picked.index === undefined) return { index: undefined, source: picked.source };
    if (picked.source !== "anchor") return { index: picked.index, source: picked.source };
    const id = anchors[picked.index]?.id;
    if (id === undefined) return { index: fraction, source: "fraction" as const };
    const tickIndex = ticks.findIndex((tick) => tick.id === id);
    return { index: tickIndex >= 0 ? tickIndex : fraction, source: picked.source };
  }, [anchors, scrollTop, metrics, ticks]);

  const anchorIndex = activePick.index;

  useEffect(() => {
    if (anchorIndex === undefined) return;
    const tick = ticks[anchorIndex];
    if (tick === undefined) return;
    setActive(tick.id);
    followRef.current = { index: anchorIndex };
  }, [anchorIndex, ticks]);

  /* ── 4. 列的排布 ───────────────────────────────────────── */

  const rows = useMemo(() => railRowsOf(ticks.length, avail), [ticks.length, avail]);
  /*
   * 常规条的上限 **比"当前条"少 6px**（`slot.width - 10` vs `slot.width - 4`）。
   * 为什么：轨道只有 36px 宽，若常规条也能到 32px，"当前条跨满 32px"就与最长的一条同宽 ——
   * 实测截图里完全看不出哪条是当前（十字路口：宽度这个通道被自己占满了）。
   */
  const barPeak = Math.max(BAR_WIDTH_MIN + 2, slot.width - 10);
  const widths = useMemo(() => railWidthsOf(ticks, barPeak), [ticks, barPeak]);

  /**
   * 可视范围内的行区间（用于"可视范围带"）。
   *
   * 直接用正文的可视范围去反推"哪些刻度在这一屏里"，而不是用条的滚动位置：
   * 条可能被用户滚到别处看（那时带去指的仍是"正文在读哪一段"，这是这个控件的信息价值）。
   */
  const bandRows = useMemo(() => {
    const top = scrollTop;
    const bottom = scrollTop + metrics.clientHeight;
    /*
     * 先建 id → top 的索引再扫一遍：直接在内层 `anchors.find()` 是 O(条数 × 锚点数)，
     * 560 条刻度的会话里每次滚动要跑 30 万次比较（实测这属于"滚动路径上的重算"，`frontend/code.md` 2.19 反对）。
     */
    const topOf = new Map<string, number>();
    for (const anchor of anchors) topOf.set(anchor.id, anchor.top);
    let first = -1;
    let last = -1;
    for (let index = 0; index < ticks.length; index += 1) {
      const anchorTop = topOf.get(ticks[index].id);
      if (anchorTop === undefined) continue;
      if (anchorTop >= top - metrics.clientHeight * 0.5 && anchorTop <= bottom) {
        if (first < 0) first = index;
        last = index;
      }
    }
    if (first < 0) {
      // 没有任何可见锚点（渲染窗口只覆盖别处）：退化成"当前行"+附近一行
      const fallback = anchorIndex ?? 0;
      first = Math.max(0, fallback);
      last = Math.min(ticks.length - 1, fallback + 1);
    }
    return { first, last };
  }, [anchors, ticks, scrollTop, metrics.clientHeight, anchorIndex]);

  /*
   * 带状指示的坐标基准是**全部行的总高**（`count × rowHeight`），不是可视高度。
   * 踩过：可滚时用 `rows.height`（= 62% 上限 523px）当基准，而真实内容高 960px ——
   * 带的位置只到 523/960 的位置，指向"中段偏上"，与正文实际读到的地方对不上。
   */
  /*
   * 带的**位置**跟 `anchorIndex`（当前读到第几条），**高度**跟实测的"一屏几条"。
   *
   * 早先位置是用 anchors 算的（"哪些锚点落在视口内"），那在虚拟化渲染下是错的 ——
   * 锚点只覆盖队尾一小段，于是用户滚到会话 10% 时那块还指着末尾（实测 513-519/560）。
   * 详见 `railBandOf` 头注。
   */
  /*
   * 滑块（可视范围带）：位置 = `scrollTop × ratio`，与拖动**互逆**（VSCode `minimap.ts:391/:254`）。
   *
   * **拖动中必须用冻结的 ratio**：`scrollTop` 每帧都在变，而 `visibleTicks`（bandRows）由锚点算，
   * 锚点每 150ms 才重量一次 —— 用实时 ratio 会出现"指针走 10px、滑块走 7px"（实测）。
   * 冻结之后严格 1:1，这才是"拖那个块它跟着鼠标走"。
   */
  /*
   * 滑块（可视范围带）：**画在列的可视框坐标系里**，所以它永远可见（不会随刻度列滚动而消失）。
   * 长度 = 一屏占全会话的比例，位置 = 当前刻度在全会话里的比例。见 `railOverviewOf` 头注。
   */
  const liveBand = useMemo(() => railOverviewOf({
    scrollTop,
    scrollHeight: metrics.scrollHeight,
    clientHeight: metrics.clientHeight,
    viewHeight: listViewHeight,
  }), [scrollTop, metrics.scrollHeight, metrics.clientHeight, listViewHeight]);

  /**
   * 最新 `liveBand` 的转发（供 `onRowPointerDown` 读）。
   *
   * 为什么用 ref 而不是进依赖表：`onRowPointerDown` 依赖 liveBand 会让它每帧重建，
   * 进而让 `RailRows` 的 props 变、560 行白重渲一次。
   *
   * 为什么必须有它（实测 2026-11-19）：漏了这一步，`onRowPointerDown` 的闭包捕获的是
   * **首次渲染时**的 liveBand（那时 `metrics` 还是 0 → `ratio` 落在"不可滚动"分支 = 1），
   * 于是拖动一开始滑块就跳到末端、之后再也不动。
   */
  const liveBandRef = useRef(liveBand);
  liveBandRef.current = liveBand;
  /** `metrics` 的最新值转发（pointerdown 的闭包不能直接读 state）。 */
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  /*
   * 滑块的位置**直接来自 `liveBand`**（跟 `activeIndex` 走），不需要手算 ——
   * 因为 `activeIndex` 本身就跟正文滚动同步变化，所以拖动时滑块自然跟手。
   * 拖动中只冻结 `ratio`（位置与滚动的换算系数），避免它随测量抖动。
   */
  const band = liveBand;
  void scrubbing;

  /* ── 4b. 把"当前/悬停/tabIndex"写进 DOM（不进 React 渲染路径）── */

  /**
   * 行的三种"经常变的状态"用**直接写 DOM**维护，不让它们成为 `RailRows` 的 props：
   *  - `data-rail-active`（当前条：强调色 + 跨满 + 描边）
   *  - `data-rail-hovered`（悬停条）
   *  - `aria-current` + `tabIndex`（roving tabindex：整列只有一个 Tab 停靠点）
   *
   * **为什么**：这些值经由 props 传给 `RailRows` 时，任何一个变化都会让 **560 行全量重渲染**
   * （`memo` 只能挡住"props 没变"的情况）。高亮在滚动/流式期间是高频变化的，所以走 DOM 直写，
   * 每次只有 O(变化条数) 次属性写。
   *
   * **实测数据要如实记**（2026-11-19）：流式 120 个 delta 时，竖条可见与竖条隐藏
   * 各有 **8 个长任务**（最长 65 / 89ms）—— 也就是说**那些长任务不是竖条引入的**，
   * 是流式渲染本身的存量行为（Task 0018 的范围）。所以这条改动是**预防性**的：
   * 它消除的是"560 行重渲染"这件事本身，不是那 8 个长任务。
   * （第一次用 390 宽做对照得出"竖条是元凶"是错的：那同时改了宽度与移动端布局两个变量。）
   *
   * 用 `[data-rail-active]` 记录"上一次是谁"，避免全量清（560 次查询换成 1 次）。
   */
  useEffect(() => {
    const root = containerRef.current;
    if (root === null) return;
    const paint = (attribute: string, id: string | undefined, extra?: (node: HTMLElement, on: boolean) => void) => {
      for (const node of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
        node.removeAttribute(attribute);
        extra?.(node, false);
      }
      if (id === undefined) return;
      const node = root.querySelector<HTMLElement>(`[data-rail-id="${CSS.escape(id)}"]`);
      if (node === null) return;
      node.setAttribute(attribute, "true");
      extra?.(node, true);
    };
    paint("data-rail-active", active, (node, on) => {
      if (on) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
    paint("data-rail-hovered", hovered);
    /*
     * roving tabindex：只有"当前"那条是 0，其余 -1。
     * 一列有 560 条时，若每条都 `tabIndex=0`，键盘用户要按 560 次 Tab —— 那不是导航条，是一堵墙。
     */
    for (const node of root.querySelectorAll<HTMLElement>("[data-testid=rail-tick]")) node.tabIndex = -1;
    const focusNode = active === undefined ? null : root.querySelector<HTMLElement>(`[data-rail-id="${CSS.escape(active)}"]`);
    const fallback = focusNode ?? root.querySelector<HTMLElement>("[data-testid=rail-tick]");
    if (fallback !== null) fallback.tabIndex = 0;
  }, [active, hovered, ticks]);

  /* ── 5. 把当前行滚进条的视口（只动条，不动正文）───────── */

  useEffect(() => {
    const list = listRef.current;
    const follow = followRef.current;
    if (list === null || follow === undefined || !rows.scrollable) return;
    const target = railEnsureVisible(follow.index * rows.rowHeight, rows.rowHeight, list.scrollTop, list.clientHeight);
    if (Math.abs(target - list.scrollTop) < 1) return;
    list.scrollTo({ top: target, behavior: "smooth" });
  }, [anchorIndex, rows.scrollable, rows.rowHeight]);

  /* ── 6. 悬停与卡片 ─────────────────────────────────────── */

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current === undefined) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = undefined;
  }, []);

  const placeCard = useCallback((tick: RailTickView, node: HTMLElement) => {
    const rail = containerRef.current;
    if (rail === null) return;
    const railRect = rail.getBoundingClientRect();
    const rowRect = node.getBoundingClientRect();
    pendingCardRef.current = { tick, rowRect, railRight: railRect.left + railRect.width };
    const guess = railCardPlaceOf(
      { top: rowRect.top, left: rowRect.left, right: railRect.left + railRect.width, bottom: rowRect.bottom, width: rowRect.width, height: rowRect.height },
      { width: CARD_WIDTH, height: 132 },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setCard({ tick, top: guess.top, left: guess.left });
  }, []);

  /** 卡片渲染后用**真实尺寸**校正位置（第一版按 132px 估算，实测卡片 115.9px → 错位 19.8px）。 */
  useLayoutEffect(() => {
    const pending = pendingCardRef.current;
    const panel = cardRef.current;
    if (pending === undefined || panel === null) return;
    const rect = panel.getBoundingClientRect();
    const place = railCardPlaceOf(
      { top: pending.rowRect.top, left: pending.rowRect.left, right: pending.railRight, bottom: pending.rowRect.bottom, width: pending.rowRect.width, height: pending.rowRect.height },
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    if (Math.abs(place.top - (parseFloat(panel.style.top) || 0)) > 0.5) panel.style.top = `${place.top}px`;
    if (Math.abs(place.left - (parseFloat(panel.style.left) || 0)) > 0.5) panel.style.left = `${place.left}px`;
  }, [card]);

  const onTickEnter = useCallback((tick: RailTickView, node: HTMLElement) => {
    clearHideTimer();
    setHovered(tick.id);
    placeCard(tick, node);
  }, [clearHideTimer, placeCard]);

  const onTickLeave = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = undefined;
      setHovered(undefined);
      setCard(undefined);
    }, CARD_HIDE_DELAY);
  }, [clearHideTimer]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  /** Esc 关卡片。 */
  useEffect(() => {
    if (card === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      clearHideTimer();
      setHovered(undefined);
      setCard(undefined);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [card, clearHideTimer]);

  /* ── 7. 拖动 scrub（按住拖，正文连续跟手）───────────────── */

  /**
   * 按下：只记起点，**不改任何状态** —— 因为这次按下也可能是一次点击。
   * 触屏不参与（`pointerType === "touch"`）：触屏上下滑应该是**滚这一列**，与原生行为一致；
   * 把它抢过来做 scrub 会让"想看更多刻度"变成"正文乱跑"。
   */
  const onRowPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") return;
    if (event.button !== 0) return;
    const container = scrollContainer.current;
    if (container === null) return;
    /*
     * **按在滑块里 = 拖动；按在滑块外 = 点击跳转**（与 VSCode 的分工一致）。
     *
     * 源码依据：`microsoft/vscode` `minimap.ts:1459-1484` 把拖动绑在 **slider 元素**上
     * （`_sliderPointerDownListener`），点 minimap 其他区域走另一条路径 —— 它**没有**"位移超过阈值才算拖"。
     *
     * 我们原来只有 4px 阈值，于是"想拖但手没动起来"会被判成点击 → **跳到那一行**。
     * 用户 2026-11-19 报的"有时突然一下又到顶部了，我都没点顶部的横条"就是这个：
     * 按在视口上方某一行、手没动够 4px 就松手 → 跳到上面去了。
     * 现在只要按在滑块范围内，就一定是拖动，绝不会因为"没动够"变成跳转。
     */
    /*
     * **几何没就绪就不当拖动处理**（2026-11-19 修"一刷新、一拖动就跳到最顶"）：
     * 刚刷新时 `metrics` 还是 `{0,0}`，此时 `ratio` 落在"不可滚动"分支，
     * 拖动会把 band 算成 0（= 最顶），看起来就是"跳上去了"。
     */
    if (!(liveBandRef.current.height > 0) || !(metricsRef.current.clientHeight > 0)) return;
    const bandNode = containerRef.current?.querySelector<HTMLElement>(".rail-band");
    const bandRect = bandNode?.getBoundingClientRect();
    const onBand = bandRect !== undefined && bandRect !== null
      && event.clientY >= bandRect.top && event.clientY <= bandRect.bottom;
    scrubRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: container.scrollTop,
      /*
       * 冻结 ratio 与滑块条数。为什么必须冻结（实测 2026-11-19）：
       * 不冻结时"指针走 10px、滑块只走 7px"—— 因为滑块位置用的是每帧重算的 ratio，
       * 而拖动用的 ratio 是按下那一刻的，两者不互逆。冻结后严格 1:1。
       * 同时也避免"拖动中加载了更早的页 → scrollHeight 变 → 滑块突然变长变位"。
       */
      ratio: liveBandRef.current.ratio,
      // 按在滑块上：直接进入拖动（不看阈值）；按在外面：先按"可能的点击"处理
      moved: onBand,
    };
    if (onBand) {
      setScrubbing(true);
      notifyScrubbing(true);
      // 这次交互不是点击：松手时浏览器补的 click 要被吃掉
      suppressClickRef.current = true;
      clearHideTimer();
      setHovered(undefined);
      setCard(undefined);
    }
    // 捕获指针：拖到列表外面也继续收事件（否则拖快了会"掉线"）
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [scrollContainer]);

  const onRowPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const scrub = scrubRef.current;
    if (scrub === undefined || scrub.pointerId !== event.pointerId) return;
    const container = scrollContainer.current;
    if (container === null) return;
    const deltaY = event.clientY - scrub.startY;
    if (!scrub.moved) {
      if (railGestureOf(0, deltaY) === "click") return;    // 阈值内：还可能是一次点击
      scrub.moved = true;
      setScrubbing(true);
      notifyScrubbing(true);
      suppressClickRef.current = true;
      // 进入拖动：收起卡片、清掉悬停 —— 拖动途中一路弹卡片会很吵
      clearHideTimer();
      setHovered(undefined);
      setCard(undefined);
    }
    /*
     * 直接写 `scrollTop`，**不用** `scrollIntoView({behavior:"smooth"})`：
     * 拖动要跟手，平滑滚动会把每次位移排队成动画，表现是"手停了它还在滚"。
     * 与拖动列宽同一条纪律（`frontend/code.md` 2.19：手势期间写 DOM）。
     */
    /*
     * **一次拖动只能在"已渲染的那一段"里移动**（这条限制必须写出来，它是约束不是缺陷）：
     * 正文是虚拟化渲染的（`visibleCount` 只渲染最近 50 条所在整轮，更早的滚到顶才加载），
     * 所以 `container.scrollHeight` 只反映**当前已渲染部分**。于是：
     *  - 在底部往下拖 = 到底了，不动（与滚动条一致）；
     *  - 往上拖正常跟手；拖到顶时顶部哨兵会加载更早的一页，继续拖就能再往前。
     *
     * 为什么不用"整个会话的高度"当基准：那个数前端**不知道**（未加载的页还没量）。
     * 若按"整列内容高 → 全会话高度"硬映射，用户会拖到一片还没加载的区域，
     * 表现是"指针在动、画面不动"—— 比现在的"渐进式"更糟。
     */
    container.scrollTop = railScrubTargetOf(
      scrub.startScrollTop,
      deltaY,
      scrub.ratio,
      container.scrollHeight,
      container.clientHeight,
    );

  }, [scrollContainer, rows.rowHeight, ticks.length, clearHideTimer]);

  const endScrub = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const scrub = scrubRef.current;
    if (scrub === undefined || scrub.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    scrubRef.current = undefined;
    setScrubbing(false);
    notifyScrubbing(false);
  }, [notifyScrubbing]);

  /* ── 8. 点击 ───────────────────────────────────────────── */

  const handleJump = useCallback((tick: RailTickView, index: number) => {
    // 刚拖完的那一下点击要吃掉（松手时浏览器会补一个 click）
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    lockRef.current = { index, until: Date.now() + RAIL_ACTIVE_LOCK_MS };
    setActive(tick.id);
    onJump(tick);
  }, [onJump]);

  if (!slot.visible || ticks.length === 0) return null;

  const hovering = hovered !== undefined;

  return (
    <div
      ref={containerRef}
      data-testid="message-rail"
      data-rail-scrollable={rows.scrollable ? "true" : "false"}
      data-rail-active-index={anchorIndex ?? "none"}
      data-rail-band={`${bandRows.first}-${bandRows.last}`}
      className={`pointer-events-none absolute inset-y-0 left-0 flex flex-col items-center justify-center ${LAYER_CLASS.rail}`}
      style={{ width: slot.width }}
    >
      {/*
        可视框：**不滚动**，滑块（band）相对它定位 —— 这样滑块永远在可视范围内，
        不会像早先那样被"刻度列自己滚动"带走（用户 2026-11-19："我滚动了上面那个条，
        或者点击了靠上的一些横条之后，你那个滚动条见都不见了"）。
      */}
      <div
        className="relative"
        style={{ width: slot.width, maxHeight: avail > 0 ? Math.max(0, avail * RAIL_MAX_RATIO) : undefined }}
      >
        {/*
          「当前读到哪一截」的滑块：画在**可视框坐标系**里（`liveBand` 的 top/height 都相对它）。
          放在可滚列表**外面**是必须的 —— 早先放在里面（内容坐标系）时，列表一滚它就滚出视口。
          `z-0` + `pointer-events-none`：它只是背景指示，点击命中仍在行上。
        */}
        {rows.height > 0 && band.height > 0 && (
          <div
            aria-hidden
            className="rail-band pointer-events-none absolute left-0 right-0"
            style={{ top: band.top, height: Math.max(2, band.height) }}
          />
        )}
        <div
          ref={listRef}
          className="rail-scroll rail-tracking pointer-events-auto relative overflow-y-auto overscroll-y-contain"
          data-rail-hovering={hovering ? "true" : "false"}
          /* 拖动中：CSS 用这个属性把整列的光标切成 grabbing（挂在 `.rail-tracking` 上才是选择器基准） */
          data-rail-scrubbing={scrubbing ? "true" : "false"}
          role="toolbar"
          aria-orientation="vertical"
          aria-label="消息导航"
          style={{ width: slot.width, maxHeight: avail > 0 ? Math.max(0, avail * RAIL_MAX_RATIO) : undefined }}
        >
        <RailRows
          ticks={ticks}
          widths={widths}
          rowHeight={rows.rowHeight}
          slotWidth={slot.width}
          onEnter={onTickEnter}
          onLeave={onTickLeave}
          onJump={handleJump}
          onPointerDown={onRowPointerDown}
          onPointerMove={onRowPointerMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
        />
        </div>
      </div>

      {card !== undefined && (
        <div
          ref={cardRef}
          data-testid="rail-card"
          role="tooltip"
          style={{ position: "fixed", top: card.top, left: card.left, width: CARD_WIDTH, ...surfaceStyle("popover") }}
          className={`rail-card pointer-events-none ${surfaceClass("popover")} ${LAYER_CLASS.popover}`}
        >
          <p className="mb-1 text-micro text-ink-500">
            {card.tick.role === "user" ? "你" : `Agent · ${card.tick.chars.toLocaleString()} 字`}
          </p>
          <p className="whitespace-pre-wrap break-words text-meta text-ink-900"
            style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {card.tick.preview}
          </p>
        </div>
      )}
    </div>
  );
});

/**
 * 一列行（**单独 memo**）。
 *
 * 为什么拆出来：父组件在滚动时会 `setScrollTop`（每帧最多一次），若行是父组件里直接 map 出来的，
 * 每次重渲染都会重建 560 个 `<button>` 的 props 与内联 style。拆成 `memo` 之后，
 * 滚动导致的父重渲染只传下**没变的**几个引用，行树整体跳过（`frontend/code.md` 2.31 的同一条思路：
 * 热路径上的重算量必须与历史长度无关）。
 *
 * 传下去的都是原始值或稳定引用（`ticks`/`widths` 由 useMemo 给出，回调由 useCallback 给出）。
 */
const RailRows = memo(function RailRows({
  ticks, widths, rowHeight, slotWidth, onEnter, onLeave, onJump,
  onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
}: {
  ticks: readonly RailTickView[];
  widths: readonly number[];
  rowHeight: number;
  slotWidth: number;
  onEnter: (tick: RailTickView, node: HTMLElement) => void;
  onLeave: () => void;
  onJump: (tick: RailTickView, index: number) => void;
  /** 拖动 scrub（P7）：按下/移动/松手。语义是"相对位移"，见 `railScrubTargetOf`。 */
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  /** ↑/↓/Home/End 在条内移动焦点，并保持"只有一条 tabIndex=0"。 */
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
    const toHome = event.key === "Home";
    const toEnd = event.key === "End";
    if (!forward && !backward && !toHome && !toEnd) return;
    event.preventDefault();
    const next = toHome ? 0 : toEnd ? ticks.length - 1 : Math.max(0, Math.min(ticks.length - 1, index + (forward ? 1 : -1)));
    const nodes = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-testid=rail-tick]");
    nodes?.[next]?.focus();
  };

  return (
    <div
      ref={listRef}
      className="relative flex flex-col"
    >
      {ticks.map((tick, index) => {
        return (
          <button
            key={tick.id}
            type="button"
            data-testid="rail-tick"
            data-rail-id={tick.id}
            data-rail-role={tick.role}
            aria-label={`跳到${tick.role === "user" ? "提问" : "回复"}：${tick.preview.slice(0, 20)}`}
            /* tabIndex 由父组件的 effect 维护（roving：只有"当前"那条是 0），见 `syncRowStates` */
            tabIndex={-1}
            className="rail-tick relative flex shrink-0 items-center justify-start pl-0.5"
            /*
             * 宽度与厚度用 **CSS 变量**传，而不是在 span 上写内联 width/height：
             * 这样"当前/悬停 → 跨满整列 + 变厚"完全由 CSS 完成（`[data-rail-active="true"]` 覆盖
             * `--rail-bar-w/h`），React **不需要**为了高亮变化重渲染任何一行。
             *
             * 为什么必须这样（2026-11-19 实测）：高亮原先走 props（`activeId`）传进 `RailRows`，
             * 流式期间高亮每帧都可能变 → 560 行全量重渲染。A/B 实测：
             * 竖条不在时 0 个长任务；竖条在时 **8 个长任务、最长 67ms**。改成 DOM 直写后归零。
             */
            style={{
              height: rowHeight,
              width: slotWidth,
              ["--rail-bar-w" as string]: `${widths[index]}px`,
              ["--rail-bar-h" as string]: `${BAR_HEIGHT}px`,
              ["--rail-bar-hover" as string]: `${BAR_HEIGHT_HOVER}px`,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onMouseEnter={(event) => onEnter(tick, event.currentTarget)}
            onMouseLeave={onLeave}
            onFocus={(event) => onEnter(tick, event.currentTarget)}
            onBlur={onLeave}
            onClick={() => onJump(tick, index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {/*
              真条是**按钮内的一个 span**，宽度 = 内容量（内联）。
              为什么不直接把按钮本身画成条：按钮要保持**整行全宽可点**（命中区 = 行），
              而视觉的条只是那一小段 —— "能点的范围"与"看见的条"是两件事，不能混成同一个盒子。
            */}
            <span aria-hidden className="rail-tick-bar" />
          </button>
        );
      })}
    </div>
  );
});
