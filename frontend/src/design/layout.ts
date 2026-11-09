/**
 * 布局宽度的唯一计算入口（前端开发路径 · 闸 3 的不变量基座）。
 *
 * 为什么要有这个文件：之前宽度在 useColumnWidth 里算一遍（假设收起列占 20px）、
 * 组件里又各自渲染一遍（FoldRail 实际 36px），三列全收时面板上限多算 48px，
 * 聊天列被压到 252px < 自声明的 MIN_CHAT。数值一旦有两处来源就必然对不上。
 *
 * 约定：
 * - 本函数是纯函数，不读 DOM、不读 localStorage；测试对「视口 × 折叠组合 × 面板」穷举断言。
 * - 图标轨常驻 44px（收起/展开一样），列收展只影响列的 0/实宽；绝不 O(n)。
 * - 聊天保底 MIN_CHAT 由本函数钳制，面板永远拿不到"挤死聊天"的宽度。
 */

export const RAIL = 44;
export const HANDLE = 6;
export const MIN_CHAT = 420;
/** 完整历史（回合检查器）并列列：最小/默认宽度。它和文件面板互斥。 */
export const MIN_HISTORY = 360;
export const DEFAULT_HISTORY = 440;
export const MIN_PANEL = 320;
export const MIN_VIEWER = 206;
/**
 * 检视面板（Task 0010）：与文件面板/完整历史**并存不互斥**（D10）。
 * 宽度走比例（D7/D12）：用户拖出的 `reviewRatio` 是"检视区占右侧可用宽度的份额"，
 * 布局时按视口换算成 px，再钳 MIN/MAX——换屏幕比例不变（D12 的核心）。
 * 单列 diff 的最小宽 360：行号区+内边距 60px + 12px 等宽 50 字符（P50 以下），实测推导见
 * 01-background「数值事实」；并排是宽屏增量，`reviewView="split"` 时两栏各 ≥240。
 */
export const MIN_REVIEW = 360;
/**
 * 比例的自然区间：比例是**视口的份额**，0–1 是它的物理边界（防 localStorage 脏值，不是产品限制）。
 *
 * 2026-11-05 用户："这里还是限制了最大的左拖动的宽度吗？没必要限制的" —— 去掉人为的像素上限
 * （旧 `MAX_REVIEW 1200` / `MAX_REVIEW_RATIO 0.9`）。**唯一的真上限是右侧预算**：
 * `reviewBudget = 视口 − 左列 − 把手 − MIN_CHAT`，也就是"对话区不被压破"这条物理约束。
 * 参考：opencode `session-panel-width.ts:19-21` 的 `sessionPanelWidthMax` 也是
 * `available − SIDE_PANE_WIDTH_MIN`（只保对侧最小宽，没有绝对上限），一致。
 */
export const MIN_REVIEW_RATIO = 0;
export const MAX_REVIEW_RATIO = 1;
/**
 * 默认比例 = 1/3 视口（"对话 2 : 检视 1"的经典分栏）。
 *
 * 为什么不是 pi-web 的 0.42：它的左栏仅 ~200px，0.42 × 视口 在它那里对话仍宽裕；
 * 我们左列合计 588px（已被面板合并压过一轮），0.42 × 1680 = 706 → 对话被压到保底 420，
 * 实际是"默认就顶格"。1/3 在 1680 下是 554px / 对话 526px，与 P2 停点时给用户看的
 * 529 / 551 几乎一致（差 25px），不制造视觉漂移。
 */
export const DEFAULT_REVIEW_RATIO = 1 / 3;

/**
 * 比例 ↔ 像素的**唯一**换算（布局与拖动共用同一对函数）。
 *
 * 2026-11-05 修（用户实测报"一左右拖动就有问题"）：旧实现拖动按 `宽 /(视口 − MIN_CHAT)` 存比例，
 * 布局时又 `Math.min(…, reviewMaxRaw)` 把像素截掉而比例照涨——**存的比例如不是看到的宽度**。
 * 实测后果三条：① 拖到顶后往回拉有 163px 死区；② 换视口面板自己跳（666px → 1920 变 868px）；
 * ③ 拖动没有可用的区间尺子。
 *
 * 现在：`px = round(视口 × ratio)`，拖动只在 `[MIN_REVIEW, 右侧预算]` 对应的**比例区间**内取值，
 * 因此 1px 鼠标位移 = 1px 面板位移，换屏严格等比例（D12）。
 */
