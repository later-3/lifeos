// 与其他 Agent 对话（M1）：会话复用、发起一轮。
//
// 语义（Task 0013 · 01-background「M1 设计定稿」）：
// - 同一个 (发起方, 目标 agent, 项目) 复用一个"对话会话"，因此多轮有上文；
// - ask = 等这一轮跑完再返回（同步）；send = 发出去就返回收据（异步）；
// - 目标会话是我们自己的完整会话：identity + harness + Task + 全部工具（createSession）。
//
// 不做的事：不引入反向调用（B 反问 A）。B 在回答里写清楚问题，A 读到后自行决定。
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readAgent } from "./agents.ts";
import { createSession, getSession, messagesOf, runTurn } from "./agent-host.ts";
import { resolveHome } from "./home.ts";

/** 对话会话标记：记录这条会话是"和哪个 Agent 的对话"。 */
export const PEER_ENTRY = "lifeos_peer";

export type PeerErrorCode = "self" | "unknown_agent" | "archived";

export type PeerConversation = { agentId: string; sessionId: string; created: boolean };

/** 目标 Agent 必须存在且未归档；不允许与自己对话（防自环）。 */
export async function resolvePeer(
  sourceAgentId: string,
  targetAgentId: string,
): Promise<{ ok: true; name: string } | { ok: false; code: PeerErrorCode }> {
  if (targetAgentId === sourceAgentId) return { ok: false, code: "self" };
  const agent = await readAgent(targetAgentId);
  if (agent === undefined) return { ok: false, code: "unknown_agent" };
  if (agent.archivedAt !== undefined) return { ok: false, code: "archived" };
  return { ok: true, name: agent.name };
}

/**
 * 内存索引：Pi 对新会话延迟落盘，标记只存在内存里时也必须能复用，
 * 否则连续两次 lifeos_ask 会各建一条会话（多轮上文就断了）。
 */
const peerIndex = new Map<string, string>();   // `${发起方}|${目标}|${项目}` → sessionId

function indexKey(sourceAgentId: string, targetAgentId: string, projectId: string): string {
  return `${sourceAgentId}|${targetAgentId}|${projectId}`;
}

function peerSessionsDir(targetAgentId: string, projectId: string): string {
  return join(resolveHome(), "agents", targetAgentId, "projects", projectId, "sessions");
}

/** 读会话文件里的 lifeos_peer 标记（找第一个匹配的对端）。 */
async function peerOfSessionFile(file: string): Promise<string | undefined> {
  let text: string;
  try { text = await readFile(file, "utf8"); } catch { return undefined; }
  for (const line of text.split("\n")) {
    if (line.trim() === "" || !line.includes(PEER_ENTRY)) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; customType?: string; data?: { peerAgentId?: unknown } };
      if (entry.type !== "custom" || entry.customType !== PEER_ENTRY) continue;
      const peer = entry.data?.peerAgentId;
      if (typeof peer === "string" && peer !== "") return peer;
    } catch { /* 单行坏掉不影响其它行 */ }
  }
  return undefined;
}

/**
 * 找到（或建立）与某个 Agent 的对话会话。
 *
 * 复用规则：同一发起方在同一项目下与同一目标 Agent 的对话只存在一条。
 * 目标会话建在**目标 Agent 自己的项目目录**里 —— 它就是目标 Agent 的一条普通会话，
 * 因此出现在会话列表、有 Task、有未读，与其它会话完全一致。
 */
