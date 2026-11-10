/**
 * 状态徽标（运行 / 已完成未读 / 失败，含绿点红点与呼吸动画）的偏好层（纯函数、无 IO）。
 *
 * 为什么要有它（2026-11-10 用户）：
 * > 「有一些数字呢，它是表示正在运行的 session，有一些已完成，有些未读……
 * >   这些呢，我希望其实也是可以单独去调整，比如说调整动画的效果、速率、范围、颜色；
 * >   白色主题和黑色主题都需要做适配，不然黑色主题下效果基本上就差太多了。」
 *
 * 两件事实（都实测过，写成代码后用断言锁住）：
 * 1. **深色 soft 底曾经比页面底还暗**（`#10263a` L*≈21 < 页面 `#292828` L*≈29）
 *    —— 浅色下 soft 底比底"浮"出来，深色下却"凹"进去，方向反了。所以深浅两套
 *    soft 都改为**从语义色派生**（色相必然同源、亮度方向必然向上）；
 * 2. 动画的周期（3s）与幅度（1.02 / 1.30）此前写死在 keyframes——数值出处没错
 *    （用户 2026-11-06 在 animlab 调定），但**没法定档调整**。这里把它们变成
 *    CSS 变量 + 可持久化偏好（`~/.lifeos/config/ui.json` 的 `badges` 键）。
 *
 * 参考机制（借的是结构，不是数值）：
 * - LobeChat Tag：alpha 分档填充（fillTertiary/quaternary）+ 同色文字（`src/Tag/Tag.tsx:67-76`）；
 * - novu Inbox：counter 底色与文字色是**成对的**用户可配变量
 *   （`docs/platform/inbox/configuration/styling.mdx:96-97` 的 `colorCounter` / `colorCounterForeground`）。
 */

/** 动效基准周期（用户 2026-11-06 在 animlab 调定 v5：3s，接近静息呼吸）。 */
export const BADGE_BASE_PERIOD_S = 3;
/** 幅度为 0（静止）到 v5 默认（0.667）之间时，徽标/圆点的最大scale（delta 线性插值）。 */
const BADGE_MAX_DELTA = 0.03;   // a=0.667 → ±.02（= v5 现值）
const DOT_MAX_DELTA = 0.45;     // a=0.667 → ±.30（= v5 现值）

export type BadgeStrength = "soft" | "standard" | "vivid";
export type BadgePrefs = { speed: number; amplitude: number; strength: BadgeStrength };

/** v5 现值作为默认档（用户已在实机看过并拍板，不改它的观感）。 */
export const BADGE_DEFAULTS: BadgePrefs = { speed: 1, amplitude: 0.667, strength: "standard" };

/** soft 底的强度三档：语义色混进页面底的比例（%）。深色整体抬高一档（底必须被页面"看得见"）。 */
/**
 * 三档混入比例（%）。**kind × mode × strength 逐格实测选定**（AA 物理约束，不是手感）：
 * - light 共用 [6, 10, 14]（最紧的 success #007845 在 14% 上 ≥4.5）；
 * - dark 的 danger 上界 L*70 亮红在自己的底上，mix=16% 就掉到 4.4 —— danger 单独 [8, 11, 14]；
 *   running/success 深色是亮字，可以到 20（vivid 20% 最低 4.80）。
 * 断言把整张表锁住（`test/badge-prefs.test.mjs` 5 预设 × 深浅 × 3 kind × 3 档）。
 */
const SOFT_ALPHA: Record<BadgeKind, Record<BadgeMode, Record<BadgeStrength, number>>> = {
  running: { light: { soft: 6, standard: 10, vivid: 14 }, dark: { soft: 10, standard: 14, vivid: 20 } },
  success: { light: { soft: 6, standard: 10, vivid: 14 }, dark: { soft: 10, standard: 14, vivid: 20 } },
  danger: { light: { soft: 6, standard: 10, vivid: 14 }, dark: { soft: 8, standard: 11, vivid: 14 } },
};

