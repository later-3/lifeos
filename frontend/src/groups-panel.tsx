/**
 * 左区层次面板：**项目分组 → 会话行**（Task 0015 · T15，按 P-02 草案落码）。
 *
 * 为什么合并（不是审美，是宽度预算 + 已写规范）：
 * - 旧：项目列 216 + 会话列 272 + 3 个把手 → `leftDocked = 782`，退化阈值 1202 > 1024
 *   → 13 寸笔记本上左三列整体变抽屉（`design/layout.ts` 手算）；
 * - 新：一列 300（240–440）+ 2 个把手 → `leftDocked = 588`，阈值 1008，1024 直接可用；
 * - P-02 草案早已写定形态与数值（`knowledge/design/im/groups-panel.md` §5.1/§5.2、
 *   `design-language.md` §5.1），本文件是**照图施工**，不新造数值。
 *
 * 数值纪律（全部来自 design-language §5.1，不在这里写 px 字面量）：
 * - 分组头高 32、section 字级（content / 600 / ink-900）、左侧 28 折叠列、右侧计数 micro tabular；
 * - **不画括线**（Task 0006：D10 作废）：层级只靠一条左缘 + 折叠状态。
 *   分组头与组内行共用同一套左缘（列内边距 8 + 折叠列 28 + gap 8 = 44），
 *   与 A 级参考 LobeHub 同构（`NavItem` 的 Center 28 + gap 8 + paddingInline 4，
 *   `src/features/NavPanel/components/NavItem.tsx:196-215`；分组头同样 C enter 28 + padding 4，
 *   `src/features/AgentSidebar/Topic/TopicListContent/ByProjectMode/GroupItem.tsx:347-360`）；
 * - 组内行双行 56；组间距 8；列内边距 8。
 */
