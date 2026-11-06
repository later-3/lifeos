/**
 * 带批注的文本块（Task 0003 · P2 显示 + P3 编辑）。
 *
 * 从 Message.tsx 拆出来（2026-11-03 自检）：它占 387 行，和消息渲染混在一个文件里
 * 已经成了巨型文件（检视规范把"巨型文件"列为质量缺口）。
 *
 * 职责三件：
 *  1. 按偏移**上色**（CSS Highlight API，不改 DOM）；
 *  2. 鼠标移到高亮上 → 浮出批注卡片（可编辑）；移开 → 收起；
 *  3. 拖选文字 → 浮出 draft 编辑框。
 *
 * 无批注且无 actions 时行为与改造前完全一致。上色每次渲染后都要重跑
 *（整块重渲染会让旧 Range 失效，P1 实测）。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  buildIndex, paintAnnotations, quoteOf, toOffset, toRange,
  type Annotation, type BlockIndex,
} from "./annotations";
import { AnnotationCard, AnnotationDraft } from "./annotation-card";
import { markById } from "./marks";
import { Markdown } from "./message-markdown";

type AnnotatedTextBlockProps = {
  text: string;
  blockIndex?: number;
  messageId?: string;
  annotations: readonly Annotation[];
  /** 批注操作（P3）。不传 = 只读展示（历史时间线等场景）。 */
  actions?: AnnotationActions;
  /**
   * 这一条消息正在流式生成（Task 0003 · P6）。
   * 流式期**不允许新建批注**：文字每帧都在变，偏移会漂，用户在生成中圈的那句话
   * 下一秒可能已经不是那句话了。等这一轮结束、文字定稿再标。
   */
  busy?: boolean;
};

/** 批注的可写操作集合；由 App 用 store 组装。 */
export type AnnotationActions = {
  add: (anchor: { messageId: string; blockIndex: number; start: number; end: number; quote: string }, marks: readonly string[], note: string) => string;
  setMarks: (id: string, marks: readonly string[]) => void;
  setNote: (id: string, note: string) => void;
  togglePinned: (id: string) => void;
  setOffset: (id: string, dx: number, dy: number) => void;
  remove: (id: string) => void;
  /** 点开一个批注（悬停已打开的那个，也用于从表格定位）。 */
  open: (id: string) => void;
};

/**
 * 带批注的文本块（Task 0003 · P2 显示 + P3 编辑）。
 *
 * 三件事：
 *  1. 按偏移**上色**（CSS Highlight API，不改 DOM）；
 *  2. 鼠标移到高亮上 → 浮出批注框（可编辑）；移开 → 收起；
 *  3. 拖选文字 → 浮出 draft 编辑框。
 *
 * **无批注且无 actions 时行为与改造前完全一致**（不加节点、不挂监听）。
 * 上色必须每次渲染后重跑：整块重渲染会让旧 Range 失效（P1 实测）。
 */
