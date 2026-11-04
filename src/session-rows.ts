// 会话列表的"一行"对象（任务 0005）：SessionRow 的**唯一实现**。
//
// 为什么单独一个模块：现状行对象在两个 HTTP 端点里各拼一次
// （`src/server.ts` 的 `/api/agents/:id/sessions` 与 `/projects/:pid/sessions`），
// 已经漂移出形状不一致（一处 `peer` 是字符串、一处是对象）。本模块是唯一实现，所有入口都调它。
//
// 设计依据（详见任务 0005 的 `02-design.md` / `05-basis.md` / `06-references.md`）：
// - 不为展示新增存储：标题只有会话文件一份（`display` 是同源派生）、Task 名来自 `task.md`、
//   项目名/图标来自 `project.json`；
// - 时间拆 `createdAt / firstMessageAt / lastMessageAt / lastActivityAt / fileModifiedAt`；
//   `lastActivityAt` 用于排序与分组，`fileModifiedAt`（mtime）**禁止**用于显示与排序；
// - 四态优先级只在 `rowActivityOf()` 一处（`src/row-activity.ts`，纯函数、前后端共用）；
// - `counts` 分项取代单一 `messages`（pi-web `lib/session-stats.ts:4-15` 同口径）；
// - `lastMessageAt` 只认 user/assistant（照 pi-web `activityTimeOf()`，toolResult 是内部过程）。
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveHome } from "./home.ts";
import { classifyFailure, type FailureKind } from "./failure.ts";
import { readGlobalProject } from "./project-registry.ts";
import { listTasks } from "./tasks.ts";
import { readAgent } from "./agents.ts";
import { runningOf } from "./session-runtime.ts";
import { sessionViewsOf } from "./session-views.ts";
import { pendingSessions } from "./agent-host.ts";
import { PEER_ENTRY } from "./peer.ts";
import { displayTitleOf, rowActivityOf, type RowActivity } from "./row-activity.ts";

export type { RowActivity, RowPhase } from "./row-activity.ts";

export type RowAvatar = { kind?: string; file?: string; revision?: number };
export type RowTitle = { raw: string; display: string };
export type RowProject = { id: string; name: string; icon?: string };
export type RowTask = { id: string; title: string; status: string; type: string };
export type RowPeer = { kind: "agent"; id: string; name: string; avatar?: RowAvatar };
export type RowCounts = { user: number; assistant: number; toolResult: number; system: number; total: number };

export type RowTime = {
  createdAt: string;
  firstMessageAt?: string;
  /** 最后一条 **user 或 assistant** 的时间（不含 toolResult）。 */
  lastMessageAt?: string;
  /** 排序/分组/日历都用它 = `lastMessageAt ?? createdAt ?? fileModifiedAt`。 */
  lastActivityAt: string;
  /** 文件 mtime：**禁止用于显示与排序**，只给排障。 */
  fileModifiedAt: string;
};

export type SessionRow = {
  sessionId: string;
  title: RowTitle;
  project: RowProject;
  task: RowTask | null;
  peer: RowPeer | null;
  counts: RowCounts;
  time: RowTime;
  activity: RowActivity;
  isDefault: boolean;
};

type RawEntry = {
  type?: string; id?: string; name?: string; timestamp?: string; customType?: string;
  message?: { role?: string; content?: unknown; stopReason?: string; errorMessage?: string };
  data?: { taskId?: unknown; peerAgentId?: unknown };
};

type ScannedSession = {
  sessionId: string;
  rawTitle: string;
  counts: RowCounts;
  createdAt?: string;
  firstMessageAt?: string;
  lastMessageAt?: string;
  fileModifiedAt: string;
  activeTaskId?: string;
  peerAgentId?: string;
  failure?: { kind: FailureKind; detail: string; at?: string };
};

const emptyCounts = (): RowCounts => ({ user: 0, assistant: 0, toolResult: 0, system: 0, total: 0 });

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => ((part as { type?: string; text?: string }).type === "text" ? [(part as { text?: string }).text ?? ""] : []))
    .join("");
}

