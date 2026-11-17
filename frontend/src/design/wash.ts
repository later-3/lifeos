/**
 * wash 层（Task 0017 · P2 / 决策 D1：**状态薄涂允许 alpha**）。
 *
 * ## 这个文件解决什么
 *
 * 设计系统里有两类颜色，我们此前压成了一类：
 *
 * | 类 | 语义 | 例子 | 契约 |
 * |---|---|---|---|
 * | **fill** | 承载文字的**实底** | `surface` / `nav-bg` / 计数药丸 / 气泡 | 不透明；必须与前景满足 AA |
 * | **wash** | 叠在宿主上的**状态薄涂** | 行 hover / 行选中 / 药丸底 | 允许 alpha；只需「能从宿主里认出」 |
 *
 * 只有 fill 时，`--color-nav-accent` 一个 token 要背六个绘制职责（行悬停 / 覆盖层板 /
 * 计数药丸 / 分组头悬停 / 设置导航悬停 / 列头计数）。**一个 token 画两层，就必然要求
 * 两层逐字节相等** —— 这是 2026-11-16 那两张截图里「竖缝 + 上下缺口」的物理成因。
 *
 * wash 用 alpha 之后，子层叠在父层上自动合成，不存在「必须相等」的刚性要求。
 *
 * ## 为什么还要「收敛」而不只是「允许 alpha」
 *
 * 用户第一张截图：Quiet Light 的选中底是 `#c4d9b1`（荧光绿）。它不是我们设计的，是
 * VSCode 的 `list.activeSelectionBackground` 被直连成 `--color-nav-selected` 的结果。
 * 实测（本文件下面那张表的同一套量法）：
 *
 * | 主题 | nav-selected 的 OKLCH chroma |
 * |---|---|
 * | 内置 5 预设 × 深浅（10 组） | 0.0032 – **0.0121** |
 * | Quiet Light | **0.0585**（= 内置上界的 4.8 倍） |
 * | Monokai | 0.0288 |
 *
 * 压在这个底上的东西全部失真（running 光环实测 `#a7b6b4`，对底 1.39:1 —— 蓝绿相消成一坨灰泥；
 * 未读绿点 3.77:1 且**同色相叠同色相**）。
 *
 * 所以 wash 的 alpha **不是手感调出来的**，而是从「我们自己的引擎在 5 个预设 × 深浅下
 * 实际产出的 chroma 区间」反解出来的：外部主题的饱和度超出这个区间时，按比例降低 alpha，
 * 让**合成后**的 chroma 回到区间内。区间来自 `calculatePalette` 的实测，不是新造的数字
 * （协议 3.13：限制必须有参考或实测）。
 *
 * 内置主题的 chroma 本来就在区间内 → alpha = 1 → **合成结果与改造前逐字节相同**
 * （P3/P5/P6 的「视觉零变化」门因此仍然成立）。
 */
import { themeWashEnvelope } from "./theme.ts";

export type Rgba = { r: number; g: number; b: number; a: number };

/** `#rrggbb` 或 `#rgba`/`#rrggbbaa` → 通道值。非法输入收敛为透明黑（偏好层纪律：坏值不炸界面）。 */
export function parseColor(value: string): Rgba {
  const raw = value.trim().replace("#", "");
  const expand = (s: string) => (s.length === 1 ? s + s : s);
  if (!/^[0-9a-fA-F]+$/.test(raw) || (raw.length !== 3 && raw.length !== 4 && raw.length !== 6 && raw.length !== 8)) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (raw.length <= 4) {
    const [r, g, b, a] = raw.split("").map(expand);
    return {
      r: Number.parseInt(r ?? "0", 16), g: Number.parseInt(g ?? "0", 16), b: Number.parseInt(b ?? "0", 16),
      a: a === undefined ? 1 : Number.parseInt(a, 16) / 255,
    };
  }
  const hexAt = (i: number) => Number.parseInt(raw.slice(i, i + 2), 16);
  return { r: hexAt(0), g: hexAt(2), b: hexAt(4), a: raw.length === 8 ? hexAt(6) / 255 : 1 };
}

