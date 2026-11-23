/**
 * 工作台项目区（Task 0023 · S1 第 3 块）：左项目列表（多选）+ 右看板（列 = 归一状态）。
 *
 * 数据 = `/api/projects` + `/api/tasks`（契约冻结形状）；**归一状态只用后端给的 `state`**
 * ——前端不得再写第二份归一（api 2.7 / S1-contract §0-2）。排除 daily 只判 `type`
 * （S1-contract §6-R3），判据唯一落在 `stateColumnsOf()` / `taskCountsByProject()`。
 *
 * R4：4 个状态不能只画 3 列——`state === "其他"` 非空时**必须**渲染尾部「其他 N」组，
 * 组内卡显示**原始 status**（否则用户分不清"已作废"还是"状态写错了"）；空时整组不渲染。
 *
 * 边界（09-boundary）：工作台只读——项目行与看板卡都**不可点执行**，没有"打开任务"这类假入口。
 */
import { useState } from "react";
import { AppIcon } from "../design/icons";
import { ClickableRow, EmptyState } from "../design/ui";
import { Skeleton } from "../design/ui";
import { AgentAvatar } from "./agent-avatar";
import type { Agent } from "../hooks/types";
import { taskCountsByProject, stateColumnsOf, type GlobalProject, type GlobalTask } from "../api/workbench";

/** 头像堆叠（Plane `AvatarGroup max={3}` + "+N"，demo 已验证）：前 3 个真头像，多的折成 +N。 */
function AvatarStack({ agentIds, agents }: { agentIds: string[]; agents: Agent[] }) {
  const shown = agentIds.slice(0, 3);
  const rest = agentIds.length - shown.length;
  return (
    <span className="flex shrink-0" aria-label={`${agentIds.length} 位助手`}>
      {shown.map((id, index) => {
        const agent = agents.find((item) => item.id === id);
        return (
          <span key={id} className={index === 0 ? "" : "-ml-1.5"} title={agent?.name ?? id}>
            <AgentAvatar id={id} name={agent?.name ?? id}
              {...(agent?.avatar !== undefined ? { avatar: agent.avatar } : {})} size={16} />
          </span>
        );
      })}
      {rest > 0 && (
        <span className="-ml-1.5 flex h-4 min-w-4 items-center justify-center overflow-hidden rounded-full bg-ink-500 px-0.5 text-micro font-semibold text-white">
          +{rest}
        </span>
      )}
    </span>
  );
}

