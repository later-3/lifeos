/**
 * 布局宽度的唯一计算入口（前端开发路径 · 闸 3 的不变量基座）。
 *
 * 为什么要有这个文件：之前宽度在 useColumnWidth 里算一遍（假设收起列占 20px）、
 * 组件里又各自渲染一遍（FoldRail 实际 36px），三列全收时面板上限多算 48px，
 * 聊天列被压到 252px < 自声明的 MIN_CHAT。数值一旦有两处来源就必然对不上。
 *
 * 约定：
 * - 本函数是纯函数，不读 DOM、不读 localStorage；测试对「视口 × 折叠组合 × 面板」穷举断言。
 * - 折叠成本常数化：任一列收起 → 一条 44px 导航轨；全部展开 → 0px。绝不 O(n)。
 * - 聊天保底 MIN_CHAT 由本函数钳制，面板永远拿不到"挤死聊天"的宽度。
 */

export const RAIL = 44;
export const HANDLE = 6;
export const MIN_CHAT = 420;
export const MIN_PANEL = 320;
export const MIN_VIEWER = 206;

export type Folded = { nav: boolean; projects: boolean; sessions: boolean };
export type Widths = { c1: number; c2: number; c3: number; c4: number; c4t: number };

export const DEFAULT_WIDTHS: Widths = { c1: 232, c2: 216, c3: 272, c4: 600, c4t: 240 };

export const WIDTH_LIMITS: Record<keyof Widths, [number, number]> = {
  c1: [180, 440],
  c2: [160, 400],
  c3: [200, 560],
  c4: [320, 1600],
  c4t: [160, 560],
};

/** 窄视口自动降级：只影响"实际渲染"，不改用户手动状态（放宽后自动恢复）。 */
export function effectiveFolded(requested: Folded, viewport: number): Folded {
  if (viewport < 1000) return { nav: requested.nav, projects: true, sessions: true };
  if (viewport < 1200) return { nav: requested.nav, projects: true, sessions: requested.sessions };
  return requested;
}

export type LayoutInput = {
  viewport: number;
  widths: Widths;
  requested: Folded;
  panelOpen: boolean;
};

export type Layout = {
  rail: number;
  c1: number;
  c2: number;
  c3: number;
  panel: number;
  tree: number;
  chat: number;
  folded: Folded;
  panelFits: boolean;
};

export function layout(input: LayoutInput): Layout {
  const folded = effectiveFolded(input.requested, input.viewport);
  const anyFolded = folded.nav || folded.projects || folded.sessions;
  const rail = anyFolded ? RAIL : 0;

  const c1 = folded.nav ? 0 : input.widths.c1;
  const c2 = folded.projects ? 0 : input.widths.c2;
  const c3 = folded.sessions ? 0 : input.widths.c3;
  const colHandles = (folded.nav ? 0 : HANDLE) + (folded.projects ? 0 : HANDLE) + (folded.sessions ? 0 : HANDLE);
  const leftCost = rail + c1 + c2 + c3 + colHandles;

  // 面板上限：拿掉左边成本后，给聊天留足保底
  const panelMax = Math.max(0, input.viewport - leftCost - HANDLE - MIN_CHAT);
  const panelFits = panelMax >= MIN_PANEL;
  const panel = input.panelOpen && panelFits ? Math.max(MIN_PANEL, Math.min(input.widths.c4, panelMax)) : 0;
  const tree = panel === 0 ? 0 : Math.max(0, Math.min(input.widths.c4t, panel - MIN_VIEWER));
  const chat = input.viewport - leftCost - (panel > 0 ? HANDLE + panel : 0);

  return { rail, c1, c2, c3, panel, tree, chat, folded, panelFits };
}

/** 拖拽夹紧（纯函数，供 useColumnWidth 调用）。c4 把手在面板左缘：右拉=变小，sign=-1。 */
export function clampWidth(key: keyof Widths, value: number): number {
  const [min, max] = WIDTH_LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}
