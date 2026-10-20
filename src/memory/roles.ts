// 记忆的四种角色与落点（docs/architecture/agent-memory.md §2）。
// 纯逻辑：只回答"哪个角色 → 哪个目录"，不启动 MemOS、不读模型配置。
import { join } from "node:path";
import { resolveHome } from "../home.ts";
import { sanitizeSegment } from "../projects.ts";

export const DEFAULT_USER_ID = "default";

export type MemoryRole =
  | { kind: "user"; userId?: string }
  | { kind: "agent"; agentId: string }
  | { kind: "agent_project"; agentId: string; projectId: string }
  | { kind: "project"; projectId: string };

const seg = (value: string): string => sanitizeSegment(value);

export function roleKey(role: MemoryRole): string {
  switch (role.kind) {
    case "user": return `user:${seg(role.userId ?? DEFAULT_USER_ID)}`;
    case "agent": return `agent:${seg(role.agentId)}`;
    case "agent_project": return `agent_project:${seg(role.agentId)}:${seg(role.projectId)}`;
    case "project": return `project:${seg(role.projectId)}`;
  }
}

/**
 * 四个角色各自的存储根：
 * - 用户：跟人走，跨项目/跨 Agent；
 * - Agent：跟 Agent 走，跨项目；
 * - agent 的项目记忆（私有）：跟 Agent 走（放在 Agent 的树里，不写进公用项目）；
 * - 项目共享：跟项目走（项目是全局实体）。
 */
export function storeRoot(role: MemoryRole): string {
  const home = resolveHome();
  switch (role.kind) {
    case "user": return join(home, "memory", "user", seg(role.userId ?? DEFAULT_USER_ID));
    case "agent": return join(home, "agents", seg(role.agentId), "memory");
    case "agent_project": return join(home, "agents", seg(role.agentId), "projects", seg(role.projectId), "memory");
    case "project": return join(home, "projects", seg(role.projectId), "memory");
  }
}

export function roleLabel(role: MemoryRole): string {
  switch (role.kind) {
    case "user": return `用户记忆（${role.userId ?? DEFAULT_USER_ID}）`;
    case "agent": return `Agent 记忆（${role.agentId}）`;
    case "agent_project": return `agent 的项目记忆（${role.agentId} @ ${role.projectId}）`;
    case "project": return `项目共享（${role.projectId}）`;
  }
}

/** 一次检索默认覆盖的角色（越具体越靠前：agent 的项目记忆 → 项目共享 → Agent → 用户）。 */
export function defaultReadOrder(input: { agentId: string; projectId: string; userId?: string }): MemoryRole[] {
  return [
    { kind: "agent_project", agentId: input.agentId, projectId: input.projectId },
    { kind: "project", projectId: input.projectId },
    { kind: "agent", agentId: input.agentId },
    { kind: "user", ...(input.userId !== undefined ? { userId: input.userId } : {}) },
  ];
}