import type { ReactNode } from "react";
import { IconChevronLeft, IconChevronRight, IconFolderPlus, IconHistory, IconPencil, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { AgentAvatar, type AgentAvatarSpec } from "./agent-avatar";
import { UserAvatar } from "./user-avatar";
import { Button, IconButton, Label } from "./design/ui";

/** 分组头（项目）：section 字级 + 28 折叠列 + 右侧计数。 */
export function GroupHeader({ name, count, open, onToggle, onSelect, selected = false, onNewSession, onNewSessionDisabled = false, onRemove, actions }: {
  name: string;
  count: number;
  open: boolean;
  /** 折叠 / 展开（点箭头或整行名称）。 */
  onToggle: () => void;
  /**
   * 切到该项目（Task 0015 · T15）。
   *
   * 合并前"点项目行 = 选中项目"；合并后分组头的**主作用必须是折叠**（P-02 §6），
   * 所以选中改由**会话行**承担（点会话 → 同时选中它的项目）。
   * 这个入口只给"该项目下还没有会话"时用（`＋ 新建会话` 会需要知道当前项目）。
   */
  onSelect?: () => void;
  selected?: boolean;
  /**
   * 在这个项目下开新会话（Task 0006）。
   *
   * 为什么要长在分组头里：合并成一个面板后，「新建会话」原来只剩列底一个全局按钮，
   * 它**不知道用户想建到哪个项目**——落点由 `selectedProjectId` 这个变量决定，
   * 而点会话行/点分组头都不改它（`App.tsx:1805` / `:1781`），于是新会话会落进
   * 上一个项目。把按钮放进项目名那一行，归属就变成**界面位置**，不再依赖隐式状态。
   */
  onNewSession?: () => void;
  /** 已经在这个项目的草稿里：本组按钮禁用（其他组照常可点，点了切过去）。 */
  onNewSessionDisabled?: boolean;
  onRemove?: () => void;
  actions?: ReactNode;
}) {
  return (
    // 行高 32（design-language §5.1）；内部按钮用 **h-8**（32 = 命中区档位 ≥28），
    // 不用 h-7（28 视觉高但实测只报 26，撞门禁）。
    // 容器**不加水平内边距**：滚动容器已有 px-2（8），折叠列 28 + gap 8 = 44 刚好与组内行标题同缘（D21）。
    <div className="group flex h-8 items-center gap-2 pr-1"
      data-testid="group-header" data-group-name={name}>
      {/* 折叠列 = 28 = 命中盒档位；点击整行折叠（不只点箭头）。
          整行可点：把折叠钮与名字合成一个按钮区，避免出现两个可点目标指向同一动作。 */}
      <button type="button"
        onClick={() => { if (onSelect !== undefined && !selected) { onSelect(); return; } onToggle(); }}
        aria-expanded={open}
        aria-current={selected ? "true" : undefined}
        aria-label={`${name}，${open ? "折叠" : "展开"}分组`}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control text-left hover:bg-nav-accent">
        <span className="flex h-8 w-7 shrink-0 items-center justify-center text-ink-500">
          {open ? <IconChevronRight size={16} className="rotate-90" /> : <IconChevronRight size={16} />}
        </span>
        {/* 分组头 = **容器**，字级要比行标题**小一号**、颜色更弱（2026-11-09 实测修正）。
            旧值是 text-content(15px)/600 —— 比行标题 text-body(13.5px) 还大，容器抢了内容的戏。
            两家产品参考：LobeHub 分组标签 12px/500/中灰（桌面版实测）、
            LibreChat 分区标题 12px/500/text-secondary（`Nav/KeyboardShortcutsDialog.tsx:240`）。
            我们用 text-meta(12px)/500 + nav-muted：字级与颜色两条都弱下去，名字仍可扫。 */}
        <span className="min-w-0 flex-1 truncate text-meta font-medium text-nav-muted">{name}</span>
      </button>
      {/* 新建会话：在项目名之后、计数之前。
          不放最右是因为最右是「移除项目」（hover 出现），两个图标紧挨着误点代价不对称。 */}
      {onNewSession !== undefined && (
        <span className="shrink-0">
          <IconButton size="sm" label={`在 ${name} 新建会话`} onClick={onNewSession}
            {...(onNewSessionDisabled === true ? { disabled: true } : {})}>
            <IconPlus size={14} />
          </IconButton>
        </span>
      )}
      <span aria-label={`${count} 条会话`} data-shot-mask="group-count"
        className="shrink-0 text-micro tabular-nums text-nav-muted">{count}</span>
      <span className="flex shrink-0 items-center">
        {actions}
        {onRemove !== undefined && (
          <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <IconButton label={`从该助手移除项目 ${name}`} size="sm" onClick={onRemove}>
              <IconX size={14} />
            </IconButton>
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * 组内行的容器（Task 0006：**不再画括线**）。
 *
 * 旧的括线是 D10 的落码，而 D10 直接抄了 Zulip 的装饰件 —— 用户 2026-11-06 判定“太丑”。
 * 现在从属关系只靠**缩进**表达：分组头与组内行共用一套左缘（列内边距 8 + 折叠列 28 + gap 8 = 44），
 * 括线删掉，列里只剩两条左缘（列头 8 / 行内容 44）。
 * 依据：LobeHub 没有括线，层级靠 accordion 的展开状态 + 对齐缩进
 * （`src/features/NavPanel/components/NavItem.tsx:196-215`、`ByProjectMode/GroupItem.tsx:347`）。
 */
export function GroupBody({ children }: { children: ReactNode }) {
  // 缩进 = 折叠列 28（w-7）。行内部再 px-2（8）→ 标题落在 8(列) + 28 + 8 = **44**，
  // 与分组头名字同一左缘（分组头：8 + 28 + gap8 = 44）。一列只剩两条左缘：列头 8 / 内容 44（D21）。
  return <div className="pb-1 pl-7 pr-2">{children}</div>;
}

/** 参与者叠放双头像（会话行第一行的锚点）：表达"这条是两个参与者在谈"。 */
/**
 * 会话行**第二行**开头的参与者头像（Task 0015 · T17 修订，用户 2026-11-02）。
 *
 * 为什么从"第一行大叠放头像"改成"第二行小头像"：
 * - 左侧 Agent 列已经表达了"我在跟哪个 Agent 干活"，第一行再放 24px 头像等于**每行重画一次同一个 Agent**；
 * - 会话行的第一行应该只回答"是哪件事"，"和谁"属于元信息（与 Task、状态、时间同一行）；
 * - 放到第二行后，第一行标题不再被头像挤占（可用宽度回到满格）。
 *
 * 尺寸 16 = 与第二行的 `micro` 字号同高的行内档（`design-language.md` §5.3 图标 16 档），
 * 不新增尺寸；只有 **Agent ↔ Agent** 的会话才叠第二个（用户 ↔ Agent 的对端就是当前 Agent，
 * 左边那列已经写着了，不重复）。
 */
export function ParticipantToken({ me, them, showMe, size = 16, ringClass }: {
  me: { id: string; name: string; kind: "user" | "agent" };
  them: { id: string; name: string; avatar?: AgentAvatarSpec } | undefined;
  showMe: boolean;
  size?: number;
  ringClass: string;
}) {
  if (them === undefined) {
    return <span className="shrink-0" aria-hidden><MeAvatar spec={me} size={size} /></span>;
  }
  if (!showMe) {
    return (
      <span className="shrink-0" aria-hidden>
        <ThemAvatar id={them.id} name={them.name} {...(them.avatar !== undefined ? { avatar: them.avatar } : {})} size={size} />
      </span>
    );
  }
  // 叠放：第二个左移 60%，描边随行底色（避免两层圆叠死）
  const gap = Math.round(size * 0.6);
  return (
    <span className="relative shrink-0" style={{ width: size + gap, height: size }} aria-hidden>
      <span className="absolute left-0 top-0"><MeAvatar spec={me} size={size} /></span>
      <span className={`absolute top-0 ${ringClass}`} style={{ left: gap, borderRadius: 999 }}>
        <ThemAvatar id={them.id} name={them.name} {...(them.avatar !== undefined ? { avatar: them.avatar } : {})} size={size} />
      </span>
    </span>
  );
}

function MeAvatar({ spec, size }: { spec: { id: string; name: string; kind: "user" | "agent" }; size: number }) {
  if (spec.kind === "user") return <UserAvatar profile={{ id: spec.id, name: spec.name, avatar: null }} size={size} />;
  return <span className="flex shrink-0 items-center justify-center rounded-full bg-accent font-medium text-white"
    style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) }}>{spec.name.slice(0, 1)}</span>;
}

function ThemAvatar({ id, name, avatar, size }: { id: string; name: string; avatar?: AgentAvatarSpec; size: number }) {
  return <AgentAvatar id={id} name={name} avatar={avatar} size={size} />;
}

/**
 * 会话行（双行 56）。
 *
 * 第一行：**只有标题**（"是哪件事"）——头像已移到第二行，
 * 因为它属于元信息，且左边 Agent 列已经表达了"和谁"。
 * 第二行：`[参与者小头像] 对端 · Task · 状态`（"和谁、属于什么、现在怎样"）。
 */
export function SessionRow({ selected, title, titleFallback, participants, meta, status, onSelect, onRename, onHistory, onDelete, renameValue, renaming, onRenameChange, onRenameCommit, onRenameCancel, testId }: {
  selected: boolean;
  title: string;
  titleFallback: boolean;
  /** 第二行开头的参与者头像（`ParticipantToken`）。 */
  participants: ReactNode;
  meta: ReactNode;
  status: ReactNode;
  onSelect: () => void;
  onRename: () => void;
  onHistory: () => void;
  onDelete: () => void;
  testId?: string;
  renaming: boolean;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameCommit: (value: string) => void;
  onRenameCancel: () => void;
}) {
  return (
    <div role="button" tabIndex={0} data-testid={testId} aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }}
      className={`group/session flex h-14 w-full cursor-pointer items-center gap-2 rounded-row px-2 transition-colors ${
        selected ? "bg-nav-selected font-medium text-ink-900" : "text-ink-700 hover:bg-nav-accent"
      }`}>
      <span className="flex min-w-0 flex-1 flex-col">
        {renaming ? (
          <input autoFocus value={renameValue}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => onRenameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); onRenameCommit(event.currentTarget.value); }
              if (event.key === "Escape") { event.preventDefault(); onRenameCancel(); }
            }}
            onBlur={onRenameCancel}
            onClick={(event) => event.stopPropagation()}
            className="min-w-0 rounded-control bg-surface px-1 text-body text-ink-900 ring-1 ring-accent" />
        ) : (
          <span className={`truncate text-body ${titleFallback ? "font-mono text-nav-muted" : "text-ink-900"}`}
            data-fallback={titleFallback ? "id" : undefined}
            title={titleFallback ? "这条会话还没有标题（显示的是会话 id）" : undefined}>{title}</span>
        )}
        {/* 副行用 nav-muted 而不是 ink-500：ink-500 在 nav-accent / nav-selected 上只有 4.10 / 4.03，
            低于 AA 4.5（导航层专用色 nav-muted 为 4.90 / 4.65）。 */}
        <span className="flex min-w-0 items-center gap-1.5 text-micro text-nav-muted">
          {participants}
          <span className="min-w-0 truncate">{meta}</span>
        </span>
      </span>
      <span className="relative flex w-16 shrink-0 items-center justify-end group/slot">
        {/* 状态槽的包装器**必须是 flex 容器**（Task 0004 / C161）：
            里面的点/时间是空 inline 元素，`w-1.5 h-1.5` 对 non-replaced inline 不生效
            （MDN CSS/width：applies to all elements but non-replaced inline elements），
            包装器是 block+width:auto 时就一起塌成 0×0 —— 未读点、运行点、失败点全部看不见。
            合并前这个点是 flex item 所以正常，hover 包装器把它变成了 block 子元素。
            上游 pi-web 同构：`app/sidebar.css:357` `.session-tree-meta{display:flex}`。
            （Task 0005 的 worktree 从 0004 修复前的 commit 分出，两边都改到这里；
            本任务已把同一处修复移植进分支 —— 合并后此处为单一事实，注释只留这一份。） */}
        {/* 可见性谓词（Task 0005，与 action-bar revealActions 同一语义的 CSS 形式）：
            hover(行) ∨ 键盘 focus-visible 在动作钮上 ∨ (无悬停设备 ∧ 行 focus-within)。
            此前无条件的 `group-focus-within/session` 让点击行后动作区钉死常显（用户报告的缺陷）；
            现在键盘路径收窄为 `:has(:focus-visible)`（鼠标点击行不匹配 focus-visible，实测），
            focus-within 只保留在 `@media (hover: none)` 下给触屏当“点行显现”入口。 */}
        <span className="flex items-center transition-opacity group-hover/session:opacity-0 group-has-[:focus-visible]/slot:opacity-0 [@media(hover:none)]:group-focus-within/session:opacity-0">{status}</span>
        <span className="absolute right-0 flex items-center opacity-0 pointer-events-none transition-opacity group-hover/session:opacity-100 group-hover/session:pointer-events-auto group-has-[:focus-visible]/slot:opacity-100 group-has-[:focus-visible]/slot:pointer-events-auto [@media(hover:none)]:group-focus-within/session:opacity-100 [@media(hover:none)]:group-focus-within/session:pointer-events-auto">
          <IconButton label="会话历史" size="sm" onClick={(event) => { event.stopPropagation(); onHistory(); }}><IconHistory size={14} /></IconButton>
          <IconButton label="重命名会话" size="sm" onClick={(event) => { event.stopPropagation(); onRename(); }}><IconPencil size={14} /></IconButton>
          <IconButton label="删除会话" size="sm" onClick={(event) => { event.stopPropagation(); onDelete(); }}><IconTrash size={14} /></IconButton>
        </span>
      </span>
    </div>
  );
}

