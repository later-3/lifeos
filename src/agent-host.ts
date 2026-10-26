// 进程内 Agent 宿主：会话 id 用 Pi 生成的 id；一轮的输出进“按 Agent 的事件流”（带序号，可续传）。
// 默认会话不是运行时生成的：出厂即随模板预置在 workspace/sessions/（协议 §12.2），这里只负责加载。
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { buildPromptParts, createLifeOsPromptExtension, resolveModelChoice } from "./assembly.ts";
import type { ImageAttachment } from "./image-input.ts";
import { ensureDailyShard, ensureDefaultTask, listTasks } from "./tasks.ts";
import { readProjectManifests } from "./projects.ts";
import { ensureAgentProjectLayer } from "./project-skeleton.ts";
import { log } from "./logging.ts";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { resolveHome } from "./home.ts";
import { LIFEOS_TOOL_NAMES, createAgentTools } from "./agent-tools.ts";
import { toolResultImages, toStreamEvent, type StreamEvent } from "./stream-events.ts";
import { classifyFailure, type FailureKind } from "./failure.ts";
import { decideRestoreModel, decideRestoreThinking } from "./model-follow.ts";
import type { ModelRef } from "./model-follow-types.ts";
// 事件总线独立成模块（events.ts）：写操作（agents/projects/任务）在**共享实现**里广播，
// 不再依赖调用方传 notify，也不再产生 agents → agent-host 的循环 import（2026-10-20）。
import { broadcast, isFocusedVisible, publish, type AgentEvent } from "./events.ts";
import { sessionViewsOf, sessionViewsReady } from "./session-views.ts";
import { titleFromFirstMessage } from "./session-title.ts";
import { clearRunning, isRunning, markRunning, runningAll, runningOf, type RunSnapshot } from "./session-runtime.ts";
import { randomBytes } from "node:crypto";
import { readTurnVerdict, type TurnVerdict } from "./turn-verdict.ts";
export { broadcast } from "./events.ts";
export type { AgentEvent } from "./events.ts";
export type { RunSnapshot } from "./session-runtime.ts";

/** 会话当前选中的 Task（自定义条目；不参与模型上下文）。 */
const ACTIVE_TASK_ENTRY = "lifeos_active_task";

type HostedSession = Awaited<ReturnType<typeof createAgentSession>>["session"];
type ModelRuntimeInstance = Awaited<ReturnType<typeof ModelRuntime.create>>;
type SessionState = { session: HostedSession; modelRuntime: ModelRuntimeInstance; taskId?: string };
type AgentState = {
  sessions: Map<string, SessionState>;
  /** 已创建但尚未落盘的会话（Pi 对无消息会话延迟写文件）——列表必须包含它们，否则“新建会话”隐身。 */
  pending: Map<string, { projectId: string; at: string; taskId?: string }>;
};

// 状态以「家 + agentId」为键：测试/引导切换 LIFEOS_HOME 后不串状态（同 id 会话可能存在于不同家）。
const agents = new Map<string, AgentState>();
const stateKey = (agentId: string) => `${resolveHome()}\u0000${agentId}`;

function stateOf(agentId: string): AgentState {
  const key = stateKey(agentId);
  const existing = agents.get(key);
  if (existing !== undefined) return existing;
  const created: AgentState = { sessions: new Map(), pending: new Map() };
  agents.set(key, created);
  return created;
}

/**
 * 全局快照（任务 0007）：跨 Agent 的运行中会话（带当前 turnId）、服务端未读、最近回合账本。
 * 必须与 subscribeBus 在同一个同步块里生成（HTTP 层保证），否则快照与缓冲会重复一条终态。
 */
export function globalSnapshot(): {
  running: Array<RunSnapshot & { agentId: string; turnId?: string }>;
  unread: Array<{ agentId: string; sessionId: string; completedAt: string }>;
  turns: Array<TurnRecord & { agentId: string }>;
} {
  const running = runningAll().map((entry) => {
    const record = turnLedger.get(`${entry.agentId}\u0000${entry.sessionId}`);
    return record !== undefined && record.state === "running"
      ? { ...entry, turnId: record.turnId }
      : entry;
  });
  return { running, unread: sessionViewsOf().unread(), turns: turnSnapshotAll() };
}

// 装配常量（2026-10-18/19 用户拍板）：工具**显式钉死**，不依赖 Pi 的隐式默认——
// 8 个内置 + 10 个 Life OS 自有工具（agent、task、project、memory；见 src/agent-tools.ts）。
// 注意：createAgentSession 的 tools 是**白名单**（只允许列出的工具启用），新工具必须写进来。
const ALL_TOOL_NAMES = [...["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"] as const, ...LIFEOS_TOOL_NAMES];

type CreateOptions = NonNullable<Parameters<typeof createAgentSession>[0]>;
type ThinkingOption = NonNullable<CreateOptions["thinkingLevel"]>;
type ModelOption = NonNullable<CreateOptions["model"]>;

/**
 * 资源加载器（装配点）：
 * - **显式关闭 Pi 的上下文文件**（`noContextFiles: true`）：Pi 默认会把 cwd **及其所有父目录**的
 *   `AGENTS.md`/`CLAUDE.md` 读进 `<project_context>` 区——"向上继承父目录规范"不是我们的设计（2026-10-18 用户确认），
 *   所以我们关掉它；要项目规范时走我们自己的通道：`agents/<id>/projects/<pid>/AGENTS.md` → harness 区（有出处、可反查）。
 * - 方案 E 的内联 extension：preamble 换 identity + 回填 Pi 的 tools/rules + 独立 harness 区。
 */
