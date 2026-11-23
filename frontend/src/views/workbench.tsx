/**
 * 用户工作台（Task 0023 · S1 第 2 块：页面骨架）。
 *
 * 「我」这一层的首页（14-final-design §2 定稿）：rail（我/助手/对话/⊞/设置）
 * + stories 头像横排 + tabs + 内容区（内容流 | 项目区）+ 右栏（月历）。
 * 页面组件只消费 `api/workbench.ts` 的函数与纯函数；布局宽度只来自 App 的 `layout()`
 * （右栏三档降级 docked/narrowed/overlay 由它算，组件只执行结论）。
 *
 * 边界（09-boundary，用户拍板）：工作台**只读**——看内容、做筛选，没有"让 Agent 做事"的控件；
 * 唯一的写入口是「写一条」（自己的东西，S1 是骨架，发布 S2 接工具）。
 *
 * 四态（规范 2.32/2.33）：每个列表**就绪与失败分开**；失败只在没有内容时成为表面
 * （原因 + 重试，`failureTextOf` 出文案）；骨架与内容结构互斥。
 */
import { useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { AppIcon } from "../design/icons";
import { IconButton, Tabs } from "../design/ui";
import { useDialogFocus } from "../design/overlay";
import { LAYER_CLASS } from "../design/surface";
import { ResizeColumn } from "../design/resize-column";
import { AgentAvatar } from "./agent-avatar";
import { UserAvatar } from "./user-avatar";
import { FeedView } from "./workbench-feed";
import { FailureNotice } from "./workbench-failure";
import { ProjectPane } from "./workbench-projects";
import { WorkbenchCalendar } from "./workbench-calendar";
import { useWorkbench } from "../hooks/useWorkbench";
import type { Agent, UserProfile } from "../hooks/types";
import { todayLocal } from "../api/workbench";
import type { RightMode } from "../design/layout";

export type WorkbenchTab = "all" | "post" | "todo" | "project";

/** rail 顶部的 stories 行：我 + 全部助手（Instagram stories 同构，demo 已验证）。 */
function StoriesRow({ agents, profile, selected, onSelect, onSelectMe }: {
  agents: Agent[];
  profile?: UserProfile;
  /** 选中 = agentId；"me" = 只看我。 */
  selected: string | undefined;
  onSelect: (id: string) => void;
  onSelectMe: () => void;
}) {
  return (
    <div className="flex shrink-0 gap-2.5 overflow-x-auto border-b border-line px-3.5 py-3 [scrollbar-width:none]"
      data-testid="workbench-stories" role="group" aria-label="按作者筛选内容流">
      {/* 我：头像来自用户档案（验收句 1：avatar 为 null 时必须是首字母色块——UserAvatar 内部已处理） */}
      <button type="button" aria-pressed={selected === "me"} onClick={onSelectMe}
        className="flex w-13 shrink-0 flex-col items-center gap-1">
        <span className={`flex h-11 w-11 items-center justify-center rounded-full p-0.5 transition-colors ${
          selected === "me" ? "bg-accent" : "bg-hover hover:bg-ink-300"
        }`}>
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-surface">
            {profile === undefined
              ? <span className="h-10 w-10 animate-pulse rounded-full bg-hover" aria-hidden="true" />
              : <UserAvatar profile={profile} size={40} />}
          </span>
        </span>
        <span className={`w-13 truncate text-center text-micro font-medium ${selected === "me" ? "text-accent" : "text-ink-900"}`}>我</span>
      </button>
      {agents.map((agent) => (
        <button key={agent.id} type="button" aria-pressed={selected === agent.id}
          title={agent.name} onClick={() => onSelect(agent.id)}
          className="flex w-13 shrink-0 flex-col items-center gap-1">
          <span className={`flex h-11 w-11 items-center justify-center rounded-full p-0.5 transition-colors ${
            selected === agent.id ? "bg-accent" : "bg-hover hover:bg-ink-300"
          }`}>
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-surface">
              <AgentAvatar id={agent.id} name={agent.name} {...(agent.avatar !== undefined ? { avatar: agent.avatar } : {})} size={40} />
            </span>
          </span>
          <span className={`w-13 truncate text-center text-micro ${selected === agent.id ? "font-medium text-accent" : "text-ink-500"}`}>
            {agent.name}
          </span>
        </button>
      ))}
    </div>
  );
}

export function WorkbenchSurface({ agents, profile, right, onRightResizeStart, isMobile, onClose }: {
  agents: Agent[];
  profile?: UserProfile;
  /** 右栏几何（App 的 layout() 产物；overlay 档 = 右栏退出布局，月历不渲染）。 */
  right: { width: number; mode: RightMode; budget: number };
  /** 右栏把手按下（App 的 beginDrag("right")）。 */
  onRightResizeStart: (event: ReactMouseEvent) => void;
  isMobile: boolean;
  onClose: () => void;
}) {
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [tab, setTab] = useState<WorkbenchTab>("all");
  /** 作者筛选：undefined = 不筛；"me" = 只看我。 */
  const [agentFilter, setAgentFilter] = useState<string | undefined>(undefined);
  /** 项目多选：undefined = 全选（默认全选，demo 与任务书一致）；否则精确集合。 */
  const [picked, setPicked] = useState<Set<string> | undefined>(undefined);

  const today = useMemo(() => todayLocal(now), [now]);
  const data = useWorkbench(month);
  const projectsValue = data.projects.value ?? [];
  const feedValue = data.feed.value ?? [];
  const selectedIds = useMemo(
    () => (picked === undefined ? new Set(projectsValue.map((project) => project.id)) : picked),
    [picked, projectsValue],
  );
  const toggleProject = (id: string) => {
    const base = picked === undefined ? new Set(projectsValue.map((project) => project.id)) : new Set(picked);
    if (base.has(id)) base.delete(id); else base.add(id);
    setPicked(base);
  };
  const shiftMonth = (delta: number) => {
    setMonth((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  // 内容流计数（tabs 用；就绪才显数字——columnCountOf 的同一条纪律）。
  // S1 的 feed 里全是动态/笔记（待办 S3 接入），与 filterFeedOf 同口径：post = 全部。
  const postCount = feedValue.length;
  /** S1 无待办数据（S3 接 users/todo 后从这里喂），常量挂在唯一这一处。 */
  const todoCount = 0;
  const countLabel = (base: string, count: number | undefined) => (count === undefined ? base : `${base} ${count}`);
  const projectCount = data.projects.ready ? projectsValue.length : undefined;
  const tabOptions: Array<{ value: WorkbenchTab; label: string }> = [
    { value: "all", label: countLabel("全部", data.feed.ready ? feedValue.length : undefined) },
    { value: "post", label: countLabel("动态 / 笔记", data.feed.ready ? postCount : undefined) },
    { value: "todo", label: `待办 ${todoCount}` },
    { value: "project", label: countLabel("项目", projectCount) },
  ];
  const mobileTabOptions: Array<{ value: WorkbenchTab | "calendar"; label: string }> = [...tabOptions, { value: "calendar", label: "日历" }];
  const [mobileTab, setMobileTab] = useState<WorkbenchTab | "calendar">("all");
  const activeTab = isMobile ? mobileTab : tab;

  /** 月历的 props（桌面右栏与手机日历块共用一份，防两处漂移）。 */
  const calendarProps = {
    year: month.year,
    month: month.month,
    days: data.days.value ?? [],
    today,
    loading: !data.days.ready && data.days.failure === undefined,
    onPrevMonth: () => shiftMonth(-1),
    onNextMonth: () => shiftMonth(1),
    agents,
    stats: {
      projects: projectCount,
      agents: agents.length,
      tasks: data.tasks.ready ? (data.tasks.value ?? []).length : undefined,
    },
  };

  const content: ReactNode = activeTab === "project"
    ? ((data.tasks.failure === undefined || (data.tasks.value?.length ?? 0) > 0) && (data.projects.failure === undefined || (data.projects.value?.length ?? 0) > 0) ? (
        <ProjectPane tasks={data.tasks.value ?? []} projects={projectsValue} agents={agents}
          selected={selectedIds} onToggleProject={toggleProject}
          loading={(!data.tasks.ready && data.tasks.failure === undefined) || (!data.projects.ready && data.projects.failure === undefined)} />
      ) : (
        <FailureNotice failure={(data.tasks.failure ?? data.projects.failure)!} scope="projects"
          onRetry={() => { void data.reloadTasks(); void data.reloadProjects(); }} />
      ))
    : activeTab === "calendar"
      ? <WorkbenchCalendar {...calendarProps}
          {...(data.days.failure !== undefined && (data.days.value?.length ?? 0) === 0
            ? { failed: data.days.failure, onRetry: () => { void data.reloadDays(); } } : {})} />
      : ((data.feed.failure === undefined || feedValue.length > 0) ? (
          <FeedView feed={feedValue} tab={activeTab} agentFilter={agentFilter} agents={agents} profile={profile}
            today={today} loading={!data.feed.ready && data.feed.failure === undefined}
            onClearFilter={() => setAgentFilter(undefined)} />
        ) : (
          <FailureNotice failure={data.feed.failure!} scope="feed" onRetry={() => { void data.reloadFeed(); }} />
        ));

  // 手机全屏表面：焦点陷阱 + Esc + 锁滚动（与 Modal 同一条契约；关后还焦点）
  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(panelRef, onClose, { enabled: isMobile });

  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <StoriesRow agents={agents} profile={profile} selected={agentFilter}
        onSelect={(id) => setAgentFilter((current) => (current === id ? undefined : id))}
        onSelectMe={() => setAgentFilter((current) => (current === "me" ? undefined : "me"))} />
      <div className={`shrink-0 px-3.5 pt-2.5 ${isMobile ? "pb-2.5" : ""}`}>
        {isMobile
          ? <Tabs value={mobileTab} options={mobileTabOptions} onChange={setMobileTab} label="工作台分区" idPrefix="workbench" block />
          : <Tabs value={tab} options={tabOptions} onChange={setTab} label="工作台分区" idPrefix="workbench" />}
      </div>
      <div id={`workbench-panel-${activeTab}`} role="tabpanel" aria-labelledby={`workbench-tab-${activeTab}`}
        data-testid="workbench-panel" data-panel={activeTab}
        className="flex min-h-0 flex-1 flex-col">
        {content}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="我的工作台"
        className={`fixed inset-0 flex flex-col bg-surface ${LAYER_CLASS.drawer}`}
        style={{ height: "var(--app-height, 100dvh)" }}>
        <header className="flex h-11 shrink-0 items-center gap-2 px-2 pt-safe">
          <IconButton label="返回" onClick={onClose}><AppIcon name="arrow-left" size={18} /></IconButton>
          <h1 className="min-w-0 truncate text-body font-semibold text-ink-900">我的工作台</h1>
        </header>
        <div className="min-h-0 flex-1 pb-safe">{body}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface" data-testid="workbench-surface">
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">{body}</section>
        {/*
          右栏（月历）：三档降级由 layout() 算——docked=用户宽度 / narrowed=钳到 220 / overlay=退出布局。
          overlay 档不渲染（宽度为 0）：月历在 <684 的窗口暂不可达，是已批准方案的已知边界（S1）。
          ResizeColumn = 可拖宽的唯一实现（写上标记就生效，门禁自动枚举 data-resize-key）。
        */}
        {right.mode !== "overlay" && (
          <ResizeColumn resizeKey="right" side="left" width={right.width} ariaLabel="工作台日历栏"
            onStart={onRightResizeStart}
            className="border-l border-nav-line bg-nav-bg" testId="workbench-right">
            <WorkbenchCalendar {...calendarProps} />
          </ResizeColumn>
        )}
      </div>
    </div>
  );
}
