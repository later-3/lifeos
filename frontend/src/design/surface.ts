/**
 * 浮层外观配方（**唯一事实源**）。
 *
 * 为什么有这个文件（2026-11-09 审计）：同是"浮起来的卡片"，仓里有 **5 套写法**：
 *   display-prefs-panel  border + shadow-md   z-30
 *   ReviewPanel 预览     ring   + shadow-lg   z-50
 *   Modal                ring   + shadow-xl   z-50
 *   Toast                ring   + shadow-lg   z-50
 *   copy-toast           无     + shadow-anno z-50
 * 而 `tokens.css` / `theme.ts` 早就把 `--surface-popover` / `--surface-modal` 算好了
 * （深色下带 1px 白色微描边）—— **一个都没人用**。结果：
 *  · 深色下 `shadow-lg`（Tailwind 裸值）叠在 `#292828` 上几乎不可见 → 浮层糊成一片（实测截图见 evidence/ui-round5）；
 *  · `border` 占 1px 布局、`ring` 不占 → 两个浮层并排时边框粗细差 1px。
 *
 * 所以：**浮层的外观只能从这里取**。`test/design-system.test.mjs` 会扫源码，
 * 出现 `shadow-md|lg|xl|2xl` 或裸 `z-<数字>` 就红。
 *
 * 数值纪律：这里只做"角色 → token 名"的映射，**不写具体像素/颜色**；
 * 具体值来自 `tokens.css`（圆角、内距）与 `theme.ts`（阴影，随深浅色变）。
 */

/** 浮层的角色。新浮层先归类，再取配方 —— 不许自己另起一套。 */
export type SurfaceTone = "card" | "popover" | "modal" | "toast" | "tooltip";

/**
 * 层级语义（唯一来源）。
 *
 * 现状问题（审计）：z-index 是 10/20/30/40/50 随手写的，Toast 与 Modal 同为 50 ——
 * 模态打开时 Toast 会被压在下面（顺序错了）。这里按"谁该在上面"定死：
 * 轨上的浮标 < 弹出面板 < 抽屉 < 版本提示条 < 模态 < toast（toast 永远最上，否则用户看不到反馈；
 * 版本提示条在模态下面 —— 更新提示不抢模态里的操作，关掉模态就看见）。
 */
export const LAYER = {
  rail: 10,
  popover: 30,
  drawer: 40,
  versionBanner: 45,
  modal: 50,
  toast: 60,
} as const;

export type LayerName = keyof typeof LAYER;

/**
 * 浮层配方。
 *
 * - `radius`：引用 tokens.css 的圆角档（`var(--radius-*)`），不写 px；
 * - `edge`：**统一 `ring`**（不占布局）。理由：`border` 占 1px 会把浮层内容推开 2px，
 *   两个浮层并排时边框粗细也会不一致（实测 `border border-line` 与 `ring-1 ring-line` 视觉等价）；
 * - `shadow`：引用 theme.ts 写入的 `--surface-*`（深浅色各一套）；
 * - `padding`：4 网格档（`p-2` = 8 / `p-3` = 12 / `px-4 py-3` = 16/12）。
 */
export type SurfaceRecipe = {
  radius: string;
  edge: "ring";
  shadow: string;
  padding: string;
  layer: LayerName;
};

export const SURFACE: Record<SurfaceTone, SurfaceRecipe> = {
  /** 页面内的卡片（设置页的分组卡）：静止就要有一层极淡的边界，不要投影压迫感 */
  card: {
    radius: "rounded-panel",
    edge: "ring",
    shadow: "var(--surface-card)",
    padding: "p-4",
    layer: "popover",   // 卡片不浮起，层级只为完整性（实际不会叠）
  },
  /** 弹出面板：下拉、滑块面板、预览气泡 —— 有投影 + 1px 边界，贴视口平移 */
  popover: {
    radius: "rounded-panel",
    edge: "ring",
    shadow: "var(--surface-popover)",
    padding: "p-3",
    layer: "popover",
  },
  /** 模态：最大一档投影，必须盖住内容并压暗背景 */
  modal: {
    radius: "rounded-panel",
    edge: "ring",
    shadow: "var(--surface-modal)",
    padding: "px-5 py-4",
    layer: "modal",
  },
  /** Toast：比 popover 高一档投影（它不是"面板"，是"事件通知"） */
  toast: {
    radius: "rounded-panel",
    edge: "ring",
    shadow: "var(--surface-popover)",
    padding: "px-3 py-2",
    layer: "toast",
  },
  /** 工具提示：最小一档，无投影（它不承载交互） */
  tooltip: {
    radius: "rounded-control",
    edge: "ring",
    shadow: "var(--surface-card)",
    padding: "px-2 py-1",
    layer: "toast",
  },
};

/**
 * 组合成 className（供不需要组件的场景，如只想要外观的容器）。
 *
 * `edge` 一律用 `ring-1 ring-line`：环不占布局，且与 `SURFACE` 的语义一致。
 * 需要强调边界的浮层（模态）可以再叠 `ring-ink-900/10`（见 `Modal`）。
 */
export function surfaceClass(tone: SurfaceTone, extra = ""): string {
  const recipe = SURFACE[tone];
  return `bg-surface ${recipe.radius} ring-1 ring-line ${recipe.padding} ${extra}`.trim();
}

/** 内联样式里的阴影（Tailwind 无法表达"深浅色随主题变"的阴影，必须走 CSS 变量）。 */
export function surfaceStyle(tone: SurfaceTone): { boxShadow: string } {
  return { boxShadow: SURFACE[tone].shadow };
}

/** 层级的内联样式（用于必须精确指定 z-index 的地方）。 */
export function layerStyle(name: LayerName): { zIndex: number } {
  return { zIndex: LAYER[name] };
}

/**
 * Tailwind 用的层级类名（**唯一来源**）。
 *
 * 为什么不直接用 `z-30`：Tailwind 的 `z-<数字>` 是任意数字，写错了不报错、顺序错了也不报错
 * （现状：Toast 与 Modal 同为 z-50，模态打开时 Toast 被压在下面）。这里把它变成**有限集合** ——
 * 只能写 `LAYER_CLASS.popover`，`test/design-system.test.mjs` 会拦下裸 `z-<数字>`。
 *
 * 类名在 index.css 里映射到 `--z-*`（`--z-*` 的值来自 `LAYER` 的同一份定义，见 index.css 注释）。
 * 不用 `z-[30]` 这种任意值形式：lint:tokens 明令禁止任意值，而且那样仍然是"手写数字"。
 */
export const LAYER_CLASS = {
  rail: "layer-rail",
  popover: "layer-popover",
  drawer: "layer-drawer",
  versionBanner: "layer-version-banner",
  modal: "layer-modal",
  toast: "layer-toast",
} as const;

/**
 * 遮罩（scrim）：模态/抽屉背后那层压暗。
 *
 * 现状：`bg-ink-900/20` 在两处各写一遍（App 的浮动左列、ReviewPanel 的快捷键弹窗）。
 * 收到这里，避免"有的 20%、有的 30%"这种漂移。
 */
export const SCRIM_CLASS = "bg-ink-900/20";
