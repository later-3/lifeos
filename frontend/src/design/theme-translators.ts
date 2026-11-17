/**
 * 外部主题转译器（Task 0015 · B1）：VSCode JSON / Obsidian CSS → LifeOS 主题包。
 *
 * 映射规则 = 06-theme-element-map.md（**按域归并**，非逐 token 手写）；
 * 未映射项零静默：报告输出 mapped/merged/dropped 三清单。
 * Obsidian 侧是**有界状态机**（逐行，选择器跟踪）+ **CSS 值求值**（var 插值/命名色/hsl/rgb，
 * 生成式主题如 Minimal 的 --bg1 = hsl(var(--base-h), …) 可解析）；1.3MB 线性过。
 */
import { isHexColor, normColor, type ContractVar, type ThemePack } from "./theme-package.ts";

type Vars = Partial<Record<ContractVar, string>>;
type Report = { mapped: string[]; merged: string[]; dropped: string[] };

/* ── VSCode：colors 域映射 ── */
const VSC_MAP: Record<string, ContractVar> = {
  "editor.background": "--color-surface",
  "panel.background": "--color-sunken",
  "sideBar.background": "--color-nav-bg",
  "activityBar.background": "--color-nav-edge",
  /*
   * **`list.hoverBackground` / `list.activeSelectionBackground` 被有意从映射里删掉**
   * （Task 0017 · P2，2026-11-16）。
   *
   * 旧映射把 VSCode 的「编辑器选区色」直接当成我们的行选中底：
   *   `list.activeSelectionBackground` → `--color-nav-selected`
   * 而后者是**派生量**（`theme.ts` `navSelected: [selL, nC*2.6, nH]`，饱和度锚在主题中性色）。
   *
   * 后果（用户第一张截图）：Quiet Light 的 `#c4d9b1` 直接变成整块荧光绿的选中底 ——
   * OKLCH chroma **0.0585**，而内置引擎 5 预设 × 深浅 10 组实测上界只有 **0.0121**（4.8 倍）。
   * 压在它上的运行光环实测变成 `#a7b6b4`（对底 1.39:1，蓝绿相消成一坨灰泥）；
   * 未读绿点 3.77:1 且同色相叠同色相。
   *
   * 为什么是"删掉"而不是"改映射到别的变量"：这两个键在 VSCode 里表达的是
   * **"状态有多重"（一个 L* 台阶 + 一点色相）**，而我们的 `navAccent / navSelected`
   * 是**从主题中性色按比例派生**的同一个量。把它们并进 fill 只能二选一：
   * 要么让外来值覆盖关系（旧行为，出荧光绿），要么让关系覆盖外来值（等于不读）。
   * 正确做法是**不读这两项的色值**，只让 `extractVscodeSeed` 用 `focusBorder/button.background`
   * 定主色相，行态的台阶仍由引擎算 —— 这样主题个性体现在色相上，强度留在我们验证过的区间里。
   *
   * 遗留（登记在 Task 0017 todo）：VSCode 的这两个键带 alpha（`#ffffff14` = 8% 白），
   * 那正是 wash 的语义。等 wash 契约稳定后可以把它们的 **alpha** 读进来当 wash 强度种子，
   * 但需要先扩展契约（新增 wash 变量），不在 P2 的范围里。
   */
  "panel.border": "--color-line",
  "input.border": "--color-line",
  "menu.border": "--color-line",
  "editor.foreground": "--color-ink-900",
  "sideBar.foreground": "--color-ink-700",
  "focusBorder": "--color-accent",
  "button.background": "--color-accent-solid",
  "inputValidation.errorForeground": "--color-danger",
  "gitDecoration.modifiedResourceForeground": "--color-diff-mod",
  "gitDecoration.deletedResourceForeground": "--color-diff-del",
  "gitDecoration.addedResourceForeground": "--color-diff-add",
};

