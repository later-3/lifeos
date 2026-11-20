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
  RAIL_JUMP_LOCK_MAX_MS,
  railActivePick,
  railAnchorWithLoadedTail,
  railLockActive,
} from "../api/rail-anchor";
import {
  BAR_HEIGHT,
  BAR_HEIGHT_HOVER,
  BAR_WIDTH_MIN,
  RAIL_MAX_RATIO,
  railProgressModelOf,
  railBandTopOf,
  railCardPlaceOf,
  railCenterTopOf,
  railIndexAtBandTop,
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
  const [card, setCard] = useState<{ tick: RailTickView; top: number; left: number } | undefined>(undefined);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);


  const cardRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const measureTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lockRef = useRef<{
    index: number; until: number; reason?: "drag" | "jump";
    /** 锁建立时刻（判断"这次 scroll 是不是用户自己滚的"） */
    armedAt: number;
  } | undefined>(undefined);
  const loadedFromRef = useRef(0);
  const measureRef = useRef<() => void>(() => {});
  const pendingCardRef = useRef<{ tick: RailTickView; rowRect: DOMRect; railRight: number } | undefined>(undefined);
  /**
   * 拖动 scrub 的状态（Task 0020 · P7）。
   *
   * 形态参照 **VSCode / Sublime 的 minimap**：在缩略图上按住拖动，编辑器内容跟着滚。
   * 语义是**相对位移**（`railScrubTargetOf`）：按下时记 `scrollTop`，之后只按"指针移动了多少"换算
   * ——不是"指针的绝对位置 → 内容比例"。后者在可滚的列上会打架：列自己也在跟着滚，
   * 映射基准每帧都变，指针不动正文却在加速跑。
   */
  const scrubRef = useRef<{
    pointerId: number;
    /** 抓在滑块的哪个位置（指针 y − 滑块顶边），拖动中滑块顶边 = 指针 y − 这个值 */
    grabOffsetY: number;
    moved: boolean;
    /** 按下时的指针位置（只用于区分"手抖"与"真的在拖"） */
    startX: number;
    startY: number;
    /** 按下时的正文位置、行号与滑块顶边：拖动一律按**增量**换算，避免绝对比例跳段 */
    startScrollTop: number;
    startIndex: number;
    startBandTop: number;
  } | undefined>(undefined);
  /** 拖完之后浏览器仍会补一个 `click`：用它把那次点击吃掉，否则松手会额外跳一次。 */
  const suppressClickRef = useRef(false);
  const [scrubbing, setScrubbing] = useState(false);
  /** 拖动中由滑块反推出的行号（松手后锁住它，见 `endScrub`）。 */
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined);
  const dragIndexRef = useRef<number | undefined>(undefined);
  dragIndexRef.current = dragIndex;
  /** 每秒变一次的计数，仅用于让"锁定到期"能被重算（见 `resolvedIndex`）。 */
  const [scrollTick, setScrollTick] = useState(0);
  /**
   * 锁定值的 **state 镜像**（`{index, token}`，token 只用于让依赖变化）。
   *
   * 为什么不能只靠 `lockRef`（2026-11-19 实测）：`useMemo` 的依赖里没有任何一个会因"写入 ref"而变化
   * （`dragIndex`/`anchorIndex` 点一下都不变、`scrollTick` 恒为 0），于是点击后 `resolvedIndex`
   * **一次都不重算** —— 锁定写进去了、`data-rail-last-click` 也写了，但高亮纹丝不动（实测 #37 → #39）。
   */
  const [lockTick, setLockTick] = useState({ index: -1, token: 0 });
  /**
   * 拖动中的滑块顶边（px，相对可视框）。`undefined` = 不在拖动。
   *
   * 拖动是**滚动条语义**：滑块严格跟指针（1:1），正文按"滑块走过行程的比例"滚，
   * 刻度列同步滚到那一行。三者一次性在同一帧更新（见 `onRowPointerMove`）。
   */
  const [dragBand, setDragBand] = useState<number | undefined>(undefined);
  /*
   * 刻度列**此刻**的滚动量。滑块按"行的实际位置"画，所以这个值必须进模型；
   * 每帧最多提交一次（`frontend/code.md` 2.19：滚动回调里不做与数据量成正比的工作）。
   */
  const [listScroll, setListScroll] = useState(0);
  /** `resolvedIndex` 的实时镜像：指针按下的那一刻要读最新值（闭包里的是旧值） */
  const resolvedIndexRef = useRef(0);

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

  /** 由正文滚动反查出的"视口中线落在第几条"（锚点精确值）。 */
  const anchorIndex = activePick.index;

  /*
   * `resolvedIndex` = **唯一的状态**，其余（高亮条、滑块、刻度列滚动、百分比）全部由它派生。
   *
   * 三个来源，优先级从高到低：
   *  1. **拖动中**：由滑块位置反推（滑块主导，见 `railIndexAtBandTop`）；
   *  2. **刚点击/刚跳转**：锁定值（`RAIL_ACTIVE_LOCK_MS`），避免平滑滚动途中高亮乱跳；
   *  3. **滚动正文**：由锚点反查（`anchorIndex`）。
   */
  const resolvedIndex = useMemo(() => {
    if (scrubbing && dragIndex !== undefined) return dragIndex;
    const lock = lockRef.current;
    if (lock !== undefined) {
      /*
       * **跳转锁**（点击某条刻度）的释放条件不是"时间到"，而是**锚点真的追上了目标**。
       *
       * 为什么（2026-11-19 用户第三次报同一现象）：用户点 #530，正文要滚 6000+px；
       * 而 `RAIL_ACTIVE_LOCK_MS=1600` 是固定时长 —— 滚完之前锁就过期了，`resolvedIndex`
       * 退回"锚点反查"（那时还停在中途），于是高亮/滑块只走到半路。
       * 实测：连点 5 条只有第 1 条到位，后面全部"没到"（#530 → #495）。
       *
       * 现在：`reason === "jump"` 时，只要锚点还没到目标就继续锁（封顶
       * `RAIL_JUMP_LOCK_MAX_MS`，防"目标永远到不了"时锁死）。
       */
      if (lock.reason === "jump") {
        /*
         * **跳转锁由"用户滚动"解除，不由"锚点追上"解除**（2026-11-19 实测）。
         *
         * 为什么不能等锚点追上：点击的是**一条刻度**，而滚到的是它的**宿主消息**
         * （轮末回复被过程条折叠时 `host` 指向该轮第一条回复）。两者相差 1–2 条刻度，
         * 锚点永远等不到"等于目标" —— 于是要么锁死到超时，要么提前松手退回锚点值，
         * 表现都是"点 #21 却高亮 #22"。
         *
         * 现在：锁住点击的那条；**用户自己滚动**（`onScroll` 里判断）才解除，交回锚点。
         */
        if (Date.now() >= lock.until) {
          lockRef.current = undefined;
          return anchorIndex ?? lock.index;
        }
        return lock.index;
      }
      if (railLockActive(lock, Date.now())) return lock.index;
      lockRef.current = undefined;
    }
    return anchorIndex ?? 0;
  }, [scrubbing, dragIndex, anchorIndex, ticks.length, scrollTick, lockTick]);
  resolvedIndexRef.current = resolvedIndex;

  /* ── 4. 列的排布 ───────────────────────────────────────── */

  const rows = useMemo(() => railRowsOf(ticks.length, avail), [ticks.length, avail]);

  /* 刻度列自己的滚动 → 进模型（滑块要按"行此刻在哪"画，见 `railProgressModelOf`） */
  useEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    let raf = 0;
    const onScroll = () => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setListScroll(list.scrollTop);
      });
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    setListScroll(list.scrollTop);      // 挂载/列表高度变化时先把真实值喂进去
    return () => {
      list.removeEventListener("scroll", onScroll);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [rows.scrollable]);

  /*
   * 常规条的上限 **比"当前条"少 6px**（`slot.width - 10` vs `slot.width - 4`）。
   * 为什么：轨道只有 36px 宽，若常规条也能到 32px，"当前条跨满 32px"就与最长的一条同宽 ——
   * 实测截图里完全看不出哪条是当前（十字路口：宽度这个通道被自己占满了）。
   */
  const barPeak = Math.max(BAR_WIDTH_MIN + 2, slot.width - 10);
  /*
   * 滑块 + 列表滚动 + 高亮条的**唯一模型**（见 `railProgressModelOf` 头注）：
   * 三者都从一个 `progress` 派生，所以"高亮条落在滑块中间"是代数恒等式，不是调参调出来的。
   */
  const model = useMemo(() => railProgressModelOf({
    resolvedIndex,
    totalTicks: ticks.length,
    viewHeight: listViewHeight,
    clientHeight: metrics.clientHeight,
    scrollHeight: metrics.scrollHeight,
    listContentHeight: ticks.length * rows.rowHeight,
    /*
     * 列表的可视高必须**实测**（`list.clientHeight`），不能用 `avail × RAIL_MAX_RATIO` 推算：
     * 可滚时两者不等（实测 508 vs 523），而 `listScrollTop` 对 `view` 极其敏感。
     */
    listViewHeight,
    listScrollTop: listScroll,
  }), [resolvedIndex, ticks.length, listViewHeight, metrics.clientHeight, metrics.scrollHeight, rows.rowHeight, listScroll]);

  /*
   * 拖动中滑块跟**指针**走（`dragBand`），其余时候跟**高亮行**走（`model.bandTop`）。
   * 两种语义不能混：前者是"我在整段对话的哪里"，后者是"当前这条在列里的哪里"。
   */
  /*
   * 拖动中滑块也画在**高亮行的位置**（`model.bandTop` 已按 dragIndex 算好）。
   *
   * 2026-11-19 实测：改成"滑块跟指针 + 刻度列事后追行"时，滑块每帧已经走了 25px，
   * 而刻度列要等一个 `useLayoutEffect` 才跟上 —— 于是拖快一点，高亮就被甩出滑块 66px。
   * 两者同源（都由 `dragIndex` 派生）就没有滞后。
   */
  /*
   * 拖动中：**长会话**滑块跟指针（刻度列在下面滚，行程 = 整段对话）；
   * **短会话**（刻度列装得下）滑块跟高亮行 —— 那时没有滚动空间，两者必须同源，
   * 否则高亮会被留在滑块外面。
   */
  const band = {
    top: scrubbing && dragBand !== undefined && rows.scrollable ? dragBand : model.bandTop,
    height: model.bandHeight,
  };


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
  /** `model` 的最新值转发（pointer 回调的闭包要读，不进依赖表 —— 否则每帧重建回调）。 */
  const modelRef = useRef(model);
  modelRef.current = model;


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
  /**
   * **同一帧写三件事**：高亮条、悬停条、刻度列滚动。
   *
   * 为什么必须同一个 effect（2026-11-19 实测）：分成两个 effect 时，
   * `list.scrollTop` 在 layout 阶段生效、而高亮属性要等下一次渲染的 effect ——
   * 中间会画一帧，于是"滑块动了、高亮还没动"（差一行 12px）或反过来。
   *
   * 三个状态的分工（用户 2026-11-19 审核过）：
   *  - **高亮条**（`data-rail-active`）：唯一表示"当前读到哪一条"，由 `resolvedIndex` 决定；
   *  - **悬停条**（`data-rail-hovered`）：只表示"鼠标指着哪一条"，**不动高亮、不动滑块**；
   *  - **刻度列滚动**：让高亮那一条落在滑块里（`model.listScrollTop`）。
   */
  useLayoutEffect(() => {
    const root = containerRef.current;
    const list = listRef.current;
    if (root === null) return;

    const paintOne = (attribute: string, id: string | undefined, extra?: (node: HTMLElement, on: boolean) => void) => {
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

    const activeTick = ticks[resolvedIndex];
    paintOne("data-rail-active", activeTick?.id, (node, on) => {
      if (on) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
    paintOne("data-rail-hovered", hovered);

    /*
     * roving tabindex：只有"当前"那条是 0，其余 -1。
     * 一列 560 条时若每条都 `tabIndex=0`，键盘用户要按 560 次 Tab —— 那不是导航条，是一堵墙。
     */
    for (const node of root.querySelectorAll<HTMLElement>("[data-testid=rail-tick]")) node.tabIndex = -1;
    const focusNode = activeTick === undefined ? null : root.querySelector<HTMLElement>(`[data-rail-id="${CSS.escape(activeTick.id)}"]`);
    const fallback = focusNode ?? root.querySelector<HTMLElement>("[data-testid=rail-tick]");
    if (fallback !== null) fallback.tabIndex = 0;

    /*
     * 刻度列**只做最小滚动**：高亮那条还在可视区里就一动不动。
     *
     * 为什么不能用模型给的 `listScrollTop` 直接写（2026-11-19 实测）：模型算的是"让行落进滑块"，
     * 而滑块又跟着行走 —— 写成环之后，用户点一条就已经在屏幕上的行，列表也照样滚动，
     * 把那条从光标下面搬走（实测 3812 → 3344，滑块留在底部不动）。
     * 这里读 DOM 的实时 `scrollTop`，只处理"行真出去了"这一种情况。
     */
    if (list !== null && rows.scrollable && rows.rowHeight > 0) {
      const live = list.scrollTop;
      const rowTop = resolvedIndex * rows.rowHeight;
      const viewHeight = list.clientHeight;
      const max = Math.max(0, list.scrollHeight - viewHeight);
      let target = live;
      if (rowTop < live) target = rowTop;
      else if (rowTop + rows.rowHeight > live + viewHeight) target = rowTop + rows.rowHeight - viewHeight;
      target = Math.max(0, Math.min(max, target));
      if (Math.abs(target - live) >= 1) list.scrollTop = target;
    }
  }, [resolvedIndex, hovered, ticks, model.listScrollTop, rows.scrollable, rows.rowHeight, scrubbing, band.top, band.height]);

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
  /**
   * 按下。**按在滑块里 = 拖动；按在别处 = 点击跳转**（与 VSCode 的分工一致）。
   *
   * 源码依据：`microsoft/vscode` `minimap.ts:1404-1410` 的 `_sliderPointerDownListener`
   * 把拖动绑在 **slider 元素**上；`:1365-1396` 的 minimap 本体 pointerdown 走
   * `revealLineNumber()`（点击 = 跳到那一行）。**它没有任何位移阈值** ——
   * "按在滑块上就是拖"、"按在别处就是点"，两个命中目标分开。
   */
  const onRowPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") return;      // 触屏上下滑 = 滚这一列，不抢
    if (event.button !== 0) return;
    const container = scrollContainer.current;
    if (container === null) return;

    // 几何没就绪就不拖（刚刷新时 metrics 是 0，拖了会算成 0 = 最顶）
    const m = modelRef.current;
    if (!(m.bandHeight > 0) || !(m.bandRange > 0)) return;

    const bandNode = containerRef.current?.querySelector<HTMLElement>(".rail-band");
    const bandRect = bandNode?.getBoundingClientRect();

    /*
     * 命中横条 = 用户想点这一条。**不论它在不在滑块里**都要算 ——
     * 用户 2026-11-19："我点击任意一个横条，都应该跳转到那个横条，且高亮那个横条"。
     *
     * 为什么以前点不动：短会话里滑块很大（cafe 实测占 66% 高度），几十条横条全在滑块里；
     * 而"按在滑块上就是拖"这条规则（VSCode `minimap.ts:1459-1484`）把整片区域都吃成了拖动，
     * 于是**滑块里的横条一条都点不动**，只有滑块外那几条能点。
     *
     * 现在的划分：**按在横条上 → 单击跳转 / 按住移动才拖动**；
     * 按在滑块空白处 → 直接拖动（保持原来的手感）。
     */
    /*
     * 按在滑块上：进入拖动。记下"抓在滑块的哪个位置"（grabOffset），
     * 之后滑块顶边 = 指针 y − grabOffset —— 这样**滑块严格跟手**（不是按位移换算）。
     */
    scrubRef.current = {
      pointerId: event.pointerId,
      grabOffsetY: event.clientY - (bandRect as DOMRect).top,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      startScrollTop: container.scrollTop,
      startIndex: resolvedIndexRef.current,
      startBandTop: modelRef.current.bandTop,
    };
    setScrubbing(true);
    notifyScrubbing(true);
    /*
     * 这里**不**吞掉 click、也**不**清跳转锁 —— 一切的判定留给"有没有真的移动"。
     *
     * 为什么（2026-11-19 用户截图："我点击了一个横条，但高亮和滑块都没有跟上"）：
     * 上一版在 pointerdown 就把 `suppressClickRef` 置真，然后**指望 `pointerup`** 来跳转。
     * 一旦 `pointerup` 没落到竖条上（松手前指针移开、行在滚动中重挂、指针捕获丢失），
     * 那次点击就被"抑制"吃掉，跳转一次也不会发生 —— 而且 `scrubbing` 卡在真。
     * 现在改成：**跳转走原生 `click`**（浏览器保证一定会到），拖动才置抑制。
     */
    suppressClickRef.current = false;
    clearHideTimer();
    setHovered(undefined);
    setCard(undefined);
    // 捕获指针：拖到列外面也继续收事件（否则拖快了会"掉线"）
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [scrollContainer, ticks, clearHideTimer, notifyScrubbing]);

  /*
   * 松手兜底：`pointerup` 只在竖条自己收到时才会调 `endScrub`。
   * 指针在竖条外松手、或指针被系统取消（切窗口、按 Esc）时收不到 —— 那样 `scrubbing`
   * 会永久为真，之后所有点击都被当成"还在拖"。所以窗口级再补一次。
   */
  useEffect(() => {
    if (!scrubbing) return;
    const finish = () => {
      const scrub = scrubRef.current;
      if (scrub === undefined) return;
      scrubRef.current = undefined;
      setScrubbing(false);
      notifyScrubbing(false);
      const lastIndex = dragIndexRef.current;
      if (lastIndex !== undefined) {
        lockRef.current = { index: lastIndex, until: Date.now() + RAIL_ACTIVE_LOCK_MS, reason: "drag", armedAt: Date.now() };
      }
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [scrubbing, notifyScrubbing]);

  /*
   * **用户滚动 = 跳转锁作废**（见 `resolvedIndex` 的"跳转锁由用户滚动解除"）。
   *
   * 判据是**用户输入**（滚轮 / 触摸 / 键盘），不是 `scroll` 事件 ——
   * 程序化的 `scrollIntoView({behavior:"smooth"})` 会持续 300–500ms 一直触发 scroll，
   * 按"scroll 就解锁"会把跳转锁在滚动途中解掉（2026-11-19 实测：点 a2@3，500ms 后高亮回到 4）。
   * 反差很大：改成只认输入事件后，`message-rail.mjs` 的三套会话全部"点哪到哪"。
   */
  useEffect(() => {
    const container = scrollContainer.current;
    if (container === null) return;
    const dropJumpLock = () => {
      const lock = lockRef.current;
      if (lock !== undefined && lock.reason === "jump") lockRef.current = undefined;
    };
    container.addEventListener("wheel", dropJumpLock, { passive: true });
    container.addEventListener("touchstart", dropJumpLock, { passive: true });
    container.addEventListener("keydown", dropJumpLock);
    return () => {
      container.removeEventListener("wheel", dropJumpLock);
      container.removeEventListener("touchstart", dropJumpLock);
      container.removeEventListener("keydown", dropJumpLock);
    };
  }, [scrollContainer]);

  /**
   * 拖动：**滑块跟指针**，再由滑块位置反推行号，最后把正文滚到同一进度。
   *
   * 顺序就是因果链（用户 2026-11-19 的要求）：
   *   指针 → 滑块（逐帧 1:1）→ 行号（`railIndexAtBandTop`）→ 高亮 + 刻度列滚动 + 正文滚动
   * 因为高亮和滑块都由同一个行号派生，所以"滑块始终包裹高亮条"是恒等式。
   */
  const onRowPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const scrub = scrubRef.current;
    if (scrub === undefined || scrub.pointerId !== event.pointerId) return;
    const container = scrollContainer.current;
    const rail = containerRef.current;
    if (container === null || rail === null) return;

    const m = modelRef.current;
    /*
     * **必须用"可视框"的顶边，不是轨道的顶边**：滑块是 `absolute` 在可视框里，
     * 而可视框在轨道里是垂直居中的（`justify-center`）—— 两者顶边差
     * `(轨道高 − 可视框高) / 2`。用轨道顶边会把这个差值算进拖动位移里，
     * 表现是"拖了半天滑块不动，然后突然跳一大段"（实测前 160px 完全不动）。
     */
    const frame = (containerRef.current?.querySelector<HTMLElement>(".rail-band")?.parentElement) ?? null;
    if (frame === null) return;
    const frameRect = frame.getBoundingClientRect();
    const desiredTop = event.clientY - frameRect.top - scrub.grabOffsetY;
    const bandTop = Math.max(0, Math.min(m.bandRange, desiredTop));
    /*
     * 行号 = **按下时的行号 + 指针增量折算到整段对话**（拖动 = 滚动条语义）。
     *
     * 两个坑都在这里避开：
     *  1. 不能按"指针跨过的行数"算：一行 12px、一屏 42 行，而对话有几百上千行 ——
     *     一次满行程拖动只覆盖 7% 的对话（实测 beef：480px 满拖，正文 100% → 93%），
     *     用户看到的就是"拖了滑块，右边不联动"。
     *  2. 不能按"滑块当前位置的比例"算：滑块被夹在可视框边上时（例如高亮行停在窗口顶端，
     *     滑块顶边 = 0）那个比例恒为 0，一按下去序号就从 357 跳到 0（实测）。
     * 增量 + 夹紧的滑块显示，两者都解决了。
     */
    /*
     * 行号按**滑块行程**折算（滚动条语义）：拖满一列 = 走完整段对话。
     *
     * 为什么不用 `pointerDelta / rowHeight`（2026-11-19 实测）：那样"一次满行程"只覆盖
     * `列高 / 行高` 行 —— 长会话（262 条刻度）里只有 40 行 ≈ 15%，用户拖到底也只能走一小段，
     * 正是"拖动不联动"的另一种形态。按行程折算后，满行程 = 整段（与点击跳转互补：
     * 拖动=连续大范围移动，点击=精确落到某一条）。
     */
    const pointerDelta = event.clientY - scrub.startY;
    /*
     * 刻度列**装得下**（`rows.scrollable === false`）时，行不能跟着滑块走 ——
     * 那时滑块一路滑走会把高亮留在原地，于是"高亮露在滑块外"（实测短会话第 3 条露在上面）。
     * 这种会话的刻度列没有可滚空间，滑块行程必须**限制在行网格内**：只允许在
     * 首行到末行之间移动，于是滑块始终包住某一整行。
     */
    /*
     * 短会话（刻度列装得下）时**滑块不跟指针**，而是由行号派生（见渲染处的 `band`）：
     * 那时没有"行跟着滑块滚"这回事，滑块一旦按指针走就会把高亮留在原地（实测露出 79px）。
     * 长会话里滑块跟指针、刻度列在下面滚，两者才是一体。
     */
    const bandTopNow = Math.max(0, Math.min(m.bandRange, scrub.startBandTop + pointerDelta));
    const index = Math.max(0, Math.min(ticks.length - 1,
      scrub.startIndex + Math.round((pointerDelta / Math.max(1, m.bandRange)) * (ticks.length - 1))));
    /*
     * **3px 内不算拖动**：这是"单击横条跳转"与"按住拖滑块"的分界。
     *
     * 注意这与之前删掉的 4px 位移阈值**不是同一件事**：那个阈值吃掉的是拖动的头 4px
     * （滑块不跟手），已按 VSCode 的做法删掉；这里只用来区分"手抖"和"真的在拖"，
     * 一旦超过 3px，后续位移一次性全部生效（`grabOffsetY` 记的是按下时的偏移，所以不会丢）。
     */
    if (!scrub.moved) {
      const drift = Math.hypot(event.clientY - scrub.startY, event.clientX - scrub.startX);
      if (drift <= 3) return;
      scrub.moved = true;
      // 真的在拖了：松手时浏览器补的 click 要吃掉，上一轮的跳转锁也作废
      suppressClickRef.current = true;
      lockRef.current = undefined;
      // 进入拖动：收起卡片、清掉悬停 —— 拖动途中一路弹卡片会很吵
      clearHideTimer();
      setHovered(undefined);
      setCard(undefined);
    }
    const changed = index !== dragIndexRef.current;
    dragIndexRef.current = index;
    setDragIndex(index);
    setDragBand(bandTopNow);
    /*
     * 刻度列**同步**滚到"让这一行落在滑块里" —— 必须在这里写（不能等 `useLayoutEffect`）。
     * 2026-11-19 实测：等 effect 会晚一帧，滑块每帧已走 25px，高亮就被甩出滑块 66px。
     */
    const list = listRef.current;
    if (list !== null && rows.rowHeight > 0) {
      const max = Math.max(0, list.scrollHeight - list.clientHeight);
      const target = index * rows.rowHeight + rows.rowHeight / 2 - (bandTopNow + Math.max(2, m.bandHeight) / 2);
      const next = Math.max(0, Math.min(max, target));
      if (Math.abs(next - list.scrollTop) >= 1) list.scrollTop = next;
    }

    /*
     * 正文按**增量**滚，不按绝对比例。
     *
     * 为什么不能用 `scrollTop = bandTop / bandRange × scrollable`（2026-11-19 实测）：
     * 刻度列是**等距**的（一行 12px），正文是**不等距**的（一条带工具的回复可能是一句话的
     * 20 倍高）。按绝对比例写等于假设两者线性，一次拖动就会把正文"唰"地挪走一大段：
     * cafe 会话点完某条刻度正文在 1206px，而 26/39 的比例指向 3100px —— 一按下去就跳 1600px。
     *
     * 增量映射没有这个问题：从**按下时**的正文位置出发，滑块走了行程的百分之几，
     * 正文就滚相应的百分之几。方向连续、不跳段，也不会跟随手时累积误差。
     */
    const scrollable = Math.max(0, container.scrollHeight - container.clientHeight);
    if (scrollable > 0) {
      /*
       * 正文与滑块**同一来源**（行号）：指针跨了几行，正文就滚几行对应的比例。
       *
       * 这样三者（滑块位置、高亮、正文）都由 `index` 派生，不存在"比例空间 vs 行空间"的换算差。
       * 满行程（拖过整列）覆盖 `n - 滑块行数` ≈ 90% 的对话 —— 首尾那两行半被滑块自己占着，
       * 是几何必然（VSCode 的滚动条同理）。
       */
      const ratio = (index - scrub.startIndex) / Math.max(1, ticks.length - 1);
      container.scrollTop = Math.max(0, Math.min(scrollable, scrub.startScrollTop + ratio * scrollable));
    }
    void changed;
  }, [clearHideTimer, ticks, rows.rowHeight]);

  const endScrub = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const scrub = scrubRef.current;
    if (scrub === undefined || scrub.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    scrubRef.current = undefined;
    setScrubbing(false);
    setDragBand(undefined);
    notifyScrubbing(false);
    /*
     * 松手**不清 `dragIndex`**（用户 2026-11-19："松开鼠标之后，就还是放到鼠标的那个位置吧，
     * 不要自动弹走了"）。
     *
     * 为什么清掉会弹走：松手时正文的 `scrollTop` 由拖动最后一步写过，但**正文锚点重算**
     * （`railActivePick`，走 150ms 节流 + DOM 测量）还没跟上那一帧 —— 于是 `anchorIndex`
     * 仍是旧值，`resolvedIndex` 退回旧值，滑块跳回去。实测：拖动中 330 → 松手 394（跳 64 条）。
     *
     * 所以松手后**保持拖动值**，并用 `lockRef` 把它锁住；等正文滚动事件重新算出可信的锚点
     * （`scrollTick` 到期）后自然接管。这正是 `RAIL_ACTIVE_LOCK_MS` 的用途。
     */
    // 没拖动就是一次普通点击：交给 `click` 事件（`handleJump`），这里什么都不做。

    const lastIndex = dragIndexRef.current;
    if (lastIndex !== undefined) {
      lockRef.current = { index: lastIndex, until: Date.now() + RAIL_ACTIVE_LOCK_MS, reason: "drag", armedAt: Date.now() };
    }
  }, [notifyScrubbing]);

  /* ── 8. 点击 ───────────────────────────────────────────── */



  /**
   * 跳到某一条（**不做**拖后抑制 —— 那一层在 `onRailClick` 里）。
   *
   * 2026-11-19 实测：抑制标记原先在两处各查一次，而 `onRailClick` 先查并清掉它，
   * `handleJump` 再查时已经是假 —— 于是"拖完之后单击"会双重判断，其中一次必然错位
   * （实测点 #37 却高亮 #39）。一处判断，一处负责。
   */
  const handleJump = useCallback((tick: RailTickView, index: number) => {
    lockRef.current = { index, until: Date.now() + RAIL_JUMP_LOCK_MAX_MS, reason: "jump", armedAt: Date.now() };
    setLockTick((prev) => ({ index, token: prev.token + 1 }));   // 让 `resolvedIndex` 重算
    onJump(tick);
  }, [onJump]);

  /**
   * 列上的**唯一**点击入口。
   *
   * 为什么不用"每行自己的 onClick"（2026-11-19 用户截图："我点击了一个横条，但高亮和滑块
   * 都没有跟上"）：行只有 12px 高、条只有 6–32px 宽，**点和条的命中区都不是像素级精确**——
   * 点歪 1px 就落到行与行之间的缝里（目标是列表容器），那一行自己的 onClick 根本不会触发，
   * 于是"点了、什么都没发生"。现在只要点在列里，就按 y 算出最近的一条，**点哪儿都算数**。
   */
  const onRailClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    // 刚拖完的那一下点击要吃掉（拖动结束时浏览器会补一个 click）
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    const rowNode = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-rail-id]");
    const rowId = rowNode?.getAttribute("data-rail-id") ?? undefined;
    let index = rowId === undefined ? -1 : ticks.findIndex((tick) => tick.id === rowId);
    if (index < 0) {
      /*
       * 按 `y` 反算最近的一条，**行高用 DOM 实测值**，不用 `rows.rowHeight` 的计算值。
       *
       * 为什么：计算值是 `availableHeight / count`（实测 63.55/5 = 12.71），而浏览器排版后
       * 每行实际是 12.7px；两者差 0.01px/行，20 行之后就是 0.2px，在行边界附近会让反算
       * 差一条（实测点 #37 落到 #39）。DOM 的值才是"用户看到的那一行"。
       */
      const list = event.currentTarget;
      const box = list.getBoundingClientRect();
      const firstRow = list.querySelector<HTMLElement>("[data-testid=rail-tick]");
      const rowHeight = firstRow === null
        ? rows.rowHeight
        : (list.querySelectorAll<HTMLElement>("[data-testid=rail-tick]")[1]?.getBoundingClientRect().top
          ?? firstRow.getBoundingClientRect().top) - firstRow.getBoundingClientRect().top;
      const y = event.clientY - box.top + list.scrollTop;
      index = Math.min(ticks.length - 1, Math.max(0, Math.floor(y / Math.max(1, rowHeight))));
    }
    const tick = ticks[index];
    if (tick === undefined) return;
    (rootRef.current as HTMLElement | null)?.setAttribute("data-rail-last-click", `${tick.id}@${index}`);
    handleJump(tick, index);
  }, [ticks, rows.rowHeight, handleJump]);

  if (!slot.visible || ticks.length === 0) return null;

  const hovering = hovered !== undefined;

  return (
    <div
      ref={(node) => { containerRef.current = node; rootRef.current = node; }}
      data-testid="message-rail"
      data-rail-scrollable={rows.scrollable ? "true" : "false"}
      data-rail-active-index={anchorIndex ?? "none"}
      /* 诊断用：解析出的行号与列表目标滚动量（与滑块/高亮同一个来源） */
      data-rail-resolved={resolvedIndex}
      data-rail-list-target={Math.round(model.listScrollTop)}
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
          onClick={onRailClick}
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

        {/*
          百分比：回答"在整段对话的哪里"（用户 2026-11-19 新要求：顶部 0%、中间对应、底部 100%）。
          贴在**可视框底部**（不在可滚列表里）—— 跟着列滚会看不见，跟着滑块飘会压住刻度。
          数值来自 `model.percent`，与滑块、高亮**同一个 `resolvedIndex`**。
        */}
        {ticks.length > 0 && (
          <div
            data-testid="rail-percent"
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -bottom-5 text-center text-micro tabular-nums text-ink-500"
          >
            {model.percent}%
          </div>
        )}
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
