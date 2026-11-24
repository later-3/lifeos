import { useEffect, useRef, useState } from "react";
import { AgentAvatar, type AgentAvatarSpec } from "./agent-avatar";
import { useDialogFocus } from "../design/overlay";
import { useInstallPrompt } from "../use-mobile";
import { Button, IconButton, Row } from "../design/ui";
import { LAYER_CLASS, SURFACE, surfaceStyle } from "../design/surface";
import { AppIcon } from "../design/icons";

type AgentLite = { id: string; name: string; avatar?: AgentAvatarSpec };
type ProjectLite = { id: string; name: string; isDefault?: boolean };
/**
 * 手机导航只用到三样东西（标题 / 是否在跑 / 是否未读），所以这里声明的是一份**投影**，
 * 由 App 从 `SessionRow` 映射而来 —— 手机导航不直接吃整个行对象，避免它跟着后端字段一起改。
 * （任务 0005：`title` 是显示形态、`running` 来自 `activity.state`。）
 */
/**
 * 会话行的**投影**（不是整个 SessionRow）：手机导航只要这几样。
 * `titleRaw` 是重命名要用的原文（与 `title` 分开：`title` 是显示形态，可能被截断）。
 */
type SessionLite = { sessionId: string; title: string; titleRaw?: string; running?: boolean };
type GroupLite = { project: ProjectLite; sessions: SessionLite[] };
export type Level = "agents" | "projects" | "sessions";

/**
 * 抽屉列表一页多少条（Task 0016 · P7-S4）。
 *
 * 手机抽屉是 drill-down（一级一屏），所以项目与会话的列表都**可能有几百条**：
 * 实测主家目录某个 Agent 的 workspace 下 11 条会话；用户真实使用时每项目几十到上百条很正常。
 * 首屏只渲染一页 + 一个"显示更多"，比虚拟滚动便宜得多（同一结论见 P4 的分页渲染）。
 *
 * 20 的依据：手机一屏可见行数 ≈ 13–15 行（`Row` 44 高），留一页余量以便"再多看一点"，
 * 同时把首屏 DOM 控制在 20 行级别。
 */
const PAGE_SIZE = 20;

/**
 * 手机导航：多级 drill-down（助手 → 项目 → 会话），而不是“点一下就关”。
 * 参考 iOS/Linear/ChatGPT 手机端：选中上一级进入下一级，header 有返回；选到会话才关闭。
 */