/** 扫一个会话文件 → 事实（不含任何展示决定）。 */
/**
 * 扫描结果的 fingerprint 缓存（Task 0005 · P8-6）。
 *
 * ## 为什么需要
 *
 * 实测（69 个会话文件 / 58.9MB）：
 *   · 全读文件 **156ms**
 *   · 只 `stat` **1ms**     ← 150 倍差
 * 而列表请求、`/tasks`、聚合都会走到扫描。不缓存 → 每次 156ms；缓存命中 → 1ms。
 *
 * ## 为什么用 size:mtimeMs 做指纹
 *
 * 照 pi-web `lib/session-reader.ts:528-578`（注释："The fingerprint (size + mtimeMs)
 * invalidates on external appends (TUI writes)"）。会话文件是 **append-only**：
 * 追加必然改变 size；大小相同但内容变了的情况在这个格式下不存在（除非原地改写，
 * 那时 mtime 也会变）。两个都进指纹，是为了同时挡住"同大小改写"。
 *
 * ## 边界
 *
 * 只缓存**小结果对象**（ScannedSession 是几十个字段的纯数据），不缓存文件内容。
 * 条目数按文件数自然有界（一个项目的会话数），不需要 LRU —— 项目会话是几十到几百级。
 */
type CacheEntry = { fingerprint: string; value: ScannedSession };
const scanCache = new Map<string, CacheEntry>();

/** 测试用：清空缓存（避免用例之间互相影响）。 */
export function clearSessionScanCache(): void {
  scanCache.clear();
}

async function scanSessionFile(path: string): Promise<ScannedSession | undefined> {
  // 先 stat：命中缓存时省掉 readFile（这是全部收益的来源）
  const info = await stat(path).catch(() => undefined);
  const fingerprint = info === undefined ? undefined : `${info.size}:${info.mtimeMs}`;
  if (fingerprint !== undefined) {
    const cached = scanCache.get(path);
    if (cached !== undefined && cached.fingerprint === fingerprint) return cached.value;
  }
  const content = await readFile(path, "utf8").catch(() => undefined);
  if (content === undefined) {
    // 文件读不到（被删/权限）：**清掉缓存**，否则会一直返回幽灵行。
    // 这是 T23 测出来的：缓存按路径存，文件消失时没人负责删它。
    scanCache.delete(path);
    return undefined;
  }
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  let sessionId = "";
  let displayName = "";
  let firstUserText = "";
  let activeTaskId: string | undefined;
  let peerAgentId: string | undefined;
  let createdAt: string | undefined;
  let firstMessageAt: string | undefined;
  let lastMessageAt: string | undefined;
  const counts = emptyCounts();
  // 失败态：只有"最后一条 assistant 以 error 结束"才算（历史失败不盖当前状态）。
  let failing: { kind: FailureKind; detail: string; at?: string } | undefined;

  for (const line of lines) {
    let entry: RawEntry;
    try { entry = JSON.parse(line) as RawEntry; } catch { continue; /* 坏行跳过，不补造 */ }

    if (entry.type === "session" && typeof entry.id === "string") {
      sessionId = entry.id;
      if (typeof entry.timestamp === "string") createdAt = entry.timestamp;
      continue;
    }
    if (entry.type === "session_info" && typeof entry.name === "string" && entry.name.trim() !== "") {
      displayName = entry.name;
      continue;
    }
    if (entry.type === "custom") {
      if (entry.customType === "lifeos_active_task" && typeof entry.data?.taskId === "string") activeTaskId = entry.data.taskId;
      if (entry.customType === PEER_ENTRY && typeof entry.data?.peerAgentId === "string") peerAgentId = entry.data.peerAgentId;
      continue;
    }
    if (entry.type !== "message") continue;

    const role = entry.message?.role;
    if (role === "user") counts.user += 1;
    else if (role === "assistant") counts.assistant += 1;
    else if (role === "toolResult") counts.toolResult += 1;
    else if (role === "system") counts.system += 1;
    counts.total += 1;

    const at = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
    if (at !== undefined) {
      firstMessageAt ??= at;
      // 只有 user / assistant 算"对话活动"（pi-web activityTimeOf 同口径）
      if (role === "user" || role === "assistant") lastMessageAt = at;
    }
    if (role === "user" && firstUserText === "") firstUserText = textOfContent(entry.message?.content);

    if (role === "assistant") {
      const stopReason = entry.message?.stopReason;
      const errorMessage = typeof entry.message?.errorMessage === "string" ? entry.message.errorMessage.trim() : "";
      if (stopReason === "error") {
        const kind = classifyFailure({ stopReason: "error", ...(errorMessage !== "" ? { errorMessage } : {}), hasContent: false }) ?? "unknown";
        failing = { kind, detail: errorMessage, ...(at !== undefined ? { at } : {}) };
      } else {
        failing = undefined;   // 成功的 assistant 覆盖之前的失败
      }
    } else if (role === "user") {
      failing = undefined;     // 用户又发了新消息：上一条失败不再代表"现在"
    }
  }
  if (sessionId === "") return undefined;
  const scanned: ScannedSession = {
    sessionId,
    rawTitle: displayName !== "" ? displayName : firstUserText,
    counts,
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(firstMessageAt !== undefined ? { firstMessageAt } : {}),
    ...(lastMessageAt !== undefined ? { lastMessageAt } : {}),
    fileModifiedAt: (info?.mtime ?? new Date(0)).toISOString(),
    ...(activeTaskId !== undefined ? { activeTaskId } : {}),
    ...(peerAgentId !== undefined ? { peerAgentId } : {}),
    ...(failing !== undefined ? { failure: failing } : {}),
  };
  // 写缓存：指纹用**读之前**那次 stat（读的过程中文件被追加的话，下次 stat 会不匹配，自然重扫）
  if (fingerprint !== undefined) scanCache.set(path, { fingerprint, value: scanned });
  return scanned;
}

