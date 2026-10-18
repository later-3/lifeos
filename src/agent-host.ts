// 进程内 Agent 宿主：会话 id 用 Pi 生成的 id；一轮的输出进“按 Agent 的事件流”（带序号，可续传）。
// 默认会话不是运行时生成的：出厂即随模板预置在 workspace/sessions/（协议 §15.2），这里只负责加载。
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveHome } from "./home.ts";

type AgentEventPayload =
  | { sessionId: string; type: "delta"; text: string }
  | { sessionId: string; type: "done" }
  | { sessionId: string; type: "error"; message: string };

export type AgentEvent = AgentEventPayload & { seq: number };

export type RunSnapshot = { sessionId: string; startedAt: string };

type SessionState = { session: Awaited<ReturnType<typeof createAgentSession>>["session"] };
type AgentState = {
  seq: number;
  recent: AgentEvent[];                       // 环形缓冲，供 since 续传
  listeners: Set<(event: AgentEvent) => void>;
  sessions: Map<string, SessionState>;
  running: Map<string, RunSnapshot>;
  /** 已创建但尚未落盘的会话（Pi 对无消息会话延迟写文件）——列表必须包含它们，否则“新建会话”隐身。 */
  pending: Map<string, { projectId: string; at: string }>;
};

// 状态以「家 + agentId」为键：测试/引导切换 LIFEOS_HOME 后不串状态（同 id 会话可能存在于不同家）。
const agents = new Map<string, AgentState>();
const stateKey = (agentId: string) => `${resolveHome()}\u0000${agentId}`;

function stateOf(agentId: string): AgentState {
  const key = stateKey(agentId);
  const existing = agents.get(key);
  if (existing !== undefined) return existing;
  const created: AgentState = { seq: 0, recent: [], listeners: new Set(), sessions: new Map(), running: new Map(), pending: new Map() };
  agents.set(key, created);
  return created;
}

/** 发布一条事件：分配序号、进缓冲、推给订阅者。 */
function publish(agentId: string, event: AgentEventPayload): AgentEvent {
  const state = stateOf(agentId);
  const full: AgentEvent = { ...event, seq: ++state.seq };
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

/** 会话物理落在所属 project 的 sessions/ 下（协议 §15.1 结构即事实；默认 workspace）。 */
export function sessionDir(agentId: string, projectId = "workspace"): string {
  return join(resolveHome(), "agents", agentId, "projects", projectId, "sessions");
}

/** 跨 project 定位会话文件（会话可能在任一已绑定项目的 sessions/ 里）。 */
async function findSessionFile(agentId: string, sessionId: string): Promise<{ path: string; dir: string } | undefined> {
  const root = join(resolveHome(), "agents", agentId, "projects");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name, "sessions");
    const file = (await readdir(dir).catch(() => [] as string[])).find((name) => name.endsWith(`_${sessionId}.jsonl`));
    if (file !== undefined) return { path: join(dir, file), dir };
  }
  return undefined;
}

/** 新建会话到指定 project（cwd 由调用方按项目定：workspace=~/.lifeos，外部=项目 path）。 */
export async function createSession(agentId: string, cwd: string, projectId = "workspace"): Promise<string> {
  if (projectId === "workspace") {
    // 内置 workspace 兜底注册（每个 Agent 天然有默认 project，agent.md §5.6）；外部项目 manifest 在共用层，不在此处理。
    const projectDir = join(resolveHome(), "agents", agentId, "projects", "workspace");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "project.json"),
      JSON.stringify({ schemaVersion: 1, id: "workspace" }) + "\n",
      { encoding: "utf8", flag: "wx" }).catch(() => undefined);   // create-only
  }
  const manager = SessionManager.create(cwd, sessionDir(agentId, projectId));
  const { session } = await createAgentSession({ sessionManager: manager });
  const sessionId = manager.getSessionId();
  stateOf(agentId).sessions.set(sessionId, { session });
  stateOf(agentId).pending.set(sessionId, { projectId, at: new Date().toISOString() });
  return sessionId;
}

/** 待落盘会话清单（供列表合并；含展示名，改名在未落盘阶段也不丢）。 */
export function pendingSessions(agentId: string): Array<{ sessionId: string; projectId: string; at: string; name?: string }> {
  const state = stateOf(agentId);
  return [...state.pending.entries()].map(([sessionId, meta]) => {
    const name = state.sessions.get(sessionId)?.session.sessionManager.getSessionName();
    return { sessionId, ...meta, ...(name !== undefined && name !== "" ? { name } : {}) };
  });
}

