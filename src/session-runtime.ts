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
export function setDraining(value: boolean): void { draining = value; }
export function isDraining(): boolean { return draining; }
