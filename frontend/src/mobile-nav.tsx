import { useRef } from "react";
import { IconArrowLeft, IconPlus, IconX } from "@tabler/icons-react";
import { AgentAvatar, type AgentAvatarSpec } from "./agent-avatar";
import { useDialogFocus } from "./design/overlay";
import { useInstallPrompt } from "./use-mobile";
import { Button, Row } from "./design/ui";

type AgentLite = { id: string; name: string; avatar?: AgentAvatarSpec };
type ProjectLite = { id: string; name: string; isDefault?: boolean };
type SessionLite = { sessionId: string; title: string; updatedAt: string; running?: boolean };
type GroupLite = { project: ProjectLite; sessions: SessionLite[] };
export type Level = "agents" | "projects" | "sessions";

/**
 * 手机导航：多级 drill-down（助手 → 项目 → 会话），而不是“点一下就关”。
 * 参考 iOS/Linear/ChatGPT 手机端：选中上一级进入下一级，header 有返回；选到会话才关闭。
 */
export function MobileNav({ open, level, onLevelChange, onBack, onClose, agents, groups, agent, projectId, sessionId,
  onSelectAgent, onSelectProject, onOpenSession, onNewSession, onAddProject, onConfigAgent }: {
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
  onSelectAgent: (agent: AgentLite) => Promise<void> | void;
  onSelectProject: (project: ProjectLite) => Promise<void> | void;
  onOpenSession: (sessionId: string) => void;
  onNewSession: () => void;
  onAddProject: () => void;
  onConfigAgent: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const install = useInstallPrompt();
  useDialogFocus(panel, onClose, { enabled: open });
  if (!open) return null;

  const currentGroup = groups.find((group) => group.project.id === projectId);
  const currentProject = currentGroup?.project;
  const sessions = currentGroup?.sessions ?? [];
  const title = level === "agents" ? "助手" : level === "projects" ? "项目" : "会话";
  const subtitle = level === "agents" ? (agent?.name ?? "选择一个助手") : level === "projects" ? (agent?.name ?? "") : (currentProject?.name ?? "");

  return (
    <div ref={panel} role="dialog" aria-modal="true" aria-label="导航"
      className="fixed inset-0 z-50 flex flex-col bg-surface sm:hidden" data-testid="mobile-nav"
      data-mobile-level={level} style={{ height: "var(--app-height, 100dvh)" }}>
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-line px-4 pt-safe">
        {level !== "agents" ? (
          <Button variant="ghost" size="sm" aria-label="返回上一级" onClick={onBack}><IconArrowLeft size={18} /> 返回</Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-ink-900">{title}</p>
          <p className="truncate text-micro text-ink-500">{subtitle}</p>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="关闭导航"><IconX size={18} /> 关闭</Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {level === "agents" && agents.map((item) => (
          <Row key={item.id} selected={item.id === agent?.id}
            onClick={() => { void Promise.resolve(onSelectAgent(item)).then(() => onLevelChange("projects")); }}>
            <AgentAvatar id={item.id} name={item.name} avatar={item.avatar} size={24} />
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
          </Row>
        ))}

        {level === "projects" && groups.map((group) => (
          <Row key={group.project.id} selected={group.project.id === projectId}
            onClick={() => { void Promise.resolve(onSelectProject(group.project)).then(() => onLevelChange("sessions")); }}>
            <span className="min-w-0 flex-1 truncate">{group.project.name}</span>
            <span className="text-micro text-ink-500">{group.sessions.length}</span>
          </Row>
        ))}
        {level === "projects" && groups.length === 0 && <p className="px-3 py-8 text-center text-meta text-ink-500">还没有项目</p>}

        {level === "sessions" && sessions.map((item) => (
          <Row key={item.sessionId} selected={item.sessionId === sessionId}
            onClick={() => onOpenSession(item.sessionId)}>
            <span className="min-w-0 flex-1 truncate">{item.title || "未命名"}</span>
            {item.running === true && <span className="h-1.5 w-1.5 rounded-full bg-success" title="生成中" />}
          </Row>
        ))}
        {level === "sessions" && sessions.length === 0 && <p className="px-3 py-8 text-center text-meta text-ink-500">还没有会话</p>}
      </div>

      <footer className="shrink-0 border-t border-line p-3 pb-safe">
        {install.canInstall && (
          <Button variant="secondary" className="mb-2 w-full" onClick={() => void install.install()}>安装 Life OS</Button>
        )}
        {level === "agents" ? (
          <Button className="w-full" disabled={agent === undefined} onClick={onConfigAgent}>配置当前助手</Button>
        ) : level === "projects" ? (
          <Button className="w-full" onClick={onAddProject}><IconPlus size={16} /> 添加项目</Button>
        ) : (
          <Button className="w-full" onClick={onNewSession}><IconPlus size={16} /> 新建会话</Button>
        )}
      </footer>
    </div>
  );
}
