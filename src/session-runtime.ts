// 运行态登记（哪些会话正在跑）：独立成模块，避免 agents.ts 为了查"是否在跑"反向 import agent-host（循环）。
// 只放进程内的运行态；会话数据与 Pi 会话本身仍归 agent-host。
import { resolveHome } from "./home.ts";

export type RunSnapshot = { sessionId: string; startedAt: string };

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