/** 项目行（多选行）：整行是一个 aria-pressed 的开关，不内嵌 checkbox（无嵌套可点目标）。 */
function ProjectRow({ project, counts, selected, onToggle, agents }: {
  project: GlobalProject;
  counts: { total: number; running: number };
  selected: boolean;
  onToggle: () => void;
  agents: Agent[];
}) {
  return (
    <ClickableRow shape="row" aria-pressed={selected} onClick={onToggle} data-testid="workbench-project-row"
      className={`px-2 py-1.5 ${selected ? "bg-wash-selected text-ink-900" : "text-ink-700"}`}>
      {/* 多选框视觉（span，不是 input——行本身已是开关语义） */}
      <span aria-hidden className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-inner border ${
        selected ? "border-accent bg-accent" : "border-ink-300"
      }`}>
        {selected && <AppIcon name="check" size={10} className="text-white" />}
      </span>
      {project.icon !== undefined && <span aria-hidden className="shrink-0 text-body">{project.icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="min-w-0 truncate text-meta font-medium text-ink-900">{project.name}</span>
        <span className="min-w-0 truncate text-micro text-nav-muted">{counts.running} 进行中 · {counts.total} 个任务</span>
      </span>
      <AvatarStack agentIds={project.agentIds} agents={agents} />
    </ClickableRow>
  );
}

/** 看板卡：只读信息卡（没有详情页可去，不做假链接）。 */
function KanbanCard({ task, agents, projectName }: { task: GlobalTask; agents: Agent[]; projectName: string }) {
  const agent = agents.find((item) => item.id === task.agentId);
  return (
    <div className="rounded-control bg-surface p-2.5 ring-1 ring-line" data-testid="workbench-kanban-card">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="shrink-0 font-mono text-micro text-ink-500">{task.id}</span>
        <span className="min-w-0 truncate text-micro text-ink-500">{projectName}</span>
        <span className="ml-auto inline-flex h-5 shrink-0 items-center rounded-inner bg-hover px-1.5 text-micro text-ink-700">{task.category}</span>
      </div>
      <p className="line-clamp-2 text-meta leading-snug text-ink-900" title={task.title}>{task.title}</p>
      <div className="mt-2 flex items-center gap-1.5">
        <AgentAvatar id={task.agentId} name={agent?.name ?? task.agentId}
          {...(agent?.avatar !== undefined ? { avatar: agent.avatar } : {})} size={16} />
        <span className="min-w-0 truncate text-micro text-ink-500">{agent?.name ?? task.agentId}</span>
        {task.date !== undefined && <span className="ml-auto shrink-0 text-micro text-ink-500 tabular-nums">{task.date}</span>}
      </div>
    </div>
  );
}

/** 看板列：列头（状态 + 数）+ 卡列表（列内滚）。列头是**枚举值**，不是原始 status 字符串（R3）。 */
function KanbanColumn({ label, tone, cards, agents, projectNames }: {
  label: string;
  tone: "run" | "done" | "move";
  cards: GlobalTask[];
  agents: Agent[];
  projectNames: Map<string, string>;
}) {
  /*
   * 列头色：**语义 token 成对用**，不用 accent。
   * "进行中" = running 语义（Task 0005 为"正在跑"拍板的同一族），running on running-soft 全预设 ≥5.29；
   * 旧写法 `text-accent` on `bg-accent-soft` 只有 4.22–4.35（axe 实测 4.28 < 4.5）。
   * "已完成" 的 success on success-soft 全预设 ≥4.84，本来就达标，保持。
   */
  const toneClass = tone === "run"
    ? "bg-running-soft text-running"
    : tone === "done"
      ? "bg-success-soft text-success"
      : "bg-wash-hover text-ink-700";
  return (
    <section className="flex min-w-48 flex-1 basis-0 flex-col rounded-panel bg-sunken ring-1 ring-line" aria-label={`${label}（${cards.length}）`}>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-2.5 py-2">
        <span className={`inline-flex h-5 items-center rounded-full px-2 text-micro font-medium ${toneClass}`}>{label}</span>
        <span className="text-micro tabular-nums text-ink-500" data-testid="workbench-kanban-count">{cards.length}</span>
      </header>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-y-contain p-1.5">
        {cards.length === 0
          ? <p className="px-2 py-4 text-center text-micro text-ink-500">没有{label}的任务</p>
          : cards.map((task) => (
            <KanbanCard key={`${task.agentId}/${task.projectId}/${task.id}`} task={task} agents={agents}
              projectName={projectNames.get(task.projectId) ?? task.projectId} />
          ))}
      </div>
    </section>
  );
}

/**
 * 「其他」尾部组（R4，唯一改看板布局的）：非空才出现。
 * 形态 = 折叠组（点击行开合）+ Row 列表；组内卡显示**原始 status 全文**。
 */
function OtherGroup({ cards, agents }: { cards: GlobalTask[]; agents: Agent[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-panel bg-sunken ring-1 ring-line" data-testid="workbench-kanban-other">
      <ClickableRow shape="row" onClick={() => setOpen((value) => !value)}
        aria-expanded={open} className="px-2.5 py-2">
        <AppIcon name={open ? "chevron-down" : "chevron-right"} size={14} className="shrink-0 text-ink-500" />
        <span className="inline-flex h-5 items-center rounded-full bg-wash-hover px-2 text-micro font-medium text-ink-700">其他</span>
        <span className="text-micro tabular-nums text-ink-500">{cards.length}</span>
        <span className="ml-auto text-micro text-ink-500">{open ? "收起" : "展开"}</span>
      </ClickableRow>
      {open && (
        <div className="space-y-1 p-1.5 pt-0">
          {cards.map((task) => {
            const agent = agents.find((item) => item.id === task.agentId);
            return (
              <div key={`${task.agentId}/${task.projectId}/${task.id}`}
                className="rounded-control bg-surface px-2.5 py-2 ring-1 ring-line" data-testid="workbench-kanban-other-card">
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 font-mono text-micro text-ink-500">{task.id}</span>
                  <span className="min-w-0 truncate text-micro text-ink-500">{task.projectId}</span>
                  <span className="ml-auto shrink-0 text-micro text-ink-700">{agent?.name ?? task.agentId}</span>
                </div>
                {/* 原文 status 全文（R4 的核心：用户要能看出"已作废"还是"状态写错了"） */}
                <p className="mt-1 text-micro leading-snug text-ink-900">{task.status}</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ProjectPane({ tasks, projects, agents, onToggleProject, selected, loading }: {
  tasks: GlobalTask[];
  projects: GlobalProject[];
  /** 行点击回调由父级持有（选择状态在工作台根，切 tab 不丢）。 */
  onToggleProject: (id: string) => void;
  selected: Set<string>;
  agents: Agent[];
  /** 数据没就绪（首帧）：骨架，不写"没有项目"（规范 2.32）。 */
  loading: boolean;
}) {
  const counts = taskCountsByProject(tasks);
  const picked = tasks.filter((task) => selected.has(task.projectId));
  const columns = stateColumnsOf(picked);
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  if (loading) {
    return <div className="min-h-0 flex-1 p-3" data-testid="workbench-projects-loading"><Skeleton rows={6} /></div>;
  }
  if (projects.length === 0) {
    return <div className="min-h-0 flex-1" data-testid="workbench-projects-empty"><EmptyState title="还没有项目" hint="项目在各助手的对话里注册后出现在这里。" /></div>;
  }
  return (
    <div className="flex min-h-0 flex-1" data-testid="workbench-projects">
      {/* 左：项目多选列表 */}
      <div className="flex w-48 shrink-0 flex-col border-r border-line bg-nav-bg">
        <div className="flex shrink-0 items-center gap-2 px-2 py-2 text-micro text-nav-muted">
          <span>已选 {selected.size} / {projects.length}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-y-contain px-1.5 pb-2">
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} agents={agents}
              counts={counts.get(project.id) ?? { total: 0, running: 0 }}
              selected={selected.has(project.id)} onToggle={() => onToggleProject(project.id)} />
          ))}
        </div>
      </div>
      {/* 右：看板（列 = 归一状态；勾选的项目为范围；无勾选 = 明确空态，不静默消失） */}
      <div className="flex min-w-0 flex-1 flex-col">
        {selected.size === 0 ? (
          <div className="min-h-0 flex-1" data-testid="workbench-projects-none"><EmptyState title="勾选项目，看板显示它们的任务" hint="左列默认全选；清空后这里给出指引。" /></div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-auto overflow-y-hidden p-2">
            <div className="flex min-h-0 flex-1 gap-2">
              <KanbanColumn label="进行中" tone="run" cards={columns.run} agents={agents} projectNames={projectNames} />
              <KanbanColumn label="已完成" tone="done" cards={columns.done} agents={agents} projectNames={projectNames} />
              <KanbanColumn label="已移交" tone="move" cards={columns.moved} agents={agents} projectNames={projectNames} />
            </div>
            {/* R4：其他非空才出现（四列卡数相加 = 非 daily 条数的关系在测试锁） */}
            {columns.other.length > 0 && <OtherGroup cards={columns.other} agents={agents} />}
          </div>
        )}
      </div>
    </div>
  );
}
