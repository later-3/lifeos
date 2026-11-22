/**
 * 工作台内容流（Task 0023 · S1 第 4 块的范围：桩卡片 + 显式「示例」标）。
 *
 * 数据 = `api/workbench.ts` 的 feed（S1 全是桩，S2 接 GET /api/feed）；
 * 按天分组用纯函数 `groupFeedByDay`（Misskey 日期分隔同构，demo 已验证）。
 *
 * 桩纪律：每张卡带「示例」徽标（`_stub: true`）——假数据不能让人误以为是真的；
 * 点赞/评论按钮**画出来**但点了只给 toast（S4 才接真），不给"看起来能用"的假象。
 * `kind` 缺失是合法输入（architect S1 回应③）：渲染层 fallback 成纯文本卡，不炸。
 *
 * 媒体在 S1 画**占位框**（bg-hover），不喂假 URL（假 <img> 会以破图收场）。
 * 真接口（S2）的 media 才渲染 <img> —— 渲染分支按 `_stub` 判，不按 URL 猜。
 */
import { useToast } from "../design/toast";
import { AppIcon } from "../design/icons";
import { EmptyState, MicroButton } from "../design/ui";
import { Skeleton } from "../design/ui";
import { AgentAvatar } from "./agent-avatar";
import { UserAvatar } from "./user-avatar";
import type { Agent } from "../hooks/types";
import type { UserProfile } from "../hooks/types";
import {
  dayLabelOf, filterFeedOf, groupFeedByDay,
  type FeedItem,
} from "../api/workbench";

/** 卡片头部 36px 头像：真实作者用真头像；桩作者按 id 从 agents 里认领，认领不到走首字母。 */
function AuthorAvatar({ item, agents, profile }: { item: FeedItem; agents: Agent[]; profile?: UserProfile }) {
  if (item.author.kind === "user") {
    return profile === undefined
      ? <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-hover" aria-hidden="true" />
      : <UserAvatar profile={profile} size={36} />;
  }
  const known = agents.find((agent) => agent.id === item.author.id);
  return <AgentAvatar id={item.author.id} name={known?.name ?? item.author.name}
    {...(known?.avatar !== undefined ? { avatar: known.avatar } : {})} size={36} />;
}

/** 「示例」徽标：桩卡的唯一视觉标（样式唯一居所，S4 桩清零时整卡随 STUB_FEED 一起消失）。 */
export function StubBadge() {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-accent-soft px-2 text-micro font-medium text-accent">
      示例
    </span>
  );
}

/** 卡型徽标：S1 全部用中性 chip（0009 的 kindStyle 色板在第 4 块全套接入）；kind 缺失不渲染。 */
function KindChip({ item }: { item: FeedItem }) {
  if (item.kind === undefined) return undefined;
  return <span className="inline-flex h-5 shrink-0 items-center rounded-inner bg-hover px-2 text-micro text-ink-700">{item.kind}</span>;
}

function FeedCard({ item, agents, profile, onPlaceholderAction }: {
  item: FeedItem; agents: Agent[]; profile?: UserProfile;
  onPlaceholderAction: () => void;
}) {
  const media = item.media ?? [];
  const shown = media.slice(0, 4);
  return (
    <article className="rounded-panel bg-surface ring-1 ring-line" data-testid="workbench-feed-card">
      <header className="flex items-center gap-2 px-3.5 pt-3">
        <AuthorAvatar item={item} agents={agents} profile={profile} />
        <span className="min-w-0 truncate text-body font-semibold text-ink-900">{item.author.name}</span>
        <KindChip item={item} />
        <StubBadge />
      </header>
      <div className="px-3.5 pb-1 pt-2">
        {item.title !== undefined && item.title !== "" && (
          <h3 className="text-content font-semibold leading-snug text-ink-900">{item.title}</h3>
        )}
        <p className="text-content leading-relaxed text-ink-900">{item.text}</p>
      </div>
      {shown.length > 0 && (
        <div className="flex gap-1.5 px-3.5 pt-2">
          {shown.map((m, index) => (
            // S1 桩媒体 = 占位框（不喂假 URL）；说明文字走 title，不假装是图
            <div key={index} title={m.caption ?? "示例媒体占位"}
              className="flex h-16 min-w-0 flex-1 items-center justify-center rounded-inner bg-hover text-ink-300">
              <AppIcon name="photo" size={16} />
            </div>
          ))}
          {media.length > 4 && (
            <span className="flex h-16 w-10 shrink-0 items-center justify-center rounded-inner bg-hover text-micro text-ink-500">
              +{media.length - 4}
            </span>
          )}
        </div>
      )}
      {(item.projectId !== undefined || item.task !== undefined) && (
        <div className="flex flex-wrap gap-1.5 px-3.5 pt-2.5">
          {item.projectId !== undefined && (
            <span className="inline-flex h-6 items-center rounded-inner bg-sunken px-2 text-micro text-ink-700 ring-1 ring-line">{item.projectId}</span>
          )}
          {item.task !== undefined && (
            <span className="inline-flex h-6 items-center rounded-inner bg-sunken px-2 text-micro text-ink-700 ring-1 ring-line">
              {item.task.id} {item.task.title}
            </span>
          )}
        </div>
      )}
      {/* 动作行（第 4 块完整形态的一部分先落位）：桩上点了给 toast，不装作能用。
          S1 用**纯文字标签**：图标库里没有 ♡/↗/⛉（不为此扩 icon 集），文字本身已表意。 */}
      <div className="flex items-center px-2.5 py-1.5">
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
  const filterName0 = agentFilter === undefined
    ? undefined
    : agentFilter === "me" ? "我" : (agents.find((agent) => agent.id === agentFilter)?.name ?? agentFilter);
  /** 筛选 chip：骨架与空态**都要**可见（否则筛出一个空结果时没有出口，用户被困住）。 */
  const clearChip = filterName0 !== undefined ? (
    <span className="mb-2.5 inline-flex">
      <MicroButton tone="accent" onClick={onClearFilter} data-testid="workbench-clear-filter">
        只看 {filterName0} ×
      </MicroButton>
    </span>
  ) : undefined;
  if (loading) {
    return <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3.5 py-3"><Skeleton rows={5} /></div>;
  }
  const items = filterFeedOf(feed, tab, agentFilter);
  if (items.length === 0) {
    const who = agentFilter === undefined
      ? undefined
      : agentFilter === "me" ? "我" : (agents.find((agent) => agent.id === agentFilter)?.name ?? agentFilter);
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3.5 py-3">
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
  );
}
