/**
 * 工作台内容流的卡片（Task 0023 · S1 第 4 块）。
 *
 * 契约唯一来源：`0009/knowledge/design/feed-post-contract.md`（8 kind / 媒体网格 5 档 / 视觉规格）。
 * 本文件只负责**画**；所有"该显示什么"的判定在 `api/feed-cards.ts`（纯函数，可穷举测试）。
 *
 * ## 视觉值从哪来（frontend 2.8：组件不写字面量）
 *
 * - 颜色 → `tokens.css` 的 `--color-feed-<kind>` / `-soft`（色相来自契约示例 hex 的反解，
 *   亮度彩度按本项目规则算；推导见 `0023/evidence/feed-kind-hue-probe.txt`）；
 * - 圆角 → `--radius-panel`（10，卡片档；契约写的 18 不在本项目圆角阶里，
 *   按 2.8「数值只进 tokens」取最接近的既有档，漂移记在回执的偏离清单）；
 * - 阴影 → `SURFACE.card` 的 `--surface-card`（契约的"双层投影"由本项目的 `--surface-card` 表达；
 *   2.22 规定浮层外观只能从 design/surface.ts 取，不写 Tailwind shadow-*）；
 * - 间距 → 4 网格的 Tailwind 档；宽度/上限 → 走 flex/grid，不写 px。
 *
 * ## 桩纪律
 *
 * 每张卡都带「示例」徽标（`_stub: true`）——**卡型做全了也还是桩**，这正是假数据最容易混成真的时刻。
 * 桩媒体画占位框（不加载假 URL，假 `<img>` 会破图）；点赞/评论点了只给 toast（S4 才接真）。
 */
import type { ReactNode } from "react";
import { useToast } from "../design/toast";
import { AppIcon } from "../design/icons";
import { EmptyState, MicroButton, Skeleton } from "../design/ui";
import { SURFACE } from "../design/surface";
import { AgentAvatar } from "./agent-avatar";
import { UserAvatar } from "./user-avatar";
import type { Agent, UserProfile } from "../hooks/types";
import {
  chartBarsOf, kindMetaOf, mediaCellClassOf, mediaFrameClassOf, mediaTierOf, progressPercentOf,
  reviewSummaryOf, textClampedOf, visibleMediaOf, MEDIA_GRID_CLASS,
} from "../api/feed-cards";
import {
  dayLabelOf, filterFeedOf, groupFeedByDay,
  type FeedBlock, type FeedItem,
} from "../api/workbench";

/**
 * 卡片外观 = `SURFACE.card` 的配方（2.22：浮层/卡片外观只能从 design/surface.ts 取）。
 *
 * **偏离记录**：契约 §5 写「圆角 18 + 双层投影」，18 不在本项目圆角阶
 *（inner 4 / control 6 / row 8 / panel 10 / bubble 14 / full），按 2.8「数值只进 tokens」
 * 取最接近的既有档 `--radius-panel`（10）；投影用 `--surface-card`（描边影 + 柔影，
 * 深浅色各一套，深色带白色微描边）——正是契约"双层投影"在本项目表达里的等价物。
 */
const SURFACE_CARD_STYLE = { borderRadius: "var(--radius-panel)", boxShadow: SURFACE.card.shadow };

/* ══════════════════ 小件 ══════════════════ */

/** 「示例」徽标：桩卡的唯一视觉标（S4 桩清零时整卡随 STUB_FEED 一起消失）。 */
export function StubBadge() {
  return (
    /* 「示例」是**标记**不是链接：底 accent-soft + 深字 ink-900（全预设 ≥9.96）。
       不用 text-accent：accent on accent-soft 在 5 预设浅色下只有 4.22–4.35 < 4.5（axe 实测 4.28）。 */
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-accent-soft px-2 text-micro font-medium text-ink-900">
      示例
    </span>
  );
}

