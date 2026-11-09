/**
 * 批注浮框（Task 0003 · P3）。
 *
 * 只有两个操作按钮（用户 2026-11-03 定）：**图钉**（是否常显）与**删除**。
 * 没有"关闭框"按钮——不需要：不钉住时移开鼠标就收起；钉住了想收起就点图钉取消。
 * 早期那版有 ✕，和钉住/删除的语义重叠，反而让人犹豫点哪个。
 *
 * 两种形态：
 *  - **draft**（拖选后出现）：引用 + 语气按钮 + 输入框 + Enter/Esc + 标上；
 *  - **已有批注**：引用 + 语气按钮（可改）+ 输入框（可改）+ 图钉 / ✕ / 🗑。
 *
 * 位置规则（与 demo 一致）：
 *  - 默认在被批注文字**正下方 8px、水平居中**；放不下 → 上方；水平夹 8px 边距；
 *  - 拖动过的（dx/dy 非零）以第一行矩形为基准加偏移。
 *
 * 交互纪律（都是用户明确要求过的）：
 *  - **未钉住不能拖**（先钉住，怕它消失）；
 *  - **✕ 只关框**，不删数据；**🗑 才删**；
 *  - 框本身 `user-select: none`，但输入框要 `user-select: text`。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Annotation } from "./annotations.ts";
import { MARKS, markById, type MarkSpec } from "./marks.ts";
import { IconButton } from "./design/ui";
import { popupPosition, type OccupiedBox } from "./annotation-position";

export { popupPosition };

/* ---------- 图标（SVG，不换图案，靠激活态区分） ---------- */

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M9.5 1.8 14.2 6.5l-2 .4-2.7 2.7.3 2.1-1.4 1.4L4 8.6 1.6 11 1 10.4 3.4 8 .9 4.5l1.4-1.4 2.1.3L7.1 1.4l.4-2z" transform="translate(0.4 0.4) scale(0.92)" />
      <path d="M5.4 10.6 2 14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3 w-3">
      <path d="M2.5 4.5h11M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4 4.5l.7 8a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8M6.5 7v4M9.5 7v4" />
    </svg>
  );
}

/* ---------- 语气按钮组（draft 与已有批注共用） ---------- */

function MarkButtons({ selected, onToggle, testId }: {
  selected: readonly string[];
  onToggle: (id: string) => void;
  testId?: string;
}) {
  /**
   * 两组分开显示（用户 2026-11-03）：语气发给 Agent，功能只留给自己。
   * 放在一起用户就分不清"哪些会发给它"。中间一条细竖线，不加标题文字（框很窄）。
   */
  const tones = MARKS.filter((mark) => mark.kind === "tone");
  const features = MARKS.filter((mark) => mark.kind === "feature");
  const button = (mark: MarkSpec) => {
    const on = selected.includes(mark.id);
    return (
      <button
        key={mark.id}
        type="button"
        data-mark={mark.id}
        data-kind={mark.kind}
        aria-pressed={on}
        onClick={() => onToggle(mark.id)}
        className={`rounded-control border px-2 py-0.5 text-micro transition-colors ${
          on ? "border-transparent font-semibold" : "border-line bg-surface text-ink-700 hover:border-ink-300"
        }`}
        style={on ? {
          background: `var(--color-anno-${mark.tone}-soft)`,
          color: `var(--color-anno-${mark.tone})`,
        } : undefined}
      >
        {mark.label}
      </button>
    );
  };
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1" data-testid={testId}>
      {tones.map(button)}
      {features.length > 0 && (
        <>
          <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-line" />
          {features.map(button)}
        </>
      )}
    </div>
  );
}

/* ---------- 公共外壳：标题栏 + 定位 + 拖动 ---------- */

