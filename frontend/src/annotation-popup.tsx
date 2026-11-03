/**
 * 批注框（Task 0003 · P2：只读版）。
 *
 * P2 职责：**让用户看见批注存在**——浮在文字之上、指向被批注的那段、能看内容。
 * 编辑/钉住/拖动/关闭/删除是 P3 的事，本阶段只做"显示"。
 *
 * 位置规则（与 demo 一致）：
 *  - 默认放在被批注文字的**正下方 8px、水平居中**；
 *  - 下方放不下 → 放文字上方；
 *  - 水平夹在容器内 8px 边距。
 */

import { useLayoutEffect, useRef } from "react";
import type { Annotation } from "./annotations.ts";
import { markById } from "./marks.ts";

export type AnnotationPopupProps = {
  annotation: Annotation;
  /** 被批注文字的矩形集合（相对视口），用于定位。 */
  anchorRects: readonly DOMRect[];
  /** 容器（批注层）的矩形，用于坐标换算与边界夹取。 */
  hostRect: DOMRect;
  /** 容器高度（用于"下方放不下"判断）。 */
  hostHeight: number;
};

/** 由选区矩形算浮框位置（相对容器左上角）。 */
export function popupPosition(
  rects: readonly DOMRect[],
  hostRect: DOMRect,
  hostHeight: number,
  size: { width: number; height: number },
  offset: { dx: number; dy: number } = { dx: 0, dy: 0 },
): { left: number; top: number } {
  if (rects.length === 0) return { left: 8, top: 8 };
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  const top = Math.min(...rects.map((r) => r.top));
  const bottom = Math.max(...rects.map((r) => r.bottom));

  const gap = 8;
  const margin = 8;

  // 拖动过的（dx/dy 非零）：以第一行矩形为基准加偏移
  if (offset.dx !== 0 || offset.dy !== 0) {
    const first = rects[0] ?? { left, bottom };
    return {
      left: first.left - hostRect.left + offset.dx,
      top: first.bottom - hostRect.top + gap + offset.dy,
    };
  }

  let x = (left + right) / 2 - size.width / 2 - hostRect.left;
  let y = bottom - hostRect.top + gap;
  if (y + size.height > hostHeight) y = Math.max(0, top - hostRect.top - size.height - gap);
  x = Math.max(margin, Math.min(hostRect.width - size.width - margin, x));
  return { left: Math.round(x), top: Math.round(Math.max(0, y)) };
}

export function AnnotationPopup({ annotation, anchorRects, hostRect, hostHeight }: AnnotationPopupProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const { left, top } = popupPosition(
      anchorRects, hostRect, hostHeight,
      { width: el.offsetWidth, height: el.offsetHeight },
      { dx: annotation.ui.dx, dy: annotation.ui.dy },
    );
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [anchorRects, hostRect, hostHeight, annotation.ui.dx, annotation.ui.dy, annotation.note, annotation.marks]);

  return (
    <div
      ref={ref}
      data-testid="annotation-popup"
      data-anno={annotation.id}
      className="absolute rounded-anno border border-line bg-surface shadow-anno"
      style={{
        pointerEvents: "auto",
        width: "var(--container-anno-popup)",
        maxWidth: "var(--container-anno-popup-max)",
      }}
    >
      <div className="flex flex-wrap items-center gap-1 rounded-t-anno border-b border-line bg-sunken px-2.5 py-1.5">
        {annotation.marks.map((id) => {
          const mark = markById(id);
          if (mark === undefined) return null;
          return (
            <span
              key={id}
              data-mark={id}
              className="rounded-full px-1.5 py-px text-micro font-semibold"
              style={{
                background: `var(--color-anno-${mark.tone}-soft)`,
                color: `var(--color-anno-${mark.tone})`,
              }}
            >
              {mark.label}
            </span>
          );
        })}
      </div>
      <div className="px-3 pb-2.5 pt-2">
        <div className="mb-1.5 border-l-2 border-line pl-2 text-meta leading-snug text-ink-500 line-clamp-2">
          {annotation.quote}
        </div>
        <div className={`whitespace-pre-wrap text-body ${annotation.note === "" ? "italic text-ink-300" : "text-ink-900"}`}>
          {annotation.note === "" ? "（只标了，没写话）" : annotation.note}
        </div>
      </div>
    </div>
  );
}
