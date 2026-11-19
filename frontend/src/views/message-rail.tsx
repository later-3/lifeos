/**
 * 对话区左侧的消息导航竖条（Task 0020）。
 *
 * ## 它是什么
 *
 * 一条消息一条刻度：**用户消息** + **轮末回复**（该轮最后一条有文字的 assistant），
 * 所以一轮 = 两条刻度。长度表示内容量（字符数，两侧同口径），悬停出预览卡片，点击跳到那条消息。
 *
 * 形态依据：用户 2026-11-04 认可的交互原型
 * （`agents/coder/projects/workspace/tasks/0008-批注面板展示逻辑优化/tools/nav-demo/`）。
 * 与 ZCode / DeepSeek Harness 的差异（它们每轮一条、定距）是**有意的**：用户 2026-11-19 明确
 * 「按照我们之前的一轮=2，长度有定义，跳转点击的是问就跳转到问，是答就跳转到答」。
 *
 * ## 为什么数据从服务端来
 *
 * 前端只持有窗口内的消息（首屏 `?tail=200`，更早的靠游标分页）。实测最长会话 2290 条 entry /
 * 548 条刻度，大部分不在首屏那一页里。`/rail` 端点用与会话详情同一个 `messagesOf()` 投影，
 * 所以刻度的 id 与跳转锚点天然一致（`specs/code/api/api.md` 2.7）。
 *
 * ## 为什么窗口是"画哪些"而不是"合并"
 *
 * 刻度装不下时只有两条路：继续缩（缩到 2px 就分不清了，再缩就被裁掉——实测 548 条的会话有
 * 约 380 条整个消失）或只画附近一段。合并会丢掉"点得到具体消息"这个核心能力，所以选窗口。
 *
 * ## 三条不能破的纪律
 *
 * 1. **不吞正文的点击**：轨道容器 `pointer-events: none`，只有刻度节点 `pointer-events: auto`。
 *    否则正文的拖选、点链接在左缘一整条都失灵（验收句 7）。
 * 2. **滚动期间不驱动 React 状态**（`specs/code/frontend/code.md` 2.19）：量测与重算都节流，
 *    且只更新"锚点下标"这一个数，不重建刻度列表。
 * 3. **颜色/圆角/过渡只用 token**：数值在 `api/rail-geometry.ts`，样式在 `tokens.css` 的 `.rail-tick`。
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { LAYER_CLASS, surfaceClass, surfaceStyle } from "../design/surface";
import {
  RAIL_ACTIVE_LOCK_MS,
  railActivePick,
  railLockActive,
} from "../api/rail-anchor";
import {
  RAIL_BAR,
  RAIL_BAR_HOVER,
  RAIL_GAP,
  needsRailWindow,
  railAnchorWithLoadedTail,
  railCardPlaceOf,
  railHeightsOf,
  railScaleOf,
  railSlotFromGutter,
  railWindowOf,
} from "../api/rail-geometry";

/** `/rail` 端点返回的一条刻度（与服务端 `src/rail-ticks.ts` 的 `RailTick` 同形）。 */
export type RailTickView = {
  id: string;
  role: "user" | "assistant";
  chars: number;
  preview: string;
};

/** 卡片收起前的宽限（ms）。原型 90ms：够用户在刻度与卡片之间横移，又不会粘着不消失。 */
const CARD_HIDE_DELAY = 90;
/** 量测节流（ms）。与 pi-web 上游 `ChatMinimap.tsx` 的 150ms 同值：滚动时不每帧量 DOM。 */
const MEASURE_THROTTLE = 150;
/**
 * "滚动停下来再量一次"的延迟（ms）。平滑滚动的动画约 300–600ms，
 * 取 220 让它在动画基本结束后补一次准确值（不影响拖动时的响应）。
 */
const SETTLE_DELAY = 220;
/**
 * 卡片宽度（px）。原型 340（`tools/nav-demo/index.html` 的 `.card`），
 * 且与批注浮框的上限 `--container-anno-popup` 同档 —— 两个"贴在内容旁边的浮层"宽度一致才不跳。
 */
const CARD_WIDTH = 340;

