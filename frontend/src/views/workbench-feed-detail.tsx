/**
 * 动态详情浮层（Task 0023 · 修正批 4 · e2e 第 9 条）。
 *
 * 用户原话：「动态详情还是没有？」——S1 的可点卡片只是"卡片"，点不开。
 *
 * ## 形态
 *
 * - **桌面**：`Modal` primitive（宽 760，标题=卡片标题），不按 `_stub` 分叉；
 * - **手机**：同一个 `Modal` + `fullScreen`（它内部按 `useIsMobile()` 切成全屏 sheet）——
 *   与目录选择器/配置助手的语义一致，**不切整个中栏**（工作台本身已是覆盖层，再切一层会丢上下文）。
 * - **不新增组件语义**：可访问性（`role="dialog"` / `aria-modal` / 焦点陷阱 / Esc / 焦点归还）全部由
 *   `Modal`（`design/overlay.tsx` 的 `useDialogFocus`）提供，这里只填内容。
 *
 * ## 内容
 *
 * 标题 → 媒体（复用 `MediaGrid`）→ Markdown 正文（复用 `renderMarkdown`）→ 上下文字段 → 标签。
 * `body` 缺省时用 `text` 兜底：**不出现空白浮层**（用户点开看到空白等于坏）。
 * Markdown 用 `Markdown` 组件（与对话区同一条渲染链路：marked → DOMPurify → 代码块着色）。
 */
import { Modal } from "../design/overlay";
import { AppIcon } from "../design/icons";
import { AgentAvatar } from "./agent-avatar";
import { UserAvatar } from "./user-avatar";
import { Markdown } from "./message-markdown";
import { KindChip, StubBadge } from "./workbench-feed";
import type { Agent, UserProfile } from "../hooks/types";
import type { FeedItem } from "../api/workbench";

/** 详情里的一行上下文（项目 / Task / worktree / 检视）。有哪个渲染哪个。 */
function detailContextOf(item: FeedItem): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (item.projectId !== undefined) rows.push({ label: "项目", value: item.projectId });
  if (item.task !== undefined) rows.push({ label: "任务", value: `${item.task.id} ${item.task.title}` });
  if (item.worktree !== undefined) rows.push({ label: "worktree", value: item.worktree });
  if (item.review !== undefined) rows.push({ label: "检视", value: `${item.review.note ?? "检视"} ${item.review.closed}/${item.review.total}` });
  return rows;
}

export function WorkbenchFeedDetail({ item, agents, profile, onClose }: {
  item: FeedItem;
  agents: Agent[];
  profile?: UserProfile;
  onClose: () => void;
}) {
  const known = agents.find((agent) => agent.id === item.author.id);
  const context = detailContextOf(item);
  return (
    <Modal title={item.title ?? "动态详情"} subtitle={item.author.name} onClose={onClose} width={760} fullScreen
      icon={item.author.kind === "user"
        ? (profile === undefined ? undefined : <UserAvatar profile={profile} size={28} />)
        : <AgentAvatar id={item.author.id} name={known?.name ?? item.author.name}
            {...(known?.avatar !== undefined ? { avatar: known.avatar } : {})} size={28} />}>
      <article data-testid="workbench-feed-detail" data-kind={item.kind ?? "none"} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <KindChip kind={item.kind} />
          <MoodEmoji mood={item.mood} />
          {item._stub === true && <StubBadge />}
          {item.tags.map((tag) => <span key={tag} className="text-micro text-ink-500">#{tag}</span>)}
        </div>

        {item.media !== undefined && item.media.length > 0 && (
          <div data-testid="workbench-feed-detail-media">
            <MediaBlock items={item.media} />
          </div>
        )}

        {/* 正文：body 优先（S2 的真接口会给），缺省用卡片 text 兜底——绝不出现空白浮层 */}
        <div data-testid="workbench-feed-detail-body">
          <Markdown text={item.body ?? item.text} />
        </div>

        {context.length > 0 && (
          <dl className="mt-1 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line pt-3 text-meta">
            {context.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-ink-500">{row.label}</dt>
                <dd className="min-w-0 break-words text-ink-900">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {item.docs !== undefined && item.docs.length > 0 && (
          <ul className="flex flex-col gap-1">
            {item.docs.map((doc) => (
              <li key={doc.name} className="flex items-center gap-2 rounded-control bg-sunken px-2.5 py-1.5 ring-1 ring-line">
                <span aria-hidden className="text-body">{doc.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-micro text-ink-900">{doc.name}</span>
                  <span className="block truncate text-micro text-ink-500">{doc.sub}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <footer className="flex items-center gap-3 border-t border-line pt-2 text-micro text-ink-500">
          <span>{item.likes} 赞</span>
          <span>{item.comments} 评论</span>
          <span className="ml-auto inline-flex items-center gap-1">
            <AppIcon name="info" size={12} aria-hidden="true" />
            {item._stub === true ? "示例内容（S2 接真）" : "动态详情"}
          </span>
        </footer>
      </article>
    </Modal>
  );
}

/** 心情 emoji（有就渲染，装饰性）。 */
function MoodEmoji({ mood }: { mood: string | undefined }) {
  if (mood === undefined) return undefined;
  return <span aria-hidden className="text-body">{mood}</span>;
}

/**
 * 详情里的媒体块：与卡片里**同一套网格规则**，但不复用 `MediaGrid`（那个带 `ImageTrigger` 的
 * 卡片内交互与 caption 胶囊；详情里要的是大图直排）。
 *
 * 为什么在这里要一层：卡片内的媒体是"缩略"，详情是"看图"。**档位规则共用**（`mediaTierOf`），
 * 只是每格尺寸跟着浮层宽度走 —— 不写第二套档位判定。
 */
function MediaBlock({ items }: { items: NonNullable<FeedItem["media"]> }) {
  /*
   * **详情里的图不按原始比例无限放大**（实测反馈：760 宽的浮层里一张 16:9 图高 428，
   * 两张就把视口占满，正文被推到几百像素以下 —— 用户点开"详情"看到的是相册而不是文章）。
   * 做法：每张图 `max-h-72`(288) + `object-cover`，多图两列并排；caption 在图下。
   * 想看大图点卡片里的 `ImageTrigger`（那是放大器的职责），详情负责"读文章"。
   */
  const grid = items.length > 1 ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2";
  return (
    <div className={grid}>
      {items.map((media, index) => (
        <figure key={index} className="overflow-hidden rounded-panel bg-hover">
          {media.kind === "video" ? (
            <div className="flex aspect-video items-center justify-center text-ink-500">
              <AppIcon name="chevron-right" size={28} />
            </div>
          ) : (
            <img src={media.url} alt={media.caption ?? "示例图"} loading="lazy" decoding="async"
              className="block max-h-72 w-full object-cover" />
          )}
          {media.caption !== undefined && (
            <figcaption className="px-3 py-1.5 text-micro text-ink-500">{media.caption}</figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}
