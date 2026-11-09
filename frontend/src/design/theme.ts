/**
 * 主题引擎（Task 0009 · P1-1）。
 *
 * 从 demo（`evidence/demo/index.html` 的 palette()）移植：主题 = 一份状态 → 纯函数算出全部
 * `--color-*` 值（OKLCH→sRGB），写到 :root。5 预设 × 深浅，深色由公式派生（darkL），不手挑第二套值。
 *
 * 纪律（协议 §3.13 / 前端规范 2.8）：
 * - 色值只在 tokens.css（静态默认）与本文件（运行时计算）两处，且本文件不发明新值——
 *   全部从「四档底色 L* + 主色 H/C + 悬停/选中比」推导；
 * - 纯函数：calculatePalette 不读 DOM、不碰 localStorage；测试可穷举（test/theme.test.mjs）；
 * - 组件不感知主题：仍只用 `bg-nav-*` / `text-ink-*` 等 utility（Tailwind v4 的 @theme
 *   utility 编译为 var(--color-*) 引用，运行时改 :root 变量即全站生效）。
 */

/* ── OKLCH → sRGB（Björn Ottosson 公式；与 Pi TUI oklab.ts 同源不同层）── */
function oklchToRgb(lstar: number, c: number, hDeg: number): [number, number, number] {
  // 约定：入参 lstar 是 CIE L*（0–100，与设计文档/滑杆同口径）。
  // OKLab 的 L 是另一刻度：无彩色时 OKLab L = (L* + 16) / 116。2026-11-07 demo 实测修正。
  const L = (lstar + 16) / 116;
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const f = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  return [f(r), f(g), f(bl)].map((v) => Math.max(0, Math.min(255, Math.round(v * 255)))) as [number, number, number];
}

