/**
 * 对话区的两个显示偏好：内容宽度 + 字号。
 *
 * 用户 2026-11-02 拍板：做成**两个滑块**（不是开关），放在顶部「完整历史 / 文件面板」两个图标旁边，
 * 点开设置弹层后各自调。语义分别是：
 * - 宽度：小 = 专注模式（正文列约 1/3 屏，像 Obsidian），大 = 取消上限铺满；
 * - 字号：整组字阶等比缩放，不是单点改某个 text-*。
 *
 * 为什么用"档位 + 系数"而不是直接存 px：
 * - 宽度要参与 layout.ts 的宽度预算（列宽、面板、聊天保底都在那里算），存 px 会让两套宽度打架；
 * - 字号必须整组缩放（micro/meta/body/content/title 一起），存单个 px 会破坏字阶间距。
 *
 * 纯函数，无 IO、无 DOM：单测覆盖（test/display-prefs.test.mjs）。
 */

/** 宽度档位：0 = 最窄（专注），100 = 不限（铺满）。中间线性插值。 */
export type WidthSetting = { mode: "limited" | "full"; value: number };

/** 字号档位：百分比，100 = 设计基准（tokens.css 现值）。 */
export type FontSetting = { scale: number };

export type DisplayPrefs = { width: WidthSetting; font: FontSetting };

/** 专注模式最窄正文列：约等于一屏 1/3（1920 → 640，1440 → 480，与 Obsidian 专注观感一致）。 */
export const FOCUS_MIN_RATIO = 1 / 3;
/** 设计基准的阅读上限（默认值就是它，也是"好读"的传统上限）。 */
export const READING_MAX_PX = 860;
/**
 * 宽度滑块的**最右端限宽**（而不是 READING_MAX_PX）。
 *
 * 为什么不能拿 READING_MAX_PX 当滑块终点（2026-11-02 实测 bug）：
 * 终点 860 时，整个滑块只跨 `专注(视口 1/3) → 860` 这一小段（1643 窗口下只有 548→860），
 * 于是拖到 858 之后 0.5% 直接跳到"铺满"，中间一片空白，感觉像 bug。
 * 现在把滑块铺满整个可用宽度：`专注 → 视口宽`，最后 0.5% 才落到"铺满(none)"。
 */
export function readingMaxForViewport(viewport: number): number {
  const focus = focusWidthOf(viewport);
  // 至少要比专注宽一档，否则小窗口下滑块退化成一点
  return Math.max(focus + 120, Math.round(viewport));
}
/** 专注宽度：视口的 1/3，不低于地板、不超过设计上限。 */
export function focusWidthOf(viewport: number): number {
  return Math.max(WIDTH_FLOOR_PX, Math.min(READING_MAX_PX, Math.round(viewport * FOCUS_MIN_RATIO)));
}
/**
 * 宽度滑块的最小值（px）：低于它一段话会频繁折行，不能再窄。
 * 取值依据：最窄 1/3 屏在 1280 窗口上是 427px，仍能放下 40 个中文字/行（15px 字号）。
 */
export const WIDTH_FLOOR_PX = 360;
/** 字号缩放范围：低于 85% 正文变小字；200% 是用户 2026-11-02 亲定的上限。 */
export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 2;

/**
 * 头像随字号缩放的尺寸（用户 2026-11-02：字号变大而头像不变会"畸形"）。
 * 只随字号放大，不随缩小（字号变小时头像保持可识别下限）；上下都封顶。
 */
export function avatarSizeOf(baseSize: number, scale: number): number {
  const factor = Math.min(1.6, Math.max(1, scale));
  return Math.round(baseSize * factor);
}

export const DEFAULT_PREFS: DisplayPrefs = {
  width: { mode: "limited", value: READING_MAX_PX },
  font: { scale: 1 },
};

/** 把任意输入收敛成合法偏好（坏值一律回默认，绝不抛）。 */
export function parsePrefs(raw: unknown): DisplayPrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PREFS;
  const record = raw as { width?: unknown; font?: unknown };
  const width = typeof record.width === "object" && record.width !== null ? record.width as Record<string, unknown> : {};
  const font = typeof record.font === "object" && record.font !== null ? record.font as Record<string, unknown> : {};
  const mode = width.mode === "full" ? "full" : "limited";
  const value = typeof width.value === "number" && Number.isFinite(width.value) ? width.value : READING_MAX_PX;
  const scale = typeof font.scale === "number" && Number.isFinite(font.scale) ? font.scale : 1;
  return {
    width: { mode, value: clampWidth(value) },
    font: { scale: clampScale(scale) },
  };
}