export function reviewPxOfRatio(viewport: number, ratio: number | undefined): number {
  const value = Number.isFinite(ratio) ? (ratio as number) : DEFAULT_REVIEW_RATIO;
  const clamped = Math.min(MAX_REVIEW_RATIO, Math.max(MIN_REVIEW_RATIO, value));
  return Math.max(MIN_REVIEW, Math.round(viewport * clamped));
}

/**
 * 像素 → 比例（拖动用）。`maxPx` = 这一侧实际能给的最大像素（Layout.reviewBudget）。
 *
 * 只有两条约束：不小于 MIN_REVIEW（行号槽 + 50 字符可读）、不大于右侧预算（不压破对话区）。
 * 区间取完后 `reviewPxOfRatio(reviewRatioOfPx(px))` 在区间内必须回到 `px`——这条往返无损
 * 是"1px 跟手、无死区"的数学保证（测试已锁）。
 */
export function reviewRatioOfPx(viewport: number, px: number, maxPx: number): number {
  const safeViewport = Math.max(1, viewport);
  const lo = Math.max(MIN_REVIEW_RATIO, MIN_REVIEW / safeViewport);
  const hi = Math.max(lo, Math.min(MAX_REVIEW_RATIO, Math.max(MIN_REVIEW, maxPx) / safeViewport));
  return Math.min(hi, Math.max(lo, px / safeViewport));
}

/**
 * 折叠状态（Task 0015 · T15 面板合并后）。
 *
 * 旧：`{nav, projects, sessions}` —— 项目列表与会话列表各占一列。
 * 新：`{nav, groups}` —— 项目作为**分组头**并入会话列（P-02 草案，
 * `knowledge/design/im/groups-panel.md` §5.2）。图标栏 3 → 2，折叠态 8 → 4 种。
 */
export type Folded = { nav: boolean; groups: boolean };
export type Widths = { c1: number; c2: number; c3: number; c4: number; c4t: number; c5: number };

/**
 * `c2` = 分组面板（项目分组 → 会话行），默认 300、范围 240–440（P-02 已定，不是新数值）。
 * `c3` 保留在类型里只为兼容既有调用（合并后不再渲染列，值恒为 0）。
 */
export const DEFAULT_WIDTHS: Widths = { c1: 232, c2: 300, c3: 0, c4: 600, c4t: 240, c5: DEFAULT_HISTORY };

export const WIDTH_LIMITS: Record<keyof Widths, [number, number]> = {
  c1: [180, 440],
  c2: [240, 440],
  c3: [0, 0],
  c4: [320, 1600],
  c4t: [160, 560],
  c5: [MIN_HISTORY, 720],
};

// 2026-10-18（用户定 + 参照 VS Code Activity Bar）：**不再按视口强制收起列**。
// 旧规则（<1200 收项目、<1000 收会话）会让"点图标展开"变成死点击；现在一律以用户的收展状态为准，
// 窗口窄就压缩列/聊天（与 VS Code 一致：它也不会因为窗口变窄就把你的侧栏关掉）。

export type LayoutInput = {
  viewport: number;
  widths: Widths;
  requested: Folded;
  panelOpen: boolean;
  /** 完整历史并列列（与文件面板互斥；放不下时为 0，调用方负责降级） */
  historyOpen?: boolean;
  /**
   * 检视面板（Task 0010）：与文件面板**并存不互斥**（D10）。
   * `reviewRatio` 是用户拖出的比例（存 localStorage，D12）；不传按默认比例算。
   */
  reviewOpen?: boolean;
  reviewRatio?: number;
};

export type Layout = {
  rail: number;
  history: number;
  c1: number;
  c2: number;
  c3: number;
  panel: number;
  tree: number;
  /** 检视面板宽度（并存不互斥 D10；比例制 D12） */
  review: number;
  /** 检视这一侧还能用的最大像素（左边列/历史/文件面板/聊天保底扣完）——拖动的上限口径，与 layout 同源 */
  reviewBudget: number;
  /** 检视放得下吗（false 时 review=0，调用方要负责任何降级提示） */
  reviewFits: boolean;
  chat: number;
  folded: Folded;
  panelFits: boolean;
  /** 窄窗口：左三列改为浮层抽屉（overlay），不再挤占聊天列（参照 Pi Web 的移动端抽屉）。 */
  overlayLeft: boolean;
};