/** 一次 `listTasks` 建 id → Task 摘要映射（不为每个会话各读一遍 `task.md`）。 */
async function taskIndexOf(agentId: string, projectId: string): Promise<Map<string, RowTask>> {
  const tasks = await listTasks({ agentId, projectId }).catch(() => []);
  const map = new Map<string, RowTask>();
  for (const task of tasks) map.set(task.id, { id: task.id, title: task.title, status: task.status, type: task.type });
  return map;
}

/** 项目身份：`project.json` 的 `name` 优先，`basename(path)` 兜底（pi-web `projectDisplayName()` 同逻辑）。 */
async function projectOf(projectId: string): Promise<RowProject | undefined> {
  const manifest = await readGlobalProject(projectId).catch(() => undefined);
  if (manifest === undefined) return undefined;
  const fallback = (manifest.path ?? "").split(/[\\/]/).filter((part) => part !== "").at(-1) ?? manifest.id;
  const name = manifest.name.trim() !== "" ? manifest.name : fallback;
  const icon = (manifest as { icon?: unknown }).icon;
  return {
    id: manifest.id,
    name,
    ...(typeof icon === "string" && icon.trim() !== "" ? { icon: icon.trim() } : {}),
  };
}

/** 对端 Agent：同批会话的对端通常只有 1–2 个，读一次后缓存。 */
async function peerOf(peerAgentId: string, cache: Map<string, RowPeer>): Promise<RowPeer> {
  const cached = cache.get(peerAgentId);
  if (cached !== undefined) return cached;
  const def = await readAgent(peerAgentId).catch(() => undefined);
  const avatar = (def as { avatar?: RowAvatar } | undefined)?.avatar;
  const peer: RowPeer = {
    kind: "agent",
    id: peerAgentId,
    name: def?.name ?? peerAgentId,   // 对端被删/归档：有 id 就是信息，不编名字
    ...(avatar !== undefined ? { avatar } : {}),
  };
  cache.set(peerAgentId, peer);
  return peer;
}

export type SessionRowsOptions = { now?: number; defaultSessionId?: string };

/**
 * 组装某一项目下的所有行。
 *
 * 事实来源（每个都只有一处）：
 * - 会话事实 = 会话文件（`sessions/*.jsonl`）+ 文件 mtime（**只**用于 `fileModifiedAt`）
 * - 运行态 = `session-runtime`（`startedAt`）
 * - 未读 = `session-views`（`completedAt > viewedAt`）
 * - Task 名 = `tasks/<NNNN>/task.md`（一次 `listTasks` 建映射）
 * - 项目名/图标 = `projects/<id>/project.json`
 * - 对端 = `agents/<id>/agent.json`
 */
/**
 * 扫一个项目的所有会话文件（**一遍 IO**）。
 *
 * 为什么单独提出来（Task 0005 · P6）：`/tasks` 原来对每个 Task 各调一次
 * `sessionsOfTask()`，N 个 Task 就是 N 遍全扫（实测 26 个会话 × 4 个 Task）。
 * 现在两处共用这一遍扫描 —— 与 `sessionRowsOf` 同源，就不会出现
 * "列表里算的和 /tasks 里算的不一样"。
 */