export async function createHostedResourceLoader(input: {
  cwd: string; configDir: string; settingsManager: SettingsManager; parts: Awaited<ReturnType<typeof buildPromptParts>>;
  /** 每次 run 重新装配（用于会话中途切换 Task）；不传则用固定 parts。 */
  getParts?: () => Promise<Awaited<ReturnType<typeof buildPromptParts>>>;
}): Promise<DefaultResourceLoader> {
  const loader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.configDir,
    settingsManager: input.settingsManager,
    noContextFiles: true,
    extensionFactories: [createLifeOsPromptExtension(input.getParts ?? input.parts)],
  });
  await loader.reload();
  return loader;
}

/**
 * 统一创建 Agent 会话（装配层，事实见 .lifeos/projects/lifeos/knowledge/architecture/agent.md §9.4）：
 * - agentDir = ~/.lifeos/config（Pi 由此读 models.json/auth.json/settings.json——界面里配的模型才真正生效）；
 * - customPrompt = identity（替换 Pi 默认“编码 agent”前言）+ harness 独立区；Pi 的 tools/rules 原样回填；
 * - tools = 全部 8 个内置工具（显式，不随隐式默认漂移）；Pi 的上下文文件读取已关闭（见 createHostedResourceLoader）；
 * - 新建会话：按优先级 A 显式选模型；恢复会话：不传 model，尊重会话内 model_change。
 */