export function layout(input: LayoutInput): Layout {
  const folded = input.requested;
  // 图标轨**常驻**（VS Code Activity Bar 范式）：收起/展开都占一条 44px，收起只是不显示列内容。
  const rail = RAIL;

  const c1 = folded.nav ? 0 : input.widths.c1;
  // 合并后只有一列"项目分组 → 会话"；c3 恒为 0（类型保留是为了不惊动历史调用）
  const c2 = folded.groups ? 0 : input.widths.c2;
  const c3 = 0;
  const colHandles = (folded.nav ? 0 : HANDLE) + (folded.groups ? 0 : HANDLE);
  const leftDocked = rail + c1 + c2 + c3 + colHandles;
  // 并列放不下（会把聊天压到 MIN_CHAT 以下）→ 左三列改浮层：聊天只让出图标轨的宽度。
  // 参照 Pi Web / 通用 AppShell：窄屏用 overlay 抽屉，而不是把内容压扁或替用户收列。
  const overlayLeft = leftDocked + MIN_CHAT > input.viewport;
  const leftCost = overlayLeft ? rail : leftDocked;

  // 完整历史优先占右侧（与文件面板互斥）：先给它，再由剩余空间决定面板/聊天
  const historyMax = Math.max(0, input.viewport - leftCost - HANDLE - MIN_CHAT);
  const history = input.historyOpen === true && historyMax >= MIN_HISTORY
    ? Math.max(MIN_HISTORY, Math.min(input.widths.c5, historyMax))
    : 0;
  const historyCost = history > 0 ? HANDLE + history : 0;

  // 面板上限：拿掉左边成本与历史列后，给聊天留足保底
  const panelMax = Math.max(0, input.viewport - leftCost - historyCost - HANDLE - MIN_CHAT);
  const panelFits = panelMax >= MIN_PANEL;
  const panelBase = history === 0 && input.panelOpen && panelFits ? Math.max(MIN_PANEL, Math.min(input.widths.c4, panelMax)) : 0;

  // 检视面板（D10 并存不互斥）：右侧预算先看文件面板占着的情况；不够 MIN_REVIEW 就**让文件面板让宽**
  // （只在本次布局里生效，不改 c4 存储值——检视一关，面板回到用户拖的宽度）。
  // 两步都放不下才归 0（reviewFits=false，调用方先收左列、再提示），绝不静默关掉用户的文件面板。
  const priorCost = leftCost + historyCost + (panelBase > 0 ? HANDLE + panelBase : 0);
  const budgetWithBase = Math.max(0, input.viewport - priorCost - HANDLE - MIN_CHAT);
  const wantReview = input.reviewOpen === true;
  const canYield = wantReview && panelBase > 0 && budgetWithBase < MIN_REVIEW;
  const yieldedPanel = canYield ? Math.max(MIN_PANEL, Math.min(panelBase, panelMax - MIN_REVIEW - HANDLE)) : panelBase;
  const panel = canYield && yieldedPanel < MIN_PANEL ? 0 : (canYield ? yieldedPanel : panelBase);
  const tree = panel === 0 ? 0 : Math.max(0, Math.min(input.widths.c4t, panel - MIN_VIEWER));
  const fixedCost = leftCost + historyCost + (panel > 0 ? HANDLE + panel : 0);
  const reviewBudget = Math.max(0, input.viewport - fixedCost - HANDLE - MIN_CHAT);
  const reviewFits = reviewBudget >= MIN_REVIEW;
  const review = wantReview && reviewFits
    ? Math.min(reviewBudget, reviewPxOfRatio(input.viewport, input.reviewRatio))
    : 0;
  const chat = input.viewport - leftCost - historyCost - (panel > 0 ? HANDLE + panel : 0) - (review > 0 ? HANDLE + review : 0);

  return { rail, history, c1, c2, c3, panel, tree, review, reviewBudget, reviewFits, chat, folded, panelFits, overlayLeft };
}

/**
 * 把手语义的唯一来源：把手在列的**右缘** → 右拉变大（+1）；把手在列的**左缘**（右侧停靠面板）→ 右拉变小（-1）。
 * 以前是"if (key === 'c4')"写死的，新加 c5 就漏了 —— 方向必须由把手位置决定，不能由 key 名字决定。
 */
export const HANDLE_SIGN: Record<keyof Widths, 1 | -1> = { c1: 1, c2: 1, c3: 1, c4: -1, c4t: 1, c5: -1 };

/** 拖拽夹紧（纯函数，供 useColumnWidth 调用）。 */
export function dragWidth(key: keyof Widths, startWidth: number, deltaX: number): number {
  return clampWidth(key, startWidth + HANDLE_SIGN[key] * deltaX);
}

export function clampWidth(key: keyof Widths, value: number): number {
  const [min, max] = WIDTH_LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}