async function scanProject(agentId: string, projectId: string): Promise<ScannedSession[]> {
  const dir = join(resolveHome(), "agents", agentId, "projects", projectId, "sessions");
  const names = await readdir(dir).catch(() => [] as string[]);
  // 并行扫描：逐个 await 会让 69 个文件的 IO 完全串行（实测串行 156ms vs 并行读 133ms，
  // 缓存命中后差距更明显，因为每次都只是并行的 stat）。
  const scanned = (await Promise.all(
    names.filter((name) => name.endsWith(".jsonl")).map((name) => scanSessionFile(join(dir, name))),
  )).filter((item): item is ScannedSession => item !== undefined);
  // 未落盘的会话（Pi 延迟写文件）：字段与落盘会话**同源同形**——现状只给 title/updatedAt/messages，
  // 导致刚建的新会话在 Task 列是空的（01 §3 第 7 条）。
  const fileIds = new Set(scanned.map((item) => item.sessionId));
  for (const pending of pendingSessions(agentId)) {
    if (pending.projectId !== projectId || fileIds.has(pending.sessionId)) continue;
    if (pending.name === undefined || pending.name === "") continue;   // 草稿不进列表
    // 计数取内存会话的真实角色分布（与落盘后同一口径）。
    // 注意一个**真实但正确**的情形：模型不可用时，`prompt` 立刻失败，内存会话里没有消息条目，
    // 而标题已经写进 sessionManager 的名字 —— 于是出现"有标题、counts 全 0"。
    // 这不是缺失语义错误：当时的真实事实就是"还没有成功发出任何消息条目"。
    // （2026-11-03 在开发实例实测到；落盘后 counts 会由文件扫描给出真实值。）
    const pendingCounts = pending.counts;
    scanned.push({
      sessionId: pending.sessionId,
      rawTitle: pending.name,
      counts: pendingCounts !== undefined
        ? { ...pendingCounts, total: pendingCounts.user + pendingCounts.assistant + pendingCounts.toolResult + pendingCounts.system }
        : emptyCounts(),
      createdAt: pending.at,
      fileModifiedAt: pending.at,
      ...(pending.taskId !== undefined ? { activeTaskId: pending.taskId } : {}),
    });
  }
  return scanned;
}