/** 空态行（组内没有会话，或整列没有项目）。 */
export function PanelEmpty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="px-4 py-6 text-center">
      <p className="text-body text-ink-700">{title}</p>
      {hint !== undefined && <p className="mt-1 text-micro text-nav-muted">{hint}</p>}
      {action !== undefined && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** 底部主操作（添加项目 / 新建会话）。 */
export function PanelFooter({ children }: { children: ReactNode }) {
  return <div className="shrink-0 px-2 py-2">{children}</div>;
}

export function AddProjectButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" className="w-full" onClick={onClick}>
      <IconFolderPlus size={14} /> 添加项目
    </Button>
  );
}

/** 列头：Label「会话」+ 总数 + 收起。与 App 里其它列头保持同一形状。 */
export function GroupsColumnHeader({ count, onHide }: { count?: number; onHide: () => void }) {
  return (
    // 列内边距 8（design-language §5.1 / D21）：与助手列的列头同一左缘，
    // 也与分组头、组内行共用这套网格（旧值 pl-3=12 多出第三条左缘）。
    <div className="flex h-10 shrink-0 items-center gap-1.5 px-2">
      <Label tone="nav" className="min-w-0 truncate">会话</Label>
      {count !== undefined && (
        <span aria-label={`会话 ${count} 个`} data-shot-mask="column-count"
          className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-nav-accent px-1.5 text-micro font-medium tabular-nums text-nav-muted">{count}</span>
      )}
      <span className="ml-auto" />
      <IconButton size="sm" label="收起此列" onClick={onHide}><IconChevronLeft size={16} /></IconButton>
    </div>
  );
}
