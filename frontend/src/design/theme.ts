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

/** 深色派生：L* 翻转后压缩到 13–34（台阶 ×1.6 放大——深底上同台阶感知更弱，demo 实测）。 */
function darkL(lstar: number): number {
  return Math.min(34, 13 + (100 - lstar) * 1.6);
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
  hoverD: 2.8,
  selRatio: 1.75,
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
  const lineL = dark ? Math.min(38, darkL(state.lLine) + 4) : state.lLine;
  // 深色下方向翻转：状态色比列底**更亮**
  const hoverL = dark ? navL + state.hoverD : navL - state.hoverD;
  const selL = dark ? navL + state.hoverD * state.selRatio : navL - state.hoverD * state.selRatio;

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
    sunken: [dark ? surfaceL - 1.7 : surfaceL - 1.7, nC * 0.5, nH],
    hover: [dark ? navL + state.hoverD + 1.2 : navL - state.hoverD - 0.3, nC, nH],
    line: [lineL, nC * 1.3, nH],
    navBg: [navL, nC, nH],
    navEdge: [railL, nC * 1.15, nH],
    navAccent: [hoverL, nC * 1.2, nH],
    navSelected: [selL, nC * 2.6, nH],
    navLine: [lineL, nC * 1.3, nH],
    navMuted: dark ? [70, 0.008, nH] : [43.5, 0.012, nH],
    accent: [accentL, accentC, hue],
    accentSolid: [accentSolidL, accentC, hue],
    accentSoft: dark
      ? [Math.min(30, accentL - 44), accentC * 0.35, hue]
      : [96.5, accentC * 0.16, hue],
    ink900: [ink[900], 0.01, nH],
    ink700: [ink[700], 0.008, nH],
    ink500: [ink[500], 0.006, nH],
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