export async function sessionRowsOf(agentId: string, projectId: string, options: SessionRowsOptions = {}): Promise<SessionRow[]> {
  const now = options.now ?? Date.now();
  const project = await projectOf(projectId);
  const tasks = await taskIndexOf(agentId, projectId);
  const running = new Map(runningOf(agentId).map((entry) => [entry.sessionId, entry] as const));
  const unread = new Map(
    // 未读带 `state`：失败与成功分别判断（Task 0005 · 2026-11-04）。
    // 绝不能只用 `completedAt` —— 一个会话可能失败多次后成功，那样失败会被成功覆盖。
    sessionViewsOf().unread().map((item) => [`${item.agentId}\u0000${item.sessionId}`, item] as const),
  );
  const peerCache = new Map<string, RowPeer>();

  const scanned = await scanProject(agentId, projectId);

  // 未落盘的会话（Pi 延迟写文件）：字段与落盘会话**同源同形**——现状只给 title/updatedAt/messages，
  // 导致刚建的新会话在 Task 列是空的（01 §3 第 7 条）。
  const fileIds = new Set(scanned.map((item) => item.sessionId));
  for (const pending of pendingSessions(agentId)) {
    if (pending.projectId !== projectId || fileIds.has(pending.sessionId)) continue;
    if (pending.name === undefined || pending.name === "") continue;   // 草稿不进列表
    // 计数取内存会话的真实角色分布（与落盘后同一口径）。
    // 注意一个**真实但正确**的情形：模型不可用时，`prompt` 立刻失败，内存会话里没有消息条目，
    // 而标题已经写进 sessionManager 的名字 —— 于是出现"有标题、counts 全 0"。
    // 这不是缺失语义错误：当时的真实事实就是"还没有成功发出任何消息条目"。
    // （2026-11-03 在开发实例实测到；落盘后 counts 会由文件扫描给出真实值。）
    const pendingCounts = pending.counts;
    scanned.push({
      sessionId: pending.sessionId,
      rawTitle: pending.name,
      counts: pendingCounts !== undefined
        ? { ...pendingCounts, total: pendingCounts.user + pendingCounts.assistant + pendingCounts.toolResult + pendingCounts.system }
        : emptyCounts(),
      createdAt: pending.at,
      fileModifiedAt: pending.at,
      ...(pending.taskId !== undefined ? { activeTaskId: pending.taskId } : {}),
    });
  }

  // 项目目录异常（manifest 缺失）：不编一个 {id, name:id}，直接返回空。
  if (project === undefined) return [];

  const rows: SessionRow[] = [];
  for (const item of scanned) {
    const runningEntry = running.get(item.sessionId);
    const unreadItem = unread.get(`${agentId}\u0000${item.sessionId}`);
    rows.push({
      sessionId: item.sessionId,
      title: { raw: item.rawTitle, display: displayTitleOf(item.rawTitle) },
      project,
      task: item.activeTaskId !== undefined ? tasks.get(item.activeTaskId) ?? null : null,
      peer: item.peerAgentId !== undefined ? await peerOf(item.peerAgentId, peerCache) : null,
      counts: item.counts,
      time: {
        createdAt: item.createdAt ?? item.fileModifiedAt,
        ...(item.firstMessageAt !== undefined ? { firstMessageAt: item.firstMessageAt } : {}),
        ...(item.lastMessageAt !== undefined ? { lastMessageAt: item.lastMessageAt } : {}),
        lastActivityAt: item.lastMessageAt ?? item.createdAt ?? item.fileModifiedAt,
        fileModifiedAt: item.fileModifiedAt,
      },
      activity: rowActivityOf({
        ...(runningEntry !== undefined ? { runningSince: runningEntry.startedAt } : {}),
        ...(unreadItem !== undefined ? { unreadSince: unreadItem.completedAt } : {}),
        // 失败：**索引优先**。索引里"有未看的失败"时，即使会话文件最后一条是成功（`item.failure` 为空），
        // 也要显示红点 —— 否则数字说有一条失败、行上却没有，用户会找不到它。
        ...(item.failure !== undefined
          ? { failure: { kind: item.failure.kind, detail: item.failure.detail, ...(item.failure.at !== undefined ? { at: item.failure.at } : {}) } }
          : unreadItem?.state === "error"
            ? { failure: { kind: (unreadItem.failureKind ?? "unknown") as FailureKind, detail: unreadItem.failureDetail ?? "" } }
            : {}),
        now,
      }),
      isDefault: item.sessionId === options.defaultSessionId,
    });
  }
  // 排序：最近活动在前（键 = `lastActivityAt`，**不是 mtime**）
  return rows.sort((a, b) => (a.time.lastActivityAt < b.time.lastActivityAt ? 1 : -1));
}

/**
 * 每个 Task 下有哪些会话（**一遍扫描**，取代 N×全扫）。
 *
 * 形状对齐 `sessionsOfTask()` 的返回，因为 `/tasks` 端点就是给它消费的；
 * 但排序键改用 `lastActivityAt`（不是 mtime）—— 与列表同口径，
 * 否则"Task 里的会话顺序"和"列表里的顺序"会不一致。
 */
export async function sessionsByTask(
  agentId: string,
  projectId: string,
): Promise<Map<string, Array<{ sessionId: string; title?: string; lastActivityAt: string; running: boolean }>>> {
  const scanned = await scanProject(agentId, projectId);
  const runningSet = new Set(runningOf(agentId).map((entry) => entry.sessionId));
  const grouped = new Map<string, Array<{ sessionId: string; title?: string; lastActivityAt: string; running: boolean }>>();
  for (const item of scanned) {
    if (item.activeTaskId === undefined) continue;
    const list = grouped.get(item.activeTaskId) ?? [];
    list.push({
      sessionId: item.sessionId,
      ...(item.rawTitle !== "" ? { title: item.rawTitle } : {}),
      lastActivityAt: item.lastMessageAt ?? item.createdAt ?? item.fileModifiedAt,
      running: runningSet.has(item.sessionId),
    });
    grouped.set(item.activeTaskId, list);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1));
  }
  return grouped;
}
