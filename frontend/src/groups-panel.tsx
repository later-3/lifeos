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
 * - 括线 1px `--color-nav-line`、宽 8、圆角 4、上下内缩 8、光学补偿 1px；
 * - 组内行缩进 = 28 + 8 = 36（只允许两条左缘）；组内行双行 56；组间距 8；列内边距 8。
 */
import type { ReactNode } from "react";
import { IconChevronLeft, IconChevronRight, IconFolderPlus, IconHistory, IconPencil, IconTrash, IconX } from "@tabler/icons-react";
import { AgentAvatar, type AgentAvatarSpec } from "./agent-avatar";
import { UserAvatar } from "./user-avatar";
import { Button, IconButton, Label } from "./design/ui";

/** 分组头（项目）：section 字级 + 28 折叠列 + 右侧计数。 */
export function GroupHeader({ name, count, open, onToggle, onSelect, selected = false, onRemove, actions }: {
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
  onRemove?: () => void;
  actions?: ReactNode;
}) {
  return (
    // 行高 32（design-language §5.1）；内部按钮用 **h-8**（32 = 命中区档位 ≥28），
    // 不用 h-7（28 视觉高但实测只报 26，撞门禁）。
    <div className="group flex h-8 items-center gap-2 pl-2 pr-1"
      data-testid="group-header" data-group-name={name}>
      {/* 折叠列 = 28（命中盒档位）= 组内缩进的一半；点击整行折叠（不只点箭头）。
          整行可点：把折叠钮与名字合成一个按钮区，避免出现两个可点目标指向同一动作。 */}
      <button type="button"
        onClick={() => { if (onSelect !== undefined && !selected) { onSelect(); return; } onToggle(); }}
        aria-expanded={open}
        aria-current={selected ? "true" : undefined}
        aria-label={`${name}，${open ? "折叠" : "展开"}分组`}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control pl-1 pr-1 text-left hover:bg-hover">
        <span className="flex h-8 w-7 shrink-0 items-center justify-center text-ink-500">
          {open ? <IconChevronRight size={16} className="rotate-90" /> : <IconChevronRight size={16} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-content font-semibold text-ink-900">{name}</span>
      </button>
      <span aria-label={`${count} 条会话`} data-shot-mask="group-count"
        className="shrink-0 text-micro tabular-nums text-ink-500">{count}</span>
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
 * 组内行的容器：画**括线**（从属关系不能靠猜，D10）。
 *
 * 括线用伪元素式的绝对定位 span 实现（不进可访问性树）：1px、宽 8、左侧圆角、
 * 上下内缩 8、`translate-x-px` 光学补偿（shadcn Sidebar `:646` 同一手法）。
 */
export function GroupBody({ children }: { children: ReactNode }) {
  // 缩进 = 折叠列 28 + gap 8 = 36（D21：只允许两条左缘），所以 pl-9 = 36px。
  // 括线落在折叠列中心：36/2 = 18 → 用 4 个网格（4×4=16）再 +1px 光学补偿，
  // 不写裸 px：位置由"缩进/2 - 线宽/2"推导，边距用 4 网格的 Tailwind 档位。
  return (
    <div className="relative pb-1 pl-9 pr-2">
      <span aria-hidden
        className="pointer-events-none absolute bottom-2 left-4 top-2 w-2 translate-x-px rounded-l-inner border-b border-l border-nav-line" />
      {children}
    </div>
  );
}

/** 参与者叠放双头像（会话行第一行的锚点）：表达"这条是两个参与者在谈"。 */
/**
 * 会话行的参与者锚点（Task 0015 · T17）。
 *
 * 两种形状，取决于"这是不是 Agent ↔ Agent 的对话"：
 * - `showMe = false`（用户 ↔ Agent）：**只显示对端 Agent 一个头像**。
 *   叠两个头像在这种场景下没有信息量——"我"在每一行都一样，等于每行画一次自己。
 * - `showMe = true`（Agent ↔ Agent）：**叠放**（我 → 对方），这才是"两个参与者"的表达。
 *
 * 叠放几何：24px，第二个左移 15px（overlap 9），2px 描边随行底色（避免两层圆叠死）。
 */
export function ParticipantPair({ me, them, showMe, size = 24, gap = 15, ringClass }: {
  me: { id: string; name: string; kind: "user" | "agent" };
  them: { id: string; name: string; avatar?: AgentAvatarSpec } | undefined;
  showMe: boolean;
  size?: number;
  gap?: number;
  ringClass: string;
}) {
  if (them === undefined) {
    return <span className="relative shrink-0" style={{ width: size, height: size }} aria-hidden><MeAvatar spec={me} size={size} /></span>;
  }
  if (!showMe) {
    return (
      <span className="shrink-0" style={{ width: size, height: size }} aria-hidden>
        <ThemAvatar id={them.id} name={them.name} {...(them.avatar !== undefined ? { avatar: them.avatar } : {})} size={size} />
      </span>
    );
  }
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

/** 会话行（双行 56）：第一行参与者+标题，第二行 对端 · Task · 状态。 */
export function SessionRow({ selected, title, titleFallback, participants, meta, status, onSelect, onRename, onHistory, onDelete, renameValue, renaming, onRenameChange, onRenameCommit, onRenameCancel, testId }: {
  selected: boolean;
  title: string;
  titleFallback: boolean;
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
    <div role="button" tabIndex={0} data-testid={testId}
      onClick={onSelect}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }}
      className={`group/session flex h-14 w-full cursor-pointer items-center gap-2 rounded-control px-1.5 transition-colors ${
        selected ? "bg-surface shadow-sm ring-1 ring-line" : "hover:bg-hover"
      }`}>
      {participants}
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
            className="min-w-0 rounded bg-surface px-1 text-body text-ink-900 ring-1 ring-accent" />
        ) : (
          <span className={`truncate text-body ${titleFallback ? "font-mono text-ink-500" : "text-ink-900"}`}
            data-fallback={titleFallback ? "id" : undefined}
            title={titleFallback ? "这条会话还没有标题（显示的是会话 id）" : undefined}>{title}</span>
        )}
        <span className="truncate text-micro text-ink-500">{meta}</span>
      </span>
      <span className="relative flex w-16 shrink-0 items-center justify-end">
        <span className="transition-opacity group-hover/session:opacity-0 group-focus-within/session:opacity-0">{status}</span>
        <span className="absolute right-0 flex items-center opacity-0 transition-opacity group-hover/session:opacity-100 group-focus-within/session:opacity-100">
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
      {hint !== undefined && <p className="mt-1 text-micro text-ink-500">{hint}</p>}
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
    <div className="flex h-10 shrink-0 items-center gap-1.5 px-2 pl-3">
      <Label className="min-w-0 truncate">会话</Label>
      {count !== undefined && (
        <span aria-label={`会话 ${count} 个`} data-shot-mask="column-count"
          className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-hover px-1.5 text-micro font-medium tabular-nums text-ink-700">{count}</span>
      )}
      <span className="ml-auto" />
      <IconButton size="sm" label="收起此列" onClick={onHide}><IconChevronLeft size={16} /></IconButton>
    </div>
  );
}
