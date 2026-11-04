// 进程内 Agent 宿主：会话 id 用 Pi 生成的 id；一轮的输出进“按 Agent 的事件流”（带序号，可续传）。
// 默认会话不是运行时生成的：出厂即随模板预置在 workspace/sessions/（协议 §12.2），这里只负责加载。
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { planElision } from "./image-budget.ts";
import { appendAttachmentRefs, attachmentFileSizeCached, gcAttachments, imageBlocksOfRefs } from "./attachments.ts";
import { parseImageRefs } from "./image-note.ts";
import { readLimits, recordObservedToFile, resolveBudget, type Budget } from "./payload-limit.ts";
import { buildPromptParts, createLifeOsImageBudgetExtension, createLifeOsPromptExtension, createLifeOsReadPathExtension, resolveModelChoice } from "./assembly.ts";
import type { ImageAttachment } from "./image-input.ts";
import { ensureDailyShard, ensureDefaultTask, listTasks } from "./tasks.ts";
import { readProjectManifests } from "./projects.ts";
import { ensureAgentProjectLayer } from "./project-skeleton.ts";
import { log } from "./logging.ts";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { resolveHome } from "./home.ts";
import { createAgentTools } from "./agent-tools.ts";
import { LIFEOS_TOOL_NAMES } from "./tool-names.ts";
import { toolResultImages, toStreamEvent, type StreamEvent } from "./stream-events.ts";
import { phaseOfStreamEvent, rowPatches } from "./row-patch.ts";
import { displayTitleOf } from "./row-activity.ts";
import { classifyFailure, type FailureKind } from "./failure.ts";
import { envRefsOf, envRefState, isCommandConfigValue } from "./env-refs.ts";
import { reloadEnvFromShellConfigs } from "./env-reload.ts";
import { decideRestoreModel, decideRestoreThinking } from "./model-follow.ts";
import type { ModelRef } from "./model-follow-types.ts";
// 事件总线独立成模块（events.ts）：写操作（agents/projects/任务）在**共享实现**里广播，
// 不再依赖调用方传 notify，也不再产生 agents → agent-host 的循环 import（2026-10-20）。
import { broadcast, isFocusedVisible, publish, type AgentEvent } from "./events.ts";
import { sessionViewsOf, sessionViewsReady } from "./session-views.ts";
import { notifyPeerTurnFinished } from "./peer-completion.ts";
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
    extensionFactories: [
      createLifeOsPromptExtension(input.getParts ?? input.parts),
      createLifeOsImageBudgetExtension(),
      createLifeOsReadPathExtension(),
    ],
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
  // 模型凭据/清单默认走本家目录；开发实例可用路径级覆盖指向真实配置（只读路径，不复制凭据）。
  const modelRuntime = await ModelRuntime.create({
    authPath: process.env.LIFEOS_AUTH_PATH?.trim() || join(configDir, "auth.json"),
    modelsPath: process.env.LIFEOS_MODELS_PATH?.trim() || join(configDir, "models.json"),
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
      // 会话 id：稳定，创建后不变（send 的完成回流要知道"回流到哪"）
      sessionId: sessionManager.getSessionId(),
      // 当前 Task 必须**实时读**：会话可以中途切 Task（/task、lifeos_task_enter），
      // 在创建时取一次会永久滞后。用 getter 每次调用现读（Task 0015 · T1 的 lane 维度）。
      get taskId(): string | undefined {
        return stateOf(agentId).sessions.get(sessionManager.getSessionId())?.taskId
          ?? activeTaskOf(sessionManager);
      },
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
  if (mode !== "new") {
    await adoptAgentDefault(session, sessionManager, modelRuntime, agentId);
  } else {
    // 新建会话（Task 0017）：Pi 拿不到指定模型的凭据时会**静默**换成另一个有凭据的模型
    // （pi/packages/coding-agent/src/core/sdk.ts:224-249 的 findInitialModel）。
    // 我们传了 model 却没得到它，说明用户选的那个用不了——必须当场报错，
    // 否则用户看到的界面与实际请求会分叉。
    if (model !== undefined) {
      const actual = session.model;
      if (actual === undefined || actual.provider !== model.provider || actual.id !== model.id) {
        await session.abort().catch(() => undefined);
        const detail = describeModelUnavailable(model, await readProvidersConfig());
        throw new Error(formatModelUnavailable(model, detail));
      }
    }
  }
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

/**
 * 待落盘会话清单（供列表合并；含展示名，改名在未落盘阶段也不丢）。
 *
 * 任务 0005：**同时给出内存里的消息角色计数**。为什么需要：
 * 会话文件还没落盘时，若只给名字，行对象里的 `counts` 只能是 0 ——
 * 而标题明明已经有了（首条消息已发出），用户看到的就是"有标题、0 条消息"的自相矛盾
 * （2026-11-03 在开发实例实测到）。这里用与落盘后**同一个** `messagesOf()` 取数，不另写一套。
 */
export function pendingSessions(
  agentId: string,
): Array<{ sessionId: string; projectId: string; at: string; taskId?: string; name?: string; counts?: { user: number; assistant: number; toolResult: number; system: number } }> {
  const state = stateOf(agentId);
  return [...state.pending.entries()].map(([sessionId, meta]) => {
    const session = state.sessions.get(sessionId);
    const name = session?.session.sessionManager.getSessionName();
    const counts = session === undefined ? undefined : countsOfMessages(session);
    return {
      sessionId, ...meta,
      ...(name !== undefined && name !== "" ? { name } : {}),
      ...(counts !== undefined ? { counts } : {}),
    };
  });
}

/** 内存会话的消息角色计数（与落盘扫描同一口径：只数 message 条目，按 role 归类）。 */
function countsOfMessages(state: SessionState): { user: number; assistant: number; toolResult: number; system: number } {
  const counts = { user: 0, assistant: 0, toolResult: 0, system: 0 };
  for (const message of messagesOf(state)) {
    if (message.role === "user") counts.user += 1;
    else if (message.role === "assistant") counts.assistant += 1;
    else if (message.role === "toolResult") counts.toolResult += 1;
    else if (message.role === "system") counts.system += 1;
  }
  return counts;
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
export function activeTaskOf(manager: ReturnType<typeof SessionManager.open>): string | undefined {
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
/**
 * 标记已读 —— **两处调用必须走这一个函数**（`recordCompletion` 与 `server.ts` 的 focus 端点）。
 *
 * 为什么不各自调 `sessionViewsOf().markViewed()`：标已读有两个后果，必须一起发生
 *   ① 服务端未读事实变化（`session-views.json`）；
 *   ② 前端行的 `activity.unread` 消失、聚合层的"待查看"数减一。
 * 只做①不做②，行上的绿点会一直留到下次全量重取列表 —— 这是 Task 0005 实测到的缺口。
 */
export function markSessionViewed(agentId: string, sessionId: string, at: string, projectId: string | undefined): void {
  sessionViewsOf().markViewed(agentId, sessionId, at);
  rowPatches().pushNow(agentId, sessionId, projectId, { unread: null });
}

function recordCompletion(agentId: string, sessionId: string, aborted: boolean, projectId: string | undefined): void {
  const at = new Date().toISOString();
  if (!aborted) sessionViewsOf().markCompleted(agentId, sessionId, at, projectId);
  if (isFocusedVisible(agentId, sessionId)) markSessionViewed(agentId, sessionId, at, projectId);
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

/** 网关"请求体过大"的错误族（不绑单个 provider 的文案；P5 会归因到 FailureKind）。 */
const PAYLOAD_TOO_LARGE = /payload.?too.?large|request body.{0,20}(too large|exceed)|413/i;

/**
 * 观测记账（Task 0012 · P3）：用本轮估算的 body 字节更新 state/payload-limits.json。
 * 失败不阻断对话——观测只是"下一次更准"，不是功能本身。
 */
async function recordPayloadObservation(target: SessionState, outcome: "ok" | "too_large"): Promise<void> {
  const providerId = target.session.model?.provider ?? "";
  if (providerId === "") return;
  const bodyBytes = payloadEstimateOf(target).estimated;
  if (bodyBytes <= 0) return;
  await recordObservedToFile(resolveHome(), { providerId, bodyBytes, outcome }).catch(() => undefined);
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
  const startedAtIso = new Date().toISOString();
  markRunning(agentId, { sessionId, projectId: projectIdForLog, startedAt: startedAtIso });
  // 一开跑就推一条（`phase: "waiting"` = 等模型），让列表立刻显示"在跑 + 计时开始"，
  // 而不是等第一个 thinking/text 事件才亮（那之前有网络往返的空白期）。
  rowPatches().pushRunning(agentId, sessionId, projectIdForLog, { since: startedAtIso, phase: "waiting" });
  const unsubscribe = target.session.subscribe((event: unknown) => {
    const mapped = toStreamEvent(event);
    if (mapped !== undefined) {
      publish(agentId, { sessionId, ...mapped });
      // 列表的动态信息（任务 0005）：只推"状态切换"，正文 delta/thinking 增量不推。
      // 节流与去重都在 rowPatches() 里（每会话 ≥1000ms 至多一条 + 只在 phase/tool 变化时发）。
      const phase = phaseOfStreamEvent(mapped);
      if (phase !== undefined) {
        rowPatches().pushRunning(agentId, sessionId, projectIdForLog, {
          since: startedAtIso,
          ...(phase.phase !== undefined ? { phase: phase.phase } : {}),
          ...(phase.tool !== undefined ? { tool: phase.tool } : {}),
        });
      }
    }
  });
  const requestKey = `${agentId}\u0000${sessionId}`;
  abortRequested.delete(requestKey);
  try {
    // 发送前守卫（Task 0017）：会话可能是在凭据还正常时打开的，之后 key 被削/被改；
    // 也可能因为历史原因带着 Pi 偷换的模型。发请求前再验一次，不把用户的钱花在
    // “他不知道发生了替换”的请求上。checkAuth 实测 0.008ms/次，不需要缓存。
    const running = target.session.model;
    if (running !== undefined) {
      // 环境变量是唯一事实源，但本进程可能在变量写入 rc 之前就启动了（实测真实现场）：
      // 每次发送前都去 shell 配置文件里补一次缺失的变量（0.01-0.04ms，不执行任何命令），
      // 这样用户改好 key 后不用重启后端。已存在的值不会被覆盖。
      await reloadEnvFromShellConfigs().catch(() => undefined);
      if ((await target.modelRuntime.checkAuth(running.provider)) === undefined) {
        const detail = describeModelUnavailable(running, await readProvidersConfig());
        throw new Error(formatModelUnavailable(running, detail));
      }
    }
    // P7b / D7：用户图先落盘，**发出去的消息只带引用行**（历史里没有 base64 → 压缩路径也不会带大图）；
    // 当轮可见性由 context 钩子的重注入保证（引用行在最后一条 user 消息里，走 A 段全量）。
    // 落盘失败 → 该张回退成 inline，功能降级但不丢图。
    const attachments = images !== undefined && images.length > 0
      ? await appendAttachmentRefs(resolveHome(), text, images)
      : undefined;
    const promptText = attachments?.text ?? text;
    const fallbackImages = attachments !== undefined && attachments.failed.length > 0 ? attachments.failed : undefined;
    await target.session.prompt(promptText, fallbackImages !== undefined && fallbackImages.length > 0 ? { images: fallbackImages } : undefined);
    // 观测记账（Task 0012 · P3）：成功发出去的 body 字节 = 上限的下界。只在"更大"时写盘。
    await recordPayloadObservation(target, "ok");
    const aborted = abortRequested.delete(requestKey);
    // 回合账本 done（turn 终态先到位，再发收尾事件）；未读事实先于事件落定，断线重连的快照一定包含它
    finishTurn(agentId, sessionId, turnId, "done");
    recordCompletion(agentId, sessionId, aborted, projectIdForLog);
    // 与其他 Agent 的对话：对方跑完了 → 回流给发起方（T7）。永不抛、不影响下面的收尾。
    await notifyPeerTurnFinished(agentId, sessionId, turnId, "done");
    void log.info("agent-host", "runTurn", "回合完成", { sessionId, turnId, agentId, projectId: projectIdForLog, details: { aborted } });
    publish(agentId, { sessionId, projectId: projectIdForLog, type: "turn", turnId, state: "done" });
    // 列表行补丁（任务 0005）：终态立即发、不节流 —— 用户最需要立刻看到"完了"
    rowPatches().pushTerminal(agentId, sessionId, projectIdForLog, {
      ...(aborted ? {} : { unread: { since: new Date().toISOString() } }),
      lastActivityAt: new Date().toISOString(),
    });
    publish(agentId, { sessionId, projectId: projectIdForLog, type: "done", turnId, aborted });
  } catch (error) {
    abortRequested.delete(requestKey);
    const message = error instanceof Error ? error.message : String(error);
    // 被网关以"请求体过大"拒过 → 记上界，下一次解析会自动降到 0.8× 该值
    if (PAYLOAD_TOO_LARGE.test(message)) await recordPayloadObservation(target, "too_large");
    finishTurn(agentId, sessionId, turnId, "error");
    recordCompletion(agentId, sessionId, false, projectIdForLog);
    // 失败也要回流（发起方要知道它失败了、为什么）——同一套去重与投递确认。
    await notifyPeerTurnFinished(agentId, sessionId, turnId, "error");
    void log.error("agent-host", "runTurn", "回合失败", { sessionId, turnId, agentId, projectId: projectIdForLog, details: { message } });
    publish(agentId, { sessionId, projectId: projectIdForLog, type: "turn", turnId, state: "error" });
    const kind = classifyFailure({ errorMessage: message, hasContent: false }) ?? "unknown";
    // 列表行补丁：失败态 + 原文（用户裁决不脱敏）+ 未读
    rowPatches().pushTerminal(agentId, sessionId, projectIdForLog, {
      unread: { since: new Date().toISOString() },
      failure: { kind, detail: message, at: new Date().toISOString() },
      lastActivityAt: new Date().toISOString(),
    });
    publish(agentId, { sessionId, projectId: projectIdForLog, type: "error", message, kind, turnId });
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

/**
 * 请求体字节估算（Task 0012 · P1）：**图片 base64 编码后字节 + 文本 UTF-8 字节**。
 * 图片必须按**编码后**长度算（base64 比二进制大 1/3，网关限的是编码后的请求体）——
 * 按解码字节算会少算 25%，正因如此 0010 那套估算一直看着"还有余量"。
 * 只估算"随请求重发的全部历史"，不含系统提示与工具 schema（那部分留在 reserve 里）。
 * 这是观测值，不是策略：淘汰在 P3 才接。
 */
export function payloadEstimateOf(state: SessionState, projection?: ReturnType<SessionState["session"]["sessionManager"]["buildSessionProjection"]>): { images: number; text: number; estimated: number } {
  let images = 0;
  let text = 0;
  for (const message of (projection ?? state.session.sessionManager.buildSessionProjection()).messages) {
    // AgentMessage 是联合类型（含没有 content 的 bash 执行消息），按字段探测而不是强转
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") { text += Buffer.byteLength(content, "utf8"); continue; }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const block = part as { type?: string; data?: unknown; text?: unknown };
      if (block.type === "image" && typeof block.data === "string") images += block.data.length;
      else if (block.type === "text" && typeof block.text === "string") {
        let textBytes = Buffer.byteLength(block.text, "utf8");
        // P7b：引用化后，"会重注入的附件"按 base64 后字节计入（≈ 重注入后真正上线的尺寸）
        for (const ref of parseImageRefs(block.text)) {
          const fileBytes = attachmentFileSizeCached(ref);
          if (fileBytes > 0) images += Math.ceil(fileBytes / 3) * 4;
        }
        text += textBytes;
      }
    }
  }
  return { images, text, estimated: images + text };
}

/**
 * 会话的请求体画像（Task 0012 · P1）：估算 + 上限从哪来。
 * `limit === null` 表示没有任何来源 ⇒ P3 不会启用淘汰（宁可回落 token 压缩，也不猜数字）。
 */
export async function payloadMetaOf(state: SessionState): Promise<{
  images: number; text: number; estimated: number;
  /** 淘汰之后真正会发出去的估算（`estimated` 是存储量；两者不同，界面要显示这个） */
  effective: number;
  limit: number | null; source: Budget["source"] | null; triggerBytes: number | null; targetBytes: number | null;
}> {
  const model = state.session.model;
  const limits = await readLimits(resolveHome());
  const budget = resolveBudget({
    providerId: model?.provider ?? "",
    modelLimit: model?.inputLimits?.maxRequestBytes,
    config: limits.config,
    state: limits.state,
  });
  // 同一次投影复用（估算 + 淘汰各扫一遍即可，不重复构建）
  const projection = state.session.sessionManager.buildSessionProjection();
  const estimate = payloadEstimateOf(state, projection);
  const effectiveImages = budget === undefined
    ? estimate.images
    : planElision(imageSizesOf(projection.messages), budget).kept;
  return {
    ...estimate,
    effective: effectiveImages + estimate.text,
    limit: budget?.limit ?? null,
    source: budget?.source ?? null,
    triggerBytes: budget?.triggerBytes ?? null,
    targetBytes: budget?.targetBytes ?? null,
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
 * 说清楚"这个模型为什么不能用"（Task 0017）。
 *
 * 为什么要这么麻烦：Pi 的原始错误是
 *   `Failed to resolve API key for provider "amr-link" from environment variable: AMR_LINK_API_KEY`
 * 混在多层错误里。用户看到的必须是“缺 AMR_LINK_API_KEY”，而不是“模型调用失败”。
 *
 * 变量名从**哪里**来：`models.json` 的 `apiKey` 字段（唯一事实源）。
 * 不用 `runtime.getRegisteredProviderConfig()`（那是给扩展注册用的，实测回落到 undefined），
 * 也不用 `runtime.config.getProvider()`（不在公开 `.d.ts` 上）。
 *
 * 只报“缺什么 + 怎么补”，不报值（凭据零泄露，`backend/code.md` §2.10）。
 */
function describeModelUnavailable(
  model: { provider: string; id: string },
  modelsConfig: Record<string, unknown>,
): string {
  const provider = modelsConfig[model.provider] as { apiKey?: unknown; name?: unknown } | undefined;
  const rawKey = typeof provider?.apiKey === "string" ? provider.apiKey : undefined;
  const label = `${model.provider}/${model.id}`;
  if (isCommandConfigValue(rawKey)) {
    return `${label} 的 API key 由命令提供（models.json 里 ! 开头的配置），命令执行失败或没返回内容`;
  }
  const refs = envRefsOf(rawKey);
  if (refs.length === 0) {
    // 明文 key 或 provider 自带的 env 约定：我们没有可指名的变量，只能报结果
    return rawKey === undefined ? `${label} 在 models.json 里没有配 apiKey` : `${label} 有 apiKey 但无法解析`;
  }
  const bad = refs
    .map((name) => ({ name, state: envRefState(process.env, name) }))
    .filter((item) => item.state.kind !== "ok");
  if (bad.length === 0) {
    // 变量都在且格式正常，但仍被拒：不是缺变量（可能被删了、或 Pi 判定更严）
    return `${label} 的凭据无法解析（环境变量 ${refs.join("、")} 看起来是设置了的）`;
  }
  return bad.map(({ name, state }) => {
    if (state.kind === "missing") return `缺少环境变量 ${name}`;
    if (state.kind === "empty") return `环境变量 ${name} 已设置但为空`;
    if (state.kind !== "malformed") return `环境变量 ${name} 不可用`;
    const why = state.reason === "quoted" ? "带了引号" : state.reason === "newline" ? "带了换行符" : "首尾有空格";
    return `环境变量 ${name} ${why}`;
  }).join("；");
}

/** 读 models.json 的 providers（唯一事实源；读不到就当空，不猜）。 */
async function readProvidersConfig(): Promise<Record<string, unknown>> {
  const path = process.env.LIFEOS_MODELS_PATH?.trim() || join(resolveHome(), "config", "models.json");
  const text = await readFile(path, "utf8").catch(() => "");
  if (text === "") return {};
  try {
    const data = JSON.parse(text) as { providers?: unknown };
    return typeof data.providers === "object" && data.providers !== null
      ? (data.providers as Record<string, unknown>)
      : {};
  } catch { return {}; }
}

/** 拼成给用户看的一句话（带“怎么补”的下一步）。 */
function formatModelUnavailable(
  model: { provider: string; id: string },
  detail: string,
  error?: unknown,
): string {
  const raw = error instanceof Error ? error.message.trim() : "";
  const head = `${model.provider}/${model.id} 不可用：${detail}`;
  // 补得上就告诉他怎么补；补不上（明文 key / 命令式）就把 Pi 原话附在后面
  const hint = detail.startsWith("缺少环境变量") || detail.startsWith("环境变量")
    ? "。请在 ~/.zshenv 里配置好这个变量后重启后端"
    : "";
  return raw === "" ? `${head}${hint}` : `${head}${hint}\n（原始错误：${raw.slice(0, 300)}）`;
}

/**
 * 会话启动失败（凭据不可用）：不让会话存在，否则后端会拿 Pi 偷换的模型继续跑。
 *
 * 这里抛出的错误最终落到 HTTP 400 或回合 error，两者都会把 message 显示给用户。
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
  const overridden = hasOverrideIn(manager);
  const decision = decideRestoreModel({
    stored: sessionModelOf(manager),
    agentDefault,
    overridden,
  });

  // "期望模型"分两种情况（Task 0017）：
  //   1. 用户用 /model 显式覆盖过 → 期望 = 覆盖的那个（`stored`）；
  //   2. 没覆盖过 → 期望 = Agent 默认。
  //
  // ⚠ 本次静默换模型的根因：以前只在 decision === "follow" 时调 setModel，
  // 而 decideRestoreModel 比较的是「文件里的 model_change」与「Agent 默认」——
  // 两者都是 amr-link 时判 "keep"（值相同，没必要跟随），于是**没有任何一行代码
  // 去看 session.model 到底是什么**。Pi 已经因为 amr-link 缺凭据把它偷偷换成了
  // deepseek-v4-pro（sdk.ts:224-249 的 findInitialModel），而我们一无所知。
  //
  // 所以：只要决定了"期望是谁"，就必须让**实际**等于它；不等就切回去，切不回去就报错。
  const expected = overridden ? sessionModelOf(manager) : agentDefault;
  if (expected === undefined) {
    // 既没覆盖也没默认：无可期望，交给 Pi 的回落（此时没有"用户的选择"可违背）
  } else {
    const wanted = modelRuntime.getModel(expected.provider, expected.id);
    if (wanted !== undefined) {
      const actual = session.model;
      const same = actual !== undefined && actual.provider === wanted.provider && actual.id === wanted.id;
      // decision 只决定"要不要主动跟随默认"，不决定"要不要保证实际=期望"：
      // 显式覆盖的会话已不等于默认，decision 是 keep，但实际仍可能被 Pi 换掉了。
      if (!same || decision === "follow") {
        try {
          await session.setModel(wanted);
        } catch (error) {
          // 切不回去 ⇒ 用户选的模型真的不可用。如实报，绝不留一个
          // "界面写 A、实际跑 B"的会话继续花钱。
          const detail = describeModelUnavailable(wanted, await readProvidersConfig());
          throw new Error(formatModelUnavailable(wanted, detail, error));
        }
      }
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

/**
 * 只取消"正在进行中的自动重试"，不打断整轮（Task 0007 · A2）。
 *
 * 为什么单独出来：Pi CLI 在重试退避期间按 Esc 调的是 `session.abortRetry()`
 * （pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts:3749-3752），
 * 不是 `abort()`。两者语义不同：取消重试 = "别试了，我要自己处理"；
 * abort = "整轮别跑了"。我们此前只有后者，用户在 7 秒倒计时里按 Esc 会把整轮打断。
 *
 * 返回 false 表示当前没有在重试（调用方据此决定是否退回到 abort 语义）。
 */
export function abortRetryOf(agentId: string, sessionId: string): boolean {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === undefined) return false;
  if (!state.session.isRetrying) return false;
  state.session.abortRetry();
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
  // 切 Task → 推一行补丁（同理不 broadcast 让所有人重取整个列表）
  const task = tasks.find((item) => item.id === taskId);
  if (task !== undefined) {
    rowPatches().pushNow(agentId, sessionId, projectId, {
      task: { id: task.id, title: task.title, status: task.status, type: task.type },
    });
  }
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


/**
 * 按出现顺序取会话里"会被发出去的图片字节"：inline 取 base64 长度；引用取附件的 base64 等价。
 * 与 `planElision` 配套 → meta.effective 与真实发送共用同一套规则（P7b 实测：不共用会显示 418B / 实发 560KB）。
 */
function imageSizesOf(messages: readonly unknown[]): number[] {
  const sizes: number[] = [];
  for (const message of messages) {
    const content = (message as { content?: unknown } | null | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const part = block as { type?: string; data?: unknown; text?: unknown };
      if (part.type === "image" && typeof part.data === "string") { sizes.push(part.data.length); continue; }
      if (part.type === "text" && typeof part.text === "string") {
        for (const ref of parseImageRefs(part.text)) {
          const fileBytes = attachmentFileSizeCached(ref);
          if (fileBytes > 0) sizes.push(Math.ceil(fileBytes / 3) * 4);
        }
      }
    }
  }
  return sizes;
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
  // 附件可能仍被**其它**会话引用（内容 hash 共享）→ 只清"无人引用 + 7 天前"的孤儿（P8①）。
  // 失败不影响删会话本身：附件多留只是占磁盘，误删才是事故。
  void gcAttachments(resolveHome())
    .then((result) => {
      if (result.removed > 0) {
        void log.info("agent-host", "gcAttachments", "清理孤儿附件", {
          details: { removed: result.removed, removedBytes: result.removedBytes, kept: result.kept, scannedRefs: result.scannedRefs },
        });
      }
    })
    .catch(() => undefined);
  sessionViewsOf().forget(agentId, sessionId);   // 已删会话不得留下未读点
  state.sessions.delete(sessionId);
  state.pending.delete(sessionId);
  return "deleted";
}

/** 重命名会话：写 Pi 的 `session_info` 展示名（列表标题优先用它，否则回退首句）。 */
export async function renameSession(agentId: string, sessionId: string, name: string, cwd: string): Promise<boolean> {
  const loaded = stateOf(agentId).sessions.get(sessionId);
  if (loaded !== undefined) {
    loaded.session.sessionManager.appendSessionInfo(name);
    pushTitlePatch(agentId, sessionId, projectOfSessionDir(loaded.session.sessionManager.getSessionDir()), name);
    return true;
  }
  const found = await findSessionFile(agentId, sessionId);
  if (found === undefined) return false;
  SessionManager.open(found.path, found.dir, cwd).appendSessionInfo(name);
  pushTitlePatch(agentId, sessionId, projectOfSessionDir(found.dir), name);
  return true;
}

/**
 * 标题变了 → 推一行补丁（任务 0005 · 用户要求"不许刷新才更新"）。
 *
 * 为什么不 broadcast `agents_changed`：那会让**所有**客户端重取**所有**项目的整个列表
 * （实测 1+N 次请求、每次全扫 JSONL）。标题是一个字段的变化，就只推那个字段。
 */
function pushTitlePatch(agentId: string, sessionId: string, projectId: string | undefined, raw: string): void {
  rowPatches().pushNow(agentId, sessionId, projectId, {
    title: { raw, display: displayTitleOf(raw) },
  });
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
      const image = part as { type?: string; data?: unknown; text?: unknown };
      if (image.type === "image" && typeof image.data === "string") {
        const padding = image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0;
        total += Math.max(0, Math.floor((image.data.length * 3) / 4) - padding);
        continue;
      }
      // P7b：引用化后用户图在文本里 → 按附件文件**二进制字节**计（与 inline 同口径，16MB 准入不被静默废掉）
      if (image.type === "text" && typeof image.text === "string") {
        for (const ref of parseImageRefs(image.text)) total += attachmentFileSizeCached(ref);
      }
    }
  }
  return total;
}

/** 消息（含结构化块）：text/thinking/toolCall 按 Pi 真实内容块返回，toolResult 挂回对应调用
 * （参考 Pi Web MessageView 的展示数据；兼容字段 text 保留给纯文本消费者）。 */
export function messagesOf(state: SessionState) {
  // Pi 的失败信息（stopReason=error 时的 errorMessage）必须透出：否则界面只看到空回复、不知道为什么
  // durationMs / tokens（2026-11-02）：过程条要数“花了多久 / 多少 token”，两者都在 assistant 消息上，不在块里
  const out: Array<{
    role: string; text: string; blocks: MessageBlock[]; at?: number; error?: string; failure?: FailureKind;
    durationMs?: number; tokens?: number;
    /**
     * Pi 的回合终态原样透出（Task 0007）：前端要按与后端**同一张表**判定"这一轮算不算失败"，
     * 就必须拿到同一个输入。在此之前前端只看得到 text/error，只能用"文本是否为空"猜，
     * 于是出现"提示条说可以点重新发送、按钮不出现"。不做任何判断，只搬运。
     */
    stopReason?: string;
  }> = [];
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
      // D7：引用化后用户消息里只有引用行 —— 显示时按附件目录还原（老会话已有图块则原样，见 imageBlocksOfRefs）
      for (const refBlock of imageBlocksOfRefs(message)) blocks.push(refBlock);
      out.push({ role: "user", text, blocks, ...(at !== undefined ? { at } : {}) });
    } else if (message.role === "assistant") {
      const blocks: MessageBlock[] = [];
      for (const part of message.content) {
        if (part.type === "text") blocks.push({ type: "text", text: part.text });
        else if (part.type === "thinking") blocks.push({ type: "thinking", text: part.thinking });
        else if (part.type === "toolCall") blocks.push({ type: "toolCall", id: part.id, name: part.name, arguments: part.arguments });
      }
      const text = blocks.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
      const raw = message as {
        stopReason?: string; errorMessage?: string;
        durationMs?: unknown;
        usage?: { input?: unknown; output?: unknown };
      };
      const errorText = typeof raw.errorMessage === "string" && raw.errorMessage.trim() !== "" ? raw.errorMessage.trim() : undefined;
      // 失败分类：区分超时 / 连不上 / 鉴权 / 限流 / 服务端错误 / 空回复 / 中断 / 截断
      const kind = classifyFailure({ ...(raw.stopReason !== undefined ? { stopReason: raw.stopReason } : {}), ...(errorText !== undefined ? { errorMessage: errorText } : {}), hasContent: blocks.length > 0 || text.trim() !== "" });
      const durationMs = typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) && raw.durationMs > 0 ? Math.round(raw.durationMs) : undefined;
      const input = typeof raw.usage?.input === "number" ? raw.usage.input : 0;
      const output = typeof raw.usage?.output === "number" ? raw.usage.output : 0;
      const tokens = input + output > 0 ? input + output : undefined;
      out.push({
        role: "assistant", text, blocks,
        ...(at !== undefined ? { at } : {}),
        ...(kind !== undefined ? { failure: kind } : {}),
        ...(errorText !== undefined ? { error: errorText } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(tokens !== undefined ? { tokens } : {}),
        ...(typeof raw.stopReason === "string" && raw.stopReason !== "" ? { stopReason: raw.stopReason } : {}),
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
        const direct = toolResultImages(message);
        const images = direct.length > 0 ? direct : imageBlocksOfRefs(message);   // D7：引用行 → 附件还原
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