/* ── VSCode：tokenColors scope → 语法八族（表序 = 优先序，specific 在前） ── */
const VSC_SYN: Array<[ContractVar, string[]]> = [
  ["--color-syn-comment", ["comment", "punctuation.definition.comment"]],
  ["--color-syn-string", ["string"]],
  ["--color-syn-number", ["constant.numeric"]],
  ["--color-syn-constant", ["constant"]],
  ["--color-syn-function", ["entity.name.function", "support.function"]],
  ["--color-syn-type", ["entity.name.type", "support.type"]],
  ["--color-syn-keyword", ["keyword"]],
  ["--color-syn-punctuation", ["punctuation"]],
];

/* ── 色板种子提取 + 引擎再生（正确做法）──────────────────────────────────
 * 不是"VSCode 有什么就映射什么"——VSCode 是编辑器，没有消息/批注/聊天等概念。
 * 正确做法：从 VSCode 主题提取色板种子（背景/前景/主色/边框），
 * 映射到我们引擎的 ThemeState 参数，然后用 calculatePalette 重新生成全族 59 个变量。
 * 保证：全族一致、对比度达标、质感统一（引擎内建）。
 */
function hexToOklchL(hex: string): number {
  const s = hex.replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s.slice(0, 6);
  const lin = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function hexToHue(hex: string): number {
  const s = hex.replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255, g = parseInt(full.slice(2, 4), 16) / 255, b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = h * 60;
  if (h < 0) h += 360;
  return Math.round(h);
}
function hexToChroma(hex: string): number {
  const s = hex.replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255, g = parseInt(full.slice(2, 4), 16) / 255, b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  const sat = d / (1 - Math.abs(2 * l - 1));
  return Math.round(Math.min(100, sat * 100));
}

/**
 * 从 VSCode colors 里提取色板种子 → 反推 ThemeState → 引擎再生。
 * 返回 { themeState, pack }：themeState 用于引擎计算，pack 用于持久化。
 */
export function extractVscodeSeed(json: unknown, sourceRef?: string): {
  themeState: { mode: "light" | "dark"; accentH: number; accentC: number; lSurface: number; lNav: number; lRail: number; lLine: number };
  pack: ThemePack;
} {
  const d = json as { name?: string; type?: string; colors?: Record<string, string>; tokenColors?: Array<{ scope?: string | string[]; settings?: { foreground?: string } }> };
  const colors = d.colors ?? {};
  const mode = (d.type === "dark" || d.type === "vs-dark") ? "dark" as const : "light" as const;
  const bg = colors["editor.background"] ?? (mode === "dark" ? "#1e1e1e" : "#ffffff");
  const sidebarBg = colors["sideBar.background"] ?? bg;
  const activityBg = colors["activityBar.background"] ?? sidebarBg;
  const fg = colors["editor.foreground"] ?? (mode === "dark" ? "#cccccc" : "#333333");
  const accent = colors["focusBorder"] ?? colors["button.background"] ?? (mode === "dark" ? "#569cd6" : "#0066bf");
  const border = colors["panel.border"] ?? colors["input.border"] ?? (mode === "dark" ? "#333" : "#ddd");
  // 亮度 → L* 参数
  const lumToLstar = (hex: string): number => {
    const l = hexToOklchL(hex);
    return Math.round(((l <= 0.008856 ? l * 903.3 : Math.pow(l, 1 / 3) * 116 - 16)) * 10) / 10;
  };
  const lSurface = Math.min(100, Math.max(4, lumToLstar(mode === "dark" ? bg : bg)));
  const lNav = Math.min(100, Math.max(4, lumToLstar(mode === "dark" ? sidebarBg : sidebarBg)));
  const lRail = Math.min(100, Math.max(4, lumToLstar(mode === "dark" ? activityBg : activityBg)));
  const lLine = Math.min(100, Math.max(4, lumToLstar(mode === "dark" ? border : border)));
  const themeState = {
    // 补全 ThemeState 的全部字段（hoverD/selRatio/neutralC/lockNeutral/preset）——
    // 缺少任何一个字段在 calculatePalette 里会产生 NaN。
    ...{ hoverD: 4.2, selRatio: 2.0, neutralC: 4, lockNeutral: true, preset: "custom" as const },
    mode, accentH: hexToHue(accent), accentC: hexToChroma(accent),
    lSurface: mode === "dark" ? lSurface : Math.max(88, lSurface),
    lNav: mode === "dark" ? lNav : Math.max(88, lNav),
    lRail: mode === "dark" ? lRail : Math.max(84, lRail),
    lLine: mode === "dark" ? lLine : Math.max(72, lLine),
  };
  // 同域映射的变量也保留（引擎再生覆盖不了的具体语义色，如 diff/语法高亮）
  const report: Report = { mapped: [], merged: [], dropped: [] };
  const vars: Vars = {};
  for (const [key, value] of Object.entries(colors)) {
    if (!isHexColor(value)) continue;
    const target = VSC_MAP[key];
    if (target !== undefined) { vars[target] = normColor(value); report.mapped.push(key); }
    else report.merged.push(key);
  }
  for (const rule of d.tokenColors ?? []) {
    const fg = rule.settings?.foreground;
    if (!fg || !isHexColor(fg)) continue;
    const scopes = typeof rule.scope === "string" ? rule.scope.split(",").map((sc: string) => sc.trim()) : (rule.scope ?? []).map((sc: string) => sc.trim());
    for (const [target, patterns] of VSC_SYN) {
      if (vars[target] !== undefined) continue;
      if (scopes.some((sc) => patterns.some((p) => sc === p || sc.startsWith(p + ".") || sc.startsWith(p + " ")))) {
        vars[target] = normColor(fg); break;
      }
    }
  }
  const pack: ThemePack = {
    kind: "lifeos-theme-pack", version: 1,
    meta: { name: d.name ?? "未命名 VSCode 主题", source: "vscode", sourceRef: sourceRef ?? d.name },
    modes: { [mode]: vars } as ThemePack["modes"],
  };
  return { themeState, pack };
}


/* ── Obsidian：官方标准变量映射 ── */
const OBS_MAP: Record<string, ContractVar> = {
  "--background-primary": "--color-surface",
  "--background-primary-alt": "--color-sunken",
  "--background-secondary": "--color-nav-bg",
  "--background-secondary-alt": "--color-nav-edge",
  "--background-modifier-hover": "--color-hover",
  "--background-modifier-active-hover": "--color-nav-selected",
  "--background-modifier-border": "--color-line",
  "--text-normal": "--color-ink-900",
  "--text-muted": "--color-ink-500",
  "--text-faint": "--color-ink-300",
  "--text-accent": "--color-accent",
  "--interactive-accent": "--color-accent-solid",
  "--text-error": "--color-danger",
  "--text-success": "--color-success",
};

type Buckets = { base: Record<string, string>; dark: Record<string, string>; light: Record<string, string> };

/** CSS 值求值：var() 插值 → 命名色 → hsl()/rgb() 组装 → hex；深度限 5；解析不到=undefined（报告，零静默）。 */
function evalValue(raw: string, lookup: (n: string) => string | undefined, depth: number): string | undefined {
  if (depth > 5) return undefined;
  const v = raw.trim();
  if (v === "var(--dark0)") console.error("[DEBUG-eval] var(--dark0) lookup(--dark0)=", lookup("--dark0"), "depth=", depth);
  if (isHexColor(v)) return normColor(v);
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(v);
  if (ref !== null) {
    const inner = lookup(ref[1]);
    if (inner !== undefined) {
      const resolved = evalValue(inner, lookup, depth + 1);
      if (resolved !== undefined) return resolved;
    }
    const fallback = ref[2];
    if (fallback !== undefined) return evalValue(fallback, lookup, depth + 1);
    return undefined;
  }
  // 值内嵌 var()（如 hsl(var(--h), var(--s), var(--l))）→ 逐个插值后重试
  if (v.includes("var(")) {
    const interpolated = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_m, n, fb) => {
      const inner = lookup(n);
      return inner !== undefined ? inner : (fb !== undefined ? fb : "");
    });
    if (!interpolated.includes("var(") && interpolated.trim() !== "") return evalValue(interpolated, lookup, depth + 1);
  }
  const lower = v.toLowerCase();
  if (lower === "black") return "#000000";
  if (lower === "white") return "#ffffff";
  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%(?:\s*[, ]\s*([\d.]+))?\s*\)$/.exec(v);
  if (hsl !== null) {
    const h = parseFloat(hsl[1]) / 360, sat = parseFloat(hsl[2]) / 100, l = parseFloat(hsl[3]) / 100;
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
    const p2 = 2 * l - q;
    const conv = (t: number) => { let x = t; if (x < 0) x += 1; if (x > 1) x -= 1;
      if (x < 1 / 6) return p2 + (q - p2) * 6 * x; if (x < 1 / 2) return q;
      if (x < 2 / 3) return p2 + (q - p2) * (2 / 3 - x) * 6; return p2; };
    const to = (x: number) => Math.round(conv(x) * 255).toString(16).padStart(2, "0");
    return `#${to(h + 1 / 3)}${to(h)}${to(h - 1 / 3)}`;
  }
  const rgb = /^rgb\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*\)$/.exec(v);
  if (rgb !== null) {
    const to = (x: string) => Number(x).toString(16).padStart(2, "0");
    return `#${to(rgb[1])}${to(rgb[2])}${to(rgb[3])}`;
  }
  return undefined;
}

