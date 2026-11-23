/**
 * 内容流卡片的**纯函数层**（Task 0023 · S1 第 4 块）。
 *
 * 契约唯一来源：`0009/knowledge/design/feed-post-contract.md`（8 kind / 媒体网格 5 档 / 卡片视觉规格）。
 * 这里只放"输入 → 显示结论"的判定，组件只负责画（`views/workbench-feed.tsx` 里没有 if 链）。
 *
 * ## 为什么色相不是照抄契约的序号
 *
 * 契约 §5 给的是**色相序号**（dev 221 / mood 300 / review 35 / knowledge 262 / case 12 / demo 158）
 * ＋ demo 里每种类型的示例 hex。那些序号是 **HSL** 语义（221 = 蓝），而本项目主题引擎是 **OKLCH**
 * ——照抄序号会让「开发」徽标从蓝变青（观感变化，用户审核过的是蓝）。
 * 所以基准取契约里的**示例 hex**，反解成 OKLCH 色相（dev 264 / demo 157 / knowledge 304 /
 * case 37 / review 69 / mood 324），亮度与彩度按本项目规则算（浅色 fg L*40 / soft L*96.4，
 * 深色 fg L*76 / soft L*24）。推导与对比度实测见 `0023/evidence/feed-kind-hue-probe.txt`。
 *
 * `study` / `media` 契约标「待定」——**不编色相**，走中性 chip（有数据才渲染，不假装有设计）。
 *
 * ## 为什么类名是字面量
 *
 * Tailwind 只生成"源码里出现过"的类。所以这张表里每个类名都是完整字面量（不做字符串拼接），
 * `feedDev`/`bg-feed-dev-soft` 这类写法才能被扫到并生成 utility。
 */

export type FeedKind = "dev" | "demo" | "knowledge" | "case" | "review" | "mood" | "study" | "media";

/** 卡型 → 显示名 + chip 配色（类名全是字面量，Tailwind 可扫）。 */
export const FEED_KIND_META: Record<FeedKind, { label: string; chip: string }> = {
  dev: { label: "开发", chip: "bg-feed-dev-soft text-feed-dev" },
  demo: { label: "演示", chip: "bg-feed-demo-soft text-feed-demo" },
  knowledge: { label: "知识", chip: "bg-feed-knowledge-soft text-feed-knowledge" },
  case: { label: "案例", chip: "bg-feed-case-soft text-feed-case" },
  review: { label: "检视", chip: "bg-feed-review-soft text-feed-review" },
  mood: { label: "随想", chip: "bg-feed-mood-soft text-feed-mood" },
  // 契约 §2 标「预留」的两种：无色相（不编），与未知 kind 同一档
  study: { label: "学习", chip: "bg-hover text-ink-700" },
  media: { label: "运营", chip: "bg-hover text-ink-700" },
};

/** 未知/缺失 kind 的中性 chip（architect S1 回应③：kind 缺失必须能渲染）。 */
const NEUTRAL_KIND = { label: "动态", chip: "bg-hover text-ink-700" };

export function kindMetaOf(kind: FeedKind | undefined): { label: string; chip: string } {
  if (kind === undefined) return NEUTRAL_KIND;
  return FEED_KIND_META[kind] ?? NEUTRAL_KIND;
}

/* ══════════════ 媒体网格（契约 §4：5 档）══════════════ */

export type MediaTier = "n1" | "n2" | "n3" | "n4" | "nmany";

/** 媒体数量 → 档位（1 / 2 / 3 = 1 大 2 小 / 4 = 2×2 / 5+ = 三列 +N）。 */
export function mediaTierOf(count: number): MediaTier | undefined {
  if (count <= 0) return undefined;
  if (count === 1) return "n1";
  if (count === 2) return "n2";
  if (count === 3) return "n3";
  if (count === 4) return "n4";
  return "nmany";
}

/**
 * 网格容器类（契约 §4 的五行实现）。
 *
 * - `n1` 16:9 单图；`n2` 16:9 双列；`n4` 2×2；`nmany` 三列 1:1；
 * - `n3` 的 `1.6fr 1fr` 无法用整数栅格表达，取 `grid-cols-5` = 3:2（1.5），
 *   首图 `col-span-3 row-span-2` —— 视觉与契约的「1 大 2 小」同构，且不写任意值（lint:tokens 禁 `grid-cols-[...]`）。
 */
export const MEDIA_GRID_CLASS: Record<MediaTier, string> = {
  n1: "grid grid-cols-1",
  n2: "grid grid-cols-2 gap-1",
  n3: "grid grid-cols-5 grid-rows-2 gap-1",
  n4: "grid grid-cols-2 grid-rows-2 gap-1",
  nmany: "grid grid-cols-3 gap-1",
};

/** 每一格自己的类（`n3` 的首图跨两行两列 3/5 宽；`nmany` 每格 1:1）。 */
export function mediaCellClassOf(tier: MediaTier, index: number): string {
  if (tier === "n3") {
    return index === 0 ? "col-span-3 row-span-2" : "col-span-2";
  }
  return "";
}

/** 容器的宽高比档（`aspect-video` = 16:9；`nmany` 不锁整体比例，由每格 1:1 决定）。 */
export function mediaFrameClassOf(tier: MediaTier): string {
  return tier === "nmany" ? "" : "aspect-video";
}

/** 媒体区展示哪几格：5+ 只画前 4 格 + 「+N」角标（契约 §4）。 */
export function visibleMediaOf<T>(items: T[]): { shown: T[]; overflow: number } {
  if (items.length <= 4) return { shown: items, overflow: 0 };
  return { shown: items.slice(0, 4), overflow: items.length - 4 };
}

/* ══════════════ 卡内富块（契约 §3 的 blocks）══════════════ */

/**
 * 柱状图的柱高：契约 §3 的三元组是 `[label, value, heightPercent]` —— **第三个已经是百分比**
 * （demo 里直接 `style="height:${h}%"` 用），所以这里只做 0–100 的钳制，不做"归一到最大值"：
 * 归一会让「P0 = 0%」和「质量 = 42%」的相对高度随同批数据变化，读图的人失去绝对标尺。
 *
 * `muted` 是**契约的独立字段**（下标列表，如 `[0,3]`，标"这几根不强调"）——它不等于"值为 0"：
 * 混为一谈会让「P0 命中 0 但需要被看见」的柱子被降级成灰色，同时让「质量 2 条但要弱化」的柱子
 * 变成主色（语义被数值偷换）。测试 S1-W24 锁住这条。
 */
export function chartBarsOf(
  bars: Array<[string, number, number]>,
  muted: number[] = [],
): Array<{ label: string; value: number; percent: number; muted: boolean }> {
  return bars.map(([label, value, height], index) => ({
    label,
    value,
    percent: Math.min(100, Math.max(0, Math.round(height))),
    muted: muted.includes(index),
  }));
}

/** 进度条宽度（%）：`progress` 是 0–1 的契约字段；缺失/越界都收敛到 0–100。 */
export function progressPercentOf(progress: number | undefined): number {
  if (progress === undefined || !Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, Math.round(progress * 100)));
}

/** 正文是否截断（有媒体时两行截断，契约 §5「有图卡正文两行截断」）。 */
export function textClampedOf(mediaCount: number): boolean {
  return mediaCount > 0;
}

/** 检视闭环文案（`closed/total`，契约 §3 refs.review）。 */
export function reviewSummaryOf(review: { closed: number; total: number; note?: string }): string {
  return `${review.note ?? "检视"} ${review.closed}/${review.total}`;
}