type ShellProps = {
  rects: readonly DOMRect[];
  hostRect: DOMRect;
  offset: { dx: number; dy: number; moved?: boolean };
  /** 已摆定的槽位表（见 AnnotationCardProps.slots）。不传 = 每次都按默认位置算（draft 用）。 */
  slots?: Map<string, { left: number; top: number; width: number; height: number }>;
  onSlot?: (slot: { left: number; top: number; width: number; height: number }) => void;
  pinned: boolean;
  onDragStart?: () => void;
  /** 拖动过程中持续回调（父层用来抑制"移开就收起"）。 */
  onDragMove?: (dx: number, dy: number) => void;
  onDragEnd?: (dx: number, dy: number) => void;
  /** 一次按下-松开结束（无论有没有真的拖动）。 */
  onPressEnd?: () => void;
  children: React.ReactNode;
  testId: string;
  annoId: string;
  bar: React.ReactNode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

function PopupShell({ rects, hostRect, offset, pinned, slots, onSlot, onDragStart, onDragMove, onDragEnd, onPressEnd, children, testId, annoId, bar, onMouseEnter, onMouseLeave }: ShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  /**
   * 拖动进行中的实时偏移（Task 0008 修复）。
   *
   * 旧实现拖动时直接改 DOM，而下面的定位 effect **没有依赖数组**，
   * 拖动路径上只要发生一次重渲染（比如鼠标划过正文 → setHostRect），
   * effect 就拿旧闭包里的 offset（= 拖动前的 0）把位置**抹回起点**。
   * 实测：向正文方向拖，每步 style.left 停在 8px，松手瞬间跳到 -152px。
   * 现在拖动先写 ref（同步、无渲染），effect 读 ref —— 拖动期间谁也覆写不了它。
   */
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
  /** 首次摆放算定的基准（槽位或 popupPosition 的结果）；拖动的 base 不再从 style.left 读回来。 */
  const baseRef = useRef<{ left: number; top: number } | null>(null);

  /**
   * 在框里按下鼠标 → 视为"按住中"，直到 window 层 mouseup 才释放。
   * 解决的具体问题（实测）：未钉住时用户尝试拖动，鼠标划出框 → 220ms 定时器把框收走，
   * 体验是"想拖一下，框没了"。按住期间一律不收起。
   */
  /**
   * 按下 → 标记"按住中"；window mouseup 才释放。
   *
   * 存在的理由（实测踩了两次）：
   *  1. 点 pin/✕/🗑 也会触发 mouseup，若直接当成"离开"会"点一下就没了"；
   *  2. 拖动时鼠标划出框，mouseleave 提前送到，若直接安排收起会"一拖就没"。
   * 所以：按住期间一律不报告离开；松手后若鼠标真在框外，才把离开补报给上层。
   */
  const onPressStart = useCallback(() => {
    onMouseEnter?.();                       // 上层置 inBox=true，并清隐藏定时器
    // window 层的 mouseup 一定收得到（哪怕鼠标已经移出框），用它收尾。
    const release = () => {
      window.removeEventListener("mouseup", release);
      const el = ref.current;
      // 松手时鼠标到底在不在框里，用 hover 判断（比 event.target 可靠：
      // 鼠标移出后 mouseup 的 target 已经是别的元素了）
      if (el !== null && el.matches(":hover")) return;
      onMouseLeave?.();
    };
    window.addEventListener("mouseup", release);
  }, [onMouseEnter, onMouseLeave]);

  // 定位：**槽位摆定后不再重算**（这就是"拖 A 不动 B"的关键）
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    // 拖动中：直接写在 DOM 上的就是事实，effect 不许碰（否则抹回起点，见 dragOffsetRef 注释）
    if (dragOffsetRef.current !== null) return;
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const known = slots?.get(annoId);
    let base = baseRef.current ?? known ?? undefined;
    if (base === undefined) {
      // 第一次摆：读此刻已摆定的其他槽位，算一个不与它们相撞的位置，然后固定下来
      const occupied: OccupiedBox[] = [...(slots?.values() ?? [])].map((o) => ({ ...o }));
      // 传真实视口：框跑到屏幕外时翻到文字上方（P6 补）。
      // 这里用 window.innerHeight 而不是某个滚动容器的高度——用户看的是屏幕，不是容器。
      const pos = popupPosition(
        rects, hostRect, hostRect.height, size, { dx: 0, dy: 0 }, occupied,
        { top: 0, bottom: window.innerHeight },
      );
      base = { left: pos.left, top: pos.top };
    }
    baseRef.current = { left: base.left, top: base.top };
    el.style.left = `${base.left + offset.dx}px`;
    el.style.top = `${Math.max(0, base.top + offset.dy)}px`;
  });

  return (
    <div
      ref={ref}
      data-testid={testId}
      data-anno={annoId}
      className={`absolute select-none rounded-anno border bg-surface shadow-anno ${
        pinned ? "border-ink-300 shadow-anno-pinned" : "border-line"
      }`}
      style={{
        pointerEvents: "auto",
        width: "var(--container-anno-popup)",
        maxWidth: "var(--container-anno-popup-max)",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={onPressStart}
    >
      <div
        className="flex cursor-grab items-center gap-1 rounded-t-anno border-b border-line bg-sunken py-1.5 pl-2 pr-1.5 active:cursor-grabbing"
        onMouseDown={(event) => {
          if ((event.target as HTMLElement).closest("button") !== null) return;
          // **拖动与钉住是两件事**（用户 2026-11-03 明确）：
          //   拖动 = 位置，随时可拖，拖到哪就是哪；
          //   钉住 = 是否常显，只有它控制"移开收不收"。
          // 早期把两者绑在一起（钉住才能拖）是错的。
          if (onDragEnd === undefined) {
            event.preventDefault();
            onDragStart?.();
            window.addEventListener("mouseup", () => onPressEnd?.(), { once: true });
            return;
          }
          event.preventDefault();
          onDragStart?.();
          const startX = event.clientX;
          const startY = event.clientY;
          let dx = offset.dx;
          let dy = offset.dy;
          let moved = false;
          const el = ref.current;
          // 基准 = baseRef（effect 首摆时算定的槽位/位置）+ 已落盘的 offset。
          // **不从 style.left 读回来**：拖动中途被渲染打断时 style 可能是脏的，
          // 读回它会把上一次的错误位置当成新基准（误差累积，实测遇过）。
          const base = baseRef.current ?? { left: 0, top: 0 };
          const baseLeft = base.left + offset.dx;
          const baseTop = base.top + offset.dy;

          const onMove = (ev: MouseEvent) => {
            const nextDx = offset.dx + (ev.clientX - startX);
            const nextDy = offset.dy + (ev.clientY - startY);
            // 位移不足 2px 不算拖动：手抖/误按不产生「已拖动」状态，也不会把
            // 用户没动的框记成 moved（moved 一旦置上就退出避让，代价不可逆）。
            if (!moved && Math.abs(ev.clientX - startX) < 2 && Math.abs(ev.clientY - startY) < 2) return;
            moved = true;
            dx = nextDx;
            dy = nextDy;
            dragOffsetRef.current = { dx: nextDx, dy: nextDy };   // 先写 ref（同步），effect 看到它就让路
            if (el !== null) {
              el.style.left = `${baseLeft + (ev.clientX - startX)}px`;
              el.style.top = `${Math.max(0, baseTop + (ev.clientY - startY))}px`;
            }
            onDragMove?.(dx, dy);
          };
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            dragOffsetRef.current = null;   // 释放：此后 effect 接管（offset 已由 onDragEnd 落盘）
            onDragEnd(moved ? dx : offset.dx, moved ? dy : offset.dy);
            onPressEnd?.();
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        }}
      >
        <span className="text-micro text-ink-300" aria-hidden="true" title="拖动移动位置">⠿</span>
        <span className="flex flex-wrap items-center gap-1">{bar}</span>
      </div>
      <div className="px-3 pb-2.5 pt-2">{children}</div>
    </div>
  );
}

/* ---------- 引用块 ---------- */

function Quote({ text }: { text: string }) {
  return (
    <div className="mb-1.5 border-l-2 border-line pl-2 text-meta leading-snug text-ink-500 line-clamp-2">
      {text}
    </div>
  );
}

/* ---------- 形态一：draft（拖选后） ---------- */

export type AnnotationDraftProps = {
  quote: string;
  rects: readonly DOMRect[];
  hostRect: DOMRect;
  onCommit: (marks: readonly string[], note: string) => void;
  onCancel: () => void;
  /** 鼠标进出框（用于抑制"移开就收起"）。 */
  onEnter?: () => void;
  onLeave?: () => void;
};

export function AnnotationDraft({ quote, rects, hostRect, onCommit, onCancel, onEnter, onLeave }: AnnotationDraftProps) {
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [note, setNote] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // 出现后聚焦输入框（不抢滚动位置）
    const id = window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(id);
  }, []);

  const commit = useCallback(() => {
    if (picked.length === 0) return;
    onCommit(picked, note.trim());
  }, [picked, note, onCommit]);

  const toggle = useCallback((id: string) => {
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }, []);

  const bar = picked.map((id) => {
    const mark = markById(id);
    if (mark === undefined) return null;
    return (
      <span key={id} className="rounded-full px-1.5 py-px text-micro font-semibold"
        style={{ background: `var(--color-anno-${mark.tone}-soft)`, color: `var(--color-anno-${mark.tone})` }}>
        {mark.label}
      </span>
    );
  });

  return (
    <PopupShell
      testId="annotation-draft" annoId="draft"
      rects={rects} hostRect={hostRect}
      offset={{ dx: 0, dy: 0 }} pinned={false}
      bar={<>
        {bar}
        <span className="ml-auto">
          <IconButton size="sm" label="取消（Esc）" data-testid="draft-cancel" onClick={onCancel}>✕</IconButton>
        </span>
      </>}
      onMouseEnter={onEnter} onMouseLeave={onLeave}
    >
      <Quote text={quote} />
      <MarkButtons selected={picked} onToggle={toggle} testId="draft-marks" />
      <textarea
        ref={textareaRef}
        data-testid="draft-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
          if (event.key === "Enter" && !event.nativeEvent.isComposing && !event.shiftKey) {
            event.preventDefault();
            commit();
          }
        }}
        placeholder="写一句话（可空）…"
        className="min-h-14 w-full resize-y rounded-control border border-line bg-surface px-2 py-1.5 text-body text-ink-900 outline-none placeholder:text-ink-300 focus:border-accent"
        style={{ userSelect: "text" }}
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-micro text-ink-300">Enter 确认 · Esc 取消</span>
        <span className="flex-1" />
        <button type="button" data-testid="draft-commit" onClick={commit} disabled={picked.length === 0}
          className="rounded-control bg-success px-3 py-1 text-meta font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:opacity-90">
          标上
        </button>
      </div>
    </PopupShell>
  );
}

