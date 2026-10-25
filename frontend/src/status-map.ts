// 状态映射（任务 0008）：会话 → 项目 → Agent 的运行与未读，全部由同一份会话事实派生。
// 服务端只存会话级事实（运行快照 + 未读快照 + 事件）；这里只做派生，不另存一份聚合（避免两份数据不一致）。
//
// 语义（与 run-facts.ts 的拍板一致；层级计数规则 2026-10-25 用户明确）：
// - running：有回合正在生成 → 呼吸点；向上"或"（任一子会话在跑 → 上层在跑）。
// - unread：有回合完成/失败，且用户还没在前台看过 → 会话绿点。
// - 数字（只在 Project 与 Agent 层显示，绿点 = 数字 > 0）：
//   · Project 的数字 = 其下**未查看的会话个数**；
//   · Agent 的数字 = 其下**需要查看的 Project 个数**（有任一未看会话的 Project）。
//   Agent 不是会话数之和：一个 Project 看完一部分不会让 Agent 的数字变化，只有它被看完才减一。
// - 查看即消：焦点会话在页面可见时不计未读（查看动作在服务端 focus 上报与本地 markViewed 两侧都会生效）。

export type StatusMeta = { agentId: string; projectId?: string | undefined };

export type StatusFacts = {
  /** 会话归属（快照/事件/列表学到的）。 */
  sessions: Record<string, StatusMeta | undefined>;
  /** 正在跑的会话 id。 */
  running: string[];
  /** 有未读完成的会话 id（未考虑焦点）。 */
  unread: string[];
};

export type StatusFocus = { agentId?: string | undefined; sessionId?: string | undefined; visible: boolean };

export type Status = { running: boolean; unread: number };

export type DerivedStatus = {
  sessions: Record<string, { running: boolean; unread: boolean }>;
  /** 键 = projectKey(agentId, projectId) */
  projects: Record<string, Status>;
  agents: Record<string, Status>;
};

export const projectKey = (agentId: string, projectId: string): string => `${agentId}\u0000${projectId}`;

export function deriveStatus(facts: StatusFacts, focus: StatusFocus): DerivedStatus {
  const running = new Set(facts.running);
  const unread = new Set(facts.unread);
  const sessions: DerivedStatus["sessions"] = {};
  const projects: Record<string, Status> = {};
  const agents: Record<string, Status> = {};

  // Agent 层的未读数字 = 有未看会话的 Project 集合（去重），所以要记下每个 Agent 下哪些 Project 需要查看
  const agentUnreadProjects = new Map<string, Set<string>>();
  const NO_PROJECT = "\u0001";   // 没有归属 Project 的未读会话，按一个未归属的 Project 计
  const mark = (bucket: Record<string, Status>, key: string, isRunning: boolean, unreadCount: number) => {
    const current = bucket[key] ?? { running: false, unread: 0 };
    bucket[key] = { running: current.running || isRunning, unread: current.unread + unreadCount };
  };

  for (const [sessionId, meta] of Object.entries(facts.sessions)) {
    if (meta === undefined) continue;
    const watching = focus.visible && focus.sessionId === sessionId && focus.agentId === meta.agentId;
    const isRunning = running.has(sessionId);
    const isUnread = unread.has(sessionId) && !watching;
    sessions[sessionId] = { running: isRunning, unread: isUnread };
    const projectId = meta.projectId ?? NO_PROJECT;
    if (isUnread) {
      const set = agentUnreadProjects.get(meta.agentId) ?? new Set<string>();
      set.add(projectId);
      agentUnreadProjects.set(meta.agentId, set);
    }
    // Project 层：数字 = 未看会话个数（只有有归属的会话才有 Project 键，不臆造）
    if (meta.projectId !== undefined) mark(projects, projectKey(meta.agentId, meta.projectId), isRunning, isUnread ? 1 : 0);
    // Agent 层：运行照常"或"；数字在下面按 Project 个数统一写入
    mark(agents, meta.agentId, isRunning, 0);
  }
  for (const [agentId, set] of agentUnreadProjects) {
    const current = agents[agentId] ?? { running: false, unread: 0 };
    agents[agentId] = { running: current.running, unread: set.size };
  }
  return { sessions, projects, agents };
}
