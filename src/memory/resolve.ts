// 工具参数（scope + projectId）→ 记忆角色（纯函数，便于单测）。
// 规则（docs/requirements/agent-memory.md FR-2/FR-4）：
// - 默认在当前项目；projectId 可在显式指定时用于跨项目；
// - 跨项目只能读该项目的「项目共享记忆」（scope=project），不能写/删；
// - 跨项目不能读别的 Agent 的 agent 的项目记忆。
import type { MemoryRole } from "./roles.ts";

export type MemoryScope = "agent_project" | "project" | "agent" | "user";
export type ResolvedTarget = { role: MemoryRole } | { error: string };

export function resolveMemoryRole(input: {
  agentId: string;
  currentProjectId: string;
  scope: MemoryScope;
  targetProjectId?: string;
  action: "search" | "record" | "delete";
}): ResolvedTarget {
  const projectId = input.targetProjectId ?? input.currentProjectId;
  const crossProject = projectId !== input.currentProjectId;
  if (crossProject && input.scope !== "project") {
    return { error: "跨项目只能访问该项目的项目共享记忆（scope=project）；agent 的项目记忆、Agent 记忆、用户记忆不能跨项目指定" };
  }
  if (crossProject && input.action !== "search") {
    return { error: "不允许跨项目写入或删除记忆（只能读项目共享记忆）" };
  }
  switch (input.scope) {
    case "agent_project": return { role: { kind: "agent_project", agentId: input.agentId, projectId } };
    case "project": return { role: { kind: "project", projectId } };
    case "agent": return { role: { kind: "agent", agentId: input.agentId } };
    case "user": return { role: { kind: "user" } };
  }
}