/* ---------- 形态二：已有批注（可编辑 / 钉住 / 关闭 / 删除） ---------- */

export type AnnotationCardProps = {
  annotation: Annotation;
  rects: readonly DOMRect[];
  hostRect: DOMRect;
  onChangeMarks: (marks: readonly string[]) => void;
  onChangeNote: (note: string) => void;
  onTogglePinned: () => void;
  /** 拖动开始（父层置 dragging=true，避免定时器把框收走）。 */
  onDragStart?: () => void;
  /** 拖动中（持续）。 */
  onDragMove?: () => void;
  /** 一次按下-松开结束。 */
  onPressEnd?: () => void;
  /** 拖动结束：提交偏移。 */
  onOffsetChange: (dx: number, dy: number) => void;
  onRemove: () => void;
  onEnter?: () => void;
  onLeave?: () => void;
  /**
   * 同一块里**已摆定**的槽位（避免完全重叠）。
   *
   * 为什么传 Map 而不是算好的数组，且为什么在 effect 里读：
   * 用户 2026-11-03 报的 bug——拖 A，B 跟着跑。
   * 根因是避让每帧重算，且障碍物取的是"其他框当前的 DOM 位置"：
   * A 被拖走 → A 的 DOM 变了 → B 的障碍物变了 → B 重排。
   * 现在改成：每块第一次摆框时算一次并**写进这张表**，之后只读，
   * 别人怎么拖都改不了我的基准。表是 mutable 的，所以在 effect 里读最新值
   *（同一批卡片按渲染顺序执行 effect，前一个写进去的槽位后一个能读到）。
   */
  slots?: Map<string, { left: number; top: number; width: number; height: number }>;
  /** 本框第一次摆定后回报槽位（由上层写进 slots）。 */
  onSlot?: (slot: { left: number; top: number; width: number; height: number }) => void;
};