export function AnnotatedTextBlock({ text, blockIndex, messageId, annotations, actions, busy = false }: AnnotatedTextBlockProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef<BlockIndex | null>(null);
  const [hostRect, setHostRect] = useState<DOMRect | null>(null);
  /**
   * 当前展开的批注框（**可以有多个**）。
   * 2026-11-03 用户反馈"钉两个就不行"：根因这里是单个 string，
   * 开第二个就把第一个顶掉了。钉住的尤其要能并存。
   */
  const [openIds, setOpenIds] = useState<readonly string[]>([]);
  const openIdsRef = useRef(openIds);
  openIdsRef.current = openIds;
  const openOne = (id: string) => setOpenIds((list) => (list.includes(id) ? list : [...list, id]));
  const closeOne = (id: string) => setOpenIds((list) => list.filter((x) => x !== id));
  const [draft, setDraft] = useState<{ start: number; end: number; quote: string; rects: readonly DOMRect[] } | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  // 拖动中 / 框内 / 编辑中：都不许触发"移开就收起"
  const holdRef = useRef({ dragging: false, inBox: false, freeze: false });
  /**
   * 已摆定的槽位：`anno.id → 相对容器的位置与尺寸`。
   *
   * 为什么需要它（用户 2026-11-03 报的 bug：拖 A，B 跟着跑）：
   * 原来避让每帧按"其他框的当前 DOM 位置"重算——A 被拖走后 B 就少了障碍物、重排。
   * 现在**第一次摆定就写进这张表，之后只读**；拖动只在自己的基准上加偏移，
   * 别人怎么拖都改不了我的基准。
   *
   * 什么时候失效：容器宽度变了（resize）几何就不成立了，整块清空重摆。
   */
  const slotsRef = useRef<Map<string, { left: number; top: number; width: number; height: number }>>(new Map());
  /** 正在拖动哪一条（null = 没在拖）。Connector 用它决定是否 rAF 跟随。 */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // scheduleHide 在定时器/事件里执行，闭包可能拿到旧的 annotations，用 ref 取最新
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  const clearHideTimer = () => {
    if (hideTimer.current !== undefined) { window.clearTimeout(hideTimer.current); hideTimer.current = undefined; }
  };

  // 上色：每次渲染后重算 Range。
  // **不加 deps 数组**：除了 text/annotations 变化，还有"同一批批注但组件被重建"的情形
  //（发送失败时消息列表先插后替，批注渲染层会卸载重建；实测此时只靠 deps 不会重画）。
  // 每次渲染都跑一遍的代价很小：一次 TreeWalker + 一次 set，实测 6190 字符 0.4ms。
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const index = buildIndex(host);
    indexRef.current = index;
    paintAnnotations(index, annotations, undefined, `${messageId ?? "anon"}:${blockIndex ?? "x"}`);
  });

  useEffect(() => () => { clearHideTimer(); }, []);

  // 窗口尺寸/滚动变化：重算宿主矩形（浮框位置依赖它）
  useEffect(() => {
    if (openIds.length === 0 && draft === null) return;
    const refresh = () => {
      const host = hostRef.current;
      if (host !== null) setHostRect(host.getBoundingClientRect());
    };
    refresh();
    // resize/scroll 会让鼠标相对位置变化，但那不是"用户移开了"。
    // 把它们当"移开"处理会把框收掉（实测：窗口变窄后框消失且不回来）。
    // 这里只刷新坐标，不动显示状态。
    // 布局变化（resize/scroll）期间冻结"移开就收起"：
    // 这两个动作会让鼠标相对位置变化，但那不是"用户移开了"。
    // 实测：窗口变窄后框消失且不回来。冻结一个短窗口，让布局先稳定。
    let freezeTimer: number | undefined;
    const refreshKeepOpen = () => {
      // 容器宽度变了 → 旧的槽位几何不成立，整块重摆（这也是唯一该重摆的时机）
      slotsRef.current.clear();
      clearHideTimer();
      holdRef.current.freeze = true;
      if (freezeTimer !== undefined) window.clearTimeout(freezeTimer);
      freezeTimer = window.setTimeout(() => { holdRef.current.freeze = false; }, 400);
      refresh();
    };
    window.addEventListener("resize", refreshKeepOpen);
    window.addEventListener("scroll", refreshKeepOpen, true);
    return () => {
      if (freezeTimer !== undefined) window.clearTimeout(freezeTimer);
      holdRef.current.freeze = false;
      window.removeEventListener("resize", refreshKeepOpen);
      window.removeEventListener("scroll", refreshKeepOpen, true);
    };
  }, [openIds, draft]);

  /** 表格「定位」会派发这个事件请求"打开并保持"；用事件解耦，免得把 store 的方法一路透传。 */
  useEffect(() => {
    const onLocate = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id === undefined) return;
      const target = annotations.find((anno) => anno.id === id);
      if (target === undefined) return;
      setHostRect(hostRef.current?.getBoundingClientRect() ?? null);
      setOpenIds((list) => (list.includes(id) ? list : [...list, id]));
    };
    // 取消钉住时同步收卡（Task 0008）：hover 收起已删，事件是唯一能从 App 层叫渲染层收卡的路。
    const onClose = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id === undefined) return;
      setOpenIds((list) => list.filter((x) => x !== id));
    };
    window.addEventListener("lifeos:annotation-locate", onLocate as EventListener);
    window.addEventListener("lifeos:annotation-close", onClose as EventListener);
    return () => {
      window.removeEventListener("lifeos:annotation-locate", onLocate as EventListener);
      window.removeEventListener("lifeos:annotation-close", onClose as EventListener);
    };
  }, [annotations]);

  const rectsFor = useCallback((start: number, end: number): readonly DOMRect[] => {
    const index = indexRef.current;
    if (index === null) return [];
    const range = toRange(index, start, end);
    return range === null ? [] : [...range.getClientRects()];
  }, []);

  /**
   * 收起未钉住的卡（拖动结束/离开卡时用）。
   * Task 0008 修订：hover 打开已删，卡片的常态是"MarkBar 点开（已钉住）"或"刚提交的草稿"；
   * 定时器收起只剩一个入口：从卡片标题栏按下但未拖动的那次点击（避免误按后框不退场）。
   */
  const scheduleHide = useCallback(() => {
    if (holdRef.current.dragging || holdRef.current.freeze) return;
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => {
      // 只收起**未钉住**的框；钉住的一个都不动（"钉"的唯一职责）
      setOpenIds((list) => list.filter((id) => {
        const anno = annotationsRef.current.find((a) => a.id === id);
        return anno?.ui.pinned === true;
      }));
    }, 400);
  }, []);

  /**
   * 统一用 document 级 mousemove 判定"鼠标在不在框里"。
   *
   * 为什么不用 mouseleave：拖动时鼠标会划出框，leave 会在拖动中途送到，
   * 结果是"拖一下就消失"（实测踩了三次）。move 事件带坐标，判断的是**当下**的事实。
   */
  /**
   * 点框外取消 draft（2026-11-03 自检发现缺失）。
   * 规范里写明取消有三条路（Esc / ✕ / 点框外），之前只做了前两条。
   * 判定用 mousedown + 事件目标：落点既不在 draft 里、也不在正文里 → 取消。
   *
   * （Task 0008 修订：hover 打开卡片的行为已删——用户 2026-11-05 裁决
   *  "只能是点击 mark bar 里面的条目时，展示它对应的标注信息"。
   *  卡片的打开途径只剩：MarkBar 行点击（locate 事件，带钉住）、新建批注提交后。
   *  收起途径：MarkBar 再点一次（取消钉住）或删除。不再有 220ms 定时器收起。）
   */
  useEffect(() => {
    if (draft === null) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target === null) return;
      if (target.closest("[data-testid='annotation-draft']") !== null) return;
      if (target.closest("[data-testid='message-text']") !== null) return;   // 在正文里重新拖选不算"点外面"
      if (target.closest("[data-testid='annotation-card']") !== null) return;  // 点已有批注也不算
      setDraft(null);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [draft]);

  /** 拖选 → 浮出 draft。 */
  const onUp = useCallback(() => {
    // 流式期不建批注：文字还在变，锚点会漂（用户同意：等这一轮完成再标）
    if (busy) return;
    if (actions === undefined || messageId === undefined || blockIndex === undefined) return;
    const host = hostRef.current;
    const index = indexRef.current;
    if (host === null || index === null) return;
    const selection = window.getSelection();
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) return;

    const { start, end } = toOffset(index, range);
    if (start < 0 || end <= start) return;
    // quote 取自扁平串（不是 selection.toString()：跨表格单元格时浏览器用 \t）
    const quote = quoteOf(index, start, end);
    if (quote === "") return;

    const rects = rectsFor(start, end);
    clearHideTimer();
    // 进入编辑态：只收未钉住的框（钉住的保持）
    setOpenIds((list) => list.filter((id) => annotationsRef.current.find((a) => a.id === id)?.ui.pinned === true));
    setHostRect(host.getBoundingClientRect());
    setDraft({ start, end, quote, rects });
    selection.removeAllRanges();
  }, [actions, messageId, blockIndex, rectsFor, busy]);

  const commitDraft = useCallback((marks: readonly string[], note: string) => {
    if (actions === undefined || messageId === undefined || blockIndex === undefined || draft === null) return;
    const id = actions.add({ messageId, blockIndex, start: draft.start, end: draft.end, quote: draft.quote }, marks, note);
    setDraft(null);
    // 确认后立刻展开刚建的这条（用户要能马上看到并可继续改）
    if (id !== undefined) openOne(id);
  }, [actions, messageId, blockIndex, draft]);

  // 卡片被"关闭"或已删除时，本地 openIds 要跟着清掉（store 是唯一事实源）
  useEffect(() => {
    if (openIds.length === 0) return;
    const keep = openIds.filter((id) => annotations.some((anno) => anno.id === id));
    if (keep.length !== openIds.length) setOpenIds(keep);
  }, [annotations, openIds]);

  // 要渲染的卡片：openIds ∩ 现有批注（顺序按批注自身顺序，避免每帧抖动）
  const openedList = annotations.filter((anno) => openIds.includes(anno.id));

  return (
    <div className="relative" ref={wrapRef}>
      <div ref={hostRef} data-testid="message-text" data-block-index={blockIndex}
        data-anno-busy={busy ? "1" : undefined}
        title={busy && actions !== undefined ? "这一轮生成完成后才能批注" : undefined}
        onMouseUp={actions !== undefined ? onUp : undefined}>
        <Markdown text={text} />
      </div>

      {/* 虚线指引：每个展开的框各一条 */}
      {openedList.map((anno) => {
        const rects = rectsFor(anno.start, anno.end);
        if (rects.length === 0 || hostRect === null) return null;
        return (
          <Connector
            key={`conn-${anno.id}`}
            rects={rects}
            cardId={anno.id}
            tone={markById(anno.marks[0] ?? "")?.tone}
            wrapRef={wrapRef}
            live={draggingId === anno.id}
          />
        );
      })}

      {/* 批注卡片（可以有多个同时展开） */}
      {hostRect !== null && openedList.map((anno) => {
        const rects = rectsFor(anno.start, anno.end);
        if (rects.length === 0) return null;
        return (
          <AnnotationCard
            key={anno.id}
            annotation={anno}
            rects={rects}
            hostRect={hostRect}
            slots={slotsRef.current}
            onSlot={(slot) => { slotsRef.current.set(anno.id, slot); }}
            onChangeMarks={(marks) => actions?.setMarks(anno.id, marks)}
            onChangeNote={(note) => actions?.setNote(anno.id, note)}
            onTogglePinned={() => {
              const willPin = !anno.ui.pinned;
              actions?.togglePinned(anno.id);
              if (willPin) clearHideTimer();
            }}
            onDragStart={() => {
              holdRef.current.dragging = true;
              setDraggingId(anno.id);      // 连接线开始逐帧跟随
              clearHideTimer();
            }}
            onDragMove={() => clearHideTimer()}
            onPressEnd={() => {
              clearHideTimer();
              setDraggingId(null);
              window.setTimeout(() => { holdRef.current.dragging = false; }, 300);
            }}
            onOffsetChange={(dx, dy) => {
              actions?.setOffset(anno.id, dx, dy);
              clearHideTimer();
              setDraggingId(null);
              window.setTimeout(() => { holdRef.current.dragging = false; }, 300);
            }}
            onRemove={() => { actions?.remove(anno.id); closeOne(anno.id); }}
            onEnter={() => { holdRef.current.inBox = true; clearHideTimer(); }}
            onLeave={() => {
              holdRef.current.inBox = false;
              scheduleHide();
            }}
          />
        );
      })}

      {/* draft 编辑框 */}
      {draft !== null && hostRect !== null && (
        <AnnotationDraft
          quote={draft.quote}
          rects={draft.rects}
          hostRect={hostRect}
          onCommit={commitDraft}
          onCancel={() => setDraft(null)}
          onEnter={() => { holdRef.current.inBox = true; clearHideTimer(); }}
          onLeave={() => { holdRef.current.inBox = false; }}
        />
      )}
    </div>
  );
}

