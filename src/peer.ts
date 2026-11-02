// 与其他 Agent 对话：会话复用、发起一轮、查历史、完成回流（Task 0015 升级）。
//
// 语义（Task 0013 · M1 定稿 → Task 0015 · lane 升级）：
// - **lane（会话通道）** = `(发起方, 目标 agent, 项目, 发起方 taskId)`；同一 lane 复用一个对话会话，多轮有上文；
// - 一个 lane 可以有**多条**会话实例（显式新开时）；默认接回该 lane **最近活跃**那条（02-design §L1）；
// - ask = 等到有结果或该交还控制权时返回**状态快照**；send = 发出去就返回收据（异步），完成后回流发起方；
// - 目标会话是我们自己的完整会话：identity + harness + Task + 全部工具（createSession）。
//
// 不做的事：不引入反向调用（B 反问 A）。B 在回答里写清楚问题，A 读到后自行决定。
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { readAgent } from "./agents.ts";
import { bindProject, listAgentProjects } from "./projects.ts";
import { createSession, getSession, messagesOf, runTurn, turnLastOf } from "./agent-host.ts";
import { isRunning } from "./session-runtime.ts";
import { addTaskParticipant } from "./tasks.ts";
import {
  completionAlreadySent, type PendingPeer, setPeerDeliverer,
} from "./peer-completion.ts";
import { resolveHome } from "./home.ts";

/** 对话会话标记：记录这条会话是"和哪个 Agent 的对话"，以及它属于哪个 lane。 */
export const PEER_ENTRY = "lifeos_peer";

/**
 * 完成回流的自定义消息类型（T7）：目标回合结束后注入发起方会话。
 * 与 `lifeos_peer` 同族命名；`display: true` 让界面把它渲染成一条可读消息。
 */
export const PEER_DONE_ENTRY = "lifeos_peer_done";

export type PeerErrorCode = "self" | "unknown_agent" | "archived";
/** 会话选择失败（T2/S8）：指定了 sessionId 却不存在或不属于这个 lane。 */
export type PeerSelectErrorCode = "session_not_found" | "session_not_in_lane";

export type PeerConversation = {
  agentId: string;
  sessionId: string;
  created: boolean;
  /** 这条会话所属 lane 的发起方 Task（T1）；老会话没有该字段 → undefined。 */
  initiatorTaskId?: string;
};

/** `lifeos_peer` 标记的完整形状（读侧全部可选，容忍老数据）。 */
export type PeerMarker = {
  /**
   * 这条会话的**对端**（相对会话所在 Agent 而言）。
   * 会话建在目标 Agent 的项目里，所以对端就是**发起方** —— 与 M1 时代的含义一致，老数据不用迁移。
   * `peerMarkerOf()`（server 的只读检查）也靠它，语义不变。
   */
  peerAgentId: string;
  /** lane 的 Task 维度（T1）：发起方当时的 taskId。老数据缺 → 视为匹配任意 Task。 */
  initiatorTaskId?: string;
  /** 目标 Agent（= 会话所在的 Agent）；老数据缺 → 由所在目录推导。 */
  targetAgentId?: string;
  projectId?: string;
  at?: string;
};

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
 *
 * 键含 taskId（T1）：不同 Task 是不同的 lane，不能互相顶掉。
 */
const peerIndex = new Map<string, string>();   // `${发起方}|${目标}|${项目}|${taskId}` → sessionId

function laneKey(sourceAgentId: string, targetAgentId: string, projectId: string, taskId: string | undefined): string {
  // 家目录也是键的一部分：测试/引导切 LIFEOS_HOME 后不串（与 agent-host 的 stateKey 同一手法）。
  return `${resolveHome()}\u0000${sourceAgentId}|${targetAgentId}|${projectId}|${taskId ?? ""}`;
}

function peerSessionsDir(targetAgentId: string, projectId: string): string {
  return join(resolveHome(), "agents", targetAgentId, "projects", projectId, "sessions");
}