export type MessageRailProps = {
  ticks: readonly RailTickView[];
  /** 正文滚动容器（量每条消息的偏移要用它算相对位置）。 */
  scrollContainer: React.RefObject<HTMLElement | null>;
  /** 内容列（`max-w-reading` 那一层）：量它的左缘才知道竖条能用多宽。 */
  contentRef: React.RefObject<HTMLElement | null>;
  /** 点击刻度：给 id，由调用方决定补取/放大窗口/滚动（判定在 `rail-jump.ts`）。 */
  onJump: (tickId: string) => void;
  /** 是否有"更早的可能还没下载"（有则显示顶部虚线提示）。 */
  hasOlder?: boolean;
  /**
   * **已下载**消息的 id 顺序（`messages.map(m => m.id)`）。
   *
   * 为什么不由组件自己扫 DOM：DOM 里只有"已渲染"的那几十条（渲染窗口），
   * 而 `loadedFrom` 要回答的是"已下载到哪一条"——两者差一段，用它做锚点会让窗口偏移。
   */
  loadedIds: readonly (string | undefined)[];
};

/**
 * 量每条有刻度的消息在滚动内容里的偏移。
 *
 * 只量**有刻度的**消息（`ticks` 里的那些），不量全部消息：长会话里有几千条，量全部会让滚动变卡。
 * 用 `data-message-id` 定位（`views/Message.tsx` 已经给每条消息挂了它，与批注定位同一个锚点体系）。
 */
function measureAnchors(
  container: HTMLElement,
  ticks: readonly RailTickView[],
): Array<{ id: string; top: number }> {
  const containerTop = container.getBoundingClientRect().top;
  const offset = container.scrollTop - containerTop;
  const anchors: Array<{ id: string; top: number }> = [];
  for (const tick of ticks) {
    const node = container.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(tick.id)}"]`);
    if (node === null) continue;                          // 这一条还没渲染/没下载：跳过，不猜位置
    anchors.push({ id: tick.id, top: node.getBoundingClientRect().top + offset });
  }
  return anchors;
}

/**
 * 已下载消息对应的最小刻度下标（`0` = 整段都下载完了）。
 *
 * 为什么需要它：会话分页下载（首屏 200 条 + 游标往前取），已渲染的这段是刻度列表的**尾巴**。
 * 滚到顶 = 已下载部分的顶，不是会话的顶；把它当 0 会让窗口显示"一根都没下载的最前面几十条"。
 */