/** 卡型徽标：色相由 `kindMetaOf` 给（8 kind；未知/缺失走中性）。 */
function KindChip({ kind }: { kind: FeedItem["kind"] }) {
  const meta = kindMetaOf(kind);
  return (
    <span className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-micro font-medium ${meta.chip}`}>
      {meta.label}
    </span>
  );
}

/**
 * 作者头像：真实作者用真头像；桩作者按 id 从 agents 里认领，认领不到走首字母（AgentAvatar 自带）。
 * story 环（契约 §5「36px 真图 + story 环」）= 外层 2px surface + 1px accent。
 */
function AuthorAvatar({ item, agents, profile }: { item: FeedItem; agents: Agent[]; profile?: UserProfile }) {
  const inner = item.author.kind === "user"
    ? (profile === undefined
      ? <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-hover" aria-hidden="true" />
      : <UserAvatar profile={profile} size={32} />)
    : (() => {
      const known = agents.find((agent) => agent.id === item.author.id);
      return <AgentAvatar id={item.author.id} name={known?.name ?? item.author.name}
        {...(known?.avatar !== undefined ? { avatar: known.avatar } : {})} size={32} />;
    })();
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface ring-1 ring-accent">
      {inner}
    </span>
  );
}

/* ══════════════════ 媒体网格（契约 §4：5 档）══════════════════ */

function MediaGrid({ items }: { items: NonNullable<FeedItem["media"]> }) {
  const tier = mediaTierOf(items.length);
  if (tier === undefined) return undefined;
  const { shown, overflow } = visibleMediaOf(items);
  return (
    <div className="mt-2.5 overflow-hidden" data-testid="workbench-feed-media" data-media-tier={tier}>
      <div className={`${MEDIA_GRID_CLASS[tier]} ${mediaFrameClassOf(tier)}`}>
        {shown.map((media, index) => (
          <div key={index}
            className={`relative flex items-center justify-center overflow-hidden bg-hover text-ink-300 ${mediaCellClassOf(tier, index)} ${
              tier === "nmany" ? "aspect-square" : ""
            }`}
            /* 桩媒体 = 占位框（不喂假 URL）；caption 走 title，不假装是图 */
            title={media.caption ?? "示例媒体占位"}>
            <AppIcon name={media.kind === "video" ? "photo" : "photo"} size={16} />
            {media.kind === "video" && (
              <span aria-hidden className="absolute text-ink-500">
                <AppIcon name="chevron-right" size={18} />
              </span>
            )}
            {media.caption !== undefined && (
              <span className="absolute bottom-1 left-1 min-w-0 max-w-full truncate rounded-full bg-surface px-2 py-0.5 text-micro text-ink-700 ring-1 ring-line">
                {media.caption}
              </span>
            )}
            {overflow > 0 && index === shown.length - 1 && (
              <span className="absolute right-1 top-1 rounded-full bg-surface px-1.5 py-0.5 text-micro font-semibold text-ink-900 ring-1 ring-line">
                +{overflow}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════ 卡内富块（契约 §3 blocks）══════════════════ */

function BlockView({ block }: { block: FeedBlock }) {
  if (block.type === "code") {
    return (
      <div className="mt-2.5 overflow-hidden rounded-panel ring-1 ring-line" data-testid="workbench-feed-block-code">
        <div className="flex items-center gap-2 bg-sunken px-3 py-1.5 text-micro text-ink-500">
          <AppIcon name="file-text" size={12} />
          <span className="min-w-0 truncate">{block.file}</span>
          <span className="ml-auto shrink-0 font-mono">{block.lang}</span>
        </div>
        <pre className="overflow-x-auto bg-sunken px-3 py-2 font-mono text-micro leading-relaxed text-ink-700"><code>{block.code}</code></pre>
      </div>
    );
  }
  if (block.type === "diagram") {
    return (
      <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2 rounded-panel bg-sunken p-3 ring-1 ring-line"
        data-testid="workbench-feed-block-diagram">
        {block.nodes.map((node, index) => (
          <span key={`${node.t}-${index}`} className="flex items-center gap-2">
            <span className={`rounded-control bg-surface px-2.5 py-1.5 text-micro ring-1 ${
              node.accent === true ? "text-accent ring-accent" : "text-ink-900 ring-line"
            }`}>{node.t}</span>
            {index < block.nodes.length - 1 && <span aria-hidden className="text-ink-300">→</span>}
          </span>
        ))}
      </div>
    );
  }
  const bars = chartBarsOf(block.bars, block.muted ?? []);
  return (
    <div className="mt-2.5 overflow-hidden rounded-panel ring-1 ring-line" data-testid="workbench-feed-block-chart">
      <div className="flex items-center gap-2 bg-sunken px-3 py-1.5 text-micro text-ink-700">
        <span aria-hidden>◔</span>
        <span className="min-w-0 truncate">{block.title}</span>
      </div>
      <div className="flex items-end gap-2.5 px-3 py-3" style={{ height: "5rem" }}>
        {bars.map((bar) => (
          <span key={bar.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span aria-hidden className={`w-full rounded-t-inner ${bar.muted ? "bg-ink-300" : "bg-accent"}`}
              style={{ height: `${bar.percent}%` }} />
            <span className="text-micro text-ink-500">{bar.label} {bar.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════ 上下文 / 进度 ══════════════════ */

function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-6 items-center rounded-inner bg-sunken px-2 text-micro text-ink-700 ring-1 ring-line">{children}</span>;
}

function ContextRow({ item }: { item: FeedItem }) {
  const chips = [
    item.projectId !== undefined ? <Chip key="project">{item.projectId}</Chip> : undefined,
    item.task !== undefined
      ? <Chip key="task">{item.task.id} {item.task.title}</Chip>
      : undefined,
    item.worktree !== undefined ? <Chip key="worktree"><span aria-hidden>🌿</span> {item.worktree}</Chip> : undefined,
    item.review !== undefined
      ? <Chip key="review"><span aria-hidden>✅</span> {reviewSummaryOf(item.review)}</Chip>
      : undefined,
  ].filter((chip) => chip !== undefined);
  if (chips.length === 0) return undefined;
  return <div className="mt-2.5 flex flex-wrap gap-1.5">{chips}</div>;
}

function DocsRow({ docs }: { docs: NonNullable<FeedItem["docs"]> }) {
  return (
    <div className="mt-2.5 space-y-1">
      {docs.map((doc) => (
        <div key={doc.name} className="flex items-center gap-2.5 rounded-control bg-sunken px-2.5 py-1.5 ring-1 ring-line">
          <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-accent-soft text-body">{doc.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-micro text-ink-900">{doc.name}</span>
            <span className="block truncate text-micro text-ink-500">{doc.sub}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function ProgressRow({ task }: { task: NonNullable<FeedItem["task"]> }) {
  if (task.progress === undefined) return undefined;
  const percent = progressPercentOf(task.progress);
  return (
    <div className="mt-2 flex items-center gap-2 text-micro text-ink-500" data-testid="workbench-feed-progress">
      <span className="shrink-0">进度</span>
      <span aria-hidden className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-hover">
        <span className={`block h-full ${percent >= 100 ? "bg-success" : "bg-accent"}`} style={{ width: `${percent}%` }} />
      </span>
      <span className="shrink-0">{task.progressLabel ?? `${percent}%`}</span>
    </div>
  );
}

/** 点赞人行（契约 §5：叠放 16px 头像 + 「N 人觉得很赞」）。S1 不造假头像 URL，用色块首字母。 */
function LikersRow({ likers, likes, agents }: { likers: string[]; likes: number; agents: Agent[] }) {
  const shown = likers.slice(0, 4);
  return (
    <div className="mt-2 flex items-center gap-1.5 px-3.5 text-micro text-ink-700" data-testid="workbench-feed-likers">
      <span className="flex">
        {shown.map((id, index) => {
          const known = agents.find((agent) => agent.id === id);
          return (
            <span key={`${id}-${index}`} className={index === 0 ? "" : "-ml-1.5"} title={known?.name ?? id}>
              <AgentAvatar id={id} name={known?.name ?? id}
                {...(known?.avatar !== undefined ? { avatar: known.avatar } : {})} size={16} />
            </span>
          );
        })}
      </span>
      <span><span className="font-semibold text-ink-900">{likes}</span> 人觉得很赞</span>
    </div>
  );
}

/* ══════════════════ 卡片 ══════════════════ */

/** 正文里 `<sticker>x</sticker>` → 行内 30px 表情（契约 §5「正文表情包 inline 30px」）。 */
function bodyNodesOf(item: FeedItem): ReactNode {
  if (item.sticker !== true) return item.text;
  const parts = item.text.split(/(<sticker>[\s\S]*?<\/sticker>)/g);
  return parts.map((part, index) => {
    const hit = /^<sticker>([\s\S]*?)<\/sticker>$/.exec(part);
    if (hit === null) return <span key={index}>{part}</span>;
    return <span key={index} aria-hidden className="mx-0.5 inline-block align-middle text-title leading-none">{hit[1]}</span>;
  });
}

/**
 * 一张卡。
 *
 * 布局顺序按契约 §5：头（头像/名字/心情/类型/时间）→ 标题/正文 → 媒体 → 富块 → 文档卡 →
 * 上下文 chips → 进度 → 点赞人行 → 动作行 → 标签行。缺什么不渲染什么（`有数据才渲染`）。
 */
function FeedCard({ item, agents, profile, onPlaceholderAction }: {
  item: FeedItem; agents: Agent[]; profile?: UserProfile;
  onPlaceholderAction: () => void;
}) {
  const media = item.media ?? [];
  const clamped = textClampedOf(media.length);
  return (
    <article className="overflow-hidden bg-surface" data-testid="workbench-feed-card"
      data-kind={item.kind ?? "none"}
      style={SURFACE_CARD_STYLE}>
      <header className="flex items-center gap-2 px-3.5 pt-3">
        <AuthorAvatar item={item} agents={agents} profile={profile} />
        <span className="min-w-0 truncate text-body font-semibold text-ink-900">{item.author.name}</span>
        {item.mood !== undefined && <span aria-hidden className="shrink-0 text-body">{item.mood}</span>}
        <KindChip kind={item.kind} />
        {/* 只有真桩才戴「示例」（P2-2：无条件渲染会让 S2 的真卡也戴） */}
        {item._stub === true && <StubBadge />}
      </header>
      <div className="px-3.5 pb-1 pt-2">
        {item.title !== undefined && item.title !== "" && (
          <h3 className="mb-1 text-content font-semibold leading-snug text-ink-900">{item.title}</h3>
        )}
        <p className={`text-content leading-relaxed text-ink-900 ${clamped ? "line-clamp-2" : ""}`}>{bodyNodesOf(item)}</p>
      </div>
      {media.length > 0 && <div className="px-0"><MediaGrid items={media} /></div>}
      <div className="px-3.5">
        {(item.blocks ?? []).map((block, index) => <BlockView key={index} block={block} />)}
        {item.docs !== undefined && <DocsRow docs={item.docs} />}
        <ContextRow item={item} />
        {item.task !== undefined && <ProgressRow task={item.task} />}
      </div>
      {item.likers !== undefined && item.likers.length > 0 && (
        <LikersRow likers={item.likers} likes={item.likes} agents={agents} />
      )}
      {/* 动作行（契约 §5：4 等距）。桩上点了给 toast，不装作能用。
          S1 用**纯文字标签**：图标库里没有 ♡/↗/⛉（不为此扩 icon 集），文字本身已表意。 */}
      <div className="flex items-center px-2.5 py-1.5" data-testid="workbench-feed-actions">
        {[
          { key: "comment", label: `评论 ${item.comments}` },
          { key: "like", label: `赞 ${item.likes}` },
          { key: "share", label: "转发" },
          { key: "save", label: "收藏" },
        ].map((action) => (
          <button key={action.key} type="button" onClick={onPlaceholderAction}
            className="flex min-h-11 flex-1 items-center justify-center rounded-control text-micro text-ink-500 transition-colors hover:bg-hover hover:text-ink-900 sm:min-h-7">
            <span>{action.label}</span>
          </button>
        ))}
      </div>
      {item.tags.length > 0 && (
        <p className="px-3.5 pb-3 text-micro text-ink-500">
          {item.tags.map((tag) => <span key={tag} className="mr-2">#{tag}</span>)}
        </p>
      )}
    </article>
  );
}

export function FeedView({ feed, tab, agentFilter, agents, profile, today, loading, onClearFilter }: {
  feed: FeedItem[];
  tab: "all" | "post" | "todo";
  agentFilter: string | undefined;
  agents: Agent[];
  profile?: UserProfile;
  today: string;
  /** 还没就绪（首帧）：画骨架，不写"还没有内容"的结论（规范 2.32）。 */
  loading: boolean;
  /** 清除作者筛选（stories 选中态的另一半；筛选态只在这一处显示入口）。 */
  onClearFilter: () => void;
}) {
  const toast = useToast();
  const placeholderAction = () => toast("这条是示例——点赞 / 评论在 S4 接真数据", "success");
  const filterName = agentFilter === undefined
    ? undefined
    : agentFilter === "me" ? "我" : (agents.find((agent) => agent.id === agentFilter)?.name ?? agentFilter);
  /** 筛选 chip：骨架与空态**都要**可见（否则筛出一个空结果时没有出口，用户被困住）。 */
  const clearChip = filterName !== undefined ? (
    <span className="mb-2.5 inline-flex">
      <MicroButton tone="accent" onClick={onClearFilter} data-testid="workbench-clear-filter">
        只看 {filterName} ×
      </MicroButton>
    </span>
  ) : undefined;
  if (loading) {
    return <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3.5 py-3" data-testid="workbench-feed-loading"><Skeleton rows={5} /></div>;
  }
  const items = filterFeedOf(feed, tab, agentFilter);
  if (items.length === 0) {
    const who = filterName;
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3.5 py-3" data-testid="workbench-feed-empty">
        {clearChip}
        <EmptyState
          title={tab === "todo" ? "待办还没有数据（S3 接入）" : who !== undefined ? `${who} 还没有任何内容` : "还没有内容"}
          hint={tab === "todo" ? "用户待办是 S3 的范围；现在的待办都在各 Agent 的 todo/ 里。" : undefined} />
      </div>
    );
  }
  const groups = groupFeedByDay(items);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3.5 py-3" data-testid="workbench-feed">
      {/*
        **阅读宽度**（Task 0023 · S1-contract §R6，用户 2026-11-23 拍板）：
        内容流是「逐条读」，行太长眼睛回行会丢位置 → 卡片列复用**对话区同一个设置**
        `max-w-reading`（= `max-width: var(--container-reading)`，由 display-prefs 的宽度滑块
        写 `--container-reading-width`）。**没有第二个滑块 / 第二个存储字段 / 第二个变量**；
        拖到「铺满」时 `widthVar()` 给 `none`，这里自然铺满（与对话区行为一致）。

        看板**不加**这个上限（它是"横向扫状态分布"，限宽会把三列挤到一起）——
        两种宽度需求相反，用同一个值套整列必然一边将就（契约 §R6 的"为什么按内容性质分开"）。
      */}
      <div className="mx-auto flex w-full max-w-reading flex-col" data-testid="workbench-feed-column">
      {clearChip}
      {groups.map((group) => (
        <section key={group.day} className="mb-5">
          {/* 日期分隔（Misskey 同构）：左右细线 + 日期 */}
          <div className="mb-2.5 flex items-center gap-3 px-1 text-micro text-ink-500">
            <span aria-hidden className="h-px min-w-0 flex-1 bg-line" />
            <span className="font-medium">{dayLabelOf(group.day, today)}</span>
            <span aria-hidden className="h-px min-w-0 flex-1 bg-line" />
          </div>
          <div className="flex flex-col gap-2.5">
            {group.items.map((item) => (
              <FeedCard key={item.id} item={item} agents={agents} profile={profile} onPlaceholderAction={placeholderAction} />
            ))}
          </div>
        </section>
      ))}
      </div>
    </div>
  );
}