function clampWidth(value: number): number {
  // 上限放到"很宽"（不是 READING_MAX_PX）：存量值与滑块都靠这里收敛，
  // 真实可用宽度由容器自己决定（max-width 只是上限，不会把列拉宽）。
  return Math.min(WIDTH_CEILING_PX, Math.max(WIDTH_FLOOR_PX, Math.round(value)));
}

/** 宽度值的绝对上限（防脏数据写入天文数字；不参与滑块插值）。 */
export const WIDTH_CEILING_PX = 4000;

function clampScale(value: number): number {
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
  // 收两位小数：滑块精度足够，也避免 localStorage 里堆浮点噪声
  return Math.round(clamped * 100) / 100;
}

/**
 * 滑块的百分比位置 → 宽度设置。
 *
 * 档位语义（用户要的"滑轮"）：
 * - 0%：专注 —— 正文列 = 视口的 1/3（不低于 WIDTH_FLOOR_PX）
 * - 100%：铺满 —— mode = "full"，正文列没有上限，随容器走
 * - 中间：专注 → 视口宽 线性插值（此前终点误用 860，导致 858 之后直接跳到铺满）
 * - 中间：在"专注宽度"和"视口宽"之间线性插值（终点不再是 860，见 readingMaxForViewport 的说明）
 */
export function widthFromSlider(percent: number, viewport: number): WidthSetting {
  const p = Math.min(100, Math.max(0, percent)) / 100;
  // 最右端 = 铺满（无上限）；其余按 `专注 → 视口宽` 线性插值，中间有完整行程
  if (p >= 0.995) return { mode: "full", value: READING_MAX_PX };
  const focus = focusWidthOf(viewport);
  const max = readingMaxForViewport(viewport);
  const value = Math.round(focus + (max - focus) * p);
  return { mode: "limited", value: clampWidth(value) };
}

/** 反向：当前宽度设置 → 滑块百分比位置（用于把存量值显示成滑块位置）。 */
export function sliderFromWidth(width: WidthSetting, viewport: number): number {
  if (width.mode === "full") return 100;
  const focus = focusWidthOf(viewport);
  const max = readingMaxForViewport(viewport);
  if (max <= focus) return 100;
  const ratio = (width.value - focus) / (max - focus);
  return Math.round(Math.min(100, Math.max(0, ratio * 100)));
}

/** 字号滑块（85–130）→ 偏好。 */
export function fontFromSlider(percent: number): FontSetting {
  const scale = FONT_SCALE_MIN + (Math.min(100, Math.max(0, percent)) / 100) * (FONT_SCALE_MAX - FONT_SCALE_MIN);
  return { scale: clampScale(scale) };
}

/** 反向：偏好 → 滑块位置。 */
export function sliderFromFont(font: FontSetting): number {
  const ratio = (font.scale - FONT_SCALE_MIN) / (FONT_SCALE_MAX - FONT_SCALE_MIN);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/**
 * 字号档位落到 CSS 变量：整组等比缩放，**基准值来自 tokens.css**（这里不写死 px）。
 *
 * 返回的是要覆盖到根节点上的自定义属性；例如 scale=1.1 时
 * `--text-body` 变成 `calc(13.5px * 1.1)` —— 用 calc 而不是算好数字，
 * 是为了 tokens.css 改基准值时这里自动跟随，不产生第二份数值。
 */
export function fontVars(font: FontSetting): Record<string, string> {
  const scale = String(clampScale(font.scale));
  return {
    "--text-scale": scale,
    "--text-micro": `calc(var(--text-micro-base) * ${scale})`,
    "--text-meta": `calc(var(--text-meta-base) * ${scale})`,
    "--text-body": `calc(var(--text-body-base) * ${scale})`,
    "--text-content": `calc(var(--text-content-base) * ${scale})`,
    "--text-title": `calc(var(--text-title-base) * ${scale})`,
  };
}

/** 宽度偏好落到 CSS 变量：铺满时用 `none`（无上限），限定时给 px。 */
export function widthVar(width: WidthSetting): string {
  return width.mode === "full" ? "none" : `${width.value}px`;
}

/** 宽度滑块的可访问名（无障碍 + 测试共用一份文案）。 */
export function widthLabel(width: WidthSetting): string {
  return width.mode === "full" ? "内容宽度：铺满" : `内容宽度：${width.value}px`;
}

/** 字号滑块的可访问名。 */
export function fontLabel(font: FontSetting): string {
  return `字号：${Math.round(font.scale * 100)}%`;
}