function hex(lstar: number, c: number, hDeg: number): string {
  return "#" + oklchToRgb(lstar, c, hDeg).map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** 相对亮度（WCAG）。入参与 hex 同口径。 */
function relLum(lstar: number, c: number, hDeg: number): number {
  const [r, g, b] = oklchToRgb(lstar, c, hDeg).map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 对比度（WCAG）。供设置界面实时读数与测试断言。 */
export function contrastOf(a: [number, number, number], b: [number, number, number]): number {
  const A = relLum(...a), B = relLum(...b);
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
}

/**
 * 深色底色映射（2026-11-09 重写）。
 *
 * **旧实现是错的**：`13 + (100 - lstar) * 1.6` 把 light 里最亮的"内容"(100) 映射成最暗(13)、
 * 把最暗的"图标轨"(93) 映射成最亮(24) —— 方向整个反了。后果：深色模式下内容区(卡片)比列/轨都暗，
 * 卡片与页面同色，整页发平（用户截图可见）。
 *
 * **三家的正确方向（一致）**：
 * - LobeHub dark：`colorBgLayout` `#000000`(L\*0) → `colorBgContainer` `#0d0d0d`(L\*3.4) → `colorBgElevated` `#1a1a1a`；
 *   即「页面最暗、卡片在上、浮层最亮」（`generateColorPalette.ts:42-62`）
 * - LibreChat dark：`background.default` `#1f1f1c`(L\*11.7) / `background.muted` `#282828`(L\*16.2) /
 *   `stroke.default` `#323232`；同样是"底暗、卡片亮、描边再亮"（`clickui.json`）
 * - novu：无完整暗色（不作参考）
 *
 * **结论：深色必须保持 light 里的顺序**（轨 < 列 < 内容），只是把绝对值压缩到 10–17 区间。
 * 映射：`10 + (lstar − 88) × 0.6` → 88→10.0 / 93→13.0 / 96.9→15.3 / 100→17.2（跨度 7.2）。
 */
function darkL(lstar: number): number {
  // 88→5.0 / 93→9.75 / 96.9→13.4 / 100→16.4（三段跨度 11.4，与 LibreChat 11.7→16.2 同量级）
  return Math.max(4, Math.min(30, 5 + (lstar - 88) * 0.95));
}

/* ── 主题状态 ── */

export type ThemePreset = "neutral" | "cool" | "warm" | "sakura" | "ink";
export type ThemeMode = "light" | "dark";

export type ThemeState = {
  preset: ThemePreset;
  mode: ThemeMode;
  /** 主色 OKHSL：hue 0–360；chroma 0–100（0 = 近黑/近白，LobeHub 默认式） */
  accentH: number;
  accentC: number;
  /** 中性色相是否跟随主色（koharu 同构；关掉即"两套中性色打架"） */
  lockNeutral: boolean;
  /** 中性饱和 0–100 → 实际 chroma = x/100 × 0.035 */
  neutralC: number;
  /** 四档底色 L*：内容 / 列 / 图标轨 / 边界线 */
  lSurface: number;
  lNav: number;
  lRail: number;
  lLine: number;
  /** 悬停 ΔL*（列底 → 悬停）与 选中/悬停 强度比（demo：2.8 / 1.75） */
  hoverD: number;
  selRatio: number;
};

export const THEME_DEFAULTS: ThemeState = {
  preset: "neutral",
  mode: "light",
  accentH: 34,
  accentC: 0,
  lockNeutral: true,
  neutralC: 4,
  lSurface: 100,
  lNav: 96.9,
  lRail: 93,
  lLine: 89.4,
  hoverD: 4.2,
  selRatio: 2.0,
};

/** 预设 = 覆盖默认的一段增量（demo PRESETS 同源）。 */
export const THEME_PRESETS: Record<ThemePreset, Partial<ThemeState>> = {
  neutral: { accentH: 34, accentC: 0, lockNeutral: true, neutralC: 4 },
  cool: { accentH: 221, accentC: 62, lockNeutral: true, neutralC: 10 },
  warm: { accentH: 34, accentC: 62, lockNeutral: true, neutralC: 12 },
  sakura: { accentH: 351, accentC: 55, lockNeutral: true, neutralC: 14 },
  ink: { accentH: 158, accentC: 40, lockNeutral: true, neutralC: 8 },
};

export const PRESET_LABELS: Record<ThemePreset, string> = {
  neutral: "纯中性",
  cool: "冷蓝",
  warm: "暖砂",
  sakura: "樱花",
  ink: "墨绿",
};

/* ── 调色板计算（纯函数）── */

export type PaletteColor = [number, number, number]; // [L*, C, H]
export type Palette = {
  surface: PaletteColor;
  sunken: PaletteColor;
  hover: PaletteColor;
  line: PaletteColor;
  navBg: PaletteColor;
  navEdge: PaletteColor;
  navAccent: PaletteColor;
  navSelected: PaletteColor;
  navLine: PaletteColor;
  navMuted: PaletteColor;
  accent: PaletteColor;
  /** 白字底色（主按钮/用户气泡）：深色模式下比 accent 深一档，保证白字 ≥ AA */
  accentSolid: PaletteColor;
  accentSoft: PaletteColor;
  ink900: PaletteColor;
  ink700: PaletteColor;
  ink500: PaletteColor;
  ink300: PaletteColor;
  success: PaletteColor;
  danger: PaletteColor;
  running: PaletteColor;
};

export function clampState(raw: Partial<ThemeState>): ThemeState {
  const s = { ...THEME_DEFAULTS, ...raw };
  const num = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  const presets = Object.keys(THEME_PRESETS) as ThemePreset[];
  return {
    preset: presets.includes(s.preset) ? s.preset : "neutral",
    mode: s.mode === "dark" ? "dark" : "light",
    accentH: num(s.accentH, 0, 360, THEME_DEFAULTS.accentH),
    accentC: num(s.accentC, 0, 100, THEME_DEFAULTS.accentC),
    lockNeutral: s.lockNeutral !== false,
    neutralC: num(s.neutralC, 0, 100, THEME_DEFAULTS.neutralC),
    lSurface: num(s.lSurface, 88, 100, THEME_DEFAULTS.lSurface),
    lNav: num(s.lNav, 88, 100, THEME_DEFAULTS.lNav),
    lRail: num(s.lRail, 84, 100, THEME_DEFAULTS.lRail),
    lLine: num(s.lLine, 72, 100, THEME_DEFAULTS.lLine),
    hoverD: num(s.hoverD, 0.5, 6, THEME_DEFAULTS.hoverD),
    selRatio: num(s.selRatio, 1, 3, THEME_DEFAULTS.selRatio),
  };
}

/**
 * 白字压在该色上的最大 L*（二分）：返回值满足 contrast(白, 色) ≥ 4.5。
 * 单调性：L* 越小越暗，白字对比越高。
 */
function maxLforWhiteText(range: [number, number], hue: number, c: number): number {
  const [lo, hi] = range;
  const ok = (l: number) => contrastOf([100, 0, 0], [l, c, hue]) >= 4.5;
  let lo2 = lo, hi2 = hi;
  if (ok(hi2)) return hi2;
  while (hi2 - lo2 > 0.5) {
    const mid = (lo2 + hi2) / 2;
    if (ok(mid)) lo2 = mid; else hi2 = mid;
  }
  return lo2;
}

/** 该色作为文字压在深色 surface（L*≈13）上的最小 L*（二分）：contrast ≥ 4.5。 */
function leastLforTextOnDark(range: [number, number], minL: number, hue: number, c: number): number {
  const [lo, hi] = range;
  const ok = (l: number) => contrastOf([l, c, hue], [13, 0.006, hue]) >= 4.5;
  let lo2 = Math.max(lo, minL), hi2 = hi;
  if (ok(lo2)) return lo2;
  while (hi2 - lo2 > 0.5) {
    const mid = (lo2 + hi2) / 2;
    if (ok(mid)) hi2 = mid; else lo2 = mid;
  }
  return hi2;
}

/** 该色作为文字压在白 surface（L*≈100）上的最大 L*（二分）：contrast ≥ 4.5。 */
function maxLforTextOnWhite(range: [number, number], hue: number, c: number): number {
  const [lo, hi] = range;
  const ok = (l: number) => contrastOf([l, c, hue], [100, 0, 0]) >= 4.5;
  let lo2 = lo, hi2 = hi;
  if (ok(hi2)) return hi2;
  while (hi2 - lo2 > 0.5) {
    const mid = (lo2 + hi2) / 2;
    if (ok(mid)) lo2 = mid; else hi2 = mid;
  }
  return lo2;
}

export function calculatePalette(state: ThemeState): Palette {
  const dark = state.mode === "dark";
  const hue = state.accentH;
  const nH = state.lockNeutral ? hue : 260; // 不锁时用蓝紫 260（与旧默认同族）
  const nC = (state.neutralC / 100) * 0.035;

  const surfaceL = dark ? darkL(state.lSurface) : state.lSurface;
  const navL = dark ? darkL(state.lNav) : state.lNav;
  const railL = dark ? darkL(state.lRail) : state.lRail;
  // 深色下"边界线"必须比它所在的底**更亮**才是可见的发丝线；light 下比底更暗。
  // 取 surfaceL + 6（低于 38，避免亮到抢戏）。旧实现用 darkL+4 → 比 surface 暗，深色下线看不见。
  const lineL = dark ? Math.min(38, surfaceL + 6) : state.lLine;
  /**
   * 状态强度（2026-11-09 用户反馈"高亮不明显、深色等于没有"后按 VS Code 2026 校准）。
   *
   * 依据（**产品类参考，不是 VS Code**——用户 2026-11-09 明确"VS Code 最多参考布局，不参考 UI"）：
   * - LibreChat Click UI 主题：侧栏 `#ffffff`、选中 `#e6e7e9` → **ΔL* 8.4**；
   *   深色 `#1f1f1c`、选中 `#333332` → **ΔL* 9.5**（`#414141` 是 surface-active，不是侧栏选中）
   *   （`packages/client/src/theme/themes/clickui.json` 的 sidebar navigation item 段）
   * - LobeHub：选中 fill .06 → 5.2 / 悬停 .03 → 2.8（更克制）
   * - novu：选中 alpha .1 → 3.3 / 悬停 alpha .05 → 1.4（最轻）
   * 三家区间 3.3–8.4；我们取 **LibreChat 的正文档 8.4**（选中≈hover×2）。
   * 深色取 16.1：两家深色实测只有 9.5（LibreChat #333332）与 11.1（LobeHub），
   * 我们按用户 2026-11-09 的反馈（深色几乎看不见）取更高一档。详见
   * `knowledge/design/theme-systems/comparison.md` §3.2。
   */
  const darkBoost = dark ? 1.9 : 1;  // 深色提升一档（用户反馈：深色高亮必须明显）
  const hoverL = dark ? navL + state.hoverD * darkBoost : navL - state.hoverD;
  const selL = dark ? navL + state.hoverD * state.selRatio * darkBoost : navL - state.hoverD * state.selRatio;

  const accentC = (state.accentC / 100) * 0.22;
  // accent 的两个职责分开求值（demo v7 实测：单值时深色模式白字对比只有 1.96–2.15）：
  // - accent 作**文字/图标**（链接、选中图标）：要与 surface 达 AA；
  // - accent 作**白字底色**（主按钮、用户气泡）：要与白字达 AA（= accentSolid）。
  // 两者在浅色模式同向（都要求更暗），取更暗者；深色模式反向，各求各的。
  const accentL = dark
    ? leastLforTextOnDark([0, 96], 68, state.accentH, accentC) + 1
    : Math.min(
        maxLforWhiteText([0, 60], state.accentH, accentC),
        maxLforTextOnWhite([0, 60], state.accentH, accentC),
      ) - 1;
  const accentSolidL = dark ? maxLforWhiteText([0, 60], state.accentH, accentC) : accentL;

  const ink = dark
    ? { 900: 96, 700: 82, 500: 68, 300: 52 }
    : { 900: 18, 700: 30, 500: 48, 300: 70 };

  return {
    surface: [surfaceL, nC * 0.5, nH],
    // 页面底（sunken）：light 比内容暗 1.7（既有观感）；dark 比"列"再暗 1.0，
    // 保证 rail < nav 列 < sunken 页面 < surface 卡片 这个顺序不被压平（深底上小差距看不出来）。
    sunken: [dark ? navL - 1.0 : surfaceL - 1.7, nC * 0.5, nH],
    hover: [dark ? navL + state.hoverD + 1.2 : navL - state.hoverD - 0.3, nC, nH],
    line: [lineL, nC * 1.3, nH],
    navBg: [navL, nC, nH],
    navEdge: [railL, nC * 1.15, nH],
    navAccent: [hoverL, nC * 1.2, nH],
    navSelected: [selL, nC * 2.6, nH],
    navLine: [lineL, nC * 1.3, nH],
    // 辅助文字随"选中底强度"联动：选中 ≈8.4 时 light 40 在选中底上 ≈4.9、dark 78 ≈4.6（AA 达标，
    // 且不像 36/80 那样过黑/过亮）。依据 `knowledge/design/theme-systems/comparison.md` §3.2。
    navMuted: dark ? [80, 0.008, nH] : [40, 0.012, nH],
    accent: [accentL, accentC, hue],
    accentSolid: [accentSolidL, accentC, hue],
    accentSoft: dark
      ? [Math.min(30, accentL - 44), accentC * 0.35, hue]
      : [96.5, accentC * 0.16, hue],
    ink900: [ink[900], 0.01, nH],
    ink700: [ink[700], 0.008, nH],
    // ink-500 压在最深的交互底（hover/line）上也要 ≥4.5：L*48→42（hover 4.96 / line 4.57 / surface 6.01）。
    // 依据：/tmp 实测 + `knowledge/design/theme-systems/comparison.md` §3.2（底加深必须联动文字）
    ink500: [42, 0.006, nH],
    ink300: [ink[300], 0.004, nH],
    success: dark ? [72, 0.16, 158] : [45, 0.13, 158],
    danger: dark ? [70, 0.17, 25] : [46, 0.17, 25],
    running: dark ? [72, 0.15, 232] : [40, 0.17, 244],
  };
}

/* ── 应用到 :root（副作用层，唯一入口）── */

const VAR_MAP: Array<[string, keyof Palette]> = [
  ["--color-surface", "surface"],
  ["--color-sunken", "sunken"],
  ["--color-hover", "hover"],
  ["--color-line", "line"],
  ["--color-nav-bg", "navBg"],
  ["--color-nav-edge", "navEdge"],
  ["--color-nav-accent", "navAccent"],
  ["--color-nav-selected", "navSelected"],
  ["--color-nav-line", "navLine"],
  ["--color-nav-muted", "navMuted"],
  ["--color-accent", "accent"],
  ["--color-accent-solid", "accentSolid"],
  ["--color-accent-soft", "accentSoft"],
  ["--color-ink-900", "ink900"],
  ["--color-ink-700", "ink700"],
  ["--color-ink-500", "ink500"],
  ["--color-ink-300", "ink300"],
  ["--color-success", "success"],
  ["--color-danger", "danger"],
  ["--color-running", "running"],
];

/** 把主题写到 :root。幂等；任何值变化即全站生效（Tailwind utility 引用 var）。 */
export function applyTheme(state: ThemeState): void {
  if (typeof document === "undefined") return; // SSR/测试环境安全
  const palette = calculatePalette(state);
  const root = document.documentElement.style;
  for (const [name, key] of VAR_MAP) {
    const [l, c, h] = palette[key];
    root.setProperty(name, hex(l, c, h));
  }
  // color-scheme：滚动条/表单原生控件跟随
  document.documentElement.style.colorScheme = state.mode;
  document.documentElement.dataset.themeMode = state.mode;
}

/* ── 持久化 ── */

const STORAGE_KEY = "lifeos.theme";

export function loadTheme(): ThemeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return THEME_DEFAULTS;
    return clampState(JSON.parse(raw) as Partial<ThemeState>);
  } catch {
    return THEME_DEFAULTS;
  }
}

