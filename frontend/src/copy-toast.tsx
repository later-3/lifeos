/**
 * 「已复制」小胶囊（Task 0013）。
 *
 * 形态来源（见任务 02-references.md）：
 *  - 位置几何：LibreChat `QuoteButton.tsx`（上方优先 / 间距 8 / 边缘 16 / 先量后显）；
 *  - 浮层配色（2026-11-12 用户改为跟主题走）：`bg-surface` 卡面 + `ring-line` 边界 + `shadow-lg`
 *    浮层阴影 + `text-ink-900` 正文——与检视面板/Modal 同一套语言，深浅模式自适应
 *   （原为硬深底 `bg-ink-900 + text-surface`，Task 0013 D3 拍板；被本条取代）。
 *  - 文案：`已复制 · N 字`（用户 2026-11-07 拍板）；
 *  - 停留：1000ms（Zulip / Pi TUI 同值，用户拍板选它而不是我们动作条的 1500ms）。
 *
 * 三条纪律：
 *  1. **不抢事件**：`pointer-events: none` + `select-none`，否则拖选后的第一次点击会打在胶囊上；
 *  2. **不改选区**：出现在 `document.body` 的 fixed 容器里，不插进消息 DOM，
 *     所以外层任何重渲染都不会让用户"选中的那段"消失；
 *  3. **同时只留一个**：后一次复制覆盖前一次（连续拖选不叠一屏胶囊）。
 */

import { useLayoutEffect, useRef, useState } from "react";
import { copyFeedbackPosition, type RectLike } from "./copy-on-select";
import { LAYER_CLASS } from "./design/surface";

/** 展示请求：每次复制递增 `seq`（同一段文字连拖两次也要重新计时）。 */
export type CopyFeedback = { text: string; rect: RectLike; seq: number };

export function CopyFeedbackToast({ feedback }: { feedback: CopyFeedback | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  /**
   * 先量尺寸再定位：胶囊宽度取决于文案（字数不同宽度不同），
   * 未量之前不能猜。LibreChat 的做法是 `visibility: hidden` 直到定位完成，
   * 我们直接用 `visible` 状态：第一次渲染不可见，量完再显示 —— 不会闪一下错位。
   */
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null || feedback === null) { setVisible(false); return; }
    setVisible(true);
  }, [feedback]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null || feedback === null || !visible) return;
    const pos = copyFeedbackPosition(
      feedback.rect,
      { width: node.offsetWidth, height: node.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    node.style.left = `${pos.left}px`;
    node.style.top = `${pos.top}px`;
  }, [feedback, visible]);

  if (feedback === null) return null;

  return (
    <div
      ref={ref}
      data-testid="copy-feedback"
      role="status"
      aria-live="polite"
      style={{ visibility: visible ? "visible" : "hidden" }}
      className={`pointer-events-none fixed ${LAYER_CLASS.toast} inline-flex select-none items-center gap-1.5 whitespace-nowrap rounded-full bg-surface px-2.5 py-1 text-meta font-semibold text-ink-900 ring-1 ring-line shadow-lg`}
    >
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="var(--color-success)" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 8.5 6 12 13.5 4.5" />
      </svg>
      <span>{feedback.text}</span>
    </div>
  );
}