function firstLoadedTickIndex(
  loadedIds: readonly (string | undefined)[],
  ticks: readonly RailTickView[],
): number {
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
  hasOlder = false,
  loadedIds,
}: MessageRailProps) {
  /** 轨道能用多宽（命中区）与要不要显示。由内容列的实测左缘得出，不看视口。 */
  const [slot, setSlot] = useState<{ visible: boolean; hit: number; gutter: number }>({ visible: false, hit: 0, gutter: 0 });
  /** 轨道可用高度（= 对话区高度）。 */
  const [avail, setAvail] = useState(0);
  /** 精确锚点（量 DOM 得到）；`undefined` 时用比例估算顶替。 */
  const [anchors, setAnchors] = useState<Array<{ id: string; top: number }>>([]);
  /** 滚动位置（比例锚点用；只在需要重算时更新）。 */
  const [scrollTop, setScrollTop] = useState(0);
  const [metrics, setMetrics] = useState({ scrollHeight: 0, clientHeight: 0 });
  /** 悬停/当前的那一条。 */
  const [hovered, setHovered] = useState<string | undefined>(undefined);
  const [active, setActive] = useState<string | undefined>(undefined);
  const [card, setCard] = useState<{ tick: RailTickView; top: number; left: number } | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hoveredRef = useRef<string | undefined>(undefined);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const measureTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** 跳转后的高亮锁：平滑滚动期间不让中线连环改选（否则高亮在动画里抖）。 */
  const lockRef = useRef<{ index: number; until: number } | undefined>(undefined);

  /* ── 1. 量容器：轨道多宽、多高 ───────────────────────────── */

  /**
   * 量一次（几何 + 锚点）。**所有**测量都走这一个函数，避免"几何更新了但锚点是旧的"。
   *
   * 为什么锚点也要在这里量：消息是**按需渲染**的（渲染窗口只渲染最近 50 条所在整轮）。
   * 放大窗口 / 补取历史之后，可见的消息变了，但那些变化不产生 `scroll` 事件 ——
   * 只在 scroll 里量锚点的话，跳转完成后锚点仍是跳转前的，高亮会停在错的位置（实测）。
   */
  const measureRef = useRef<() => void>(() => {});
  /**
   * 已下载消息对应的**最小刻度下标**（`0` = 整段都下载完了）。
   *
   * 为什么需要它：会话分页下载（首屏 200 条 + 游标往前取），已渲染的这段是刻度列表的**尾巴**。
   * 滚到顶 = 已下载部分的顶，不是会话的顶；把它当 0 会让窗口显示"一根都没下载的最前面几十条"，
   * 而用户当前读的位置反倒不在窗口里（实测）。
   */
  const loadedFromRef = useRef(0);

  useLayoutEffect(() => {
    const container = scrollContainer.current;
    const content = contentRef.current;
    const rail = containerRef.current;
    if (container === null || content === null) return;

    const measure = () => {
      const containerRect = container.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      // 内容列左缘到容器左缘的距离就是这块"空白"——比复现 layout() 的公式可靠
      // （真实界面还有滚动条宽度与浏览器缩放）。判据本身与 railSlotOf 同一档夹紧。
      setSlot(railSlotFromGutter(contentRect.left - containerRect.left));
      /*
       * 可用高度必须**扣掉内层的上下留白**。
       * 踩过：直接用轨道总高（844）算缩放，于是刻度总高 923 顶出容器 —— 首条刻度跑到 y=4（在 header 上方），
       * 末条跑到 y=924（在输入区下面）。用户看到的是"两头各漏出去一截"。
       */
      const inner = rail?.firstElementChild;
      const innerHeight = inner instanceof HTMLElement ? inner.clientHeight : containerRect.height;
      const style = inner instanceof HTMLElement ? getComputedStyle(inner) : undefined;
      const padding = style === undefined ? 0 : (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      setAvail(Math.max(0, innerHeight - padding));
      setMetrics({ scrollHeight: container.scrollHeight, clientHeight: container.clientHeight });
      setScrollTop(container.scrollTop);
      setAnchors(measureAnchors(container, ticks));
      loadedFromRef.current = firstLoadedTickIndex(loadedIds, ticks);
    };
    measureRef.current = measure;

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    // 内容列的尺寸变化 = 消息增减/渲染窗口变了 → 必须重新量锚点（不只是几何）
    observer.observe(content);
    if (rail !== null) observer.observe(rail);
    return () => observer.disconnect();
  }, [scrollContainer, contentRef, ticks, loadedIds]);

  /* ── 2. 滚动：只更新位置，不重建列表 ─────────────────────── */

  useEffect(() => {
    const container = scrollContainer.current;
    if (container === null) return;
    const onScroll = () => {
      setScrollTop(container.scrollTop);
      /*
       * 量测节流：滚动时不每帧量 DOM（`frontend/code.md` 2.19 的同一条纪律）。
       * 但**必须另有一次"停下来再量"**：节流窗口里最后一次滚动的结果可能在动画中途量到，
       * 滚动停止后没有新事件就再也不会纠正——高亮会停在动画中途的那条（实测）。
       */
      if (measureTimerRef.current !== undefined) return;
      measureTimerRef.current = setTimeout(() => {
        measureTimerRef.current = undefined;
        measureRef.current();
        settleTimerRef.current = setTimeout(() => {
          settleTimerRef.current = undefined;
          measureRef.current();
        }, SETTLE_DELAY);
      }, MEASURE_THROTTLE);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (measureTimerRef.current !== undefined) { clearTimeout(measureTimerRef.current); measureTimerRef.current = undefined; }
      if (settleTimerRef.current !== undefined) { clearTimeout(settleTimerRef.current); settleTimerRef.current = undefined; }
    };
  }, [scrollContainer, ticks]);

  /* ── 3. 当前阅读位置 ────────────────────────────────────── */

  const activePick = useMemo(() => {
    const locked = railLockActive(lockRef.current, Date.now());
    if (locked) return { index: lockRef.current!.index, source: "locked" as const };
    const fraction = railAnchorWithLoadedTail(
      scrollTop, metrics.scrollHeight, metrics.clientHeight, ticks.length, loadedFromRef.current,
    );
    /*
     * 三个来源，优先级写在 `rail-active-pick` 里（有单测）：
     *  1. **两端吸附**：贴顶 = 第一条、贴底 = 最后一条（会话末尾是最常停留的位置）；
     *  2. **量到的锚点**：只在"这一屏的消息真的渲染了"时才有意义；
     *  3. **比例估算**：整段已渲染时的兜底。
     *
     * 为什么锚点会不可用：消息区只渲染最近 50 条所在整轮，滚到中段时可见的消息压根没渲染
     * （实测：560 条刻度的会话滚到 50%，锚点全在尾部，纯锚点算法把高亮定到 `u269`，与眼前内容完全错位）。
     */
    const picked = railActivePick(
      anchors,
      scrollTop,
      metrics.clientHeight,
      undefined,
      fraction,
      { lastIndex: Math.max(0, ticks.length - 1), scrollHeight: metrics.scrollHeight, loadedFrom: loadedFromRef.current },
    );
    if (picked.index === undefined) return { index: undefined, source: picked.source };
    if (picked.source !== "anchor") return { index: picked.index, source: picked.source };
    // 锚点下标是"anchors 数组里的位置"，要映射回整条 ticks 的下标
    const id = anchors[picked.index]?.id;
    if (id === undefined) return { index: fraction, source: "fraction" as const };
    const tickIndex = ticks.findIndex((tick) => tick.id === id);
    return { index: tickIndex >= 0 ? tickIndex : fraction, source: picked.source };
  }, [anchors, scrollTop, metrics, ticks]);

  const anchorIndex = activePick.index;

  useEffect(() => {
    if (anchorIndex === undefined) return;
    const tick = ticks[anchorIndex];
    if (tick !== undefined) setActive(tick.id);
  }, [anchorIndex, ticks]);

  /* ── 4. 窗口：刻度装不下时只画附近一段 ───────────────────── */

  const windowed = needsRailWindow(ticks.length, avail);
  const range = windowed
    ? railWindowOf(ticks.length, avail, anchors.length > 0 && anchorIndex !== undefined ? anchorIndex : ticks.length - 1)
    : { from: 0, to: ticks.length };
  const visibleTicks = ticks.slice(range.from, range.to);
  const heights = useMemo(() => railHeightsOf(visibleTicks), [visibleTicks]);
  const { scale } = useMemo(() => railScaleOf(heights, avail), [heights, avail]);

  /* ── 5. 悬停与卡片 ──────────────────────────────────────── */

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current === undefined) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = undefined;
  }, []);

  /**
   * 卡片定位（Task 0020 · P3）。
   *
   * **必须用卡片的真实高度**而不是猜一个常数：第一版按 132 估算，实测卡片是 115.9px，
   * 于是"与该刻度垂直居中"实际偏了 19.8px —— 用户看到的是卡片和鼠标下那条刻度错开半行。
   * 所以先渲染（此时 `top/left` 还是上一帧的值），在 layout effect 里量到真尺寸再校正，
   * 校正前后都在视口内，不会闪。
   */
  /**
   * 已下载消息对应的**最小刻度下标**（`0` = 整段都下载完了）。
   *
   * 为什么需要它：会话是分页下载的（首屏 200 条 + 游标往前取），所以"已渲染的这段"是刻度列表的**尾巴**。
   * 滚到顶 = 已下载部分的顶，不是会话的顶。用它把滚动位置映射成刻度下标的分段起点。
   */

  const cardRef = useRef<HTMLDivElement | null>(null);
  const pendingCardRef = useRef<{ tick: RailTickView; tickRect: DOMRect; railRight: number } | undefined>(undefined);

  const placeCard = useCallback((tick: RailTickView, node: HTMLElement) => {
    const rail = containerRef.current;
    if (rail === null) return;
    const railRect = rail.getBoundingClientRect();
    const tickRect = node.getBoundingClientRect();
    pendingCardRef.current = { tick, tickRect, railRight: railRect.left + railRect.width };
    // 先给一个安全位置（用估算高度），下一帧再按真实高度校正
    const guess = railCardPlaceOf(
      { top: tickRect.top, left: tickRect.left, right: railRect.left + railRect.width, bottom: tickRect.bottom, width: tickRect.width, height: tickRect.height },
      { width: CARD_WIDTH, height: 132 },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setCard({ tick, top: guess.top, left: guess.left });
  }, []);

  /** 卡片渲染后用真实尺寸校正位置（同一帧内完成，用户看不到中间态）。 */
  useLayoutEffect(() => {
    const pending = pendingCardRef.current;
    const panel = cardRef.current;
    if (pending === undefined || panel === null) return;
    const rect = panel.getBoundingClientRect();
    const place = railCardPlaceOf(
      { top: pending.tickRect.top, left: pending.tickRect.left, right: pending.railRight, bottom: pending.tickRect.bottom, width: pending.tickRect.width, height: pending.tickRect.height },
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    if (Math.abs(place.top - (parseFloat(panel.style.top) || 0)) > 0.5) {
      panel.style.top = `${place.top}px`;
    }
    if (Math.abs(place.left - (parseFloat(panel.style.left) || 0)) > 0.5) {
      panel.style.left = `${place.left}px`;
    }
  }, [card]);

  const onTickEnter = useCallback((tick: RailTickView, node: HTMLElement) => {
    clearHideTimer();
    hoveredRef.current = tick.id;
    setHovered(tick.id);
    placeCard(tick, node);
  }, [clearHideTimer, placeCard]);

  const onTickLeave = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = undefined;
      hoveredRef.current = undefined;
      setHovered(undefined);
      setCard(undefined);
    }, CARD_HIDE_DELAY);
  }, [clearHideTimer]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  /** Esc 关卡片（键盘用户唯一的退出方式之一；另一个是移开鼠标）。 */
  useEffect(() => {
    if (card === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      clearHideTimer();
      hoveredRef.current = undefined;
      setHovered(undefined);
      setCard(undefined);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [card, clearHideTimer]);

  /* ── 6. 点击跳转 ────────────────────────────────────────── */

  const handleJump = useCallback((tick: RailTickView, index: number) => {
    // 先锁高亮：滚动动画期间中线会扫过中间那些刻度，不锁的话高亮会连环跳
    lockRef.current = { index: range.from + index, until: Date.now() + RAIL_ACTIVE_LOCK_MS };
    setActive(tick.id);
    onJump(tick.id);
  }, [onJump, range.from]);

  if (!slot.visible || ticks.length === 0) return null;

  const hovering = hovered !== undefined;
  const prevHidden = windowed && range.from > 0;
  const nextHidden = windowed && range.to < ticks.length;

  return (
    <div
      ref={containerRef}
      data-testid="message-rail"
      data-rail-windowed={windowed ? "true" : "false"}
      /* 窗口范围与锚点：视觉/契约测试与排障都要看这两个数（不是调试残留，见 frontend/test/message-rail.mjs）。 */
      data-rail-range={`${range.from}-${range.to}`}
      data-rail-anchor={anchorIndex ?? "none"}
      className={`pointer-events-none absolute inset-y-0 left-0 flex items-center ${LAYER_CLASS.rail}`}
      style={{ width: slot.hit }}
    >
      <div
        className="rail-tracking pointer-events-auto relative flex h-full flex-col justify-center"
        data-rail-hovering={hovering ? "true" : "false"}
        style={{ width: slot.hit, gap: 0, paddingTop: 20, paddingBottom: 20 }}
      >
        {/* 窗口之外的提示：上面/下面还有刻度，但没画（虚线，不说话） */}
        {prevHidden && <div aria-hidden className="mb-1 h-3 w-full shrink-0 border-l border-dashed border-line" style={{ borderLeftWidth: 1 }} />}
        <div role="toolbar" aria-orientation="vertical" aria-label="消息导航" className="flex flex-col items-center" style={{ gap: RAIL_GAP }}>
          {visibleTicks.map((tick, index) => {
            const height = Math.max(2, heights[index] * scale);
            const isActive = active === tick.id;
            const isHovered = hovered === tick.id;
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
                className="rail-tick flex shrink-0 cursor-pointer items-center justify-center"
                style={{ height, width: isActive || isHovered ? RAIL_BAR_HOVER : RAIL_BAR }}
                onMouseEnter={(event) => onTickEnter(tick, event.currentTarget)}
                onMouseLeave={onTickLeave}
                onFocus={(event) => onTickEnter(tick, event.currentTarget)}
                onBlur={onTickLeave}
                onClick={() => handleJump(tick, index)}
              />
            );
          })}
        </div>
        {nextHidden && <div aria-hidden className="mt-1 h-3 w-full shrink-0 border-l border-dashed border-line" style={{ borderLeftWidth: 1 }} />}
      </div>

      {card !== undefined && (
        <div
          ref={cardRef}
          data-testid="rail-card"
          role="tooltip"
          style={{
            position: "fixed",
            top: card.top,
            left: card.left,
            width: CARD_WIDTH,
            ...surfaceStyle("popover"),
          }}
          className={`pointer-events-none ${surfaceClass("popover")} ${LAYER_CLASS.popover}`}
        >
          <p className="mb-1 text-micro text-ink-500">
            {card.tick.role === "user" ? "你" : `Agent · ${card.tick.chars.toLocaleString()} 字`}
          </p>
          <p className="whitespace-pre-wrap break-words text-meta text-ink-900" style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {card.tick.preview}
          </p>
        </div>
      )}
    </div>
  );
});
