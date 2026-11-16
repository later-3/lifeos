/**
 * 手机平台层的纯判定（Task 0016 · P2-S2）。
 *
 * 三个函数对应三条**与具体页面无关、作用于整站**的手机行为。抽成零依赖 `.ts` 的理由
 * 与 `design/icon-sets-resolve.ts` 一样：Node 能直接加载，才能穷举边界。
 *
 * 每条都有 A 级参考与实测依据（详见 `knowledge/reference-mobile.md`）：
 *
 * | 函数 | 参考 | 我们缺了会怎样 |
 * |---|---|---|
 * | `resolveAppHeight` | pi-web `lib/mobile-viewport.ts:11-45` | 双指放大时 `visualViewport.height` 变小 → 整页缩水 |
 * | `mobileQueryOf` | pi-web `hooks/useIsMobile.ts:7` | 横屏手机（844×390）走桌面布局，命中区掉到 32–36px |
 * | `coarsePointerCss` 的判据 | LibreChat `client/src/style.css:1881` | iOS 聚焦 15px 输入框 → 整页放大且 PWA 下不缩回 |
 */

/**
 * 应用高度（写进 `--app-height`）。
 *
 * 为什么不能直接用 `visualViewport.height`：**双指放大时它也变小**。
 * 用户放大页面（scale > 1）后 `visualViewport` 表示的是"可见区域"，用它当布局高度会让整个应用缩水
 * ——观感就是"布局崩了"。pi-web 用 `isUnscaled = |scale - 1| < 0.01` 判这一点
 * （`lib/mobile-viewport.ts:19`），我们取 1.05：Safari 的缩放有细微抖动，1.01 会把
 * "轻微滚动导致的 scale 抖动"误判成放大。
 *
 * @param innerHeight  `window.innerHeight`（布局视口高度）
 * @param visualHeight `visualViewport.height`（可见区域高度）
 * @param visualScale  `visualViewport.scale`（1 = 未缩放）
 */
export function resolveAppHeight(input: {
  innerHeight: number;
  visualHeight: number;
  visualScale: number;
}): number {
  const { innerHeight, visualHeight, visualScale } = input;
  // 放大状态：可见区域是被"裁"出来的，不是键盘压出来的 → 用布局高度，不跟着缩
  if (visualScale > 1.05) return innerHeight;
  // 未放大：键盘弹起时 visualHeight < innerHeight，此时必须跟可见区域（否则 composer 被键盘遮住）
  if (Number.isFinite(visualHeight) && visualHeight > 0 && visualHeight < innerHeight) return visualHeight;
  return innerHeight;
}

/**
 * 手机布局的媒体查询。
 *
 * 第一支是我们自己的断点（`<640`，与 `frontend-spec` §3.2 一致）。
 * **第二支是手机横屏**：iPhone 横屏宽度 844 逻辑像素，只按宽度会掉回桌面三列布局，
 * 而手指还是手指——命中区 32px、hover-only 的动作永远出不来（实测：844×390 下
 * `设置` 36px / `完整历史` 32px）。
 *
 * 为什么不采用 pi-web 的 768 作为宽度断点：我们 640–768 之间的三列还排得开
 * （`design/layout.ts` 的 `layout()` 会算），改成 768 会让 700px 窗口丢三列。
 * 所以**只补"粗指针 + 矮视口"这一支**，宽度断点保持 639。
 */
export const MOBILE_QUERY =
  "(max-width: 639px), (hover: none) and (pointer: coarse) and (max-height: 500px)";

/** 把宽度断点换成别的值时仍保留"手机横屏"那一支（测试与调试用）。 */
export function mobileQueryOf(maxWidth = 639): string {
  return `(max-width: ${maxWidth}px), (hover: none) and (pointer: coarse) and (max-height: 500px)`;
}
