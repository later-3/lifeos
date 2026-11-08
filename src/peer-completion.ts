// 对话完成回流的**登记簿与投递入口**（Task 0015 · T7）。
//
// 为什么单独成模块（与 `session-runtime.ts` 同一手法）：
//   `agent-host.ts` 需要在回合结束时通知"发起方会话"，
//   而真正的投递要用到 `getSession`（在 agent-host 里）与 lane 快照（在 peer 里）。
//   若让 agent-host 直接 import peer，就形成 agent-host ⇄ peer 的静态环。
//   所以这里只放**不含依赖的登记簿 + 注入点**：peer 在模块加载时注册 deliverer，
//   agent-host 只 import 本模块并调用 `notifyPeerTurnFinished()`。
//
// 语义（02-design §L3 的四条不可省约束）：
//   1. 去重：同一回合只打扰一次（completion key + TTL，容量封顶）；
//   2. 投递成功才清登记（送失败留着，下次再试）；
//   3. 内容里带"下一步该干什么"（在 deliverer 里组装）；
//   4. 不触发新一轮模型调用（deliverer 用 triggerTurn: false）。

/** send 的待回流登记：键 = `目标agent\0目标会话`。 */
export type PendingPeer = {
  initiatorAgentId: string;
  initiatorSessionId: string;
  peerName: string;
  initiatorTaskId?: string;
  projectId: string;
  /**
   * 这一轮"属于 send 的那一轮"的 turnId（Task 0014 · L4）。
   *
   * 为什么需要：登记是**每会话一条**，而一个会话可以被多方驱动。
   * 用户在其中插一手跑了一轮，那一轮结束时不能冒充成 send 的回执。
   * `runTurn` 在占位成功后调用 `bindPendingPeerTurn()` 回填；
   * `notifyPeerTurnFinished()` 只对**匹配**的轮次投递（且不匹配时**不清登记**）。
   * 老登记没有该字段 → 保持旧行为（按会话投递一次）。
   */
  turnId?: string;
};

/** 投递实现由 peer 注入（拿到会话 + 组装正文 + sendCustomMessage）。 */
export type PeerDeliverer = (
  input: PendingPeer & { targetAgentId: string; sessionId: string; turnId: string; state: "done" | "error" },
) => Promise<boolean>;

const pending = new Map<string, PendingPeer>();
const sent = new Map<string, number>();
const COMPLETION_TTL_MS = 10 * 60 * 1000;
const COMPLETION_CAP = 4096;

let deliverer: PeerDeliverer | undefined;

const keyOf = (targetAgentId: string, sessionId: string): string => `${targetAgentId}\u0000${sessionId}`;
const completionKey = (targetAgentId: string, sessionId: string, turnId: string): string =>
  `${targetAgentId}\u0000${sessionId}\u0000${turnId}`;

/** peer 模块加载时注册一次。重复注册覆盖（测试隔离友好）。 */
export function setPeerDeliverer(fn: PeerDeliverer | undefined): void {
  deliverer = fn;
}

/** 登记"这轮结束后要回流给谁"（send 调用时）。 */
export function registerPendingPeer(targetAgentId: string, sessionId: string, entry: PendingPeer): void {
  pending.set(keyOf(targetAgentId, sessionId), entry);
}

/**
 * 把"这一轮"绑到待回流登记上（`runTurn` 在受理成功后调）。
 *
 * 只在该会话**有登记**且**尚未绑定**时写入：
 * - 没登记 → 不做事（普通会话、ask 路径）；
 * - 已绑定 → 不覆盖（同一轮重复调不换 id；后续的轮次也不该抢走 send 的那一轮）。
 */
export function bindPendingPeerTurn(targetAgentId: string, sessionId: string, turnId: string): void {
  const key = keyOf(targetAgentId, sessionId);
  const entry = pending.get(key);
  if (entry === undefined || entry.turnId !== undefined) return;
  pending.set(key, { ...entry, turnId });
}

/** 该会话有没有待回流登记。 */
export function pendingPeerOf(targetAgentId: string, sessionId: string): PendingPeer | undefined {
  return pending.get(keyOf(targetAgentId, sessionId));
}

export function clearPendingPeer(targetAgentId: string, sessionId: string): void {
  pending.delete(keyOf(targetAgentId, sessionId));
}

/** 该回合是否已经回流过（去重判定的唯一入口）。 */
export function completionAlreadySent(targetAgentId: string, sessionId: string, turnId: string): boolean {
  const at = sent.get(completionKey(targetAgentId, sessionId, turnId));
  return at !== undefined && Date.now() - at <= COMPLETION_TTL_MS;
}

/** 标记该回合已回流（带 TTL 清理与容量封顶）。 */
export function markCompletionSent(targetAgentId: string, sessionId: string, turnId: string): void {
  const now = Date.now();
  for (const [key, at] of sent) if (now - at > COMPLETION_TTL_MS) sent.delete(key);
  if (sent.size >= COMPLETION_CAP) {
    const oldest = [...sent.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest !== undefined) sent.delete(oldest[0]);
  }
  sent.set(completionKey(targetAgentId, sessionId, turnId), now);
}

/**
 * 回合结束时的唯一调用点（agent-host 的 done/error 分支）。
 *
 * **永不抛**：通知失败不能影响回合本身的收尾（回合事件、未读、running 清理都还在后面）。
 * 返回 `true` 表示真的投递出去了。
 */
export async function notifyPeerTurnFinished(
  targetAgentId: string,
  sessionId: string,
  turnId: string,
  state: "done" | "error",
): Promise<boolean> {
  const entry = pending.get(keyOf(targetAgentId, sessionId));
  if (entry === undefined) return false;
  // 只认自己那一轮：用户/其它来源在同一会话上跑的轮次不冒充回执，也不消耗登记（Task 0014 · L4）。
  // 老登记（本字段引入前写入）没有 turnId → 保持旧行为（按会话投递一次）。
  if (entry.turnId !== undefined && entry.turnId !== turnId) return false;
  if (deliverer === undefined) return false;
  if (completionAlreadySent(targetAgentId, sessionId, turnId)) return false;
  try {
    const delivered = await deliverer({ ...entry, targetAgentId, sessionId, turnId, state });
    if (!delivered) return false;
    markCompletionSent(targetAgentId, sessionId, turnId);
    pending.delete(keyOf(targetAgentId, sessionId));
    return true;
  } catch {
    return false;   // 保留登记：下次回合再试
  }
}

/** 测试用：清空全部登记与去重状态。 */
export function resetPeerCompletionState(): void {
  pending.clear();
  sent.clear();
  deliverer = undefined;
}
