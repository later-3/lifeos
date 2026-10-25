// 事件管道守卫（2026-10-24 C119）：终态必须归属到"当前回合"，并且丢弃快照之前的旧事件。
// 这两条与"快照优先（snapshot-first）"配套：重连拿到新快照后，旧事件不允许再影响 UI。

/**
 * 终态事件是否属于"另一个回合"。
 * - 事件没有 turnId（老数据）→ 不拦（退化为 seq 守卫）；
 * - 当前没有活动回合（activeTurnId=null）→ 不拦（可能是重连后才收到终态，交给 turn 状态兜底）；
 * - 两者都有且不同 → 是旧回合的终态，必须丢弃。
 */
export function isStaleTerminal(payloadTurnId: string | undefined, activeTurnId: string | null): boolean {
  if (payloadTurnId === undefined) return false;
  if (activeTurnId === null) return false;
  return payloadTurnId !== activeTurnId;
}

/** busy 是否属于当前会话（切会话/切 Agent 后旧 busy 不得对账新会话，C120）。 */
export function busyBelongsTo(busySession: string | undefined, currentSession: string | undefined): boolean {
  return busySession !== undefined && currentSession !== undefined && busySession === currentSession;
}
