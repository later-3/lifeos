/**
 * 选中功能条（Task 0018 · SelectionToolbar）：拖选/双击/三击松手后浮在选区旁的一排功能入口。
 *
 * 形态纪律（D16）：它是**一排按钮**，不预设"框"的形态；轻量浮动、深底白字（D3 基调，
 * 与「已复制」胶囊同一视觉语言）；不引入新色、数值全部走 tokens。
 *
 * **焦点纪律（Task 0013 教训 + 0018 硬约束）**：
 *  - 条与按钮都 `onMouseDown preventDefault`——点击时焦点不离开文档、**选区不被清**
 *   （LibreChat `QuoteButton.tsx:628` 与 Open WebUI Comment 按钮同法，`02-references.md` §1.3）；
 *  - 只有「批注」被点击后才发生焦点转移（草稿框 textarea autofocus，编辑态抢焦点合法——
 *    那时选区已被主动清掉）。
 *
 * 定位：`copyFeedbackPosition` 同族（选区上方居中 / 8px / 16px 边缘 / 上下翻转 / 先量后显），
 * 但条比胶囊高——同一条竖线上**条在上、胶囊在它更上方 8px**？不：两者各自独立锚定选区，
 * 胶囊沿用 Task 0013 的几何（选区上方 8px），条放在胶囊**之上再隔 8px** 的位置会叠罗汉。
 * 简化（D9 的设计取舍）：条在**下方**优先（不与胶囊打架：胶囊在上、条在下，各占一侧），
 * 放不下翻上方，最后夹进视口。
 */

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { layerStyle } from "./design/surface";
import { COPY_EDGE_MARGIN, COPY_GAP, type RectLike } from "./copy-on-select";

/** 功能条定位（视口坐标，fixed）。下方优先，放不下翻上方，最后夹进视口。 */
export function toolbarPosition(
  anchor: RectLike,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const maxLeft = Math.max(COPY_EDGE_MARGIN, viewport.width - size.width - COPY_EDGE_MARGIN);
  const centerX = anchor.left + (anchor.right - anchor.left) / 2;
  const left = Math.min(Math.max(centerX - size.width / 2, COPY_EDGE_MARGIN), maxLeft);

  // 下方优先（区别于胶囊的上方优先：条要跟胶囊同屏共存，胶囊已占上方）
  const below = anchor.bottom + COPY_GAP;
  const above = anchor.top - COPY_GAP - size.height;
  const maxTop = Math.max(COPY_EDGE_MARGIN, viewport.height - size.height - COPY_EDGE_MARGIN);
  const fits = (value: number) => value >= COPY_EDGE_MARGIN && value <= maxTop;
  const top = fits(below) ? below : fits(above) ? above : Math.min(Math.max(below, COPY_EDGE_MARGIN), maxTop);
  return { left: Math.round(left), top: Math.round(top) };
}

export type SelectionToolbarProps = {
  state: {
    text: string;
    anchor: RectLike;
    annotatable: boolean;
    speaker: "user" | "assistant" | undefined;
    buttons: { copy: boolean; annotate: boolean; quote: boolean };
  };
  onClose: () => void;
  /** 复制（关态的复制按钮）：写剪贴板 + 胶囊反馈由调用方处理。 */
  onCopy: () => void;
  /** 批注：调用方把选区换算成批注锚点并打开草稿框。 */
  onAnnotate: () => void;
  /** 引用：格式化后填进输入框（追加，不覆盖）。 */
  onQuote: () => void;
};

export function SelectionToolbar({ state, onClose, onCopy, onAnnotate, onQuote }: SelectionToolbarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 先量后显：首帧 visibility hidden 量尺寸，算好位置再显示（防闪现在左上角）。
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (bar === null) return;
    const rect = bar.getBoundingClientRect();
    const p = toolbarPosition(
      state.anchor,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos(p);
  }, [state.anchor]);

  const buttons = state.buttons;

  return createPortal(
    <div
      ref={barRef}
      role="toolbar"
      aria-label="选中文字的操作"
      data-testid="selection-toolbar"
      onMouseDown={(event) => event.preventDefault()}
      style={{
        position: "fixed",
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos === null ? "hidden" : "visible",
        // 层级走 LAYER（design-system 门禁拦裸数字）：条是弹出面板层（toast 永远最上，胶囊反馈不被压）
        ...layerStyle("popover"),
      }}
      className="flex items-center gap-0.5 rounded-panel bg-ink-900 px-1 py-1 text-surface shadow-anno"
    >
      {buttons.copy && (
        <button type="button" onClick={onCopy} aria-label={`复制选中的 ${[...state.text.trim()].length} 字`}
          className="flex h-7 items-center gap-1 rounded-control px-2 text-meta hover:bg-hover">
          复制
        </button>
      )}
      {buttons.annotate && (
        <button type="button" onClick={onAnnotate} aria-label="批注选中的文字"
          className="flex h-7 items-center gap-1 rounded-control px-2 text-meta hover:bg-hover">
          批注
        </button>
      )}
      {buttons.quote && (
        <button type="button" onClick={onQuote} aria-label="引用到输入框"
          className="flex h-7 items-center gap-1 rounded-control px-2 text-meta hover:bg-hover">
          引用
        </button>
      )}
    </div>,
    document.body,
  );
}
