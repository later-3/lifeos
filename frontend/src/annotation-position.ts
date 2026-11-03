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

/** 默认位置（未拖动、未避让）：文字正下方 8px、水平居中；下方放不下 → 上方；水平夹在容器内。
 *
 *  抽出来单独存在的理由：**拖动偏移必须以它为基准**。
 *  早期拖动分支用的是"第一行矩形的左边"作基准，和默认的"居中"不是同一个基准，
 *  于是刚开始拖的那一像素会看到框突然跳一下（实测）。
 */
export function popupBasePosition(
  rects: readonly DOMRect[],
  hostRect: DOMRect,
  hostHeight: number,
  size: { width: number; height: number },
): { left: number; top: number } {
  if (rects.length === 0) return { left: 8, top: 8 };
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  const top = Math.min(...rects.map((r) => r.top));
  const bottom = Math.max(...rects.map((r) => r.bottom));

  const GAP = 8;
  const MARGIN = 8;

  let x = (left + right) / 2 - size.width / 2 - hostRect.left;
  let y = bottom - hostRect.top + GAP;
  if (y + size.height > hostHeight) y = Math.max(0, top - hostRect.top - size.height - GAP);
  x = Math.max(MARGIN, Math.min(hostRect.width - size.width - MARGIN, x));
  return { left: Math.round(x), top: Math.round(Math.max(0, y)) };
}

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

  // 基准永远是**默认位置**（与未拖动时同一个公式），拖动只在它上面加偏移。
  // 这样"刚开始拖的那一像素"不会因为换公式而跳。
  const base = popupBasePosition(rects, hostRect, hostHeight, size);

  if (offset.moved === true || offset.dx !== 0 || offset.dy !== 0) {
    // 拖过的框：不再参与避让（用户摆哪儿就是哪儿）
    return { left: Math.round(base.left + offset.dx), top: Math.round(Math.max(0, base.top + offset.dy)) };
  }

  const GAP = 8;
  let { left: x, top: y } = base;

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
