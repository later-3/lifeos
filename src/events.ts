// 进程内事件总线（按 Agent 分流的 SSE 缓冲）。
//
// 为什么单独成模块：**写操作要在"共用的写实现"里广播**，而不是靠每个调用方记得 notify。
// 之前工具层要 notify → 只能反向 import agent-host，会和 agent-host → agent-tools → agents 成环。
// 现在 agents / projects 都能直接 import 这里，工具与 HTTP 两条入口自动闭环（用户 2026-10-20 点名的错误）。
import { resolveHome } from "./home.ts";
import type { StreamEvent } from "./stream-events.ts";
import type { FailureKind } from "./failure.ts";

export type AgentEventPayload =
  | ({ sessionId: string } & StreamEvent)
  | { sessionId: string; type: "done" }
  | { sessionId: string; type: "error"; message: string; kind: FailureKind }
  // 助手/项目列表变了（写操作在共享实现里广播）：前端收到后重取，无需手动刷新
  | { type: "agents_changed" };

export type AgentEvent = AgentEventPayload & { seq: number };

type AgentEvents = {
  seq: number;
  /** 环形缓冲：订阅时按 ?since= 续传 */
  recent: AgentEvent[];
  listeners: Set<(event: AgentEvent) => void>;
};

// 以「家 + agentId」为键：测试/引导切换 LIFEOS_HOME 后不串状态
const byAgent = new Map<string, AgentEvents>();
const keyOf = (agentId: string) => `${resolveHome()}\u0000${agentId}`;

function eventsOf(agentId: string): AgentEvents {
  const key = keyOf(agentId);
  const existing = byAgent.get(key);
  if (existing !== undefined) return existing;
  const created: AgentEvents = { seq: 0, recent: [], listeners: new Set() };
  byAgent.set(key, created);
  return created;
}

/** 发布一条按会话的事件（thinking/delta/tool/…/done/error）。 */
export function publish(agentId: string, event: AgentEventPayload): AgentEvent {
  const state = eventsOf(agentId);
  const full: AgentEvent = { ...event, seq: ++state.seq };
  state.recent.push(full);
  if (state.recent.length > 1000) state.recent.splice(0, state.recent.length - 1000);
  for (const listener of state.listeners) listener(full);
  return full;
}

/** 全局广播（不绑定某个会话）：助手/项目是跨 Agent 的实体，逐条 state 推一遍。 */
export function broadcast(event: { type: "agents_changed" }): void {
  for (const state of byAgent.values()) {
    const full: AgentEvent = { ...event, seq: ++state.seq };
    state.recent.push(full);
    if (state.recent.length > 1000) state.recent.splice(0, state.recent.length - 1000);
    for (const listener of state.listeners) listener(full);
  }
}

/** 订阅某 Agent 的事件流：先回放 seq > since 的事件，再持续推新的。 */
export function subscribeAgent(agentId: string, since: number, listener: (event: AgentEvent) => void): () => void {
  const state = eventsOf(agentId);
  for (const event of state.recent) if (event.seq > since) listener(event);
  state.listeners.add(listener);
  return () => { state.listeners.delete(listener); };
}

/** 当前序号（快照用）。 */
export function eventsSeq(agentId: string): number {
  return eventsOf(agentId).seq;
}
