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
/**
 * 列间把手的**布局占宽**（Task 0006）：0。
 *
 * 旧值 6 把 6px 当成真宽度插在两列之间 —— 那 6px 是把手盒子，继承了父级 `bg-surface`（白），
 * 而两侧列是 `sunken`，于是屏幕上看到的是「白缝 + 细线」三条边，而不是一条分界
 * （实测像素 x276 #fff / x279 #e9e9ec / x280 #fff）。
 * 现在把手是**浮在列右缘上的覆盖层**（`DragHandle` 自己 absolute），不占布局宽度；
 * 分界由列自己的 1px 边或底色差表达。省下的 2×6px 全部给聊天列。
 */
export const HANDLE = 0;
/** 把手的视觉命中区厚度（不参与布局）：落在边界线正中，左右各半。 */
export const HANDLE_HIT = 8;
export const MIN_CHAT = 420;
/** 完整历史（回合检查器）并列列：最小/默认宽度。它和文件面板互斥。 */
export const MIN_HISTORY = 360;
export const DEFAULT_HISTORY = 440;
export const MIN_PANEL = 320;
/**
 * 查看「器」保底 = 面板 − 树的剩余空间下限（2026-11-10 调整 206 → 160）。
 *
 * 依据（协议 §3.13：不是拍出来的数）：
 * - **受压实测**：查看器的页签行/工具栏都是 `overflow-x-auto`，正文自动换行——
 *   实测把查看器压到 160/140/120，出的是滚动条而不是内容溢出（FilePanel 的极限内容宽 ~69 + 可滚正文）；
 * - **对称**：树的自身下限就是 160（`WIDTH_LIMITS.c4t[0]`），两栏同一档；
 * - **收益**：树的可拖行程 = `面板 − MIN_VIEWER − 树宽`，206→160 在 1600 上从 354 行程升到 400。
 */
export const MIN_VIEWER = 160;
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
 * `c2` = 分组面板（项目分组 → 会话行），默认 300，下限 240。
 *
 * **上限不再写常量（Task 0006）**：旧值 440 没有任何依据（`groups-panel.md` 引的是实现自身），
 * 而几何上限（视口能撑到多宽）在 1280 上已到 572 —— 用户拖到 440 就无声卡住，
 * 明明还有空间。现在上限由 `maxWidthOf()` 从视口算：能拖到「再宽就压破聊天保底」为止。
 * 依据：协议 §3.13（加限制必须有参考实现或实测）；LobeHub `NAV_PANEL_MAX_WIDTH = 400`
 * 有名字但同样缺推导，故不抄它的数（`evidence/lobehub src/store/global/selectors/systemStatus.ts:73`）。
 * `c3` 保留在类型里只为兼容既有调用（合并后不再渲染列，值恒为 0）。
 */
export const DEFAULT_WIDTHS: Widths = { c1: 232, c2: 300, c3: 0, c4: 600, c4t: 240, c5: DEFAULT_HISTORY };

/**
 * 防坏值的**技术兜底**（不是产品约束）：localStorage 是用户可写的，一个 1e9 的宽度
 * 会把布局算成负数。真实可拖上限只看视口（`maxWidthOf`），不看这个数。
 */
const SANITY = 4096;

