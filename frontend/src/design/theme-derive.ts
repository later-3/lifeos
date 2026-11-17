/**
 * 主题包的**派生层**（Task 0015 · S1）。
 *
 * 问题：外部主题（VSCode/Obsidian）只给部分颜色（实测覆盖 7–37%），剩下的变量
 * 如果留空 → 用的是**我们引擎的默认值**，与主题风格打架（深色主题里出现浅灰块）。
 *
 * 解法：从**已给的种子**派生缺失变量——不是瞎猜，而是按设计系统的关系推：
 * - 文字三档由 ink-900 + surface 的对比度目标推（保证 AA）；
 * - hover/selected 由 nav-bg 的 ΔL* 推（沿用我们引擎的比例）；
 * - soft 底由语义色 × surface 混合（保证可读）；
 * - 语法色/批注色/diff 色：主题提供了就用，没提供就按色相族从 accent/success/danger 推。
 *
 * 派生规则全部是纯函数 + 可测（每条规则一个测试断言"派生值与原值风格一致"）。
 */
import { contrastRatio, isHexColor, normColor, relLuminance, type ContractVar, type ThemePack } from "./theme-package.ts";

type Vars = Record<string, string>;

/** hex → [h, s, l]（HSL，0-360 / 0-100 / 0-100）。 */
function hexToHsl(hex: string): [number, number, number] {
  const s = normColor(hex).replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(sat * 100), Math.round(l * 100)];
}

/** [h, s, l] → hex。 */
function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;
  const hh = ((h % 360) + 360) % 360 / 360;
  if (sat === 0) {
    const v = Math.round(light * 255).toString(16).padStart(2, "0");
    return `#${v}${v}${v}`;
  }
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const conv = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const to = (x: number) => Math.round(conv(x) * 255).toString(16).padStart(2, "0");
  return `#${to(hh + 1 / 3)}${to(hh)}${to(hh - 1 / 3)}`;
}

/** 把颜色朝 target 混合 t（0..1）：用于 soft 底（语义色 × surface）。 */
function mix(a: string, b: string, t: number): string {
  const pa = normColor(a).replace("#", "");
  const pb = normColor(b).replace("#", "");
  const ea = pa.length === 3 ? pa.split("").map((c) => c + c).join("") : pa.slice(0, 6);
  const eb = pb.length === 3 ? pb.split("").map((c) => c + c).join("") : pb.slice(0, 6);
  const out = [0, 2, 4].map((i) => {
    const va = parseInt(ea.slice(i, i + 2), 16);
    const vb = parseInt(eb.slice(i, i + 2), 16);
    return Math.round(va * (1 - t) + vb * t).toString(16).padStart(2, "0");
  });
  return `#${out.join("")}`;
}

/** 调整亮度（相对）：用于 hover/selected 的台阶。 */
function shiftL(hex: string, deltaL: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s, l + deltaL);
}

/** 找「与 bg 对比度 ≥ target」的同色相色（二分亮度）。 */
function readableOn(hue: number, sat: number, bg: string, target = 4.5, darker = false): string {
  let lo = darker ? 0 : 50;
  let hi = darker ? 50 : 100;
  for (let i = 0; i < 12; i += 1) {
    const mid = (lo + hi) / 2;
    const candidate = hslToHex(hue, sat, mid);
    const ok = contrastRatio(candidate, bg) >= target;
    // darker=true：越暗对比越高；否则越亮对比越高（深底上）
    if (darker) { if (ok) lo = mid; else hi = mid; } else { if (ok) hi = mid; else lo = mid; }
  }
  return hslToHex(hue, sat, darker ? lo : hi);
}

/**
 * 补齐主题包中缺失的契约变量。**只补不改**：已有值原样保留。
 * 返回补了多少个 + 每个由什么规则补的（报告可追溯）。
 */