/** OKLCH 的 L 与 chroma（色相不需要：我们只判"饱和度是否超界"）。 */
export function oklchOf({ r, g, b }: Rgba): { L: number; c: number } {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
  const m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
  const s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
  const l3 = Math.cbrt(l), m3 = Math.cbrt(m), s3 = Math.cbrt(s);
  const L = 0.2104542553 * l3 + 0.7936177850 * m3 - 0.0040720468 * s3;
  const a = 1.9779984951 * l3 - 2.4285922050 * m3 + 0.4505937099 * s3;
  const bb = 0.0259040371 * l3 + 0.7827717662 * m3 - 0.8086757660 * s3;
  return { L, c: Math.hypot(a, bb) };
}

/** 把 wash 合成到宿主上（与浏览器 `color-mix` 的 sRGB 通道插值同式）。 */
export function compositeOver(wash: Rgba, host: Rgba): Rgba {
  const t = Math.min(1, Math.max(0, wash.a));
  return {
    r: Math.round(wash.r * t + host.r * (1 - t)),
    g: Math.round(wash.g * t + host.g * (1 - t)),
    b: Math.round(wash.b * t + host.b * (1 - t)),
    a: 1,
  };
}

/**
 * 求 wash 的 alpha：让「wash 合成在宿主上」之后的 chroma **不超过** `maxChroma`。
 *
 * - 本身已在界内 → 返回 1（内置主题走这条，合成结果与实底完全相同 = 视觉零变化）；
 * - 超界 → 二分出最大的合法 alpha（保留色相，只降饱和：Quiet Light 的绿会变成淡绿）。
 *
 * 为什么"二分"而不是解析解：合成在 sRGB 通道上做，chroma 是 OKLab 里的非线性量，
 * 没有闭式解。20 次二分的精度是 1e-6，足够。
 */
export function washAlphaFor(fill: string, host: string, maxChroma: number): number {
  const fillRgba = parseColor(fill);
  const hostRgba = parseColor(host);
  const solid = { ...fillRgba, a: 1 };
  if (oklchOf(solid).c <= maxChroma) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (oklchOf(compositeOver({ ...solid, a: mid }, hostRgba)).c <= maxChroma) lo = mid;
    else hi = mid;
  }
  /*
   * **向下取整到 0.1%，不用 round**：`round` 会把 alpha 往上抬最多 0.05%，
   * 于是"刚好卡在上界"的合成色会**微超界** —— 断言就会在边界上随机红绿（假红）。
   * 用 floor 保证"写出去的 alpha 一定满足约束"，代价是最多淡 0.1%（不可见）。
   */
  return Math.max(0, Math.min(1, Math.floor(lo * 1000) / 1000));
}

/** 写进 `:root` 的字符串（`color-mix` 用它做百分比）。alpha 保留 3 位小数，足够且稳定。 */
export const alphaVar = (alpha: number): string => `${Math.round(alpha * 1000) / 10}%`;

/**
 * 三个 wash 的 α 变量名。**值为百分比字符串**，由 `tokens.css` 的
 * `--color-wash-*: color-mix(in srgb, var(--fill) var(--wash-*-alpha), transparent)` 消费。
 */
export type WashTheme = {
  /** 行/控件的悬停薄涂（基线 = nav-accent，宿主 = nav-bg） */
  hover: string;
  /** 行选中薄涂（基线 = nav-selected，宿主 = nav-bg） */
  selected: string;
  /** 计数药丸 / chip 薄涂（基线 = sunken，宿主 = nav-bg） */
  chip: string;
};

/**
 * 从当前的 fill 值算出三个 wash 的 alpha（纯函数）。
 * `fills` 是"主题此刻真正生效的实底值"——引擎派生的或外部主题包覆盖的都行，
 * 所以内置与外部走**同一条**收敛逻辑，不存在"外部主题特判"。
 */
export function washAlphasOf(fills: { navAccent: string; navSelected: string; sunken: string; navBg: string }, mode: "light" | "dark"): WashTheme {
  const envelope = themeWashEnvelope(mode);
  return {
    hover: String(washAlphaFor(fills.navAccent, fills.navBg, envelope.hover)),
    selected: String(washAlphaFor(fills.navSelected, fills.navBg, envelope.selected)),
    chip: String(washAlphaFor(fills.sunken, fills.navBg, envelope.chip)),
  };
}

/** 便于测试与文档引用：内置引擎在 5 预设 × 深浅下实际产出的 chroma 区间（实测值）。 */
export { themeWashEnvelope as WASH_ENVELOPE };