/** VSCode 主题 JSON → 包（单 mode：文件 type 决定写入 light 或 dark 槽）。 */
export function translateVscodeTheme(json: unknown, sourceRef?: string): { pack: ThemePack; report: Report } {
  const d = json as { name?: string; type?: string; colors?: Record<string, string>; tokenColors?: Array<{ scope?: string | string[]; settings?: { foreground?: string } }> };
  const report: Report = { mapped: [], merged: [], dropped: [] };
  const vars: Vars = {};
  for (const [key, value] of Object.entries(d.colors ?? {})) {
    if (!isHexColor(value)) { report.dropped.push(`${key}=${value}（非 hex）`); continue; }
    const target = VSC_MAP[key];
    if (target !== undefined) {
      vars[target] = normColor(value);
      report.mapped.push(`${key} → ${target}`);
    } else {
      report.merged.push(key);
    }
  }
  for (const rule of d.tokenColors ?? []) {
    const fg = rule.settings?.foreground;
    if (!fg || !isHexColor(fg)) continue;
    const scopes = typeof rule.scope === "string" ? rule.scope.split(",").map((s) => s.trim()) : rule.scope ?? [];
    for (const [target, patterns] of VSC_SYN) {
      if (vars[target] !== undefined) continue; // 先到先得（表序优先）
      if (scopes.some((sc) => patterns.some((p) => sc === p || sc.startsWith(p + ".") || sc.startsWith(p + " ")))) {
        vars[target] = normColor(fg);
        report.mapped.push(`scope[${scopes.slice(0, 2).join(",")}] → ${target}`);
        break;
      }
    }
  }
  const dark = d.type === "dark" || d.type === "vs-dark";
  const mode = dark ? "dark" : "light";
  const pack: ThemePack = {
    kind: "lifeos-theme-pack",
    version: 1,
    meta: { name: d.name ?? "未命名 VSCode 主题", source: "vscode", sourceRef: sourceRef ?? d.name },
    modes: { [mode]: vars } as ThemePack["modes"],
  };
  return { pack, report };
}