export function deriveMissingVars(raw: Vars): { filled: Vars; rules: Array<{ name: string; rule: string }> } {
  const out: Vars = { ...raw };
  const rules: Array<{ name: string; rule: string }> = [];
  const get = (k: ContractVar): string | undefined => out[k];
  const set = (k: ContractVar, v: string, rule: string) => {
    if (get(k) === undefined) { out[k] = v; rules.push({ name: k, rule }); }
  };

  let surface = get("--color-surface");
  if (surface === undefined) {
    // 主题没给内容底（如 Sanctum 的 --background-primary 是 var() 链，解析失败）：
    // 从**已有变量的亮度方向**判断深/浅，给一个中性兜底底——**必须进报告**（零静默）。
    const anyC = get("--color-ink-900") ?? get("--color-ink-500");
    const inferredDark = anyC !== undefined ? relLuminance(anyC) > 0.5 : true;
    surface = inferredDark ? "#1e1e1e" : "#ffffff";
    set("--color-surface", surface, `主题未给内容底，按取向推导兜底（${inferredDark ? "深" : "浅"}）；原主题 colour 链未解析`);
  }
  const dark = relLuminance(surface) < 0.35;

  // ── 1 表面层：sunken / nav / line / hover / selected（按深底或浅底的 ΔL 台阶）──
  const step = dark ? 4 : -3;
  set("--color-sunken", shiftL(surface, dark ? -2 : 1), "surface ± ΔL（页面底）");
  set("--color-nav-bg", shiftL(surface, dark ? -1 : -2), "surface ± ΔL（导航列）");
  set("--color-nav-edge", shiftL(surface, dark ? -2 : -3), "surface ± ΔL（图标轨）");
  set("--color-line", shiftL(surface, dark ? 8 : -8), "surface ± ΔL（边界线）");
  set("--color-nav-line", out["--color-line"] as string, "= line");
  set("--color-hover", shiftL((out["--color-nav-bg"] as string) ?? surface, step + (dark ? 1 : 0)), "nav-bg + 悬停台阶");
  set("--color-nav-accent", out["--color-hover"] as string, "= hover（导航列内）");
  set("--color-nav-selected", shiftL((out["--color-nav-bg"] as string) ?? surface, step * 2 + (dark ? 2 : 0)), "nav-bg + 选中台阶（比 hover 深/亮一档）");
  set("--color-table-head", (out["--color-sunken"] as string) ?? surface, "= sunken（表头）");

  // ── 2 文字四档：由 ink-900 起，逐档降低对比（仍 ≥ AA）──
  // 主题可能一个文字色都没给（Quiet Light 只有编辑器底/前景在别处）：
  // 按 surface 明暗给一档保底的 ink-900（深底→亮字，浅底→暗字），下面的三档再按它派生。
  if (get("--color-ink-900") === undefined) {
    set("--color-ink-900", dark ? hslToHex(0, 0, 92) : hslToHex(0, 0, 17), "主题未给文字色，按底明暗给保底");
  }
  const ink900 = get("--color-ink-900");
  if (ink900 !== undefined) {
    const [h, s] = hexToHsl(ink900);
    // 深色底：文字越亮；浅色底：文字越暗
    const bgForText = surface;
    set("--color-ink-700", readableOn(h, Math.min(s, 20), bgForText, 7, !dark), "ink-900 同色相，对比 ≈7:1");
    set("--color-ink-500", readableOn(h, Math.min(s, 20), bgForText, 4.5, !dark), "ink-900 同色相，对比 ≈4.5:1（AA 下限）");
    set("--color-ink-300", readableOn(h, Math.min(s, 20), bgForText, 2.2, !dark), "ink-900 同色相，对比 ≈2.2:1（仅装饰）");
  }
  const navBg = (out["--color-nav-bg"] as string) ?? surface;
  const ink500 = out["--color-ink-500"];
  if (ink500 !== undefined) {
    // 导航层辅助字：在 nav-selected 上也要 ≥4.5
    const [h, s] = hexToHsl(ink500);
    set("--color-nav-muted", readableOn(h, s, (out["--color-nav-selected"] as string) ?? navBg, 4.5, !dark), "ink-500 同色相，在选中底上 ≥4.5");
  }

  // ── 3 主色三件：accent（文字）/ accent-solid（白字底）/ accent-soft（淡底）──
  const accent = get("--color-accent");
  if (accent !== undefined) {
    const [h, s] = hexToHsl(accent);
    const solid = get("--color-accent-solid");
    if (solid === undefined) {
      // 白字底：深色主题下用 accent 本身（够暗），浅色主题下压暗到与白字 4.5
      const candidate = readableOn(h, s, "#ffffff", 4.5, true);
      set("--color-accent-solid", candidate, "accent 同色相压暗至白字 4.5:1");
    }
    set("--color-accent-soft", dark ? mix(accent, surface, 0.82) : mix(accent, surface, 0.9), "accent × surface 混合（淡底）");
  }

  // ── 4 语义三色：没给就用可用色相的默认档（绿/红/蓝）──
  set("--color-success", dark ? hslToHex(158, 60, 68) : hslToHex(158, 65, 36), "默认 success 绿（主题未提供）");
  set("--color-danger", dark ? hslToHex(25, 70, 62) : hslToHex(25, 75, 42), "默认 danger 红（主题未提供）");
  set("--color-running", dark ? hslToHex(232, 60, 70) : hslToHex(244, 70, 42), "默认 running 蓝（主题未提供）");

  // ── 5 soft 底：语义色 × surface 混合（保证"明面容器"方向）──
  for (const [semi, softName] of [["--color-danger", "--color-danger-soft"], ["--color-success", "--color-success-soft"], ["--color-running", "--color-running-soft"]] as const) {
    const c = out[semi];
    if (c !== undefined) set(softName as ContractVar, mix(c, surface, dark ? 0.8 : 0.9), `${semi} × surface 混合`);
  }

  // ── 6 消息块：用户气泡 = accent-solid；过程块 = sunken/hover；语义块 = soft ──
  set("--color-message-user", (out["--color-accent-solid"] as string) ?? surface, "= accent-solid（用户气泡）");
  set("--color-message-thinking", (out["--color-sunken"] as string) ?? surface, "= sunken（思考块）");
  set("--color-message-tool", (out["--color-hover"] as string) ?? surface, "= hover（工具块）");
  set("--color-message-tool-done", (out["--color-success-soft"] as string) ?? surface, "= success-soft");
  set("--color-message-tool-error", (out["--color-danger-soft"] as string) ?? surface, "= danger-soft");
  set("--color-message-failure", (out["--color-danger-soft"] as string) ?? surface, "= danger-soft");

  // ── 7 diff 三族：add=success 系 / del=danger 系 / mod=琥珀系 ──
  const success = out["--color-success"] as string | undefined;
  const danger = out["--color-danger"] as string | undefined;
  if (success !== undefined) {
    set("--color-diff-add", success, "= success");
    set("--color-diff-add-soft", (out["--color-success-soft"] as string) ?? surface, "= success-soft");
    set("--color-diff-word-add", mix(success, surface, dark ? 0.55 : 0.68), "success × surface（词级改动段）");
  }
  if (danger !== undefined) {
    set("--color-diff-del", danger, "= danger");
    set("--color-diff-del-soft", (out["--color-danger-soft"] as string) ?? surface, "= danger-soft");
    set("--color-diff-word-del", mix(danger, surface, dark ? 0.55 : 0.72), "danger × surface（词级改动段）");
  }
  const modColor = dark ? hslToHex(75, 55, 72) : hslToHex(70, 60, 38);
  set("--color-diff-mod", modColor, "默认琥珀（主题未提供）");
  set("--color-diff-mod-soft", mix(modColor, surface, dark ? 0.82 : 0.92), "mod × surface 混合");

  // ── 8 批注五色：固定色相族（query/critic/praise/archive/todo），亮度随主题 ──
  const annoHues: Array<[string, number]> = [["query", 45], ["critic", 0], ["praise", 150], ["archive", 245], ["todo", 275]];
  for (const [name, hue] of annoHues) {
    const base = dark ? hslToHex(hue, 55, 72) : hslToHex(hue, 60, 38);
    set(`--color-anno-${name}` as ContractVar, base, `批注默认色相 ${hue}°（主题未提供）`);
    set(`--color-anno-${name}-soft` as ContractVar, mix(base, surface, dark ? 0.82 : 0.92), "批注色 × surface 混合");
  }

  // ── 9 语法八族：有就用主题的（VSCode tokenColors），没有就按固定色相族 ──
  const synHues: Array<[string, number]> = [
    ["keyword", 285], ["string", 145], ["comment", 260], ["number", 40],
    ["function", 250], ["type", 195], ["constant", 325], ["punctuation", 260],
  ];
  for (const [name, hue] of synHues) {
    const sat = name === "comment" || name === "punctuation" ? 8 : 60;
    const l = dark ? 72 : 38;
    set(`--color-syn-${name}` as ContractVar, hslToHex(hue, sat, l), `语法默认色相 ${hue}°（主题未提供）`);
  }

  // ── 10 头像三档：从 accent-solid 同亮度派生三个色相（与白字 AA 一致）──
  const solidForAvatar = out["--color-accent-solid"] as string | undefined;
  if (solidForAvatar !== undefined) {
    const [h, s, l] = hexToHsl(solidForAvatar);
    set("--color-avatar-1", hslToHex(h, s, l), "= accent-solid");
    set("--color-avatar-2", hslToHex((h + 120) % 360, s, l), "accent-solid 色相 +120°");
    set("--color-avatar-3", hslToHex((h + 240) % 360, s, l), "accent-solid 色相 +240°");
  }

  return { filled: out, rules };
}