/** 读会话文件里的 lifeos_peer 标记（完整形状；坏行跳过）。 */
async function markerOfSessionFile(file: string): Promise<PeerMarker | undefined> {
  let text: string;
  try { text = await readFile(file, "utf8"); } catch { return undefined; }
  let found: PeerMarker | undefined;
  for (const line of text.split("\n")) {
    if (line.trim() === "" || !line.includes(PEER_ENTRY)) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; customType?: string; data?: Record<string, unknown> };
      if (entry.type !== "custom" || entry.customType !== PEER_ENTRY) continue;
      const data = entry.data ?? {};
      const peer = data.peerAgentId;
      if (typeof peer !== "string" || peer === "") continue;
      found = {
        peerAgentId: peer,
        ...(typeof data.initiatorTaskId === "string" ? { initiatorTaskId: data.initiatorTaskId } : {}),
        ...(typeof data.targetAgentId === "string" ? { targetAgentId: data.targetAgentId } : {}),
        ...(typeof data.projectId === "string" ? { projectId: data.projectId } : {}),
        ...(typeof data.at === "string" ? { at: data.at } : {}),
      };
    } catch { /* 单行坏掉不影响其它行 */ }
  }
  return found;
}

/** lane 上与某个目标相关的候选会话（T2/T4 共用）。 */
export type PeerLaneEntry = {
  sessionId: string;
  marker: PeerMarker;
  updatedAtMs: number;
  messages: number;
  running: boolean;
};

/**
 * 列出目标 Agent 项目下、由某个发起方开的所有对话会话（不过滤 Task）。
 * 读侧容忍缺失字段：老会话没有 `initiatorAgentId` 时，用 `peerAgentId` 当发起方
 * ——历史数据里那个字段存的就是**发起方**（M1 时代的命名），语义上等价。
 */
export async function listPeerSessions(
  sourceAgentId: string,
  targetAgentId: string,
  projectId: string,
): Promise<PeerLaneEntry[]> {
  const dir = peerSessionsDir(targetAgentId, projectId);
  const files = await readdir(dir).catch(() => [] as string[]);
  const out: PeerLaneEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(file);
    const sessionId = match?.[1];
    if (sessionId === undefined) continue;
    const marker = await markerOfSessionFile(join(dir, file));
    if (marker === undefined) continue;
    // `peerAgentId` = 这条会话的对端 = 发起方（M1 时代就是这个含义，不动）
    if (marker.peerAgentId !== sourceAgentId) continue;
    const info = await stat(join(dir, file)).catch(() => undefined);
    // 消息数 = 文件里 message 条目数（与 server.listSessions 的 lines 口径不同：这里只数对话条目）
    const text = await readFile(join(dir, file), "utf8").catch(() => "");
    const messages = text.split("\n").reduce((count, line) => {
      if (line.trim() === "" || !line.includes('"message"')) return count;
      try { return (JSON.parse(line) as { type?: string }).type === "message" ? count + 1 : count; } catch { return count; }
    }, 0);
    out.push({
      sessionId,
      marker,
      updatedAtMs: info?.mtimeMs ?? 0,
      messages,
      running: isRunning(targetAgentId, sessionId),
    });
  }
  return out.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

/** 这条会话是否属于这个 lane（T1）：对端对得上，且 Task 对得上（老会话不记 Task → 视为匹配）。 */
function inLane(entry: PeerLaneEntry, sourceAgentId: string, taskId: string | undefined): boolean {
  if (entry.marker.peerAgentId !== sourceAgentId) return false;
  if (entry.marker.initiatorTaskId === undefined) return true;   // 老会话：不记 Task，兼容
  if (taskId === undefined) return true;                          // 调用方没有 Task 上下文：不排除
  return entry.marker.initiatorTaskId === taskId;
}

