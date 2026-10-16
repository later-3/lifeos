// 进程内的 Agent 宿主：会话 id 一律用 Pi 生成的 id；内存没有就从磁盘恢复。
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { resolveHome } from "./home.ts";

export type TurnEvent = { type: "delta"; text: string } | { type: "done" } | { type: "error"; message: string };

type SessionState = {
  session: Awaited<ReturnType<typeof createAgentSession>>["session"];
  listeners: Set<(event: TurnEvent) => void>;
};

const sessions = new Map<string, SessionState>();

/** 某个 Agent 的会话目录：家目录下 agents/<id>/sessions。 */
export function sessionDir(agentId: string): string {
  return join(resolveHome(), "agents", agentId, "sessions");
}

const keyOf = (agentId: string, sessionId: string) => `${agentId}\0${sessionId}`;

/** 新建一个 Pi 会话，返回 Pi 生成的会话 id。 */
export async function createSession(agentId: string, cwd: string): Promise<string> {
  const manager = SessionManager.create(cwd, sessionDir(agentId));
  const { session } = await createAgentSession({ sessionManager: manager });
  const sessionId = manager.getSessionId();
  sessions.set(keyOf(agentId, sessionId), { session, listeners: new Set() });
  return sessionId;
}

/** 取会话：内存里没有就用 Pi 的会话文件恢复（重启后也能续接）。 */
export async function getSession(agentId: string, sessionId: string, cwd: string) {
  const key = keyOf(agentId, sessionId);
  const existing = sessions.get(key);
  if (existing !== undefined) return existing;
  const found = SessionManager.findById(cwd, sessionId, sessionDir(agentId));
  if (found === undefined) return undefined;
  const { session } = await createAgentSession({ sessionManager: SessionManager.open(found, sessionDir(agentId)) });
  const state: SessionState = { session, listeners: new Set() };
  sessions.set(key, state);
  return state;
}

/** 订阅某个会话的输出（只推当前与后续的增量）。 */
export function subscribeSession(agentId: string, sessionId: string, listener: (event: TurnEvent) => void): () => void {
  const state = sessions.get(keyOf(agentId, sessionId));
  if (state === undefined) return () => {};
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

/** 跑一轮：把 Pi 的文本增量转成事件推给订阅者。 */
export async function runTurn(agentId: string, sessionId: string, text: string): Promise<void> {
  const state = sessions.get(keyOf(agentId, sessionId));
  if (state === undefined) return;
  const emit = (event: TurnEvent) => { for (const listener of state.listeners) listener(event); };
  const unsubscribe = state.session.subscribe((event: { type: string; assistantMessageEvent?: { type: string; delta?: string } }) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      emit({ type: "delta", text: event.assistantMessageEvent.delta ?? "" });
    }
  });
  try {
    await state.session.prompt(text);
    emit({ type: "done" });
  } catch (error) {
    emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    unsubscribe();
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