/** Obsidian CSS：两遍（状态机收集全声明 → 映射表目标逐个求值）。 */
export function translateObsidianTheme(cssInput: string, sourceRef?: string, fallbackName = "未命名 Obsidian 主题"): { pack: ThemePack; report: Report } {
  const report: Report = { mapped: [], merged: [], dropped: [] };
  // 预处理：花括号独占一行的风格（gruvbox 等）合并进选择器/收尾行——状态机按行工作
  const css = cssInput.replace(/\n\s*\{/g, " {").replace(/\n\s*\}/g, "\n}"); // { 并进选择器行；} 保留独立行（否则 } 连进变量行，depth 永不回落——gruvbox 实测）
  const buckets: Buckets = { base: {}, dark: {}, light: {} };
  const varRe = /^\s*(--[\w-]+)\s*:\s*([^;]+);/;
  let current = "base";
  let depth = 0;
  let darkSeen = false, lightSeen = false;
  for (const rawLine of css.split("\n")) {
    const line = rawLine.trim();
    const varMatch = varRe.exec(line);
    if (varMatch !== null && depth > 0) {
      const [, name, rawValue] = varMatch;
      if (current === "theme-dark") buckets.dark[name] = rawValue.trim();
      else if (current === "theme-light") buckets.light[name] = rawValue.trim();
      else if (current === "both") { buckets.dark[name] = rawValue.trim(); buckets.light[name] = rawValue.trim(); }
      else if (current === "base") buckets.base[name] = rawValue.trim();
      continue;
    }
    if (line.includes("{")) {
      depth += 1;
      if (depth === 1) {
        const sel = line.slice(0, line.indexOf("{")).trim();
        const isDark = sel.includes(".theme-dark") || sel.includes('[data-theme="dark"]');
        const isLight = sel.includes(".theme-light") || sel.includes('[data-theme="light"]');
        if (isDark && isLight) { current = "both"; darkSeen = true; lightSeen = true; }
        else if (isDark) { current = "theme-dark"; darkSeen = true; }
        else if (isLight) { current = "theme-light"; lightSeen = true; }
        else { current = "base"; } // 顶层选择器的变量同样是全局事实（gruvbox 等用 :root/自选命名）
      }
      continue;
    }
    if (line.includes("}")) {
      depth = Math.max(0, depth - 1);
      if (depth === 0) current = "base";
    }
  }
  // CSS 变量是**全局共享**的（.theme-light 里定义的调色板可被 .theme-dark 引用，
  // gruvbox 就是这个形态：dark 段的 --text-normal 指向 light 段的 --light0）。
  // 查序：当前段 → base → 另一段（先定义者优先，符合 CSS 级联）。
  const lookupFor = (scope: "dark" | "light") => (n: string): string | undefined => {
    const own = (scope === "dark" ? buckets.dark : buckets.light)[n];
    if (own !== undefined) return own;
    if (buckets.base[n] !== undefined) return buckets.base[n];
    return (scope === "dark" ? buckets.light : buckets.dark)[n];
  };
  const merged: { light: Vars; dark: Vars } = { light: {}, dark: {} };
  console.error("[DEBUG-A4] darkSeen=", darkSeen, "lightSeen=", lightSeen, "dark 桶键数=", Object.keys(buckets.dark).length, "base 桶键数=", Object.keys(buckets.base).length, "dark 桶 --text-normal=", buckets.dark["--text-normal"]);
  const hasSegments = darkSeen || lightSeen;
  const modes: Array<["dark" | "light", Record<string, string>]> = hasSegments
    ? [["dark", buckets.dark], ["light", buckets.light]]
    : [["dark", buckets.base], ["light", buckets.base]];
  for (const [mode] of modes) {
    const vars = merged[mode] as Vars;
    for (const [obsName, target] of Object.entries(OBS_MAP)) {
      const raw = lookupFor(mode)(obsName) ?? "";
      const resolved = evalValue(raw, lookupFor(mode), 0);
      if (raw !== "" && resolved === undefined) console.error("[DEBUG-resolve]", mode, obsName, "raw=", raw.slice(0, 40));
      if (resolved !== undefined) {
        vars[target] = resolved;
        report.mapped.push(`${obsName} → ${target} (${mode})`);
      } else {
        const rawShown = ((lookupFor(mode)(obsName) ?? buckets.base[obsName] ?? "") as string).slice(0, 40);
        if (rawShown !== "") report.dropped.push(`${obsName}（无法解析到 hex：${rawShown}）`);
      }
    }
  }
  if (!hasSegments) {
    const bgp = merged.dark["--color-surface"];
    const isDark = bgp !== undefined && isHexColor(bgp) ? luminanceOf(bgp) < 0.35 : true;
    if (isDark) merged.light = {};
    else merged.dark = {};
  }
  const pack: ThemePack = {
    kind: "lifeos-theme-pack",
    version: 1,
    meta: { name: fallbackName, source: "obsidian", sourceRef: sourceRef ?? fallbackName },
    modes: merged,
  };
  return { pack, report };
}

function luminanceOf(hex: string): number {
  const s = hex.replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s.slice(0, 6);
  const lin = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