/** 从选区最靠近框的那条边的中点，画虚线到框最靠近选区的那条边。 */
/**
 * 虚线指引：从被批注文字画一条虚线到批注框。
 *
 * 为什么不能只在 `useLayoutEffect` 里算一次：
 *   拖动时卡片是**直接改 DOM style** 的（为了跟手，不走 React 重渲染），
 *   React 不会重新执行 effect，连接线就只在拖完（onOffsetChange 触发重渲染）时才跳到新位置。
 * → 改成 rAF 跟随：拖动期间持续读卡片矩形、更新 path，做到连续。
 */
function Connector({ rects, cardId, tone, wrapRef, live }: {
  rects: readonly DOMRect[];
  cardId: string;
  tone: string | undefined;
  wrapRef: React.RefObject<HTMLDivElement | null>;
  /** true = 正在拖动，需要逐帧跟随。 */
  live: boolean;
}) {
  const pathRef = useRef<SVGPathElement>(null);
  const rafRef = useRef<number | undefined>(undefined);

  const compute = useCallback((): string | null => {
    const wrap = wrapRef.current;
    if (wrap === null) return null;
    const card = wrap.querySelector(`[data-testid="annotation-card"][data-anno="${cardId}"]`);
    if (!(card instanceof HTMLElement)) return null;
    const wrapRect = wrap.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();

    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));

    const below = cardRect.top >= bottom - 4;
    const from = {
      x: (left + right) / 2 - wrapRect.left,
      y: (below ? bottom : top) - wrapRect.top,
    };
    const to = {
      x: Math.max(cardRect.left - wrapRect.left + 12, Math.min(cardRect.right - wrapRect.left - 12, from.x)),
      y: (below ? cardRect.top : cardRect.bottom) - wrapRect.top,
    };
    const midY = from.y + (to.y - from.y) / 2;
    return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
  }, [rects, cardId, wrapRef]);

  // 每帧写一次 d（不 setState：拖动的连续性比 React 一致性重要，且这里没有依赖它的逻辑）
  const paint = useCallback(() => {
    const d = compute();
    const el = pathRef.current;
    if (el !== null && d !== null) el.setAttribute("d", d);
  }, [compute]);

  useLayoutEffect(() => { paint(); });

  // 拖动期间逐帧跟随
  useEffect(() => {
    if (!live) return;
    const tick = () => { paint(); rafRef.current = window.requestAnimationFrame(tick); };
    rafRef.current = window.requestAnimationFrame(tick);
    return () => { if (rafRef.current !== undefined) window.cancelAnimationFrame(rafRef.current); };
  }, [live, paint]);

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" data-testid="annotation-connector" aria-hidden="true">
      <path ref={pathRef} fill="none" strokeWidth={1.3} strokeDasharray="4 3" opacity={0.75}
        style={{ stroke: tone === undefined ? "var(--color-ink-300)" : `var(--color-anno-${tone})` }} />
    </svg>
  );
}
