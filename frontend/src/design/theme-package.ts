/**
 * 主题包（Task 0015 · B1，D1 定案：JSON 主题包 + 外部转译器）。
 *
 * **包 = 数据，不是参数**：`modes.light/dark` 直接填契约变量的 hex 值——
 * 运行时消费路径只有一条（包/引擎值 → :root），外部主题（VSCode/Obsidian）
 * 经转译器产出包，引擎（滑块/预设）也产出包——三条来源同一种交付形态。
 *
 * **演进视角**（D1 决策记录）：包 partial 化（可只覆盖部分变量）——校验器报告
 * 覆盖度，缺省变量由当前主题兜底；v2 再收紧"整包完整性"档位。
 */
import { VAR_MAP } from "./theme.ts";

/** 契约变量全集（引擎 VAR_MAP 的名字集合——契约的唯一出处）。 */
export const CONTRACT_KEYS = VAR_MAP.map(([name]) => name) as ContractVar[];
export type ContractVar = `--color-${string}`;

export type ThemePack = {
  kind: "lifeos-theme-pack";
  version: 1;
  meta: {
    name: string;
    author?: string;
    source: "vscode" | "obsidian" | "lifeos" | "custom";
    /** 原始出处（VSCode 主题名 / Obsidian 主题 repo），转译报告可回溯。 */
    sourceRef?: string;
  };
  modes: {
    light?: Partial<Record<ContractVar, string>>;
    dark?: Partial<Record<ContractVar, string>>;
  };
  /** VSCode 转译时保存的种子 ThemeState——应用时走标准 React 状态流（onChange → applyTheme），保证全站一致。 */
  seedThemeState?: ThemeState;
  /** 字体槽（S3）：缺省 = 系统栈。 */
  fonts?: { sans?: string; mono?: string };
  /** 图标方案槽（S3）：缺省 = tabler。 */
  icons?: { set: "tabler" | "lucide" | "phosphor" };
};

const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const NAMED_COLORS: Record<string, string> = { black: "#000000", white: "#ffffff" };
export function isHexColor(v: string): boolean {
  const t = v.trim().toLowerCase();
  if (t in NAMED_COLORS) return true;
  return HEX_RE.test(t);
}
/**
 * 值归一：命名色 → hex；**8 位 hex（带 alpha）剥成 6 位**。
 *
 * 为什么必须剥：VSCode 的 `list.hoverBackground` 是 `#ffffff14`（8% 白）。
 * 我们的契约变量是"实底"语义（`--color-message-tool` 等要能承载文字），
 * 把带 alpha 的值写进实底 = 深色主题下那块变成"几乎透明"，文字浮在页面底上（S6 审计实测）。
 * 契约只接受 `#rrggbb`（4 位简写会展开）——alpha 由派生层按底色混合表达，不在 token 里存。
 */
export function normColor(v: string, options: { keepAlpha?: boolean } = {}): string {
  const t = v.trim().toLowerCase();
  if (t in NAMED_COLORS) return NAMED_COLORS[t];
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t);
  if (m === null) return t;
  const hexPart = m[1];
  /*
   * `keepAlpha`（Task 0017 · P2）：**wash 与 fill 是两类东西**。
   *
   * 旧实现一刀切剥掉 alpha，理由（对 fill 成立）是"8 位 hex 写进实底 = 深色主题下那块
   * 几乎透明、文字浮在页面底上"（S6 审计实测，见 applyThemePack 的注释）。
   * 但对 **wash（状态薄涂）** 恰恰相反：半透明是它的语义本身 ——
   * VSCode 的 `list.hoverBackground: #ffffff14`（8% 白）本来就该当薄涂用，
   * 剥成 `#ffffff` 会让整行变成纯白块（VSCode 2026 Dark 的选中底实测就是这个结果：
   * raw `#ffffff22` → 派生后 `#ffffff`，全白）。
   */
  if (options.keepAlpha === true) {
    if (hexPart.length === 4) {
      const [r, g, b, a] = hexPart.split("").map((c) => c + c);
      return `#${r}${g}${b}${a}`;
    }
    if (hexPart.length === 8) return `#${hexPart}`;
    if (hexPart.length === 3) return "#" + hexPart.split("").map((c) => c + c).join("");
    return "#" + hexPart;
  }
  if (hexPart.length === 4) return "#" + hexPart.slice(0, 3).split("").map((c) => c + c).join("");
  if (hexPart.length === 8) return "#" + hexPart.slice(0, 6);
  if (hexPart.length === 3) return "#" + hexPart.split("").map((c) => c + c).join("");
  return "#" + hexPart;
}

