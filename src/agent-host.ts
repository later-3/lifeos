// 进程内的 Agent 宿主：把 Pi 的 AgentSession 按 (agentId, sessionId) 复用，并把一轮输出变成事件流。
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { resolveHome } from "./home.ts";

export type TurnEvent = { type: "delta"; text: string } | { type: "done" } | { type: "error"; message: string };

type Turn = { events: TurnEvent[]; listeners: Set<(event: TurnEvent) => void>; finished: boolean };

const sessions = new Map<string, Awaited<ReturnType<typeof createAgentSession>>["session"]>();
const turns = new Map<string, Turn>();

/** 某个 Agent 的会话目录：家目录下 agents/<id>/sessions。 */
export function sessionDir(agentId: string): string {
  return join(resolveHome(), "agents", agentId, "sessions");
}

/** 取（或建立）一个 Pi 会话；同一 (agentId, sessionId) 复用，保证连续对话。 */
export async function getSession(agentId: string, sessionId: string, cwd: string) {
  const key = `${agentId}\0${sessionId}`;
  const existing = sessions.get(key);
  if (existing !== undefined) return existing;
  const manager = SessionManager.create(cwd, sessionDir(agentId));
  const { session } = await createAgentSession({ sessionManager: manager });
  sessions.set(key, session);
  return session;
}

export function createTurn(): string {
  const turnId = crypto.randomUUID();
  turns.set(turnId, { events: [], listeners: new Set(), finished: false });
  return turnId;
}

/** 订阅一轮的事件；已产生的事件会立即回放。返回取消订阅函数。 */
export function subscribe(turnId: string, listener: (event: TurnEvent) => void): () => void {
  const turn = turns.get(turnId);
  if (turn === undefined) return () => {};
  for (const event of turn.events) listener(event);
  if (turn.finished) return () => {};
  turn.listeners.add(listener);
  return () => turn.listeners.delete(listener);
}

/** 跑一轮：把 Pi 的文本增量转成事件推给订阅者。 */
export async function runTurn(turnId: string, session: Awaited<ReturnType<typeof getSession>>, text: string): Promise<void> {
  const turn = turns.get(turnId);
  if (turn === undefined) return;
  const emit = (event: TurnEvent) => {
    turn.events.push(event);
    for (const listener of turn.listeners) listener(event);
  };
  const unsubscribe = session.subscribe((event: { type: string; assistantMessageEvent?: { type: string; delta?: string } }) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      emit({ type: "delta", text: event.assistantMessageEvent.delta ?? "" });
    }
  });
  try {
    await session.prompt(text);
    emit({ type: "done" });
  } catch (error) {
    emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    unsubscribe();
    turn.finished = true;
  }
}
