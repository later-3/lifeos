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
};

export const emptyRunFacts = (): RunFacts => ({ snapRunning: [], lastTurn: {}, unread: {}, queue: {} });

export type RunStreamEvent =
  | { sessionId?: string; type: "turn"; turnId: string; state: TurnStateMini }
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
    if (event.state !== "running") {
      const queue: Record<string, QueueItem[] | undefined> = { ...facts.queue, [sid]: undefined };
      return { ...facts, lastTurn, unread, queue };
    }
    return { ...facts, lastTurn, unread };
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