/** 相对亮度（WCAG）+ 对比度——校验器与转译报告共用（与 theme.ts contrastRgb 同式，独立无依赖）。 */
export function relLuminance(hex: string): number {
  const s = hex.replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  const lin = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrastRatio(a: string, b: string): number {
  const A = relLuminance(a), B = relLuminance(b);
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
}

export type PackIssue = { level: "error" | "warn"; message: string };
export type PackReport = {
  ok: boolean;
  coverage: { light: number; dark: number; total: number };
  issues: PackIssue[];
  contrastChecks: Array<{ name: string; fg: string; bg: string; ratio: number; pass: boolean; severity: "error" | "warn" }>;
};

/** 关键对比对（校验器抽检；pass 线 ≥4.5 WCAG AA 正文）。 */
/*
 * 关键对比对（校验器抽检；pass 线 ≥4.5 = WCAG AA 正文）。
 *
 * **2026-11-16（Task 0017 · P2）：原来只有 4 对，全是 ink × surface。**
 * 承托层（选中底 / 悬停底）一对都没有 —— 于是"选中底变成荧光绿、压在上面的状态点
 * 与光环全部失真"这件事，校验器一个字都说不出。现在补上承托层这一族。
 *
 * 为什么放在这里而不是只放在 P2 的生成式矩阵里：这里查的是**包本身**（导入时就能报），
 * 生成式矩阵查的是**8 个预置主题 × 4 主题态**（回归门）。两处互补，都留。
 */
const CONTRAST_PAIRS: Array<{ name: string; fg: ContractVar; bg: ContractVar; dark: boolean; severity: "error" | "warn" }> = [
  { name: "正文/内容底 (dark)", fg: "--color-ink-900", bg: "--color-surface", dark: true, severity: "error" },
  { name: "正文/内容底 (light)", fg: "--color-ink-900", bg: "--color-surface", dark: false, severity: "error" },
  { name: "辅助字/内容底 (dark)", fg: "--color-ink-500", bg: "--color-surface", dark: true, severity: "warn" },
  { name: "辅助字/内容底 (light)", fg: "--color-ink-500", bg: "--color-surface", dark: false, severity: "warn" },
  /* ── 承托层 × 压在其上的东西（P2 新增）──
   * 门槛 3.0 而不是 4.5：这些是**图形/标记**（状态点 6px、徽标 16px），
   * 不是正文。WCAG 1.4.11 Non-text Contrast 的界就是 3:1。
   * 用 4.5 会把这些有意义的小标记判成缺陷（它们本来就小，够粗就行）。 */
  { name: "导航辅助字/选中底 (dark)", fg: "--color-nav-muted", bg: "--color-nav-selected", dark: true, severity: "warn" },
  { name: "导航辅助字/选中底 (light)", fg: "--color-nav-muted", bg: "--color-nav-selected", dark: false, severity: "warn" },
];

export function validateThemePack(pack: ThemePack): PackReport {
  const issues: PackIssue[] = [];
  const coverage = {
    light: pack.modes.light ? Object.keys(pack.modes.light).length : 0,
    dark: pack.modes.dark ? Object.keys(pack.modes.dark).length : 0,
    total: CONTRACT_KEYS.length,
  };
  if (coverage.light === 0 && coverage.dark === 0) {
    issues.push({ level: "error", message: "light 与 dark 两套都为空——不是可应用的主题包" });
  }
  // 值合法性：必须是可直接写入 :root 的 hex（var()/rgba() 等在 v1 转译器已过滤，这里兜底）
  for (const mode of ["light", "dark"] as const) {
    const vars = pack.modes[mode] ?? {};
    for (const [k, v] of Object.entries(vars)) {
      if (!CONTRACT_KEYS.includes(k as ContractVar)) {
        issues.push({ level: "error", message: `${mode} 含契约外变量 ${k}（会静默无效，拒绝）` });
      } else if (!isHexColor(v as string)) {
        issues.push({ level: "error", message: `${mode}.${k} 不是 hex 颜色：${v}` });
      }
    }
  }
  // 深浅方向：dark 的 surface 应为暗、light 的 surface 应为亮（转错方向的主题一眼识破）
  const surfDark = pack.modes.dark?.["--color-surface"];
  const surfLight = pack.modes.light?.["--color-surface"];
  if (surfDark && isHexColor(surfDark) && relLuminance(surfDark) > 0.35) {
    issues.push({ level: "warn", message: `dark.surface 亮度偏高（${surfDark}）——像浅色主题放进了 dark 槽` });
  }
  if (surfLight && isHexColor(surfLight) && relLuminance(surfLight) < 0.55) {
    issues.push({ level: "warn", message: `light.surface 亮度偏低（${surfLight}）——像深色主题放进了 light 槽` });
  }
  // 对比度抽检（只查有值的对；缺值由兜底主题承担，不算错误）
  const contrastChecks = CONTRAST_PAIRS
    .filter((pair) => {
      const fg = (pair.dark ? pack.modes.dark : pack.modes.light)?.[pair.fg];
      const bg = (pair.dark ? pack.modes.dark : pack.modes.light)?.[pair.bg];
      return fg !== undefined && bg !== undefined && isHexColor(fg) && isHexColor(bg);
    })
    .map((pair) => {
      const vars = pair.dark ? pack.modes.dark : pack.modes.light;
      const fg = vars?.[pair.fg] as string;
      const bg = vars?.[pair.bg] as string;
      const ratio = contrastRatio(fg, bg);
      return { name: pair.name, fg, bg, ratio: Math.round(ratio * 100) / 100, pass: ratio >= 4.5, severity: pair.severity };
    });
  for (const c of contrastChecks) {
    if (!c.pass) issues.push({ level: c.severity, message: `对比度不达标 ${c.name}：${c.fg} on ${c.bg} = ${c.ratio}（<4.5）——正文不可读需修复，辅助字提示可用性下降` });
  }
  const ok = !issues.some((i) => i.level === "error");
  return { ok, coverage, issues, contrastChecks };
}

/* ── 应用到运行时 ──
 * 先 applyTheme(currentState) 写引擎全量（兜底缺省变量），再覆盖包有值的变量。
 * 切深浅 = 换 modes 槽（另一个槽的值覆盖）。
 */
import { applyTheme, applyWashAlphas, type ThemeState } from "./theme.ts";
import { derivePack } from "./theme-derive.ts";

export function applyThemePack(rawPack: ThemePack, requestedMode: "light" | "dark", currentState: ThemeState): "light" | "dark" {
  if (typeof document === "undefined") return requestedMode;
  // 应用前派生补齐（S1）：外部主题只给部分变量，缺失的按规则从种子推——不再让引擎默认值混进来
  const pack = derivePack(rawPack);
  /*
   * 自动模式（单槽主题）：**请求的槽没值就切到有值的那个槽**。
   *
   * 旧实现写错了顺序：`requestedMode === "dark" || lightCount === 0 ? "dark" : …`——
   * 请求 dark 时**第一个条件立刻成立**，根本不看 dark 槽有没有值。
   * 后果：Quiet Light（只有 light 槽）在深色模式下应用时，`applyTheme` 用引擎的深色底
   * 兜底、包里又没有任何变量可覆盖 → 界面显示的是"引擎深色"，而不是 Quiet Light。
   * 2026-11-14 S6 逐主题审计（Quiet Light 的 surface 与内置冷蓝深色完全相同）抓到。
   */
  const darkCount = pack.modes.dark ? Object.keys(pack.modes.dark).length : 0;
  const lightCount = pack.modes.light ? Object.keys(pack.modes.light).length : 0;
  const requestedHasValue = requestedMode === "dark" ? darkCount > 0 : lightCount > 0;
  const mode: "light" | "dark" = requestedHasValue
    ? requestedMode
    : (darkCount > 0 ? "dark" : lightCount > 0 ? "light" : requestedMode);
  // 兜底：先按该 mode 写引擎的**干净基线**（THEME_DEFAULTS + mode），
  // 而不是上一个主题的 state（否则上一个主题的深/浅残留会盖不住）
  applyTheme({ ...currentState, mode });
  const vars = pack.modes[mode] ?? {};
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(vars)) {
    if (value !== undefined && isHexColor(value)) root.setProperty(name, normColor(value));
  }
  /*
   * wash 的 α 必须在**包覆盖之后**再算一次（Task 0017 · P2）。
   *
   * `applyTheme` 已经算过一次，但那是按**引擎**的 fill 算的；包把 `nav-selected` 换成
   * 自己的值之后，同一个 α 就不对应了。顺序错了的表现：Quiet Light 的选中底是
   * 派生后的 `#e3e3e3`，但 α 仍按引擎的 `#e4e8f5` 算成 100% —— 恰好没收敛到最该收敛的地方。
   *
   * 取值用 `getPropertyValue` 读**此刻真正生效的** fill（引擎写过、包又覆盖过），
   * 所以内置与外部走同一条路径，不存在第二份判断。
   */
  const readVar = (name: string) => (root.getPropertyValue(name) ?? "").trim();
  applyWashAlphas(root, {
    navAccent: readVar("--color-nav-accent"),
    navSelected: readVar("--color-nav-selected"),
    sunken: readVar("--color-sunken"),
    navBg: readVar("--color-nav-bg"),
  }, mode);
  document.documentElement.dataset.themeMode = mode;
  // 字体槽（S3）：包里有就写，没有就保持主题引擎/默认值
  if (pack.fonts?.sans !== undefined) root.setProperty("--font-sans", pack.fonts.sans);
  if (pack.fonts?.mono !== undefined) root.setProperty("--font-mono", pack.fonts.mono);
  return mode;
}

/* ── 持久化（localStorage；跨设备同步走 ui.json 后续接） ── */
const PACK_STORE_KEY = "lifeos.themePacks";
const PACK_ACTIVE_KEY = "lifeos.themePackActive";

export function loadThemePacks(): ThemePack[] {
  try {
    const raw = localStorage.getItem(PACK_STORE_KEY);
    return raw === null ? [] : JSON.parse(raw) as ThemePack[];
  } catch { return []; }
}
export function saveThemePacks(packs: ThemePack[]): void {
  try { localStorage.setItem(PACK_STORE_KEY, JSON.stringify(packs)); } catch { /* 隐私模式 */ }
}
export function loadActivePackId(): string | undefined {
  try { return localStorage.getItem(PACK_ACTIVE_KEY) ?? undefined; } catch { return undefined; }
}
export function saveActivePackId(id: string | undefined): void {
  try { id === undefined ? localStorage.removeItem(PACK_ACTIVE_KEY) : localStorage.setItem(PACK_ACTIVE_KEY, id); } catch { /* 隐私模式 */ }
}