export function AnnotationCard({
  annotation, rects, hostRect,
  onChangeMarks, onChangeNote, onTogglePinned, onDragStart, onDragMove, onPressEnd, onOffsetChange,
  onRemove, onEnter, onLeave, slots, onSlot,
}: AnnotationCardProps) {
  const { marks, note, ui } = annotation;

  const toggle = useCallback((id: string) => {
    const next = marks.includes(id) ? marks.filter((x) => x !== id) : [...marks, id];
    if (next.length === 0) return;      // 至少留一个（demo 行为）
    onChangeMarks(next);
  }, [marks, onChangeMarks]);

  const bar = marks.map((id) => {
    const mark = markById(id);
    if (mark === undefined) return null;
    return (
      <span key={id} className="rounded-full px-1.5 py-px text-micro font-semibold"
        style={{ background: `var(--color-anno-${mark.tone}-soft)`, color: `var(--color-anno-${mark.tone})` }}>
        {mark.label}
      </span>
    );
  });

  return (
    <PopupShell
      testId="annotation-card" annoId={annotation.id}
      rects={rects} hostRect={hostRect}
      offset={{ dx: ui.dx, dy: ui.dy, moved: ui.moved === true }} pinned={ui.pinned}
      {...(slots === undefined ? {} : { slots })}
      {...(onSlot === undefined ? {} : { onSlot })}
      onDragStart={() => onDragStart?.()}
      onDragMove={() => onDragMove?.()}
      onPressEnd={() => onPressEnd?.()}
      onDragEnd={onOffsetChange}
      bar={<>
        {bar}
        <span className="ml-auto flex items-center gap-0.5">
          <IconButton size="sm"
            label={ui.pinned ? "已钉住 · 点一下解除" : "钉住，让它一直显示"}
            active={ui.pinned} data-testid="card-pin" onClick={onTogglePinned}>
            <PinIcon />
          </IconButton>
          <IconButton size="sm" label="删除这条批注" data-testid="card-remove" onClick={onRemove}>
            <TrashIcon />
          </IconButton>
        </span>
      </>}
      onMouseEnter={onEnter} onMouseLeave={onLeave}
    >
      <Quote text={annotation.quote} />
      <MarkButtons selected={marks} onToggle={toggle} testId="card-marks" />
      <textarea
        data-testid="card-note"
        value={note}
        onChange={(event) => onChangeNote(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.blur(); }}
        placeholder="写一句话…"
        className="min-h-12 w-full resize-y rounded-control border border-transparent bg-sunken px-2 py-1.5 text-body text-ink-900 outline-none placeholder:text-ink-300 hover:bg-hover focus:border-accent focus:bg-surface"
        style={{ userSelect: "text" }}
      />
    </PopupShell>
  );
}