export function saveTheme(state: ThemeState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 隐私模式写不了，忽略（display-prefs 同规） */ }
}

export function themeToCss(state: ThemeState): string {
  const palette = calculatePalette(state);
  const lines: string[] = [];
  for (const [name, key] of VAR_MAP) {
    const color = palette[key];
    lines.push(`  ${name}: ${hex(color[0], color[1], color[2])};`);
  }
  return `@theme {\n${lines.join("\n")}\n}`;
}


/* ══════════════════════════════════════════════════════════════════════
 * L3 质感层：圆角 / 阴影 / 动效 / 字距（2026-11-09 三家择优）
 *
 * 三家各自的手法（详见 knowledge/design/theme-systems/comparison.md）：
 * - **LobeHub**：阴影是**多层叠加**（5 层、每层不同 spread 与 alpha），
 *   `theme/token/shadow.ts` 的 light `boxShadow` = 40/80px…2/4px 五层，总 alpha 仅 0.20；
 *   圆角 4/6/8/12（XS/SM/·/LG）。
 * - **LibreChat**：`click.dialog.radii 0.5rem`、`click.field.space.y 0.2813rem`（4.5px，非整格）、
 *   主色底按钮**文字色 = 容器色反色**（light `#302e32` 底 + 白字；dark `#faff69` 底 + `#1f1f1c` 字）。
 * - **novu**：`box-xs` = `0 0 0 1px rgba(25,28,33,.04), 0 1px 2px rgba(25,28,33,.06)`
 *   （描边影 + 柔影两层，就是"悬浮卡"最小代价）；标题负字距 −0.035em；指示类位移统一曲线。
 *
 * 我们取三家的**交集优点**：
 * - 阴影用 LobeHub 的"多层 + 低总 alpha"（柔和而立体），但层数收敛到 3 层（够用且可读）；
 * - 卡片用 novu 的"描边影 + 柔影"（比纯投影更清晰，深色下也成立）；
 * - 圆角用 LobeHub 的 4 档 + 我们的 bubble 档（气泡需要更大）；
 * - 字距：标题负字距（novu），正文 0（可读性）；
 * - 动效：指示类位移统一曲线（novu），其余保持我们的克制。
 */