export type BadgeKind = "running" | "success" | "danger";
export type BadgeMode = "light" | "dark";
/** [R,G,B] 0-255 */
export type Rgb = [number, number, number];

/** sRGB 线性混合（等价 `color-mix(in srgb, base a%, surface)`，公式与浏览器一致：通道插值）。 */
export function mixOver(base: Rgb, surface: Rgb, alphaPercent: number): Rgb {
  const t = Math.min(1, Math.max(0, alphaPercent / 100));
  return [
    Math.round(base[0] * t + surface[0] * (1 - t)),
    Math.round(base[1] * t + surface[1] * (1 - t)),
    Math.round(base[2] * t + surface[2] * (1 - t)),
  ];
}

/** #rrggbb → [r,g,b]；非法输入收敛回黑（偏好层纪律：坏值不炸界面）。 */
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) return [0, 0, 0];
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb: Rgb): string {
  return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/**
 * 某一徽标在某主题模式、某强度下的 soft 底（hex）。
 * `baseHex` 是该状态的语义色（theme 引擎算出的 running/success/danger——色相跟主题走），
 * `surfaceHex` 是页面底。所有分支输入 → 输出单一实现（可穷举测试）。
 */
export function badgeSoft(kind: BadgeKind, mode: BadgeMode, strength: BadgeStrength, baseHex: string, surfaceHex: string): string {
  const alpha = SOFT_ALPHA[kind][mode][strength];
  return rgbToHex(mixOver(hexToRgb(baseHex), hexToRgb(surfaceHex), alpha));
}

/** 动画周期（秒）：speed ∈ [0.5, 2.5]，1 = v5 基准 3s。 */
export function badgePeriodS(speed: number): number {
  const s = Math.min(2.5, Math.max(0.5, speed));
  return Math.round((BADGE_BASE_PERIOD_S / s) * 100) / 100;
}

/** 徽标本体的最大 scale（amplitude ∈ [0,1]；a=0.667 时回到 v5 的 1.02）。 */
export function badgeBreatheMax(amplitude: number): number {
  const a = Math.min(1, Math.max(0, amplitude));
  return Math.round((1 + BADGE_MAX_DELTA * a) * 1000) / 1000;
}

/** 会话行小圆点的最大 scale（同上；a=0.667 → 1.30 = v5）。 */
export function dotBreatheMax(amplitude: number): number {
  const a = Math.min(1, Math.max(0, amplitude));
  return Math.round((1 + DOT_MAX_DELTA * a) * 1000) / 1000;
}

/** 写到 :root 的完整变量集（App 的 effect 唯一入口）。 */
export function badgeVarsOf(prefs: BadgePrefs): Record<string, string> {
  return {
    "--badge-motion-period": `${badgePeriodS(prefs.speed)}s`,
    "--badge-breathe-max": `${badgeBreatheMax(prefs.amplitude)}`,
    "--dot-breathe-max": `${dotBreatheMax(prefs.amplitude)}`,
  };
}

/** 解析（localStorage / ui.json 可能被手改坏）：逐字段钳制，字符缺失回默认。 */
export function parseBadges(raw: unknown): BadgePrefs {
  const value = (raw ?? {}) as Partial<BadgePrefs>;
  const speed = typeof value.speed === "number" && Number.isFinite(value.speed) ? value.speed : BADGE_DEFAULTS.speed;
  const amplitude = typeof value.amplitude === "number" && Number.isFinite(value.amplitude) ? value.amplitude : BADGE_DEFAULTS.amplitude;
  const strength: BadgeStrength =
    value.strength === "soft" || value.strength === "standard" || value.strength === "vivid" ? value.strength : BADGE_DEFAULTS.strength;
  return { speed: Math.min(2.5, Math.max(0.5, speed)), amplitude: Math.min(1, Math.max(0, amplitude)), strength };
}