export function MobileNav({ open, level, onLevelChange, onBack, onClose, agents, groups, agent, projectId, sessionId, canNewSession,
  onSelectAgent, onSelectProject, onOpenSession, onNewSession, onAddProject, onConfigAgent,
  onOpenProjectInfo, onRenameSession, onDeleteSession, renaming, onRenameChange, onRenameCommit, onRenameCancel,
  onOpenWorkbench }: {
  open: boolean;
  level: Level;
  onLevelChange: (level: Level) => void;
  onBack: () => void;
  onClose: () => void;
  agents: AgentLite[];
  groups: GroupLite[];
  agent?: AgentLite;
  projectId?: string;
  sessionId?: string;
  /** 当前是否还能“新建会话”：已经在草稿里就不行（决策：草稿态禁点新建会话）。 */
  canNewSession: boolean;
  onSelectAgent: (agent: AgentLite) => Promise<void> | void;
  onSelectProject: (project: ProjectLite) => Promise<void> | void;
  onOpenSession: (sessionId: string) => void;
  onNewSession: () => void;
  onAddProject: () => void;
  onConfigAgent: () => void;
  /**
   * 会话动作（P7-S1）：重命名与删除。
   *
   * 为什么必须在这里给：桌面在分组行上挂了这两个动作（`App.tsx` 的 `SessionRow`），
   * 而手机会话列表是这个抽屉 —— 它的行里只有标题和一个运行圆点，
   * **实测手机完全无法重命名或删除任何会话**（`knowledge/component-mobile-audit.md` §2.2）。
   * 业务实现仍走 App 的 `commitRename` / `setConfirm`（不复制一套写逻辑）。
   */
  /**
   * 项目概览（P7-S2）：点项目行的"信息"按钮。
   *
   * 为什么需要：桌面的入口是分组头的计数药丸（`App.tsx` 的 `onOverview`），而 `leftColumns`
   * 在手机上整块不渲染 —— **手机上完全看不到项目概览**（路径/任务/知识库计数/移除项目）。
   */
  onOpenProjectInfo?: (projectId: string) => void;
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  /**
   * 重命名的受控态（与桌面 `SessionRow` 用同一个 `renaming` 状态，由 App 持有）。
   *
   * 为什么不在抽屉里自己管一份：重命名是**写操作**，两处各管一份必然出现
   * "抽屉里改完、桌面列表还显示旧标题"。规范 2.12：跨作用域状态必须带归属、只有一份事实。
   */
  renaming?: { sid: string; value: string };
  onRenameChange?: (value: string) => void;
  onRenameCommit?: (value: string) => void;
  onRenameCancel?: () => void;
  /** 打开「我的工作台」（Task 0023 · S1）：抽屉第一级的一行入口 → 独立全屏表面。 */
  onOpenWorkbench?: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const install = useInstallPrompt();
  useDialogFocus(panel, onClose, { enabled: open });
  /** 当前展开动作菜单的会话 id（同一时刻只允许一个；点行/切级/关抽屉都清）。 */
  const [menuFor, setMenuFor] = useState<string | undefined>(undefined);
  /**
   * 当前级显示到第几条（P7-S4）。
   *
   * 为什么按"级"重置：`projects` 与 `sessions` 是两个不同的列表，
   * 共享一个水位会让"在项目级点了显示更多"影响到会话级（且切级后无从解释）。
   */
  const [visibleRows, setVisibleRows] = useState(PAGE_SIZE);
  // 切级或关闭时清空：菜单与列表水位都是某一级的临时态
  useEffect(() => { setMenuFor(undefined); setVisibleRows(PAGE_SIZE); }, [level, open]);
  if (!open) return null;

  const currentGroup = groups.find((group) => group.project.id === projectId);
  const currentProject = currentGroup?.project;
  const sessions = currentGroup?.sessions ?? [];
  const title = level === "agents" ? "助手" : level === "projects" ? "项目" : "会话";
  const subtitle = level === "agents" ? (agent?.name ?? "选择一个助手") : level === "projects" ? (agent?.name ?? "") : (currentProject?.name ?? "");

  return (
    <div ref={panel} role="dialog" aria-modal="true" aria-label="导航"
      className={`fixed inset-0 ${LAYER_CLASS.drawer} flex flex-col bg-surface sm:hidden`} data-testid="mobile-nav"
      data-mobile-level={level} style={{ height: "var(--app-height, 100dvh)" }}>
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-line px-4 pt-safe">
        {level !== "agents" ? (
          <Button variant="ghost" size="sm" aria-label="返回上一级" onClick={onBack}><AppIcon name="arrow-left" size={18} /> 返回</Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-ink-900">{title}</p>
          <p className="truncate text-micro text-ink-500">{subtitle}</p>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="关闭导航"><AppIcon name="x" size={18} /> 关闭</Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {level === "agents" && (
          <Row key="workbench" testId="mobile-workbench-entry" onClick={onOpenWorkbench}
            participants={<span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent"><AppIcon name="folder" size={18} /></span>}
            meta="你的待办、项目与全部内容">我的工作台</Row>
        )}
        {level === "agents" && agents.map((item) => (
          <Row key={item.id} testId="mobile-agent-row" selected={item.id === agent?.id}
            /*
             * 切级**立即发生**，不等 Agent 数据（2026-11-17 用户实测："点 agent 到会话页面有时候还是卡"）。
             *
             * 改之前是 `onSelectAgent(item).then(() => onLevelChange("projects"))` ——
             * 也就是"等 Agent 的 projects + 每个项目的 sessions 全部回来、**并且**它自动打开的那个
             * 会话也加载完"才切级。实测（390×844，模拟 300ms 延迟 + CPU 4x）：**2850 ms**
             * 抽屉一动不动，用户看到的是"点了没反应"。
             *
             * 现在：两个调用在**同一个 tick** 里发出。`selectAgent()` 的前半段（setAgent、
             * 缓存优先 setGroups）是同步的，所以这一帧就能渲染出该 Agent 的项目列表；
             * 网络回来的部分（远端列表、自动打开的最新会话）在后台补齐——
             * 聊天区那边已有骨架顶住（P1-S1），不会显示"对话是空的"。
             */
            onClick={() => { void onSelectAgent(item); onLevelChange("projects"); }}>
            <AgentAvatar id={item.id} name={item.name} avatar={item.avatar} size={24} />
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
          </Row>
        ))}

        {level === "projects" && groups.slice(0, visibleRows).map((group) => (
          <Row key={group.project.id} testId="mobile-project-row" selected={group.project.id === projectId}
            onClick={() => { void Promise.resolve(onSelectProject(group.project)).then(() => onLevelChange("sessions")); }}
            /* 信息按钮常显（同会话行 ⋯ 的理由：触屏没有 hover，且这里点行就进会话） */
            actionsAlwaysVisible
            actions={onOpenProjectInfo === undefined ? undefined : (
              <IconButton label="项目概览" size="sm" data-project-info={group.project.id}
                onClick={() => onOpenProjectInfo(group.project.id)}>
                <AppIcon name="info" size={14} />
              </IconButton>
            )}>
            <span className="min-w-0 flex-1 truncate">{group.project.name}</span>
            <span className="text-micro text-ink-500">{group.sessions.length}</span>
          </Row>
        ))}
        {level === "projects" && groups.length === 0 && <p className="px-3 py-8 text-center text-meta text-ink-500">还没有项目</p>}

        {level === "sessions" && sessions.slice(0, visibleRows).map((item) => (
          <Row key={item.sessionId} testId="mobile-session-row" selected={item.sessionId === sessionId}
            onClick={renaming?.sid === item.sessionId ? undefined : () => onOpenSession(item.sessionId)}
            /* 动作放 Row 的 actions 槽（与主点击区是兄弟，不嵌套 —— axe nested-interactive 的既有教训）。
               **触屏没有 hover**：Row 的 actions 槽在 `@media(hover:none)` 下只在 focus 内可见，
               手机点一下就焦点离开 = 永远看不到。所以这里显式给一个常显的 ⋯ 按钮，
               点它才展开动作（不是"划一下才出现"—— 那在手机上等于不存在）。 */
            actionsAlwaysVisible
            actions={(onRenameSession !== undefined || onDeleteSession !== undefined) ? (
              <IconButton label="会话操作" size="sm" data-session-actions={item.sessionId}
                onClick={() => setMenuFor(menuFor === item.sessionId ? undefined : item.sessionId)}>
                <AppIcon name="adjustments-horizontal" size={14} />
              </IconButton>
            ) : undefined}>
            {renaming?.sid === item.sessionId ? (
              /* 就地重命名（与桌面同一个交互）：Enter 提交、Esc 取消、失焦取消。
                 输入框 44 高，符合手机触控目标。 */
              <input autoFocus value={renaming.value} aria-label="会话名称"
                onChange={(event) => onRenameChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); onRenameCommit?.(event.currentTarget.value); }
                  if (event.key === "Escape") { event.preventDefault(); onRenameCancel?.(); }
                }}
                onBlur={() => onRenameCancel?.()}
                onClick={(event) => event.stopPropagation()}
                className="h-11 min-w-0 flex-1 rounded-control bg-surface px-2 text-body text-ink-900 ring-1 ring-accent" />
            ) : (
              <span className="min-w-0 flex-1 truncate">{item.title || "未命名"}</span>
            )}
            {item.running === true && <span className="h-1.5 w-1.5 rounded-full bg-success" title="生成中" />}
          </Row>
        ))}
        {/* 动作菜单：浮在抽屉底部（不用绝对定位贴行 —— 行会随滚动离开视口）。
            两项都是 44 高；删除走 App 的确认对话框（危险操作不当场执行）。 */}
        {level === "sessions" && menuFor !== undefined && (() => {
          const target = sessions.find((item) => item.sessionId === menuFor);
          if (target === undefined) return null;
          return (
            /* 浮层配方只从 design/surface.ts 取（规范 2.22）：阴影用主题提供的 surface 变量
               （深浅色各一套），边界用 ring（border 占布局，两个浮层并排会差 1px）。
               原先这里手写任意值阴影 —— lint:tokens 判违规，而且固定黑投影在深色底下几乎不可见，
               正是规范 2.22 立条时审计到的那个病。 */
            <div role="menu" aria-label="会话操作" data-testid="session-actions-menu"
              className={`mx-2 my-1 flex flex-col ${LAYER_CLASS.popover} ${SURFACE.popover.radius} ring-1 ring-line bg-surface`}
              style={surfaceStyle("popover")}>
              <button type="button" role="menuitem"
                className="flex h-11 items-center gap-2 rounded-t-panel px-3 text-left text-body text-ink-900 hover:bg-hover"
                onClick={() => { setMenuFor(undefined); onRenameSession?.(target.sessionId, target.titleRaw ?? target.title); }}>
                <AppIcon name="pencil" size={16} /> 重命名
              </button>
              <button type="button" role="menuitem"
                className="flex h-11 items-center gap-2 rounded-b-panel border-t border-line px-3 text-left text-body text-danger hover:bg-hover"
                onClick={() => { setMenuFor(undefined); onDeleteSession?.(target.sessionId); }}>
                <AppIcon name="trash" size={16} /> 删除
              </button>
            </div>
          );
        })()}
        {level === "sessions" && sessions.length === 0 && <p className="px-3 py-8 text-center text-meta text-ink-500">还没有会话</p>}
        {/*
          分页"显示更多"（P7-S4）：项目级与会话级共用同一个水位。
          用 `Button`（primitive，内部才是原生 button）而不是 `Row`（div role=button）——
          后者会被 `[data-mobile-level] [role="button"]` 的选择器当成"一行"，
          现有契约与键盘行为都按"每行一个实体"写的。
        */}
        {(() => {
          const total = level === "projects" ? groups.length : level === "sessions" ? sessions.length : 0;
          if (total <= visibleRows) return null;
          return (
            <div className="px-2 py-1">
              <Button variant="ghost" className="w-full" data-testid="load-more-rows"
                onClick={() => setVisibleRows((current) => current + PAGE_SIZE)}>
                显示更多（还有 {total - visibleRows} 条）
              </Button>
            </div>
          );
        })()}
      </div>

      <footer className="shrink-0 border-t border-line p-3 pb-safe">
        {install.canInstall && (
          <Button variant="secondary" className="mb-2 w-full" onClick={() => void install.install()}>安装 Life OS</Button>
        )}
        {level === "agents" ? (
          <Button className="w-full" disabled={agent === undefined} onClick={onConfigAgent}>配置当前助手</Button>
        ) : level === "projects" ? (
          <Button className="w-full" onClick={onAddProject}><AppIcon name="plus" size={16} /> 添加项目</Button>
        ) : (
          <Button className="w-full disabled:bg-sunken disabled:ring-0" disabled={!canNewSession} onClick={onNewSession}><AppIcon name="plus" size={16} /> 新建会话</Button>
        )}
      </footer>
    </div>
  );
}
