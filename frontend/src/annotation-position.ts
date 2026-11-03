/**
 * 批注浮框的位置计算（Task 0003 · P3）。
 *
 * 抽成独立文件而不是留在 .tsx 里：它是纯函数，单测要能直接 import
 *（node 不能直接加载 .tsx）。
 */

/**
 * 已占用的框（同一块里其他展开的框），用于纵向错开、避免完全重叠。
 * 每项是相对容器的 { left, top, width, height }。
 */
export type OccupiedBox = { left: number; top: number; width: number; height: number };

/** 由选区矩形算浮框位置（相对容器左上角）。纯函数。 */
export function popupPosition(
  rects: readonly DOMRect[],
  hostRect: DOMRect,
  hostHeight: number,
  size: { width: number; height: number },
  offset: { dx: number; dy: number; moved?: boolean } = { dx: 0, dy: 0 },
  occupied: readonly OccupiedBox[] = [],
): { left: number; top: number } {
  if (rects.length === 0) return { left: 8, top: 8 };
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  const top = Math.min(...rects.map((r) => r.top));
  const bottom = Math.max(...rects.map((r) => r.bottom));

  const GAP = 8;
  const MARGIN = 8;

  // 拖动过的：以第一行矩形为基准加偏移。
  // 判据是 `moved` 而不是 `dx/dy !== 0`：拖回原点（0,0）也算拖过，不能重算位置。
  if (offset.moved === true || offset.dx !== 0 || offset.dy !== 0) {
    const first = rects[0] ?? { left, bottom };
    return {
      left: first.left - hostRect.left + offset.dx,
      top: first.bottom - hostRect.top + GAP + offset.dy,
    };
  }

  // 默认：文字下方 8px 居中；下方放不下 → 上方；水平夹在容器内
  let x = (left + right) / 2 - size.width / 2 - hostRect.left;
  let y = bottom - hostRect.top + GAP;
  if (y + size.height > hostHeight) y = Math.max(0, top - hostRect.top - size.height - GAP);
  x = Math.max(MARGIN, Math.min(hostRect.width - size.width - MARGIN, x));

  // 与已展开的其他框错开：横向有重叠就往下推，直到不压住任何一个。
  // （没有这一步，同一段文字上的两条批注会完全叠在一起，看着像只有一个。）
  let guard = 0;
  while (guard < 40) {
    const hit = occupied.find((o) => (
      x < o.left + o.width + GAP && x + size.width + GAP > o.left
      && y < o.top + o.height + GAP && y + size.height + GAP > o.top
    ));
    if (hit === undefined) break;
    y = hit.top + hit.height + GAP;
    guard += 1;
  }

  return { left: Math.round(x), top: Math.round(Math.max(0, y)) };
}