export async function peerConversation(
  sourceAgentId: string,
  targetAgentId: string,
  projectId: string,
  cwd: string,
): Promise<{ ok: true; conversation: PeerConversation; name: string } | { ok: false; code: PeerErrorCode }> {
  const verdict = await resolvePeer(sourceAgentId, targetAgentId);
  if (!verdict.ok) return verdict;

  const memo = peerIndex.get(indexKey(sourceAgentId, targetAgentId, projectId));
  if (memo !== undefined) return { ok: true, conversation: { agentId: targetAgentId, sessionId: memo, created: false }, name: verdict.name };

  const dir = peerSessionsDir(targetAgentId, projectId);
  const files = await readdir(dir).catch(() => [] as string[]);
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    if ((await peerOfSessionFile(join(dir, file))) !== sourceAgentId) continue;
    const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(file);
    const sessionId = match?.[1];
    if (sessionId !== undefined) {
      peerIndex.set(indexKey(sourceAgentId, targetAgentId, projectId), sessionId);
      return { ok: true, conversation: { agentId: targetAgentId, sessionId, created: false }, name: verdict.name };
    }
  }

  // 新建：走我们自己的 createSession（完整装配：identity + harness + Task + 全部工具），随后打 peer 标记。
  const sessionId = await createSession(targetAgentId, cwd, projectId);
  const state = await getSession(targetAgentId, sessionId, cwd);
  state?.session.sessionManager.appendCustomEntry(PEER_ENTRY, {
    peerAgentId: sourceAgentId,
    at: new Date().toISOString(),
  });
  // Pi 对"还没有对话的会话"不落盘（session-manager `_hasConversation`）——标记会随进程消失，
  // 重启后同一个对端会被当成新对话。这里在标记之后显式补写文件，让标记成为持久事实。
  await persistPeerMarker(sessionId, targetAgentId, sourceAgentId, projectId);
  peerIndex.set(indexKey(sourceAgentId, targetAgentId, projectId), sessionId);
  return { ok: true, conversation: { agentId: targetAgentId, sessionId, created: true }, name: verdict.name };
}

/** 目标会话最后一条助手回复的正文（ask 的返回值）。 */
export function lastReply(state: Awaited<ReturnType<typeof getSession>>): string | undefined {
  if (state === undefined) return undefined;
  const messages = messagesOf(state);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const text = (message.text ?? "").trim();
    if (text !== "") return text;
  }
  return undefined;
}

/**
 * 把 peer 标记补写进会话文件（Pi 只在"已有 user/assistant 消息"时才落盘首帧）。
 * 用追加写而不是改写整文件：与 Pi 自己的落盘方式一致，不破坏已有条目。
 */
async function persistPeerMarker(sessionId: string, targetAgentId: string, sourceAgentId: string, projectId: string): Promise<void> {
  const { appendFile, mkdir, readdir, writeFile } = await import("node:fs/promises");
  const dir = peerSessionsDir(targetAgentId, projectId);
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const entry = `${JSON.stringify({
    type: "custom", customType: PEER_ENTRY,
    data: { peerAgentId: sourceAgentId, at: new Date().toISOString() },
    id: `${stamp}_0`.replace(/[^A-Za-z0-9_-]/g, ""), parentId: null, timestamp: new Date().toISOString(),
  })}\n`;
  const files = await readdir(dir).catch(() => [] as string[]);
  const existing = files.find((file) => file.includes(sessionId) && file.endsWith(".jsonl"));
  if (existing !== undefined) {
    await appendFile(join(dir, existing), entry);
    return;
  }
  // 还没有会话文件（Pi 要等第一条 user/assistant 消息才落盘）：按 Pi 的命名规则先建一个
  // `<ts>_<sessionId>.jsonl`，里面只放 peer 标记；之后 Pi 打开时会补 header 并继续追加。
  await writeFile(join(dir, `${stamp}_${sessionId}.jsonl`), entry, { flag: "wx" }).catch(() => undefined);
}

export const ASK_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** 给对话会话起标题（只设一次）：`与 <对端Agent> 的对话`，用户一眼能看出这是谁跟谁在说。 */
export function namePeerSession(state: Awaited<ReturnType<typeof getSession>>, peerName: string): void {
  const manager = state?.session.sessionManager;
  if (manager === undefined || manager.getSessionName()) return;
  manager.appendSessionInfo(`与 ${peerName} 的对话`);
}
