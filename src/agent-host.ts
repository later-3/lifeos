// 进程内 Agent 宿主：会话 id 用 Pi 生成的 id；一轮的输出进"按 Agent 的事件流"（带序号，可续传）。
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { resolveHome } from "./home.ts";

export type AgentEvent =
  | { seq: number; sessionId: string; type: "delta"; text: string }
  | { seq: number; sessionId: string; type: "done" }
  | { seq: number; sessionId: string; type: "error"; message: string };

export type RunSnapshot = { sessionId: string; startedAt: string };

type SessionState = { session: Awaited<ReturnType<typeof createAgentSession>>["session"] };
type AgentState = {
  seq: number;
  recent: AgentEvent[];                       // 环形缓冲，供 since 续传
  listeners: Set<(event: AgentEvent) => void>;
  sessions: Map<string, SessionState>;
  running: Map<string, RunSnapshot>;
};

const agents = new Map<string, AgentState>();

function stateOf(agentId: string): AgentState {
  const existing = agents.get(agentId);
  if (existing !== undefined) return existing;
  const created: AgentState = { seq: 0, recent: [], listeners: new Set(), sessions: new Map(), running: new Map() };
  agents.set(agentId, created);
  return created;
}

/** 发布一条事件：分配序号、进缓冲、推给订阅者。 */
function publish(agentId: string, event: Omit<AgentEvent, "seq">): AgentEvent {
  const state = stateOf(agentId);
  const full = { ...event, seq: ++state.seq } as AgentEvent;
  state.recent.push(full);
  if (state.recent.length > 1000) state.recent.splice(0, state.recent.length - 1000);
  for (const listener of state.listeners) listener(full);
  return full;
}

/** 订阅某 Agent 的事件流：先回放 seq > since 的事件，再持续推新的。 */
export function subscribeAgent(agentId: string, since: number, listener: (event: AgentEvent) => void): () => void {
  const state = stateOf(agentId);
  for (const event of state.recent) if (event.seq > since) listener(event);
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

/** 快照：当前序号 + 正在跑的会话（订阅时先给，保证不丢状态）。 */
export function snapshotOf(agentId: string): { seq: number; running: RunSnapshot[] } {
  const state = stateOf(agentId);
  return { seq: state.seq, running: [...state.running.values()] };
}

export function sessionDir(agentId: string): string {
  return join(resolveHome(), "agents", agentId, "sessions");
}

/** 新建一个 Pi 会话，返回 Pi 生成的会话 id。 */
export async function createSession(agentId: string, cwd: string): Promise<string> {
  const manager = SessionManager.create(cwd, sessionDir(agentId));
  const { session } = await createAgentSession({ sessionManager: manager });
  const sessionId = manager.getSessionId();
  stateOf(agentId).sessions.set(sessionId, { session });
  return sessionId;
}

/** 取会话：内存没有就从 Pi 的会话文件恢复（重启后也能续接）。 */
export async function getSession(agentId: string, sessionId: string, cwd: string) {
  const state = stateOf(agentId);
  const existing = state.sessions.get(sessionId);
  if (existing !== undefined) return existing;
  const found = SessionManager.findById(cwd, sessionId, sessionDir(agentId));
  if (found === undefined) return undefined;
  const { session } = await createAgentSession({ sessionManager: SessionManager.open(found, sessionDir(agentId)) });
  const restored: SessionState = { session };
  state.sessions.set(sessionId, restored);
  return restored;
}

/** 跑一轮：把 Pi 的文本增量发布成事件。 */
export async function runTurn(agentId: string, sessionId: string, text: string): Promise<void> {
  const state = stateOf(agentId);
  const target = state.sessions.get(sessionId);
  if (target === undefined) return;
  state.running.set(sessionId, { sessionId, startedAt: new Date().toISOString() });
  const unsubscribe = target.session.subscribe((event: { type: string; assistantMessageEvent?: { type: string; delta?: string } }) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      publish(agentId, { sessionId, type: "delta", text: event.assistantMessageEvent.delta ?? "" });
    }
  });
  try {
    await target.session.prompt(text);
    publish(agentId, { sessionId, type: "done" });
  } catch (error) {
    publish(agentId, { sessionId, type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    unsubscribe();
    state.running.delete(sessionId);
  }
}

export function messagesOf(state: SessionState) {
  return state.session.messages.flatMap((message) =>
    message.role === "user" || message.role === "assistant" ? [{ role: message.role, text: textOf(message) }] : []);
}

function textOf(message: unknown): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => (part as { type?: string; text?: string }).type === "text" ? [part.text ?? ""] : []).join("");
}