export const WIDTH_LIMITS: Record<keyof Widths, [number, number]> = {
  /**
   * **c1 与 c2 必须用同一套上限规则**（2026-11-09 用户报"拖助手列和拖会话列手感不一样"）。
   *
   * 旧值 `c1: [180, 440]` 是自创常量（与 c2 被否掉的那个 440 是同一个数，协议 §3.13 禁止）。
   * 后果是两列手感不同：
   *   - c1 鼠标移 215px 就撞 440 停住，剩下 185px 鼠标空走（看起来"拖不动了"）；
   *   - c2 一路跟到 550（几何上限），0 步空走。
   * 实测：同样移动 250px，c1 有 8/50 步列宽不变，c2 是 0/50。
   * 现在 c1 与 c2 一样：常量只做技术兜底，真实上限由 `maxWidthOf()` 从视口算。
   */
  c1: [180, SANITY],
  // c2 同理（Task 0006）：旧值 440 是无依据的自创约束，1280 宽上明明能到 576 却停在 440。
  c2: [240, SANITY],
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

/** 拖拽夹紧（纯函数，供 useColumnWidth 调用）。`limit` 为调用方从视口算出的上限（默认走常量表）。 */
export function dragWidth(key: keyof Widths, startWidth: number, deltaX: number, limit?: number): number {
  return clampWidth(key, startWidth + HANDLE_SIGN[key] * deltaX, limit);
}

export function clampWidth(key: keyof Widths, value: number, limit?: number): number {
  const [min, max] = WIDTH_LIMITS[key];
  const ceiling = limit === undefined ? max : Math.min(max, limit);
  return Math.min(ceiling, Math.max(min, Math.round(value)));
}

/**
 * 嵌套关系：内层可拖区域属于哪个外层列（**唯一来源**）。
 *
 * 为什么需要它（2026-11-09 用户第二次报「文件树区域的拖动很垃圾」）：
 * 文件树（`c4t`）长在文件面板（`c4`）里面。旧实现给 `c4t` 的上限是「面板 − 查看器最小宽」，
 * 而面板本身又被视口钳住 —— 1440 窗口上面板只有 444，于是 `c4t` 的可动范围只剩
 * **160–238**（默认就是 240，等于**根本拖不动**）；1280 上更彻底：面板放不下 → 一个把手都没有。
 *
 * 嵌套列的拖动语义见 `dragCascade()`：**拖哪条边，哪条边跟手**。
 * （2026-11-10 删除了当初配套的「顶到上限后从左列借宽」：
 *  ① 它让树把手全程不动，面板在用户拖动的反方向扩张（用户原话「我往右拖呢，它在往左边扩张」）；
 *  ② 从 c2/c1 借走的宽度不归还，拖完左列悄悄变窄；
 *  ③「拖树」与「拖面板」两套语义串场。
 *  想让面板整体更宽，拖**外层** `c4` 的把手 —— 那才是动面板宽度的正确入口。）
 *
 * 以后新增嵌套可拖区域（比如"面板里的预览区也可以拖"）只需在这里登记一行。
 */
export const RESIZE_PARENT: Partial<Record<keyof Widths, keyof Widths>> = {
  c4t: "c4",   // 文件树 ⊂ 文件面板
};

/**
 * 某一列在给定视口下的**真实可视上限**（Task 0006）：把手拖到哪儿就该在哪儿停。
 *
 * 为什么需要它：旧实现只有常量表（c2≤440），而实际能放多少由视口算：
 * `视口 − RAIL − 其他列 − 每道把手 − MIN_CHAT`。两套规则打架时，
 * 1280 宽上用户拖到 440 就卡住（真实可到 572），1024 宽上一拖过 316 就整块左区变浮层。
 *
 * 该函数是 `layout()` 的逆运算：拿掉目标列自身的宽度，算剩下的空间最多能给它多少
 * —— 且不突破 `overlayLeft` 阈值（否则用户拖宽反而丢列）。
 */
export function maxWidthOf(key: keyof Widths, viewport: number, widths: Widths, folded: Folded): number {
  const rail = RAIL;
  // 左侧两列：只有展开的列占宽
  const c1 = folded.nav ? 0 : widths.c1;
  const c2 = folded.groups ? 0 : widths.c2;
  const other = key === "c1" ? 0 : c1;
  const otherRight = key === "c2" ? 0 : c2;
  /*
   * **上限公式必须与 `layout()` 的预算公式逐项一致**（2026-11-09 又抓到一次漂移）。
   *
   * `layout()` 算的是 `视口 − 左侧成本 − MIN_CHAT`，而这里原来多减了 `HANDLE_HIT(8)` ——
   * 于是 1440 窗口上面板实际能渲染到 444，拖动却只允许到 436：**拖到 436 就停，空间还剩 8px**。
   * `HANDLE` 是**布局占宽**（Task 0006 起是 0，把手改成浮层），`HANDLE_HIT` 只是鼠标命中区厚度，
   * 两者都不该出现在宽度预算里。这是同一类缺陷的第二次（第一次是 c1 的 440 常量）。
   */
  if (key === "c1" || key === "c2") {
    // 左列上限：视口 − 图标轨 − 另一列 − 聊天保底
    return Math.max(WIDTH_LIMITS[key][0], viewport - rail - other - otherRight - MIN_CHAT);
  }
  if (key === "c4" || key === "c5") {
    // 右侧列上限：视口 − 左侧全部 − 聊天保底
    return Math.max(WIDTH_LIMITS[key][0], viewport - rail - c1 - c2 - MIN_CHAT);
  }
  if (key === "c4t") {
    /*
     * 文件树**不能超出它所在的面板**：`layout()` 里 `tree = min(widths.c4t, panel − MIN_VIEWER)`，
     * 所以 node 上限不是视口，而是「面板宽 − 查看器最小宽」。
     *
     * 2026-11-09 实测踩到：拖 c4t 到 300，松手后回弹到 270 —— 存进去的值超出面板能给的，
     * `layout()` 再钳回来。用户看到的是"拖到这儿、松手却弹回去"。
     * 这一条与 MaxWidthOf 的其它分支同一思路：**拖动上限 = 该列的真实可视上限**，
     * 不是视口一档、也不是常量一档。
     */
    /*
     * **必须与 `layout()` 用同一个算法**（2026-11-09 用户第二次报「文件树拖动很垃圾」）：
     * 旧实现在这里自己又算了一遍 panelLimit，与 layout 的公式差一档 ——
     * 1440 窗口上：树默认 240，而这里算出上限 230 → **一按下去就被夹到 230 然后纹丝不动**
     * （实测拖 400px，宽度取值只有 1 个）。用户看到的就是"拖不动"。
     * 现在直接问 `layout()` 要它的 panel，两处公式不可能再漂移。
     */
    const panel = layout({ viewport, widths, requested: folded, panelOpen: true }).panel;
    return Math.max(WIDTH_LIMITS.c4t[0], panel - MIN_VIEWER);
  }
  return WIDTH_LIMITS[key][1];
}

/**
 * 拖动一个（可能嵌套的）列时，**一次算出所有要变的宽度**（纯函数，可穷举单测）。
 *
 * 语义（每条都对应一个用户可见的行为；2026-11-10 按用户裁决修正第 2 条）：
 *  1. 内层拖动 = 移动"内层与查看器之间"的分界：内层变大，查看器变小（外层总宽不变）；
 *  2. 内层顶到边界就停（拖哪条边哪条边跟手；面板总宽是**外层** c4 把手的事，
 *     不串场——旧版曾在这里从左列借宽，把手不动、面板反向扩张，见 `dragCascade` 注释）；
 *  3. 往回拖时，先缩内层，外层保持（不回弹、不跳）；
 *  4. 没有外层关系的列（c1/c2/c5）就是普通的单列拖动。
 *
 * 返回的是**补丁**（只含变化的键），调用方把它合进 widths 即可 —— 这样"哪些列会动"
 * 这件事只在这个函数里决定，`useColumnWidth` 不再写第二套判断。
 *
 * `viewport`/`folded` 只用于算外层上限；`deltaX` 是鼠标位移（已经含方向，
 * 方向由 `HANDLE_SIGN` 决定，见 `dragWidth`）。
 */
export function dragCascade(
  key: keyof Widths,
  start: Widths,
  deltaX: number,
  viewport: number,
  folded: Folded,
): Partial<Widths> {
  /*
   * **拖动的唯一语义：拖哪条边，哪条边跟手**（2026-11-10 重写）。
   *
   * 旧嵌套实现把「树变宽」实现成「整块面板变宽」：树长多少、面板往左长多少，
   * 两者在屏幕上正好抵消——用户抓着的分隔条**从头到尾一动不动**，
   * 看到的是另一条边在反向移动（实测 1600 拖 +100：把手 x 恒 1237，
   * 面板左缘 x 反而 1000→900——用户原话「我往右拖呢，它在往左边扩张」）。
   * 顶到上限后还从左列借宽，借走不还。
   *
   * 现在：树变宽 = 查看器变窄（面板总宽、左缘、左列一概不动），跟手到
   * 「面板 − MIN_VIEWER」为止；想让面板整体更宽，拖**外层**（c4）的把手。
   */
  if (RESIZE_PARENT[key] === undefined) {
    return { [key]: dragWidth(key, start[key], deltaX, maxWidthOf(key, viewport, start, folded)) } as Partial<Widths>;
  }
  // 嵌套列：以**渲染宽**为基准（存储值可能被 layout 钳小过，拿它当基准会"拖了先不动"）。
  // 每帧都从「基准 + 累计位移」重算 → 同一鼠标位置永远同一结果（幂等，无累计漂移）。
  const box = layout({ viewport, widths: start, requested: folded, panelOpen: true });
  if (key === "c4t") {
    return { c4t: dragWidth("c4t", box.tree, deltaX, maxWidthOf("c4t", viewport, start, folded)) };
  }
  return { [key]: dragWidth(key, start[key], deltaX, maxWidthOf(key, viewport, start, folded)) } as Partial<Widths>;
}