export type PeerSelectOptions = {
  /** 发起方当前的 Task（T1）；不传 → 只在 initiatorTaskId 为空的会话里找。 */
  taskId?: string | undefined;
  /** 显式指定会话（T2/T7）：给了就必须用它，不存在则报错。 */
  sessionId?: string | undefined;
  /** 显式新开一条（T3）：跳过查找。 */
  newSession?: boolean | undefined;
};

/**
 * 找到（或建立）与某个 Agent 的对话会话。
 *
 * 决策顺序（02-design §L1）：
 * 1. `sessionId` 给了 → 必须存在且属于这个 lane（否则明确报错，不静默新建）；
 * 2. `newSession` → 建一条新的（同一 lane 可以有多条）；
 * 3. 否则在该 lane 里找：命中多条取**最近活跃**那条，未命中就新建。
 *
 * 目标会话建在**目标 Agent 自己的项目目录**里 —— 它就是目标 Agent 的一条普通会话，
 * 因此出现在会话列表、有 Task、有未读，与其它会话完全一致。
 */
export async function peerConversation(
  sourceAgentId: string,
  targetAgentId: string,
  projectId: string,
  cwd: string,
  options: PeerSelectOptions = {},
): Promise<
  | { ok: true; conversation: PeerConversation; name: string }
  | { ok: false; code: PeerErrorCode | PeerSelectErrorCode; available?: string[] }
> {
  const verdict = await resolvePeer(sourceAgentId, targetAgentId);
  if (!verdict.ok) return verdict;

  // 目标 Agent 必须有同一个项目，否则会话会落进"没有 manifest 的孤儿目录"。
  const project = await ensurePeerProject(sourceAgentId, targetAgentId, projectId);
  if (!project.ok) return { ok: false, code: "unknown_agent" };
  projectId = project.projectId;

  const taskId = options.taskId;
  const key = laneKey(sourceAgentId, targetAgentId, projectId, taskId);

  // 1. 显式指定会话：必须属于这个 lane，否则报错（S8：不静默新建）。
  if (options.sessionId !== undefined) {
    const wanted = options.sessionId;
    const all = await listPeerSessions(sourceAgentId, targetAgentId, projectId);
    const hit = all.find((entry) => entry.sessionId === wanted);
    if (hit === undefined) {
      return { ok: false, code: "session_not_found", available: all.map((entry) => entry.sessionId) };
    }
    if (!inLane(hit, sourceAgentId, taskId)) {
      return {
        ok: false,
        code: "session_not_in_lane",
        available: all.filter((entry) => inLane(entry, sourceAgentId, taskId)).map((entry) => entry.sessionId),
      };
    }
    peerIndex.set(key, hit.sessionId);
    return {
      ok: true,
      name: verdict.name,
      conversation: { agentId: targetAgentId, sessionId: hit.sessionId, created: false, ...(hit.marker.initiatorTaskId !== undefined ? { initiatorTaskId: hit.marker.initiatorTaskId } : {}) },
    };
  }

  // 2. 显式新开：跳过查找（T3）。
  if (options.newSession === true) {
    return await createPeerConversation(sourceAgentId, targetAgentId, projectId, cwd, taskId, verdict.name, key);
  }

  // 3. 默认接管：内存索引快路径（索引里的会话可能还没落盘）。
  const memo = peerIndex.get(key);
  if (memo !== undefined) {
    return { ok: true, conversation: { agentId: targetAgentId, sessionId: memo, created: false, ...(taskId !== undefined ? { initiatorTaskId: taskId } : {}) }, name: verdict.name };
  }

  // 4. 扫盘：取该 lane 最近活跃的一条（S2/S3/S5）。
  const lane = (await listPeerSessions(sourceAgentId, targetAgentId, projectId))
    .filter((entry) => inLane(entry, sourceAgentId, taskId));
  const newest = lane[0];
  if (newest !== undefined) {
    peerIndex.set(key, newest.sessionId);
    return {
      ok: true,
      name: verdict.name,
      conversation: {
        agentId: targetAgentId, sessionId: newest.sessionId, created: false,
        ...(newest.marker.initiatorTaskId !== undefined ? { initiatorTaskId: newest.marker.initiatorTaskId } : {}),
      },
    };
  }

  // 5. 未命中 → 新建。
  return await createPeerConversation(sourceAgentId, targetAgentId, projectId, cwd, taskId, verdict.name, key);
}

