// 浮层定位（popover placement）——纯函数，可穷举单测。
//
// 为什么要有这个文件（C190，用户报告的交互缺陷）：
//   第一版预览气泡用 `fixed bottom-20 right-6` 写死位置，实测与锚点偏差 **dx=-284px, dy=+524px**，
//   鼠标停在第 5 行的头像上，气泡跑到视口右下角。用户原话："距离检视的那一行隔得非常远……
//   弹出来就好了啊，弹到哪儿我们都没管，所以这也是一个交互上的非常典型的反面案例。"
//
// 参考实现（都有现成答案，我没先看）：
//  - **difit** `DiffQuickMenu.tsx:119-131` 用 `@floating-ui/react`：
//      `placement: 'bottom-end'`, `middleware: [offset(6), flip(), shift({ padding: 8 })]`,
//      `whileElementsMounted: autoUpdate`
//    → 三件事：贴 6px、空间不足翻转、贴边平移并留 8px。
//  - **我们自己的 `annotated-text-block.tsx:415-430`**：用 `getBoundingClientRect()` 判断卡片在
//    原文上方还是下方（`below = cardRect.top >= bottom - 4`）。同一份思路，只是那个是连线版。
//
// 纪律：不读全局、不碰 DOM——只接受矩形与视口尺寸，返回坐标。可穷举单测（architecture 2.5）。

/** 与 difit `offset(6)` 同值：浮层与锚点的间距。 */
export const POPOVER_GAP = 6;
/** 与 difit `shift({ padding: 8 })` 同值：浮层与视口边缘的最小距离。 */
export const POPOVER_VIEWPORT_PADDING = 8;

export type RectLike = { top: number; left: number; right: number; bottom: number; width: number; height: number };

export type PopoverPlacement = {
  /** `position: fixed` 用的 top/left（px） */
  top: number;
  left: number;
  /** 出现在锚点下方还是上方（空间不足会翻转） */
  side: "below" | "above";
  /** 水平方向是否被视口边界推开了（调试/断言用） */
  shifted: boolean;
};

/**
 * 计算浮层位置。
 *
 * 规则（每条都有参考依据）：
 *  1. 默认在锚点**下方**，间距 `POPOVER_GAP`；
 *  2. 下方放不下 → **翻到上方**（difit `flip()`）；
 *  3. 水平**右缘对齐**锚点右缘（difit `placement: 'bottom-end'`）——
 *     头像在行末，气泡向左展开才不会被右边缘切掉；
 *  4. 左/右超出视口 → 平移进视口，两侧各留 `POPOVER_VIEWPORT_PADDING`（difit `shift()`）；
 *  5. 上下都放不下（视频很小）→ 取空间大的一侧，并夹进视口。
 */
export function placePopover(
  anchor: RectLike,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): PopoverPlacement {
  const pad = POPOVER_VIEWPORT_PADDING;
  const spaceBelow = viewport.height - anchor.bottom - POPOVER_GAP - pad;
  const spaceAbove = anchor.top - POPOVER_GAP - pad;
  const side: "below" | "above" = size.height <= spaceBelow || spaceBelow >= spaceAbove ? "below" : "above";

  const rawTop = side === "below"
    ? anchor.bottom + POPOVER_GAP
    : anchor.top - POPOVER_GAP - size.height;
  const maxTop = Math.max(pad, viewport.height - size.height - pad);
  const top = Math.min(Math.max(rawTop, pad), maxTop);

  // 右缘对齐锚点右缘，再夹进视口
  const rawLeft = anchor.right - size.width;
  const maxLeft = Math.max(pad, viewport.width - size.width - pad);
  const left = Math.min(Math.max(rawLeft, pad), maxLeft);

  return { top, left, side, shifted: left !== rawLeft };
}
