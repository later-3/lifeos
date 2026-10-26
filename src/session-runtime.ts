// 运行态登记（哪些会话正在跑）：独立成模块，避免 agents.ts 为了查"是否在跑"反向 import agent-host（循环）。
// 只放进程内的运行态；会话数据与 Pi 会话本身仍归 agent-host。
// 运行态是服务端事实：runTurn 的 try/finally 是唯一写入方，前端只读（快照与事件）。
import { resolveHome } from "./home.ts";

export type RunSnapshot = { sessionId: string; startedAt: string; projectId?: string | undefined };
export type RunningEntry = RunSnapshot & { agentId: string };

const running = new Map<string, Map<string, RunSnapshot>>();
const keyOf = (agentId: string) => `${resolveHome()}\u0000${agentId}`;

function bucket(agentId: string): Map<string, RunSnapshot> {
  const key = keyOf(agentId);
  const existing = running.get(key);
  if (existing !== undefined) return existing;
  const created = new Map<string, RunSnapshot>();
  running.set(key, created);
  return created;
}

export function markRunning(agentId: string, snapshot: RunSnapshot): void {
  bucket(agentId).set(snapshot.sessionId, snapshot);
}

export function clearRunning(agentId: string, sessionId: string): void {
  bucket(agentId).delete(sessionId);
}

export function isRunning(agentId: string, sessionId: string): boolean {
  return bucket(agentId).has(sessionId);
}

export function runningOf(agentId: string): RunSnapshot[] {
  return [...bucket(agentId).values()];
}

/** 跨 Agent：当前家目录下所有正在跑的会话（全局快照用）。 */
export function runningAll(): RunningEntry[] {
  const prefix = `${resolveHome()}\u0000`;
  const out: RunningEntry[] = [];
  for (const [key, sessions] of running) {
    if (!key.startsWith(prefix)) continue;
    const agentId = key.slice(prefix.length);
    for (const snapshot of sessions.values()) out.push({ agentId, ...snapshot });
  }
  return out;
}

// —— 排空（drain）：开发 supervisor 要重启前先排空，不让新回合在重启瞬间开始（任务 0006 A2）——
let draining = false;
/** 排空开始的时刻：用于诊断与超时兜底。 */
let drainingSince: number | undefined;

/**
 * 排空多久之后自动失效。为什么需要：2026-10-26 实测，supervisor 请求排空后没有重启
 * （进程一直在跑、`/api/runtime` 里 running 为空，但 draining 一直是 true），
 * 结果所有发送都被 503 拒绝，人只能手动重启。排空本来只该存在几秒（等回合结束 + 重启），
 * 所以超过这个时长就认为"重启没发生"，恢复受理并留日志，绝不把用户卡死。
 */
export const DRAIN_TTL_MS = 60_000;

export function setDraining(value: boolean): void {
  draining = value;
  drainingSince = value ? Date.now() : undefined;
}

/** 纯查询：是否在排空（不做过期处理，过期由 expireDrainIfStale 统一处理，便于记录日志）。 */
export function isDraining(): boolean { return draining; }

/**
 * 排空超时兜底：超过 DRAIN_TTL_MS 仍在排空 → 清除并返回已排空时长（毫秒）。
 * 由 HTTP 中间件每请求调用一次，返回非 undefined 时调用方记日志。
 */
export function expireDrainIfStale(now = Date.now()): number | undefined {
  if (!draining || drainingSince === undefined) return undefined;
  const forMs = now - drainingSince;
  if (forMs <= DRAIN_TTL_MS) return undefined;
  draining = false;
  drainingSince = undefined;
  return forMs;
}

/** 排空的诊断信息（`/api/runtime` 用它说明"为什么在排空"）。 */
export function drainingForMs(): number | undefined {
  return draining && drainingSince !== undefined ? Date.now() - drainingSince : undefined;
}
