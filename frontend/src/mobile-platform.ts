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

/**
 * 一个触摸手势的判定（P7-S8，用户实测 2026-11-17："左滑右滑直接相当于退出到桌面"）。
 *
 * ## 为什么要抽成纯函数
 *
 * 缺陷的根因是一行**语义**错误：`touchcancel` 被当成 `touchend` 处理。
 * 安卓系统返回手势的真实序列是
 *
 * ```
 * touchstart → touchmove → touchcancel（系统接管）→ popstate（浏览器执行返回）
 * ```
 *
 * 我们把 `touchcancel` 注册在 `onEnd`（= 提交），于是**我们 back 一次 + 系统 back 一次 = 退两层**；
 * 根级时第二层就是退出应用。这个 bug 在真机上才复现（CDP 能造出同样序列，见 `test/mobile-edge-back.test.mjs`），
 * 所以判据必须能在 Node 里穷举，不能只靠"看着对"。
 *
 * ## 两条参考都是「取消 ≠ 提交」
 *
 * - open-webui `MobileSwipePanel.svelte:306-310`：`onTouchCancel → cancelSwipe()`，不提交；
 * - LibreChat `useDrawerSwipe.ts:616-626`：`onTouchCancel` 时若手势已 claimed 则 `settle(gesture, open)`
 *   ——回到**原状态**，同样不产生"再退一层"。
 *
 * 我们两样都不做，所以两边各退一次。**只有 `touchend` 才提交。**
 */

/** 手势的起点（`touchstart` 时记录）。 */
export type EdgeGestureOrigin = { x: number; y: number };

/**
 * 这次触摸是不是"从右边缘开始、且落在可编辑区域之外"。
 *
 * 右边缘 24px 的依据：iOS/Android 的系统返回手势都有自己的边缘区（iOS 约 20pt），
 * 与它重叠的区域我们**不该**再抢——但我们的方向与系统相反（右缘→左），
 * 所以重叠不会造成"两个都触发"：系统只认左缘。24 是本任务 P2-S2 起就用的值，
 * 取值理由见 `knowledge/reference-mobile.md`（open-webui `UNSAFE_EDGE = 16` /
 * LibreChat 抽屉边缘同一量级）；这里不改数值，只改"什么时候算完成"。
 *
 * @returns 起点坐标；`undefined` = 这次触摸不归我们管（多指 / 编辑区 / 不在边缘）
 */
export function edgeGestureStartsAt(input: {
  clientX: number;
  clientY: number;
  viewportWidth: number;
  touchCount: number;
  onEditable: boolean;
  edge?: number;
}): EdgeGestureOrigin | undefined {
  const { clientX, clientY, viewportWidth, touchCount, onEditable } = input;
  const edge = input.edge ?? 24;
  if (touchCount !== 1) return undefined;     // 双指 = 缩放，不是返回
  if (onEditable) return undefined;           // 输入框里拖选不该退层
  if (clientX < viewportWidth - edge) return undefined;
  return { x: clientX, y: clientY };
}

/**
 * 松手时是否**提交**返回。
 *
 * @param end   手势如何结束。`cancel` = 被系统/他人接管 → **不提交**（这是本条的全部要点）。
 * @param dx    水平位移（负 = 向左）
 * @param dy    垂直位移
 * @param commitDistance 触发阈值（默认 48）
 * @param axisRatio      水平必须压过垂直的倍数（默认 1.2）
 */
export function edgeGestureCommits(input: {
  end: "end" | "cancel";
  dx: number;
  dy: number;
  commitDistance?: number;
  axisRatio?: number;
}): boolean {
  if (input.end === "cancel") return false;
  const commitDistance = input.commitDistance ?? 48;
  const axisRatio = input.axisRatio ?? 1.2;
  return input.dx <= -commitDistance && Math.abs(input.dx) > Math.abs(input.dy) * axisRatio;
}
