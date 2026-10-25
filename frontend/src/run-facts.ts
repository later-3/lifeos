// 运行事实 store（协议 P1·1.4 / specs 2.10：呈现层不得直接消费原始事件流）。
// 纯函数：事件 → 每个会话的 {running, unread, queue, lastTurn}；三态列表、状态条、未来的通知都只是它的消费者。
// 语义（用户拍板 2026-10-24）：运行中 = 呼吸点；完成未读 = 消失前的绿点（成为焦点即清）；已读 = 时间。

export type TurnStateMini = "running" | "done" | "error";
export type TurnFact = { turnId: string; state: TurnStateMini; at: number };
export type QueueItem = { behavior: "steer" | "followUp"; text: string };

export type RunFacts = {
  /** snapshot.running[]：进程内所有在跑会话的会话 id 集 */
  snapRunning: string[];
  /** 每会话最近一次 turn 事实 */
  lastTurn: Record<string, TurnFact | undefined>;
  /** 完成未读：回合 done/error 但该会话不是当时的焦点 */
  unread: Record<string, true | undefined>;
  /** 排队区（本期仅可见）：会话在跑时投递的 steer/followUp */
  queue: Record<string, QueueItem[] | undefined>;
  /** 会话归属（任务 0008）：状态映射要用它做 Session → Project → Agent 的聚合 */
  meta: Record<string, { agentId: string; projectId?: string | undefined } | undefined>;
};

export const emptyRunFacts = (): RunFacts => ({ snapRunning: [], lastTurn: {}, unread: {}, queue: {}, meta: {} });

/** 把事件/快照里带的归属写进 meta（只补全，不清空：归属一旦知道就一直有效）。 */
function withMeta(meta: RunFacts["meta"], sessionId: string | undefined, agentId: string | undefined, projectId: string | undefined): RunFacts["meta"] {
  if (sessionId === undefined || sessionId === "" || agentId === undefined || agentId === "") return meta;
  const current = meta[sessionId];
  if (current !== undefined && current.agentId === agentId && (projectId === undefined || current.projectId === projectId)) return meta;
  return { ...meta, [sessionId]: { agentId, ...(projectId !== undefined ? { projectId } : current?.projectId !== undefined ? { projectId: current.projectId } : {}) } };
}

export type RunStreamEvent =
  | { sessionId?: string; agentId?: string; projectId?: string; type: "turn"; turnId: string; state: TurnStateMini }
  | { type: "snapshot"; running: { sessionId: string }[] };

/** 事件折叠（immutable）：turn / snapshot 两类；其他事件不产生运行事实。 */
export function applyRunEvent(facts: RunFacts, event: RunStreamEvent, now: number, focusSessionId?: string): RunFacts {
  if (event.type === "snapshot") {
    const snap = event.running.map((entry) => entry.sessionId);
    return { ...facts, snapRunning: [...new Set(snap)] };
  }
  if (event.type === "turn" && typeof event.sessionId === "string" && event.sessionId !== "") {
    const sid = event.sessionId;
    const lastTurn: Record<string, TurnFact | undefined> = { ...facts.lastTurn, [sid]: { turnId: event.turnId, state: event.state, at: now } };
    const unread: Record<string, true | undefined> = { ...facts.unread };
    if ((event.state === "done" || event.state === "error") && sid !== focusSessionId) unread[sid] = true;
    const meta = withMeta(facts.meta, sid, event.agentId, event.projectId);
    if (event.state !== "running") {
      const queue: Record<string, QueueItem[] | undefined> = { ...facts.queue, [sid]: undefined };
      return { ...facts, lastTurn, unread, queue, meta };
    }
    return { ...facts, lastTurn, unread, meta };
  }
  return facts;
}

/** 会话在跑 = 快照里在 OR 最近 turn 事实还是 running（事件更快、快照兜底）。 */
export function isRunning(facts: RunFacts, sessionId?: string): boolean {
  if (sessionId === undefined || sessionId === "") return false;
  if (facts.snapRunning.includes(sessionId)) return true;
  return facts.lastTurn[sessionId]?.state === "running";
}

/** 该会话有没有"完成未读"。 */
export function hasUnread(facts: RunFacts, sessionId?: string): boolean {
  if (sessionId === undefined) return false;
  return facts.unread[sessionId] === true;
}

/** 成为焦点即清未读（immutable）。 */
export function markViewed(facts: RunFacts, sessionId: string): RunFacts {
  if (facts.unread[sessionId] !== true) return facts;
  const unread = { ...facts.unread };
  delete unread[sessionId];
  return { ...facts, unread };
}

/** 排队区入列（本期仅可见）。 */
export function queueAdd(facts: RunFacts, sessionId: string, item: QueueItem): RunFacts {
  const rows = [...(facts.queue[sessionId] ?? []), item];
  return { ...facts, queue: { ...facts.queue, [sessionId]: rows } };
}

/** 回合收尾即清排队区（turn done/error 已在 applyRunEvent 处理 snapshot 路径，这里给 abort/手动清）。 */
export function queueClear(facts: RunFacts, sessionId: string): RunFacts {
  if (facts.queue[sessionId] === undefined) return facts;
  return { ...facts, queue: { ...facts.queue, [sessionId]: undefined } };
}

/** 服务端明确说某会话不在跑时，清掉残留的 running 事实（切回会话/后台回合结束后）。 */
export function settleStopped(facts: RunFacts, sessionId: string | undefined, now: number): RunFacts {
  if (sessionId === undefined || sessionId === "") return facts;
  const previous = facts.lastTurn[sessionId];
  if (previous === undefined || previous.state !== "running") return facts;
  return { ...facts, lastTurn: { ...facts.lastTurn, [sessionId]: { ...previous, state: "done", at: now } } };
}

/**
 * 快照（任务 0007）：服务端的运行集合与未读是真相，整体替换本地事实。
 * 断线期间已经结束的回合，本地残留的 running 必须清掉（否则会永远显示"运行中"）。
 */
export function applySnapshotFacts(
  facts: RunFacts,
  snapshot: {
    running: Array<{ sessionId: string; agentId?: string; projectId?: string }>;
    unread: Array<{ sessionId: string; agentId?: string; projectId?: string }>;
  },
  now: number,
): RunFacts {
  let meta = facts.meta;
  for (const entry of [...snapshot.running, ...snapshot.unread]) meta = withMeta(meta, entry.sessionId, entry.agentId, entry.projectId);
  const runningIds = [...new Set(snapshot.running.map((entry) => entry.sessionId))];
  const lastTurn: Record<string, TurnFact | undefined> = { ...facts.lastTurn };
  for (const [sessionId, fact] of Object.entries(lastTurn)) {
    if (fact?.state === "running" && !runningIds.includes(sessionId)) lastTurn[sessionId] = { ...fact, state: "done", at: now };
  }
  const unread: Record<string, true | undefined> = {};
  for (const entry of snapshot.unread) unread[entry.sessionId] = true;
  return { ...facts, snapRunning: runningIds, lastTurn, unread, meta };
}

/** 批量写入会话归属（列表加载、事件携带时）：只补全，不清空。 */
export function rememberMeta(
  facts: RunFacts,
  entries: Array<{ sessionId: string; agentId: string; projectId?: string | undefined }>,
): RunFacts {
  let meta = facts.meta;
  for (const entry of entries) meta = withMeta(meta, entry.sessionId, entry.agentId, entry.projectId);
  return meta === facts.meta ? facts : { ...facts, meta };
}
