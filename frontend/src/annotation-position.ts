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
  viewport?: { top: number; bottom: number },
): { left: number; top: number } {
  if (rects.length === 0) return { left: 8, top: 8 };
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  const top = Math.min(...rects.map((r) => r.top));
  const bottom = Math.max(...rects.map((r) => r.bottom));

  const GAP = 8;
  const MARGIN = 8;

  // 可见区域用**窗口坐标**。不传时退化为容器自身范围，行为与改造前一致（单测不受影响）。
  const viewTop = viewport?.top ?? hostRect.top;
  const viewBottom = viewport?.bottom ?? hostRect.top + hostHeight;

  let x = (left + right) / 2 - size.width / 2 - hostRect.left;

  // 默认在文字下方；下方**在可见区域里**放不下就翻到上方（P6 补）。
  // 早期只跟"容器高度"比：长消息里容器很高永远"放得下"，框实际跑到屏幕外。
  const below = bottom + GAP;                       // 下方方案的卡片上边（窗口坐标）
  const above = top - GAP - size.height;            // 上方方案的卡片上边
  const fitsBelow = below + size.height <= viewBottom - MARGIN;
  const fitsAbove = above >= viewTop + MARGIN;
  let yClient: number;
  if (fitsBelow) yClient = below;
  else if (fitsAbove) yClient = above;
  else yClient = Math.max(viewTop + MARGIN, below); // 两边都放不下：贴着可见下沿

  const y = yClient - hostRect.top;
  x = Math.max(MARGIN, Math.min(hostRect.width - size.width - MARGIN, x));
  return { left: Math.round(x), top: Math.round(Math.max(0, y)) };
}

/**
 * 固定的槽位（Task 0003 · 修拖动互相影响）。
 *
 * 用户 2026-11-03 报告的 bug：拖 A 框，B 框跟着跑。
 * 根因：`popupPosition` 每次渲染都重算避让——A 被拖过后退出避让集合，
 * B 少了一个障碍就重排。**别人的框动了，我的框不该动。**
 *
 * 正确模型：每块第一次摆框时把位置算定，之后：
 *   - 拖动 = 在这个固定基准上加偏移；
 *   - 别人怎么拖，都不改变我的基准；
 *   - 只有窗口尺寸变化（容器宽度变了，几何失效）才整块重算。
 *
 * 纯函数，便于单测：无副作用，返回的就是该块此刻应占的槽位表。
 */
export function fixedSlots(
  items: readonly { id: string; rects: readonly DOMRect[] }[],
  hostRect: DOMRect,
  hostHeight: number,
  size: { width: number; height: number },
  sizes: readonly { id: string; width: number; height: number }[],
): { id: string; left: number; top: number; width: number; height: number }[] {
  const out: { id: string; left: number; top: number; width: number; height: number }[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) continue;
    const own = sizes.find((s) => s.id === item.id) ?? size;
    const pos = popupPosition(
      item.rects, hostRect, hostHeight,
      { width: own.width, height: own.height },
      { dx: 0, dy: 0 },
      out.map((o) => ({ left: o.left, top: o.top, width: o.width, height: o.height })),
    );
    out.push({ id: item.id, left: pos.left, top: pos.top, width: own.width, height: own.height });
  }
  return out;
}

/** 由选区矩形算浮框位置（相对容器左上角）。纯函数。 */
export function popupPosition(
  rects: readonly DOMRect[],
  hostRect: DOMRect,
  hostHeight: number,
  size: { width: number; height: number },
  offset: { dx: number; dy: number; moved?: boolean } = { dx: 0, dy: 0 },
  occupied: readonly OccupiedBox[] = [],
  viewport?: { top: number; bottom: number },
): { left: number; top: number } {
  if (rects.length === 0) return { left: 8, top: 8 };

  // 基准永远是**默认位置**（与未拖动时同一个公式），拖动只在它上面加偏移。
  // 这样"刚开始拖的那一像素"不会因为换公式而跳。
  const base = popupBasePosition(rects, hostRect, hostHeight, size, viewport);

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