export type SurfaceScale = {
  /** 内嵌元素（标签、行内 code） */
  inner: string;
  /** 控件（按钮、输入框） */
  control: string;
  /** 面板 / 卡片 */
  panel: string;
  /** 大面板 / 弹层 */
  overlay: string;
  /** 气泡 */
  bubble: string;
  /** 胶囊 */
  full: string;
};

export const RADIUS: SurfaceScale = {
  // LobeHub `token/base.ts:4-7`：XS 4 / SM 6 / 8 / LG 12；bubble 14 是我们已有（气泡需要）
  inner: "4px",
  control: "6px",
  panel: "10px",
  overlay: "12px",
  bubble: "14px",
  full: "999px",
};

export type Elevation = {
  /** 卡片静息：描边影 + 柔影（novu `box-xs` 手法） */
  card: string;
  /** 卡片 hover：更明显一档 */
  cardHover: string;
  /** 浮层（菜单/下拉/浮卡）：LobeHub 多层低 alpha 收敛到 3 层 */
  popover: string;
  /** 模态 / 抽屉：最深一档 */
  modal: string;
};

/** 阴影随主题深浅切换（深色下阴影不可见 → 改用白色微描边，见 light/dark） */
export function elevationOf(mode: ThemeMode): Elevation {
  if (mode === "dark") {
    // 深色：投影几乎不可见（LobeHub `shadow.ts` dark 也把 alpha 提到 0.09 但视觉上仍是"黑上黑"）
    // → 用"1px 白色微描边 + 极低 alpha 扩散"替代，这是 LibreChat / shadcn 的深色惯用做法
    return {
      card: "0 0 0 1px rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.4)",
      cardHover: "0 0 0 1px rgba(255,255,255,0.10), 0 4px 12px rgba(0,0,0,0.5)",
      popover: "0 0 0 1px rgba(255,255,255,0.08), 0 8px 24px -6px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.4)",
      modal: "0 0 0 1px rgba(255,255,255,0.10), 0 16px 48px -12px rgba(0,0,0,0.7), 0 4px 12px rgba(0,0,0,0.5)",
    };
  }
  return {
    // light：novu `box-xs`（描边影 1px 4% + 柔影 1px2px 6%）→ 卡片静息
    card: "0 0 0 1px rgba(25,28,33,0.04), 0 1px 2px rgba(25,28,33,0.06)",
    cardHover: "0 0 0 1px rgba(25,28,33,0.06), 0 4px 10px -2px rgba(25,28,33,0.10)",
    // 浮层：LobeHub `boxShadowSecondary` 的 5 层收敛为 3 层（总 alpha ≈0.10）
    popover: "0 0 0 1px rgba(25,28,33,0.05), 0 10px 22px -6px rgba(25,28,33,0.10), 0 2px 6px rgba(25,28,33,0.06)",
    modal: "0 0 0 1px rgba(25,28,33,0.06), 0 24px 48px -12px rgba(25,28,33,0.16), 0 6px 14px rgba(25,28,33,0.08)",
  };
}