async function createHostedSession(
  agentId: string,
  sessionManager: ReturnType<typeof SessionManager.create>,
  mode: "new" | "restored",
  taskId?: string,
): Promise<{ session: SessionState["session"]; modelRuntime: ModelRuntimeInstance; modelLabel: string | undefined }> {
  const cwd = sessionManager.getCwd();
  const configDir = join(resolveHome(), "config");
  const modelRuntime = await ModelRuntime.create({
    authPath: join(configDir, "auth.json"),
    modelsPath: join(configDir, "models.json"),
  });
  const settingsManager = SettingsManager.create(cwd, configDir);

  const projectId = projectOfSessionDir(sessionManager.getSessionDir());
  const parts = await buildPromptParts(agentId, projectId, taskId);
  // Task 在会话中途可切换：每次 run 从会话的最后一条 active_task 条目重新装配，而不是把 task.md 固定死在创建时。
  const getParts = async (): Promise<Awaited<ReturnType<typeof buildPromptParts>>> => {
    const currentTaskId = activeTaskOf(sessionManager) ?? taskId;
    return await buildPromptParts(agentId, projectId, currentTaskId);
  };
  const resourceLoader = await createHostedResourceLoader({ cwd, configDir, settingsManager, parts, getParts });

  const resolution = await resolveModelChoice(agentId);
  let model: ModelOption | undefined;
  let thinkingLevel: ThinkingOption | undefined;
  let modelLabel: string | undefined;
  if (mode === "new" && resolution !== undefined) {
    const found = modelRuntime.getModel(resolution.choice.defaultProvider, resolution.choice.defaultModel);
    if (found !== undefined) {
      model = found;
      const sourceLabel = resolution.source === "agent" ? "Agent 个人配置"
        : resolution.source === "settings" ? "系统 settings" : "模型清单默认";
      modelLabel = `${resolution.choice.defaultProvider}/${resolution.choice.defaultModel}（来源 ${sourceLabel}）`;
      if (resolution.choice.defaultThinkingLevel !== undefined) {
        thinkingLevel = resolution.choice.defaultThinkingLevel as ThinkingOption;
      }
    }
  }

  const { session } = await createAgentSession({
    sessionManager,
    cwd,
    agentDir: configDir,
    modelRuntime,
    settingsManager,
    resourceLoader,
    tools: [...ALL_TOOL_NAMES],
    // 工具绑定会话上下文（谁 / 哪个项目），模型不用传：agentId + projectId 都从会话自身推导
    customTools: createAgentTools({
      agentId,
      projectId,
      // 建 Task 即进入它：会话指针指向新 Task（下一轮装配读取），与用户在界面里 /task 切换是同一件事
      // 进入即切换（协议 §7）：写会话指针，下一轮装配生效；校验与写指针共用 setSessionTask
      onEnterTask: async (taskId) => {
        const result = await setSessionTask(agentId, sessionManager.getSessionId(), taskId);
        if (!result.ok) throw new Error(`无法进入 Task ${taskId}：${result.reason}`);
      },
    }),
    ...(model !== undefined ? { model } : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
  });
  if (mode !== "new") await adoptAgentDefault(session, sessionManager, modelRuntime, agentId);
  return { session, modelRuntime, modelLabel };
}

/** 从会话目录反推 projectId：…/agents/<id>/projects/<pid>/sessions → <pid>。 */
function projectOfSessionDir(dir: string): string {
  const marker = `${sep}projects${sep}`;
  const index = dir.lastIndexOf(marker);
  if (index === -1) return "workspace";
  return dir.slice(index + marker.length).split(sep)[0] ?? "workspace";
}

/** 会话物理落在所属 project 的 sessions/ 下（协议 §12.1 结构即事实；默认 workspace）。 */
export function sessionDir(agentId: string, projectId = "workspace"): string {
  return join(resolveHome(), "agents", agentId, "projects", projectId, "sessions");
}

/** 读会话原始条目（会话历史的事实源）：文件里的 session 头 + 每条 append-only 条目，不做任何投影/裁剪。 */
export async function readSessionEntries(agentId: string, sessionId: string): Promise<{
  header: Record<string, unknown>;
  entries: Array<Record<string, unknown>>;
} | undefined> {
  const found = await findSessionFile(agentId, sessionId);
  if (found === undefined) return undefined;
  const text = await readFile(found.path, "utf8");
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const parsed: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    try { parsed.push(JSON.parse(line) as Record<string, unknown>); } catch { /* 坏行跳过（如实跳过，不补造） */ }
  }
  const header = parsed[0]?.type === "session" ? parsed[0] : undefined;
  if (header === undefined) return undefined;
  return { header, entries: parsed.slice(1) };
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

/** 旧 URL 的 uuid 可能已被懒迁移成可读目录：入口先解析到当前绑定 id（会话/任务不能落旧目录）。 */
async function canonicalProjectId(agentId: string, projectId: string): Promise<string> {
  if (projectId === "workspace") return projectId;
  const manifests = await readProjectManifests(agentId);
  if (manifests.has(projectId)) return projectId;
  for (const manifest of manifests.values()) if (manifest.legacyId === projectId) return manifest.id;
  return projectId;
}

/** 新建会话到指定 project（cwd 由调用方按项目定：workspace=~/.lifeos，外部=项目 path）。 */
export async function createSession(agentId: string, cwd: string, projectIdInput = "workspace"): Promise<string> {
  const projectId = await canonicalProjectId(agentId, projectIdInput);
  if (projectId === "workspace") {
    // 内置 workspace 兜底注册（每个 Agent 天然有默认 project，agent.md §5.6）；外部项目 manifest 在共用层，不在此处理。
    await ensureAgentProjectLayer(join(resolveHome(), "agents", agentId, "projects", "workspace"));
  }
  // 默认 Task（协议 §6.1）：每个 Agent × 项目一个。分片不在这里建：只有真正发起对话（每轮）才按当天日期建。
  const task = await ensureDefaultTask({ agentId, projectId });
  const manager = SessionManager.create(cwd, sessionDir(agentId, projectId));
  const { session, modelRuntime, modelLabel } = await createHostedSession(agentId, manager, "new", task.id);
  const sessionId = manager.getSessionId();
  // 持久化“当前 Task”指针；可切换，不把 Session 绑定死在一个 Task。
  session.sessionManager.appendCustomEntry(ACTIVE_TASK_ENTRY, { taskId: task.id, at: new Date().toISOString() });
  if (modelLabel !== undefined) console.log(`[assembly] 新建会话 ${sessionId} · 模型 ${modelLabel} · Task ${task.id}`);
  stateOf(agentId).sessions.set(sessionId, { session, modelRuntime, taskId: task.id });
  stateOf(agentId).pending.set(sessionId, { projectId, at: new Date().toISOString(), taskId: task.id });
  return sessionId;
}

/** 待落盘会话清单（供列表合并；含展示名，改名在未落盘阶段也不丢）。 */
export function pendingSessions(agentId: string): Array<{ sessionId: string; projectId: string; at: string; taskId?: string; name?: string }> {
  const state = stateOf(agentId);
  return [...state.pending.entries()].map(([sessionId, meta]) => {
    const name = state.sessions.get(sessionId)?.session.sessionManager.getSessionName();
    return { sessionId, ...meta, ...(name !== undefined && name !== "" ? { name } : {}) };
  });
}

/** 内存态会话的 cwd（刚创建还没落盘时是唯一来源）。 */
export function sessionCwd(agentId: string, sessionId: string): string | undefined {
  return stateOf(agentId).sessions.get(sessionId)?.session.sessionManager.getCwd();
}

/** 会话所属项目：由会话文件所在目录决定（`agents/<id>/projects/<pid>/sessions/*.jsonl`）—— 文件位置即事实。 */
export async function projectIdOfSession(agentId: string, sessionId: string): Promise<string | undefined> {
  const found = await findSessionFile(agentId, sessionId);
  return found === undefined ? undefined : projectOfSessionDir(found.dir);
}

/** 会话里最后一次选中的 Task（自定义条目；旧会话没有 → undefined）。 */
function activeTaskOf(manager: ReturnType<typeof SessionManager.open>): string | undefined {
  const branch = manager.getBranch();
  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i];
    if (entry?.type !== "custom" || entry.customType !== ACTIVE_TASK_ENTRY) continue;
    const data = entry.data as { taskId?: unknown } | undefined;
    return typeof data?.taskId === "string" && data.taskId !== "" ? data.taskId : undefined;
  }
  return undefined;
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
  const manager = SessionManager.open(found.path, found.dir, cwd);
  const projectId = projectOfSessionDir(found.dir);
  let taskId = activeTaskOf(manager);
  if (taskId === undefined) {
    // 旧会话/预置默认会话：首次打开时补当天默认 Task；旧文件没有指针时也不伪造成别的 Task。
    try {
      const task = await ensureDefaultTask({ agentId, projectId });
      taskId = task.id;
      manager.appendCustomEntry(ACTIVE_TASK_ENTRY, { taskId, at: new Date().toISOString() });
    } catch { /* 项目已被移除等：保持无 Task，不阻断会话读取 */ }
  }
  const { session, modelRuntime } = await createHostedSession(agentId, manager, "restored", taskId);
  const restored: SessionState = { session, modelRuntime, ...(taskId !== undefined ? { taskId } : {}) };
  state.sessions.set(sessionId, restored);
  state.pending.delete(sessionId);
  return restored;
}

