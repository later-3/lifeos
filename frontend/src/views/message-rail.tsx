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
  RAIL_MAX_RATIO,
  BAR_WIDTH_MIN,
  railBandOf,
  railCardPlaceOf,
  railEnsureVisible,
  railRowsOf,
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
}: MessageRailProps) {
  const [slot, setSlot] = useState<{ visible: boolean; width: number; gutter: number }>({ visible: false, width: 0, gutter: 0 });
  /** 可用高度（= 对话区高度）。 */
  const [avail, setAvail] = useState(0);
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
  const band = useMemo(
    () => railBandOf(bandRows.first, bandRows.last, ticks.length, ticks.length * rows.rowHeight),
    [bandRows.first, bandRows.last, ticks.length, rows.rowHeight],
  );

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

  /* ── 7. 点击 ───────────────────────────────────────────── */

  const handleJump = useCallback((tick: RailTickView, index: number) => {
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
      {/* 整列最多占 RAIL_MAX_RATIO 的可用高度；超了就内部滚动 */}
      <div
        ref={listRef}
        className="rail-scroll rail-tracking pointer-events-auto relative overflow-y-auto overscroll-y-contain"
        data-rail-hovering={hovering ? "true" : "false"}
        role="toolbar"
        aria-orientation="vertical"
        aria-label="消息导航"
        style={{ width: slot.width, maxHeight: avail > 0 ? Math.max(0, avail * RAIL_MAX_RATIO) : undefined }}
      >
        {/*
          「当前可视范围」带：绝对定位在行之上、不参与布局。

          **可滚时也要画**（第一版只在 `!rows.scrollable` 时画，于是长会话里"我在哪一段"完全没有指示，
          只剩一个不起眼的小点 —— 实测截图如此）。可滚时它跟着内容一起滚，语义仍然正确：
          它标的是"内容里的哪一段"，不是"视口里的哪个位置"。
        */}
        {rows.height > 0 && (
          <div
            aria-hidden
            className="rail-band pointer-events-none absolute left-0 right-0"
            style={{ top: band.top, height: Math.max(2, band.height) }}
          />
        )}
        <RailRows
          ticks={ticks}
          widths={widths}
          rowHeight={rows.rowHeight}
          slotWidth={slot.width}
          activeId={active}
          hoveredId={hovered}
          onEnter={onTickEnter}
          onLeave={onTickLeave}
          onJump={handleJump}
        />
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
  ticks, widths, rowHeight, slotWidth, activeId, hoveredId, onEnter, onLeave, onJump,
}: {
  ticks: readonly RailTickView[];
  widths: readonly number[];
  rowHeight: number;
  slotWidth: number;
  activeId: string | undefined;
  hoveredId: string | undefined;
  onEnter: (tick: RailTickView, node: HTMLElement) => void;
  onLeave: () => void;
  onJump: (tick: RailTickView, index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  /*
   * **roving tabindex**（WAI-ARIA toolbar 模式）：整列只有一条是 `tabIndex=0`，其余 `-1`。
   *
   * 为什么必须这么做（2026-11-19 自查）：一列有 560 条刻度时，若每条都 `tabIndex=0`，
   * 键盘用户要按 **560 次 Tab** 才能走过去 —— 对键盘来说这不是"导航条"，是一堵墙。
   * toolbar 模式的约定是：进去一次（Tab 落到"当前"那条），之后用 ↑/↓ 在条内移动。
   */
  const focusIndex = Math.max(0, ticks.findIndex((tick) => tick.id === activeId));

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
    <div ref={listRef} className="relative flex flex-col">
      {ticks.map((tick, index) => {
        const isActive = activeId === tick.id;
        const isHovered = hoveredId === tick.id;
        return (
          <button
            key={tick.id}
            type="button"
            data-testid="rail-tick"
            data-rail-id={tick.id}
            data-rail-role={tick.role}
            data-rail-active={isActive ? "true" : "false"}
            data-rail-hovered={isHovered ? "true" : "false"}
            aria-label={`跳到${tick.role === "user" ? "提问" : "回复"}：${tick.preview.slice(0, 20)}`}
            aria-current={isActive ? "true" : undefined}
            tabIndex={index === focusIndex ? 0 : -1}
            className="rail-tick relative flex shrink-0 cursor-pointer items-center justify-start pl-0.5"
            style={{ height: rowHeight, width: slotWidth }}
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
            <span
              aria-hidden
              className="rail-tick-bar"
              style={{
                // 当前/悬停：宽到整列（一眼看出"就是这一条"）；其余：宽度 = 内容量。
                width: isActive || isHovered ? Math.max(BAR_WIDTH_MIN + 6, slotWidth - 2) : widths[index],
                height: isActive || isHovered ? BAR_HEIGHT_HOVER : BAR_HEIGHT,
              }}
            />
          </button>
        );
      })}
    </div>
  );
});