export type Motion = {
  /** 指示类位移（tab 指示条、segmented 浮块）：novu 统一曲线 */
  indicator: string;
  /** 一般状态过渡（hover / 选中） */
  state: string;
  /** 浮层进出 */
  overlay: string;
  /** 时长 */
  fast: string;
  mid: string;
  slow: string;
};

export const MOTION: Motion = {
  // novu `primitives/tabs.tsx:66` 与 `segmented-control.tsx:52` 共用：cubic-bezier(0.65,0,0.35,1) + 300ms
  indicator: "300ms cubic-bezier(0.65, 0, 0.35, 1)",
  // LobeHub `static.ts:56` motionEaseInOut 的同型曲线（0.645,0.045,0.355,1），用于状态色/底
  state: "150ms cubic-bezier(0.645, 0.045, 0.355, 1)",
  // LobeHub motionDurationSlow 0.3s + easeOut
  overlay: "200ms cubic-bezier(0.215, 0.61, 0.355, 1)",
  fast: "100ms",
  mid: "150ms",
  slow: "200ms",
};

/** 字距：标题负字距（novu −0.035em），正文 0；中文标题收到 −0.02em（中文不需要英文那么大负值） */
export const TRACKING = {
  title: "-0.02em",
  heading: "-0.015em",
  body: "0",
  micro: "0.01em",
} as const;

/** 把 L3 层写到 :root（圆角 / 阴影 / 动效 / 字距） */
export function applySurfaceTokens(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  const elev = elevationOf(mode);
  root.setProperty("--surface-card", elev.card);
  root.setProperty("--surface-card-hover", elev.cardHover);
  root.setProperty("--surface-popover", elev.popover);
  root.setProperty("--surface-modal", elev.modal);
  root.setProperty("--motion-indicator", MOTION.indicator);
  root.setProperty("--motion-state", MOTION.state);
  root.setProperty("--motion-overlay", MOTION.overlay);
  root.setProperty("--tracking-title", TRACKING.title);
  root.setProperty("--tracking-heading", TRACKING.heading);
  root.setProperty("--tracking-micro", TRACKING.micro);
}