/**
 * 一轮交互的日期分片（协议 §6.1）：按本地日期取/建默认 Task 的 `daily/<日期>.md`。
 * 没有交互的日子不建分片；跨天的会话仍指向默认 Task，新的一天写进新的分片。
 * `date` 只给测试用（模拟跨天），正常调用不传。
 */
export async function ensureTurnShard(agentId: string, sessionId: string, date?: string): Promise<{ file: string } | undefined> {
  // 新会话在第一条消息落盘前只存在于内存：项目以内存里会话的目录为准，落盘后再看文件位置
  const live = stateOf(agentId).sessions.get(sessionId)?.session.sessionManager.getSessionDir();
  const projectId = live !== undefined ? projectOfSessionDir(live) : await projectIdOfSession(agentId, sessionId);
  if (projectId === undefined) return undefined;
  const { file } = await ensureDailyShard({ agentId, projectId }, date);
  return { file };
}

// 回合账本（协议 P1·1.2）：每 (Agent, 会话) 一条"最近回合"——running / done / error / lost。
// 事件里的 turnId 以它为宗；同一会话同一毫秒只受理一个回合，键冲突可忽略。
export type TurnState = "running" | "done" | "error" | "lost";
export type TurnRecord = { turnId: string; state: TurnState; at: string; sessionId: string };
const turnLedger = new Map<string, TurnRecord>();   // key = agent\u0000 session（\u0000 不可能与 id 相撞）