/** 新建一条对话会话（完整装配 + 写 lane 标记）。 */
async function createPeerConversation(
  sourceAgentId: string,
  targetAgentId: string,
  projectId: string,
  cwd: string,
  taskId: string | undefined,
  peerName: string,
  key: string,
): Promise<{ ok: true; conversation: PeerConversation; name: string }> {
  const sessionId = await createSession(targetAgentId, cwd, projectId);
  const state = await getSession(targetAgentId, sessionId, cwd);
  const marker: PeerMarker = {
    // 对端 = 发起方（会话建在目标 Agent 的项目里；M1 语义不变，`peerMarkerOf` 靠它对 server 做只读检查）
    peerAgentId: sourceAgentId,
    targetAgentId,
    ...(taskId !== undefined ? { initiatorTaskId: taskId } : {}),
    projectId,
    at: new Date().toISOString(),
  };
  state?.session.sessionManager.appendCustomEntry(PEER_ENTRY, marker);
  // Pi 对"还没有对话的会话"不落盘（session-manager `_hasConversation`）——标记会随进程消失，
  // 重启后同一个对端会被当成新对话。这里在标记之后显式补写文件，让标记成为持久事实。
  await persistPeerMarker(sessionId, targetAgentId, projectId, marker);
  peerIndex.set(key, sessionId);
  return {
    ok: true,
    name: peerName,
    conversation: { agentId: targetAgentId, sessionId, created: true, ...(taskId !== undefined ? { initiatorTaskId: taskId } : {}) },
  };
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
async function persistPeerMarker(sessionId: string, targetAgentId: string, projectId: string, marker: PeerMarker): Promise<void> {
  const { appendFile, mkdir, readdir, writeFile } = await import("node:fs/promises");
  const dir = peerSessionsDir(targetAgentId, projectId);
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const entry = `${JSON.stringify({
    type: "custom", customType: PEER_ENTRY,
    data: marker,
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

/**
 * 目标会话的**状态快照**（T6，02-design §L2）。
 *
 * 为什么不是抛错：`ask` 的超时不是失败，而是"先交还控制权"；调用方需要知道
 * **对方现在到底在干什么**（否则只能盲等或 sleep 轮询）。所有字段都来自会话事实：
 * - `phase` 用现成词表 `Phase = waiting|thinking|tool|text`（`frontend/src/stream-blocks.ts:25`）；
 * - `lastReply` 是**原文**（不生成摘要——摘要要额外调模型、还会与完整记录矛盾）。
 */
export type PeerState = "running" | "idle" | "error" | "aborted" | "missing";
export type PeerSnapshot = {
  agentId: string;
  sessionId: string;
  state: PeerState;
  initiatorTaskId?: string;
  turnId?: string;
  startedAt?: string;
  runningForMs?: number;
  finishedAt?: string;
  lastReply?: string;
  failure?: { kind: string; message: string };
  messages: number;
  /** 还能不能继续等（false 时调用方应该自己去处理，而不是重试）。 */
  canWaitMore: boolean;
  /** 下一步建议（必填：没有它，模型收到快照会自己编循环）。 */
  next: string;
};

/** 构建目标会话的状态快照（纯读，不改任何状态）。 */
export async function peerSnapshot(
  targetAgentId: string,
  sessionId: string,
  initiatorTaskId?: string,
): Promise<PeerSnapshot> {
  const base = { agentId: targetAgentId, sessionId, ...(initiatorTaskId !== undefined ? { initiatorTaskId } : {}) };
  const running = isRunning(targetAgentId, sessionId);
  const state = await getSession(targetAgentId, sessionId, resolveHome());
  if (state === undefined && !running) {
    return { ...base, state: "missing", messages: 0, canWaitMore: false, next: "这条会话已不存在（可能被删除）。请重新发消息或换一个目标会话。" };
  }

  const messages = state !== undefined ? messagesOf(state).length : 0;
  const { turn } = await turnLastOf(targetAgentId, sessionId).catch(() => ({ turn: null as null }));
  const reply = state !== undefined ? lastReply(state) : undefined;

  if (running) {
    const startedMs = turn?.state === "running" ? Date.parse(turn.at) : Number.NaN;
    return {
      ...base,
      state: "running",
      ...(turn !== null ? { turnId: turn.turnId } : {}),
      ...(Number.isNaN(startedMs) ? {} : { startedAt: new Date(startedMs).toISOString(), runningForMs: Date.now() - startedMs }),
      messages,
      canWaitMore: true,
      next: "对方还在处理中。可以再等一会儿、去查它的过程（它是一条普通会话），或者先把这件事放下做别的；不要 sleep 轮询。",
    };
  }

  if (turn?.state === "error") {
    return {
      ...base,
      state: "error",
      ...(turn.turnId !== undefined ? { turnId: turn.turnId } : {}),
      finishedAt: turn.at,
      ...(reply !== undefined ? { lastReply: reply } : {}),
      failure: { kind: "unknown", message: "对方回合以失败结束（具体原因见它的会话记录）" },
      messages,
      canWaitMore: false,
      next: "对方这一轮失败了。看它的会话记录确认原因；重试前先判断是偶发（网络/限流）还是这条请求本身有问题。",
    };
  }

  if (turn !== null && turn.state === "done") {
    return {
      ...base,
      state: "idle",
      ...(turn.turnId !== undefined ? { turnId: turn.turnId } : {}),
      finishedAt: turn.at,
      ...(reply !== undefined ? { lastReply: reply } : {}),
      messages,
      canWaitMore: false,
      next: reply !== undefined ? "对方已回复（lastReply 就是它的回答）。直接用它，不需要再问一遍。" : "对方这一轮结束了但没有文字回复；需要结论就再问一次并把要求写到文字里。",
    };
  }

  // 没有回合记录（刚建、还没跑过）：空闲
  return {
    ...base,
    state: "idle",
    messages,
    canWaitMore: true,
    next: "这条会话还没有跑过回合。直接发消息即可。",
  };
}

/**
 * 把"完成/失败 + 最后一段回复"注入**发起方会话**（T7）。
 *
 * 登记与去重由 `peer-completion.ts` 负责（避免 agent-host ✕ peer 的静态环）；
 * 本函数只做**投递**：拿到会话 → 组装正文 → `sendCustomMessage`。
 *
 * 四条不省略的工程约束（借 pi-subagents 的做法，见
 * `knowledge/reference-agent-conversations.md` §4）：
 * 1. 去重（同一 turnId 只打扰一次）——由 `completionAlreadySent` 守；
 * 2. 投递成功才清登记（送失败留着，下次再试）——由 `notifyPeerTurnFinished` 守；
 * 3. 内容里带**下一步该干什么**（否则模型收到通知会自己编循环）；
 * 4. `triggerTurn: false`——只落一条可读消息，不悄悄多跑一轮模型。
 */
export async function deliverPeerCompletion(input: PendingPeer & {
  targetAgentId: string;
  sessionId: string;
  turnId: string;
  state: "done" | "error";
}): Promise<boolean> {
  const { targetAgentId, sessionId, turnId, state } = input;
  if (completionAlreadySent(targetAgentId, sessionId, turnId)) return false;

  const initiator = await getSession(input.initiatorAgentId, input.initiatorSessionId, resolveHome());
  if (initiator === undefined) return false;

  const snapshot = await peerSnapshot(targetAgentId, sessionId, input.initiatorTaskId);
  const body = [
    `【与 ${input.peerName} 的对话】${state === "done" ? "已完成" : "失败了"}`,
    `会话：${sessionId}`,
    ...(input.initiatorTaskId !== undefined ? [`Task：${input.initiatorTaskId}`] : []),
    ...(snapshot.lastReply !== undefined ? ["", snapshot.lastReply] : ["", "（这一轮没有文字回复）"]),
    "",
    `下一步：${state === "done" ? "直接用上面的结果推进你手上的事；需要更多细节就去看这条会话。" : "看那条会话确认失败原因，再决定重试还是换办法。"}`,
  ].join("\n");

  try {
    await initiator.session.sendCustomMessage({
      customType: PEER_DONE_ENTRY,
      content: body,
      display: true,
      details: { peerAgentId: targetAgentId, sessionId, turnId, state },
    }, { triggerTurn: false });
  } catch {
    return false;   // 投递失败：保留登记，下次回合再试
  }

  // T13：把对端写进**发起方 Task** 的参与者（"这件事有谁参与"从此有承载物）。
  // 失败不阻断回流——参与者是补充事实，通知才是主目的。
  if (input.initiatorTaskId !== undefined) {
    await addTaskParticipant(
      { agentId: input.initiatorAgentId, projectId: input.projectId },
      input.initiatorTaskId,
      targetAgentId,
    ).catch(() => undefined);
  }
  return true;
}

// peer 模块加载时把投递实现注入登记簿（agent-host 只认 `peer-completion.ts`，不 import 本模块）。
setPeerDeliverer(deliverPeerCompletion);


/**
 * 让目标 Agent 拥有与发起方同名的项目。
 *
 * 为什么必须做（代码事实）：`createSession(agentId, cwd, projectId)` 只做 `canonicalProjectId`，
 * 目标 Agent 没有该项目时会把 projectId 原样拿去建目录——目录里没有 manifest、默认 Task 也挂不上，
 * 结果就是一条"孤儿项目里的会话"。所以发起对话前先确保目标 Agent 绑定了同一个项目路径。
 *
 * 已存在则直接返回（按 id 判定）；不存在则用 `bindProject` 绑同一目录（会一并建骨架与默认 Task）。
 */
export async function ensurePeerProject(
  sourceAgentId: string,
  targetAgentId: string,
  projectId: string,
): Promise<{ ok: true; projectId: string; bound: boolean } | { ok: false; message: string }> {
  if (projectId === "workspace") return { ok: true, projectId, bound: false };
  const existing = await listAgentProjects(targetAgentId);
  if (existing.some((item) => item.id === projectId)) return { ok: true, projectId, bound: false };

  const source = await listAgentProjects(sourceAgentId);
  const match = source.find((item) => item.id === projectId);
  if (match === undefined) return { ok: false, message: `发起方没有项目 "${projectId}"，无法在目标 Agent 上建立同名项目` };

  if (match.path === undefined) return { ok: false, message: `项目 "${projectId}" 没有可绑定的目录路径` };
  const bound = await bindProject(targetAgentId, match.path);
  if ("code" in bound) return { ok: false, message: `无法把项目 "${projectId}" 绑定到目标 Agent：${bound.message}` };
  return { ok: true, projectId: bound.project.id, bound: true };
}

/** 读某条会话上的 peer 标记（它是不是"与其他 Agent 的对话"，以及对方是谁）。 */
export function peerMarkerOf(manager: { getBranch(): ReadonlyArray<{ type?: string; customType?: string; data?: unknown }> }): string | undefined {
  const branch = manager.getBranch();
  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i];
    if (entry?.type !== "custom" || entry.customType !== PEER_ENTRY) continue;
    const data = entry.data as { peerAgentId?: unknown } | undefined;
    const peer = data?.peerAgentId;
    if (typeof peer === "string" && peer !== "") return peer;
  }
  return undefined;
}

/** 给对话会话起标题（只设一次）：`与 <对端Agent> 的对话`，用户一眼能看出这是谁跟谁在说。 */
export function namePeerSession(state: Awaited<ReturnType<typeof getSession>>, peerName: string): void {
  const manager = state?.session.sessionManager;
  if (manager === undefined || manager.getSessionName()) return;
  manager.appendSessionInfo(`与 ${peerName} 的对话`);
}

/** `lifeos_agent_list` 的返回行（T5）：谁能聊、叫什么、是不是归档了。 */
export type PeerAgentEntry = { id: string; name: string; description?: string; archived: boolean };

/** 列出除自己以外的所有 Agent（含归档的，标出来——模型需要知道"为什么找不到它"）。 */
export async function listPeerAgents(selfAgentId: string): Promise<PeerAgentEntry[]> {
  const root = join(resolveHome(), "agents");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const out: PeerAgentEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const agent = await readAgent(entry.name);
    if (agent === undefined) continue;
    if (agent.id === selfAgentId) continue;
    out.push({
      id: agent.id,
      name: agent.name,
      ...(agent.description !== undefined ? { description: agent.description } : {}),
      archived: agent.archivedAt !== undefined,
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** 会话标题（`lifeos_ask_list` 用）：读 `session_info` 的最后一条 name；没有 → undefined。 */
export async function peerSessionTitle(targetAgentId: string, sessionId: string): Promise<string | undefined> {
  const dirs = await readdir(join(resolveHome(), "agents", targetAgentId, "projects")).catch(() => [] as string[]);
  for (const dir of dirs) {
    const sessionsDir = join(resolveHome(), "agents", targetAgentId, "projects", dir, "sessions");
    const files = await readdir(sessionsDir).catch(() => [] as string[]);
    const file = files.find((name) => name.includes(sessionId) && name.endsWith(".jsonl"));
    if (file === undefined) continue;
    const text = await readFile(join(sessionsDir, file), "utf8").catch(() => "");
    let title: string | undefined;
    for (const line of text.split("\n")) {
      if (line.trim() === "" || !line.includes("session_info")) continue;
      try {
        const entry = JSON.parse(line) as { type?: string; name?: unknown };
        if (entry.type === "session_info" && typeof entry.name === "string" && entry.name.trim() !== "") title = entry.name;
      } catch { /* 坏行跳过 */ }
    }
    return title;
  }
  return undefined;
}

/** 把状态快照渲染成给人/给模型看的文本（`ask` 的返回值）。 */
export function snapshotText(peerName: string, snapshot: PeerSnapshot, hint?: string): string {
  const lines: string[] = [];
  lines.push(`${peerName} · state=${snapshot.state}${hint !== undefined ? `（${hint}）` : ""}`);
  lines.push(`session: ${snapshot.sessionId}`);
  if (snapshot.initiatorTaskId !== undefined) lines.push(`task: ${snapshot.initiatorTaskId}`);
  if (snapshot.turnId !== undefined) lines.push(`turn: ${snapshot.turnId}`);
  if (snapshot.runningForMs !== undefined) lines.push(`已在跑: ${Math.round(snapshot.runningForMs / 1000)}s`);
  if (snapshot.finishedAt !== undefined) lines.push(`结束于: ${snapshot.finishedAt}`);
  lines.push(`消息数: ${snapshot.messages}`);
  if (snapshot.lastReply !== undefined) {
    lines.push("", "它的回复：", snapshot.lastReply);
  } else if (snapshot.state !== "running") {
    lines.push("", "（这一轮没有文字回复）");
  }
  lines.push("", `下一步：${snapshot.next}`);
  return lines.join("\n");
}