/** 取会话：内存没有就从会话文件恢复（重启后也能续接；出厂默认会话也走这条路）。
 * 按文件名 `<ts>_<id>.jsonl` 匹配而不是 findById：出厂文件 header 的 cwd 为空，
 * findById 的 cwd 过滤会把它拒掉（换机器/换目录就 404）；open() 带 cwdOverride 即可绕开。 */
export async function getSession(agentId: string, sessionId: string, cwd: string) {
  const state = stateOf(agentId);
  const existing = state.sessions.get(sessionId);
  if (existing !== undefined) return existing;
  const found = await findSessionFile(agentId, sessionId);
  if (found === undefined) return undefined;
  const { session } = await createAgentSession({ sessionManager: SessionManager.open(found.path, found.dir, cwd) });
  const restored: SessionState = { session };
  state.sessions.set(sessionId, restored);
  state.pending.delete(sessionId);
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
    state.pending.delete(sessionId);   // 首轮消息后 Pi 已落盘，文件列表接管
  }
}

/** 删除会话：移除文件与内存态；正在运行的拒绝。 */
export async function deleteSession(agentId: string, sessionId: string): Promise<"deleted" | "not_found" | "running"> {
  const state = stateOf(agentId);
  if (state.running.has(sessionId)) return "running";
  const found = await findSessionFile(agentId, sessionId);
  if (found === undefined && !state.sessions.has(sessionId)) return "not_found";
  if (found !== undefined) await rm(found.path, { force: true });
  state.sessions.delete(sessionId);
  state.pending.delete(sessionId);
  return "deleted";
}

/** 重命名会话：写 Pi 的 `session_info` 展示名（列表标题优先用它，否则回退首句）。 */
export async function renameSession(agentId: string, sessionId: string, name: string, cwd: string): Promise<boolean> {
  const loaded = stateOf(agentId).sessions.get(sessionId);
  if (loaded !== undefined) { loaded.session.sessionManager.appendSessionInfo(name); return true; }
  const found = await findSessionFile(agentId, sessionId);
  if (found === undefined) return false;
  SessionManager.open(found.path, found.dir, cwd).appendSessionInfo(name);
  return true;
}

type TextBlock = { type: "text"; text: string };
type ThinkingBlock = { type: "thinking"; text: string };
type ToolCallBlock = { type: "toolCall"; id?: string; name: string; arguments: unknown; result?: string; isError?: boolean };
type MessageBlock = TextBlock | ThinkingBlock | ToolCallBlock;

/** 消息（含结构化块）：text/thinking/toolCall 按 Pi 真实内容块返回，toolResult 挂回对应调用
 * （参考 Pi Web MessageView 的展示数据；兼容字段 text 保留给纯文本消费者）。 */
export function messagesOf(state: SessionState) {
  const out: Array<{ role: string; text: string; blocks: MessageBlock[] }> = [];
  for (const message of state.session.sessionManager.buildSessionProjection().messages) {
    if (message.role === "user") {
      const text = textOf(message);
      out.push({ role: "user", text, blocks: [{ type: "text", text }] });
    } else if (message.role === "assistant") {
      const blocks: MessageBlock[] = [];
      for (const part of message.content) {
        if (part.type === "text") blocks.push({ type: "text", text: part.text });
        else if (part.type === "thinking") blocks.push({ type: "thinking", text: part.thinking });
        else if (part.type === "toolCall") blocks.push({ type: "toolCall", id: part.id, name: part.name, arguments: part.arguments });
      }
      const text = blocks.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
      out.push({ role: "assistant", text, blocks });
    } else if (message.role === "toolResult") {
      const result = textOf(message);
      for (let i = out.length - 1; i >= 0; i--) {
        const item = out[i];
        if (item === undefined || item.role !== "assistant") continue;
        const call = [...item.blocks].reverse().find((block): block is ToolCallBlock => block.type === "toolCall");
        if (call !== undefined && (call.id === message.toolCallId || call.result === undefined)) {
          call.result = result;
          call.isError = message.isError;
        }
        break;
      }
    }
  }
  return out;
}

function textOf(message: unknown): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => (part as { type?: string; text?: string }).type === "text" ? [part.text ?? ""] : []).join("");
}