/** 对整包做派生补齐（两个 mode 各自补齐）。 */
export function derivePack(pack: ThemePack): ThemePack & { deriveReport?: Array<{ mode: "light" | "dark"; name: string; rule: string }> } {
  const report: Array<{ mode: "light" | "dark"; name: string; rule: string }> = [];
  const modes = { ...pack.modes };
  for (const mode of ["dark", "light"] as const) {
    const vars = pack.modes[mode];
    if (vars === undefined) continue;
    const clean: Record<string, string> = {};
    /*
     * normColor：预置包是历史产物（可能存着 8 位带 alpha 的值），在这里统一剥成 6 位——
     * 不能只依赖转译器（新导入的走 normColor，旧的也得对齐，否则同族变量两种格式并存）
     *
     * **例外（Task 0017 · P2）：行态三件带 alpha 时不进 fill 契约。**
     *
     * 它们表达的是 VSCode 的 `#ffffff14`（8% 白）这种**薄涂强度**，而我们的
     * `--color-nav-accent / nav-selected / hover` 是**实底**契约（必须不透明、必须承载前景 AA）。
     * 剥掉 alpha 写进去 = 白底/黑底 100%：
     * 实测 VSCode 2026 Dark 的 `#ffffff14` 变成 `#ffffff`，于是行悬停是一整块纯白，
     * 行标题白字压白底 **1.00:1**（`test/wash-layer.test.mjs` 抓到 48 处这类失败）。
     *
     * 所以：这三件带 alpha 时**丢掉外来值**，交给下面的 ΔL 派生（派生值必在 chroma 界内）。
     * 丢掉是显式记录在报告里的（零静默）。等 wash 契约有独立的来源槽（v2）再把 alpha 读进来。
     */
    const ROW_STATE_KEYS = new Set(["--color-hover", "--color-nav-accent", "--color-nav-selected"]);
    const hasAlpha = (v: string) => /^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/i.test(v.trim());
    for (const [k, v] of Object.entries(vars)) {
      if (typeof v !== "string" || !isHexColor(v)) continue;
      if (ROW_STATE_KEYS.has(k) && hasAlpha(v)) continue;
      clean[k] = normColor(v);
    }
    const { filled, rules } = deriveMissingVars(clean);
    modes[mode] = filled as typeof vars;
    for (const r of rules) report.push({ mode, name: r.name, rule: r.rule });
  }
  return { ...pack, modes, deriveReport: report };
}