/** turnId：turn-<时间36>-<4hex>；P2 界面短 id = 末尾 4hex。 */
export function newTurnId(): string {
  return `turn-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
}

export function startTurn(agentId: string, sessionId: string, turnId: string): void {
  turnLedger.set(`${agentId}\u0000${sessionId}`, { sessionId, turnId, state: "running", at: new Date().toISOString() });
}

export function finishTurn(agentId: string, sessionId: string, turnId: string, state: "done" | "error"): void {
  turnLedger.set(`${agentId}\u0000${sessionId}`, { sessionId, turnId, state, at: new Date().toISOString() });
}

/** 跨 Agent 的最近回合账本（全局快照用）：key 解析出 agentId。 */
export function turnSnapshotAll(): Array<TurnRecord & { agentId: string }> {
  const out: Array<TurnRecord & { agentId: string }> = [];
  for (const [key, record] of turnLedger) {
    const sep = key.indexOf("\u0000");
    out.push({ agentId: key.slice(0, sep), ...record });
  }
  return out;
}

/**
 * 回合结束的服务端事实（任务 0007 P2）：完成即记未读；若此刻有人正在看这个会话，同时记为已读。
 * 被用户打断（aborted）的回合不算"完成"——pi-web 旧版同样不对打断的回合发完成通知（rpc-manager.ts:510）。
 */
function recordCompletion(agentId: string, sessionId: string, aborted: boolean, projectId: string | undefined): void {
  const at = new Date().toISOString();
  if (!aborted) sessionViewsOf().markCompleted(agentId, sessionId, at, projectId);
  if (isFocusedVisible(agentId, sessionId)) sessionViewsOf().markViewed(agentId, sessionId, at);
}

/** 用户主动打断的会话键（runTurn 结束时取走；不打断的回合不会留下记录）。 */
const abortRequested = new Set<string>();

/** 对账（server 端点用）：先内存账本，miss 再读会话 JSONL 尾条（重启兜底，T9）。 */
export async function turnLastOf(agentId: string, sessionId: string): Promise<{ turn: TurnRecord | null }> {
  const record = turnLedger.get(`${agentId}\u0000${sessionId}`);
  if (record !== undefined) {
    return { turn: record };
  }
  const found = await findSessionFile(agentId, sessionId);
  if (found === undefined) return { turn: null };
  const verdict: TurnVerdict = await readTurnVerdict(found.path);
  if (verdict === null) return { turn: null };
  return { turn: { sessionId, turnId: verdict.turnId, state: verdict.state, at: new Date().toISOString() } };
}

/** 引用完整性（2026-10-24 C117）：检查 parentId 指向的条目是否存在；断裂会让消息"消失"（branch 变短）。 */
export async function sessionIntegrity(agentId: string, sessionId: string): Promise<{ orphanParents: number } | undefined> {
  const found = await findSessionFile(agentId, sessionId);
  if (found === undefined) return undefined;
  const text = await readFile(found.path, "utf8").catch(() => "");
  if (text.trim() === "") return { orphanParents: 0 };
  const entries: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try { entries.push(JSON.parse(trimmed) as Record<string, unknown>); } catch { /* 坏行跳过 */ }
  }
  const ids = new Set<string>();
  for (const entry of entries) {
    const id = entry.id;
    if (typeof id === "string" && id !== "") ids.add(id);
  }
  let orphanParents = 0;
  for (const entry of entries) {
    const parent = entry.parentId;
    if (typeof parent === "string" && parent !== "" && !ids.has(parent)) orphanParents += 1;
  }
  return { orphanParents };
}

/** 会话是否实质存在（账本为空 + 磁盘没有文件 → 404 依据）。 */
export async function sessionExists(agentId: string, sessionId: string): Promise<boolean> {
  if (stateOf(agentId).sessions.has(sessionId)) return true;
  return (await findSessionFile(agentId, sessionId)) !== undefined;
}

/**
 * 首条消息发出即命名（会话维护，提交 a08a21e）：Pi 要等助手回复才把会话落盘，而列表标题读的是落盘后的文件，
 * 所以这里把标题写进内存会话名（与重命名同一个 SDK 方法，落盘时写入的内容与之一致）。
 * 必须在 POST 返回前同步完成，调用方（路由）保证：新发出的第一条消息才命名；已有名字的（重命名过）不覆盖。
 */
export function nameSessionFromFirstMessage(agentId: string, sessionId: string, text: string): boolean {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === undefined) return false;
  const sessionManager = state.session.sessionManager;
  if (sessionManager.getSessionName()) return false;
  const title = titleFromFirstMessage(text);
  if (title === "") return false;
  sessionManager.appendSessionInfo(title);
  broadcast({ type: "agents_changed" });   // 侧栏重取列表：标题立刻可见
  return true;
}

/** 跑一轮：把 Pi 的文本增量发布成事件。 */
export async function runTurn(agentId: string, sessionId: string, text: string, images?: ImageAttachment[]): Promise<void> {
  const state = stateOf(agentId);
  const target = state.sessions.get(sessionId);
  if (target === undefined) return;
  // 发起对话才有分片（协议 §6.1）：本轮的日期分片在这里建；失败不阻断对话。
  await ensureTurnShard(agentId, sessionId).catch((error) => {
    console.error(`[tasks] 当天分片创建失败：${error instanceof Error ? error.message : String(error)}`);
    void log.error("agent-host", "ensureTurnShard", "当天分片创建失败", { agentId, details: { message: error instanceof Error ? error.message : String(error) } });
  });
  // 回合账本（turnId）：受理即开账；SSE turn 事件（running），终态在 try/catch 里补（协议 P1·1.2）
  const projectIdForLog = await projectIdOfSession(agentId, sessionId);
  const turnId = newTurnId();
  startTurn(agentId, sessionId, turnId);
  publish(agentId, { sessionId, projectId: projectIdForLog, type: "turn", turnId, state: "running" });
  void log.info("agent-host", "runTurn", "受理回合", { sessionId, turnId, agentId, projectId: projectIdForLog });
  markRunning(agentId, { sessionId, projectId: projectIdForLog, startedAt: new Date().toISOString() });
  const unsubscribe = target.session.subscribe((event: unknown) => {
    const mapped = toStreamEvent(event);
    if (mapped !== undefined) publish(agentId, { sessionId, ...mapped });
  });
  const requestKey = `${agentId}\u0000${sessionId}`;
  abortRequested.delete(requestKey);
  try {
    // 图片走 Pi 原生 images 通道（PromptOptions.images）；Pi 会在进入历史前按 inputLimits 规范化
    await target.session.prompt(text, images !== undefined && images.length > 0 ? { images } : undefined);
    const aborted = abortRequested.delete(requestKey);
    // 回合账本 done（turn 终态先到位，再发收尾事件）；未读事实先于事件落定，断线重连的快照一定包含它
    finishTurn(agentId, sessionId, turnId, "done");
    recordCompletion(agentId, sessionId, aborted, projectIdForLog);
    void log.info("agent-host", "runTurn", "回合完成", { sessionId, turnId, agentId, projectId: projectIdForLog, details: { aborted } });
    publish(agentId, { sessionId, projectId: projectIdForLog, type: "turn", turnId, state: "done" });
    publish(agentId, { sessionId, projectId: projectIdForLog, type: "done", turnId, aborted });
  } catch (error) {
    abortRequested.delete(requestKey);
    const message = error instanceof Error ? error.message : String(error);
    finishTurn(agentId, sessionId, turnId, "error");
    recordCompletion(agentId, sessionId, false, projectIdForLog);
    void log.error("agent-host", "runTurn", "回合失败", { sessionId, turnId, agentId, projectId: projectIdForLog, details: { message } });
    publish(agentId, { sessionId, projectId: projectIdForLog, type: "turn", turnId, state: "error" });
    publish(agentId, { sessionId, projectId: projectIdForLog, type: "error", message, kind: classifyFailure({ errorMessage: message, hasContent: false }) ?? "unknown", turnId });
  } finally {
    unsubscribe();
    clearRunning(agentId, sessionId);
    // 待落盘登记：只有文件真的落盘了才交给文件列表接管。首轮失败时 Pi 不会落盘（要等助手回复），
    // 直接删登记会让会话从列表消失（2026-10-25 实测：模型不可用时新会话隐身，标题也丢）。
    if (await findSessionFile(agentId, sessionId) !== undefined) state.pending.delete(sessionId);
  }
}

type UsageSnapshot = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; totalTokens: number };
type UsageLike = { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: { total: number } };
const emptyUsage = (): UsageSnapshot => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: 0 });
function addUsage(totals: UsageSnapshot, usage: UsageLike): void {
  totals.input += usage.input;
  totals.output += usage.output;
  totals.cacheRead += usage.cacheRead;
  totals.cacheWrite += usage.cacheWrite;
  totals.cost += usage.cost.total;
  totals.totalTokens += usage.totalTokens;
}

/** 会话累计 usage：assistant / toolResult / usage / compaction / branch_summary。 */
function sessionUsage(state: SessionState): UsageSnapshot {
  const totals = emptyUsage();
  for (const entry of state.session.sessionManager.getEntries()) {
    if (entry.type === "message") {
      if (entry.message.role === "assistant" && entry.message.usage !== undefined) {
        addUsage(totals, entry.message.usage);
      } else if (entry.message.role === "toolResult" && entry.message.usage !== undefined) {
        addUsage(totals, entry.message.usage);
      }
    } else if ((entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary") && entry.usage !== undefined) {
      addUsage(totals, entry.usage);
    }
  }
  return totals;
}

/** 会话当前用的模型与思考级别（内存态才有；界面用来显示"到底在用哪个模型"）。 */
export function sessionMeta(agentId: string, state: SessionState): {
  model: { provider: string; id: string } | null;
  thinkingLevel: string;
  /** 这一轮是否正在跑：前端判断"跑丢了"之前先看它（避免把"模型很慢"误判成中断） */
  running: boolean;
  /** 是否用过 `/model`（显式覆盖）：决定默认模型变更后要不要跟随 */
  modelOverridden: boolean;
  /** 当前会话引用的 Task（可切换；不是绑定） */
  activeTaskId: string | null;
  usage: UsageSnapshot;
  context: { percent: number | null; window: number } | null;
} {
  const model = state.session.model;
  const context = state.session.getContextUsage();
  return {
    model: model === undefined ? null : { provider: model.provider, id: model.id },
    thinkingLevel: state.session.thinkingLevel,
    running: isRunning(agentId, state.session.sessionManager.getSessionId()),
    modelOverridden: hasModelOverride(state.session),
    activeTaskId: state.taskId ?? null,
    usage: sessionUsage(state),
    context: context === undefined ? null : { percent: context.percent, window: context.contextWindow },
  };
}

/** 会话文件里最后一次 model_change（恢复时用它判断"模型是不是还是默认"）。 */
function sessionModelOf(manager: SessionManager): { provider: string; id: string } | undefined {
  const branch = manager.getBranch();
  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i];
    if (entry?.type === "model_change") return { provider: entry.provider, id: entry.modelId };
  }
  return undefined;
}

/** 标记"用户显式换过模型"的 Pi 自定义条目（不参与模型上下文；只用于区分默认/覆盖）。 */
const MODEL_OVERRIDE_ENTRY = "lifeos_model_override";
/** 标记"用户显式换过思考级别"（`/thinking`）：没有它才跟随 Agent 默认（C120）。 */
const THINKING_OVERRIDE_ENTRY = "lifeos_thinking_override";

type SessionManagerLike = ReturnType<typeof SessionManager.create>;

/** 只认 `/model` 写的标记；`legacy` 标记是早期错误逻辑补的，不再算数（否则默认永远跟不上）。 */
function hasOverrideIn(manager: SessionManagerLike): boolean {
  return manager.getBranch().some((entry) => {
    if (entry.type !== "custom" || entry.customType !== MODEL_OVERRIDE_ENTRY) return false;
    const data = entry.data as { legacy?: unknown } | undefined;
    return data?.legacy !== true;
  });
}

function hasModelOverride(session: HostedSession): boolean {
  return hasOverrideIn(session.sessionManager);
}

function hasThinkingOverrideIn(manager: SessionManagerLike): boolean {
  return manager.getBranch().some((entry) => entry.type === "custom" && entry.customType === THINKING_OVERRIDE_ENTRY);
}

/**
 * 恢复会话时处理"默认 vs 覆盖"（用户 2026-10-20 规则）：
 * 没被 `/model` 覆盖过的会话，重开时也要跟随最新默认；覆盖过的保留用户选择。
 */
async function adoptAgentDefault(
  session: HostedSession,
  manager: SessionManagerLike,
  modelRuntime: ModelRuntimeInstance,
  agentId: string,
): Promise<void> {
  const resolution = await resolveModelChoice(agentId);
  const agentDefault: ModelRef | undefined = resolution === undefined ? undefined
    : { provider: resolution.choice.defaultProvider, id: resolution.choice.defaultModel };
  const decision = decideRestoreModel({
    stored: sessionModelOf(manager),
    agentDefault,
    overridden: hasOverrideIn(manager),
  });
  if (decision === "follow" && agentDefault !== undefined) {
    const target = modelRuntime.getModel(agentDefault.provider, agentDefault.id);
    if (target !== undefined) {
      try { await session.setModel(target); } catch { /* 默认模型此刻不可用（缺 key 等）：保持原样，下次再试 */ }
    }
  }
  // 思考级别同规则（C120）：没被 `/thinking` 覆盖过 → 跟随配置；覆盖过 → 保留。
  const wantThinking = resolution?.choice.defaultThinkingLevel;
  const thinkingDecision = decideRestoreThinking({
    stored: session.thinkingLevel,
    agentDefault: wantThinking,
    overridden: hasThinkingOverrideIn(manager),
  });
  if (thinkingDecision === "follow" && wantThinking !== undefined) {
    try { session.setThinkingLevel(wantThinking as ThinkingOption); } catch { /* 不支持该档位：保持原样 */ }
  }
}

/** 把新的默认思考级别同步给"没被 `/thinking` 覆盖过、且不在跑"的会话；返回改了几个。 */
export function applyAgentDefaultThinking(agentId: string, level: string): number {
  let applied = 0;
  for (const [sessionId, state] of stateOf(agentId).sessions) {
    if (isRunning(agentId, sessionId)) continue;
    if (hasThinkingOverrideIn(state.session.sessionManager)) continue;
    if (state.session.thinkingLevel === level) continue;
    try { state.session.setThinkingLevel(level as ThinkingOption); applied += 1; } catch { /* 不支持：跳过 */ }
  }
  return applied;
}

/** 把 Agent 的新默认模型同步给"没被 `/model` 覆盖过"的会话；返回实际改了几个。 */
export async function applyAgentDefaultModel(agentId: string, provider: string, modelId: string): Promise<number> {
  let applied = 0;
  for (const [sessionId, state] of stateOf(agentId).sessions) {
    if (hasModelOverride(state.session)) continue;
    // 正在跑的会话不在半路换模型（下一轮/重开时再跟随），避免一轮之内模型突变
    if (isRunning(agentId, sessionId)) continue;
    const model = state.modelRuntime.getModel(provider, modelId);
    if (model === undefined) continue;
    try {
      await state.session.setModel(model);
      applied += 1;
    } catch {
      // 不能切（比如 key 缺失）就保持原样：配置保存本身不应因为某个会话失败而失败
    }
  }
  return applied;
}

// —— 会话内的 Pi 原生能力（2026-10-19：全部对接 Pi AgentSession 的公开方法，不自己造）——

/** 打断当前 run（`abort()` 会等 idle；runTurn 的 finally 照常发 done）。 */
export async function abortSession(agentId: string, sessionId: string): Promise<boolean> {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === undefined) return false;
  abortRequested.add(`${agentId}\u0000${sessionId}`);
  await state.session.abort();
  return true;
}

/** 生成中投入输入：steer 插进当前思考，followUp 本轮结束后处理（都是 Pi 原生队列）。 */
export type QueueVerdict = { queued: "steer" | "followUp" } | { code: "session_idle" | "session_not_found" } | { code: "error"; message: string };

/** 生成中投递输入：先裁决（决策 b）—— 空闲返回 409 让前端改发新回合，绝不静默入 Pi 队列。 */
export async function queueSessionInput(agentId: string, sessionId: string, text: string, behavior: "steer" | "followUp"): Promise<QueueVerdict> {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === undefined) return { code: "session_not_found" };
  if (!isRunning(agentId, sessionId)) return { code: "session_idle" };
  try {
    if (behavior === "steer") await state.session.steer(text);
    else await state.session.followUp(text);
    return { queued: behavior };
  } catch (error) {
    return { code: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

/** 压缩上下文（Pi `compact()`：会先 abort 当前 run）。 */
export async function compactSession(agentId: string, sessionId: string): Promise<{ ok: true; summary: string } | { ok: false; message: string }> {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === undefined) return { ok: false, message: "找不到这个会话" };
  try {
    const result = await state.session.compact();
    return { ok: true, summary: result.summary };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export type SetTaskResult =
  | { ok: true; taskId: string }
  | { ok: false; reason: "session_not_found" | "task_not_found" };

/** 切换会话当前 Task：只影响下一轮；当前正在跑的轮次已装配完，不会被中途改写。 */
export async function setSessionTask(agentId: string, sessionId: string, taskId: string): Promise<SetTaskResult> {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === undefined) return { ok: false, reason: "session_not_found" };
  const projectId = projectOfSessionDir(state.session.sessionManager.getSessionDir());
  const tasks = await listTasks({ agentId, projectId });
  if (!tasks.some((task) => task.id === taskId)) return { ok: false, reason: "task_not_found" };
  state.session.sessionManager.appendCustomEntry(ACTIVE_TASK_ENTRY, { taskId, at: new Date().toISOString() });
  state.taskId = taskId;
  return { ok: true, taskId };
}

/** Pi 的思考档位（agent 包 types.ts）：路由用它做入参校验，界面用同一份。 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

/** 切模型的结果：三种失败要分开报（会话不在 / 清单里没有 / Pi 拒绝，含无 API key）。 */
export type SetModelResult =
  | { ok: true }
  | { ok: false; reason: "session_not_found" }
  | { ok: false; reason: "model_not_found" }
  | { ok: false; reason: "rejected"; message: string };

/** 会话级切模型（Pi `setModel()`，ModelRuntime 解析出 Model）。 */
export async function setSessionModel(agentId: string, sessionId: string, provider: string, modelId: string): Promise<SetModelResult> {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === undefined) return { ok: false, reason: "session_not_found" };
  const model = state.modelRuntime.getModel(provider, modelId);
  if (model === undefined) return { ok: false, reason: "model_not_found" };
  try {
    await state.session.setModel(model);
    // 显式覆盖标记：之后 Agent 默认变化时，这个会话不跟随（Pi 的 model_change 不区分"默认/覆盖"）
    state.session.sessionManager.appendCustomEntry(MODEL_OVERRIDE_ENTRY, { provider, modelId, at: new Date().toISOString() });
    return { ok: true };
  } catch (error) {
    // Pi 在 provider 没配 key 时抛 "No API key for provider/model"：原样带回界面，不吞成"找不到"
    return { ok: false, reason: "rejected", message: error instanceof Error ? error.message : String(error) };
  }
}

/** 会话级思考级别（Pi `setThinkingLevel()` 会把不支持的值夹取到可用档位）。 */
export function setSessionThinking(agentId: string, sessionId: string, level: ThinkingLevelName): { ok: true; level: string } | { ok: false } {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === undefined) return { ok: false };
  state.session.setThinkingLevel(level);
  state.session.sessionManager.appendCustomEntry(THINKING_OVERRIDE_ENTRY, { level, at: new Date().toISOString() });
  return { ok: true, level: state.session.thinkingLevel };
}

/** 每个家目录只清理一次孤儿未读（启动后第一次建立事件流前）。 */
const viewsPruned = new Set<string>();
export async function pruneSessionViewsOnce(): Promise<void> {
  const home = resolveHome();
  if (viewsPruned.has(home)) return;
  viewsPruned.add(home);
  await sessionViewsReady();
  // 旧记录回填项目（状态映射的项目层需要），回填不到的再按孤儿清理
  await sessionViewsOf().backfill((agentId, sessionId) => projectIdOfSession(agentId, sessionId)).catch(() => undefined);
  await sessionViewsOf().prune((agentId, sessionId) => sessionExists(agentId, sessionId)).catch(() => undefined);
}

/** 删除会话：移除文件与内存态；正在运行的拒绝。 */
export async function deleteSession(agentId: string, sessionId: string): Promise<"deleted" | "not_found" | "running"> {
  const state = stateOf(agentId);
  if (isRunning(agentId, sessionId)) return "running";
  const found = await findSessionFile(agentId, sessionId);
  if (found === undefined && !state.sessions.has(sessionId)) return "not_found";
  if (found !== undefined) await rm(found.path, { force: true });
  sessionViewsOf().forget(agentId, sessionId);   // 已删会话不得留下未读点
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
type ToolCallBlock = { type: "toolCall"; id?: string; name: string; arguments: unknown; result?: string; isError?: boolean; images?: Array<{ data: string; mimeType: string }> };
type ImageBlock = { type: "image"; data: string; mimeType: string };
type MessageBlock = TextBlock | ThinkingBlock | ToolCallBlock | ImageBlock;

/** 会话历史里已有的图片总字节：会话图片预算（不是张数）的计量依据。 */
export function sessionImageBytesOf(state: SessionState): number {
  let total = 0;
  for (const message of state.session.sessionManager.buildSessionProjection().messages) {
    if (message.role !== "user") continue;
    for (const part of Array.isArray(message.content) ? message.content : []) {
      const image = part as { type?: string; data?: unknown };
      if (image.type === "image" && typeof image.data === "string") {
        const padding = image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0;
        total += Math.max(0, Math.floor((image.data.length * 3) / 4) - padding);
      }
    }
  }
  return total;
}

/** 消息（含结构化块）：text/thinking/toolCall 按 Pi 真实内容块返回，toolResult 挂回对应调用
 * （参考 Pi Web MessageView 的展示数据；兼容字段 text 保留给纯文本消费者）。 */
export function messagesOf(state: SessionState) {
  // Pi 的失败信息（stopReason=error 时的 errorMessage）必须透出：否则界面只看到空回复、不知道为什么
  const out: Array<{ role: string; text: string; blocks: MessageBlock[]; at?: number; error?: string; failure?: FailureKind }> = [];
  // 时间来自**条目**（session entry 的 timestamp），不是消息本身：投影里的消息没有时间字段。
  // 失败块要显示"什么时候失败的"，否则历史失败会被误读成当前状态（2026-10-26 实测）。
  const projection = state.session.sessionManager.buildSessionProjection();
  const items = projection.entries.flatMap((entry) => {
    const raw = (entry.sourceEntry as { timestamp?: unknown }).timestamp;
    const parsed = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
    const at = Number.isNaN(parsed) ? undefined : parsed;
    return entry.messages.map((message) => ({ message, at }));
  });
  for (const { message, at } of items) {
    if (message.role === "user") {
      const text = textOf(message);
      // 图片必须保留：否则用户发出后刷新就看不到自己发的图（本期需求第 3 条）
      const blocks: MessageBlock[] = [];
      if (text !== "") blocks.push({ type: "text", text });
      for (const part of Array.isArray(message.content) ? message.content : []) {
        const image = part as { type?: string; data?: unknown; mimeType?: unknown };
        if (image.type === "image" && typeof image.data === "string" && typeof image.mimeType === "string") {
          blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
        }
      }
      out.push({ role: "user", text, blocks, ...(at !== undefined ? { at } : {}) });
    } else if (message.role === "assistant") {
      const blocks: MessageBlock[] = [];
      for (const part of message.content) {
        if (part.type === "text") blocks.push({ type: "text", text: part.text });
        else if (part.type === "thinking") blocks.push({ type: "thinking", text: part.thinking });
        else if (part.type === "toolCall") blocks.push({ type: "toolCall", id: part.id, name: part.name, arguments: part.arguments });
      }
      const text = blocks.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
      const raw = message as { stopReason?: string; errorMessage?: string };
      const errorText = typeof raw.errorMessage === "string" && raw.errorMessage.trim() !== "" ? raw.errorMessage.trim() : undefined;
      // 失败分类：区分超时 / 连不上 / 鉴权 / 限流 / 服务端错误 / 空回复 / 中断 / 截断
      const kind = classifyFailure({ ...(raw.stopReason !== undefined ? { stopReason: raw.stopReason } : {}), ...(errorText !== undefined ? { errorMessage: errorText } : {}), hasContent: blocks.length > 0 || text.trim() !== "" });
      out.push({
        role: "assistant", text, blocks,
        ...(at !== undefined ? { at } : {}),
        ...(kind !== undefined ? { failure: kind } : {}),
        ...(errorText !== undefined ? { error: errorText } : {}),
      });
    } else if (message.role === "toolResult") {
      const result = textOf(message);
      const callId = message.toolCallId;
      // 只按 toolCallId 精确配对：Pi 每个 toolCall 都有 id。曾用"最后一个没有结果的调用"兜底，
      // 结果把同一条消息里两个调用的结果配错（实测：ls 的结果挂到 bash 上，ls 永远"执行中"）。
      if (callId === undefined) continue;
      for (let i = out.length - 1; i >= 0; i--) {
        const item = out[i];
        if (item === undefined || item.role !== "assistant") continue;
        const call = item.blocks.find((block): block is ToolCallBlock => block.type === "toolCall" && block.id === callId);
        if (call === undefined) continue;
        call.result = result;
        call.isError = message.isError;
        // 工具读到的图片（Pi 的 read）：不带上就等于界面永远看不到
        const images = toolResultImages(message);
        if (images.length > 0) call.images = images;
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
