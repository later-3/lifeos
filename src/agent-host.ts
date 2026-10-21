// 进程内 Agent 宿主：会话 id 用 Pi 生成的 id；一轮的输出进“按 Agent 的事件流”（带序号，可续传）。
// 默认会话不是运行时生成的：出厂即随模板预置在 workspace/sessions/（协议 §15.2），这里只负责加载。
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { buildPromptParts, createLifeOsPromptExtension, resolveModelChoice } from "./assembly.ts";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { resolveHome } from "./home.ts";
import { LIFEOS_TOOL_NAMES, createAgentTools } from "./agent-tools.ts";
import { toStreamEvent, type StreamEvent } from "./stream-events.ts";
import { classifyFailure, type FailureKind } from "./failure.ts";
import { decideRestoreModel } from "./model-follow.ts";
import type { ModelRef } from "./model-follow-types.ts";
// 事件总线独立成模块（events.ts）：写操作（agents/projects/任务）在**共享实现**里广播，
// 不再依赖调用方传 notify，也不再产生 agents → agent-host 的循环 import（2026-10-20）。
import { broadcast, eventsSeq, publish, subscribeAgent, type AgentEvent } from "./events.ts";
import { clearRunning, isRunning, markRunning, runningOf, type RunSnapshot } from "./session-runtime.ts";
export { broadcast, subscribeAgent } from "./events.ts";
export type { AgentEvent } from "./events.ts";
export type { RunSnapshot } from "./session-runtime.ts";

type HostedSession = Awaited<ReturnType<typeof createAgentSession>>["session"];
type ModelRuntimeInstance = Awaited<ReturnType<typeof ModelRuntime.create>>;
type SessionState = { session: HostedSession; modelRuntime: ModelRuntimeInstance };
type AgentState = {
  sessions: Map<string, SessionState>;
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
  const created: AgentState = { sessions: new Map(), pending: new Map() };
  agents.set(key, created);
  return created;
}

/** 快照：当前序号 + 正在跑的会话（订阅时先给，保证不丢状态）。 */
export function snapshotOf(agentId: string): { seq: number; running: RunSnapshot[] } {
  return { seq: eventsSeq(agentId), running: runningOf(agentId) };
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
}): Promise<DefaultResourceLoader> {
  const loader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.configDir,
    settingsManager: input.settingsManager,
    noContextFiles: true,
    extensionFactories: [createLifeOsPromptExtension(input.parts)],
  });
  await loader.reload();
  return loader;
}

/**
 * 统一创建 Agent 会话（装配层，事实见 docs/architecture/agent.md §9.4）：
 * - agentDir = ~/.lifeos/config（Pi 由此读 models.json/auth.json/settings.json——界面里配的模型才真正生效）；
 * - customPrompt = identity（替换 Pi 默认“编码 agent”前言）+ harness 独立区；Pi 的 tools/rules 原样回填；
 * - tools = 全部 8 个内置工具（显式，不随隐式默认漂移）；Pi 的上下文文件读取已关闭（见 createHostedResourceLoader）；
 * - 新建会话：按优先级 A 显式选模型；恢复会话：不传 model，尊重会话内 model_change。
 */
async function createHostedSession(
  agentId: string,
  sessionManager: ReturnType<typeof SessionManager.create>,
  mode: "new" | "restored",
): Promise<{ session: SessionState["session"]; modelRuntime: ModelRuntimeInstance; modelLabel: string | undefined }> {
  const cwd = sessionManager.getCwd();
  const configDir = join(resolveHome(), "config");
  const modelRuntime = await ModelRuntime.create({
    authPath: join(configDir, "auth.json"),
    modelsPath: join(configDir, "models.json"),
  });
  const settingsManager = SettingsManager.create(cwd, configDir);

  const projectId = projectOfSessionDir(sessionManager.getSessionDir());
  const parts = await buildPromptParts(agentId, projectId);
  const resourceLoader = await createHostedResourceLoader({ cwd, configDir, settingsManager, parts });

  const resolution = await resolveModelChoice(agentId);
  let model: ModelOption | undefined;
  let thinkingLevel: ThinkingOption | undefined;
  let modelLabel: string | undefined;
  if (mode === "new" && resolution !== undefined) {
    const found = modelRuntime.getModel(resolution.choice.defaultProvider, resolution.choice.defaultModel);
    if (found !== undefined) {
      model = found;
      modelLabel = `${resolution.choice.defaultProvider}/${resolution.choice.defaultModel}（来源 ${resolution.source === "agent" ? "Agent 个人配置" : "系统 settings"}）`;
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
    customTools: createAgentTools({ agentId, projectId }),
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

/** 会话物理落在所属 project 的 sessions/ 下（协议 §15.1 结构即事实；默认 workspace）。 */
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
  const { session, modelRuntime, modelLabel } = await createHostedSession(agentId, manager, "new");
  const sessionId = manager.getSessionId();
  if (modelLabel !== undefined) console.log(`[assembly] 新建会话 ${sessionId} · 模型 ${modelLabel}`);
  stateOf(agentId).sessions.set(sessionId, { session, modelRuntime });
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

/** 内存态会话的 cwd（刚创建还没落盘时是唯一来源）。 */
export function sessionCwd(agentId: string, sessionId: string): string | undefined {
  return stateOf(agentId).sessions.get(sessionId)?.session.sessionManager.getCwd();
}

/** 会话所属项目：由会话文件所在目录决定（`agents/<id>/projects/<pid>/sessions/*.jsonl`）—— 文件位置即事实。 */
export async function projectIdOfSession(agentId: string, sessionId: string): Promise<string | undefined> {
  const found = await findSessionFile(agentId, sessionId);
  return found === undefined ? undefined : projectOfSessionDir(found.dir);
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
  const { session, modelRuntime } = await createHostedSession(agentId, SessionManager.open(found.path, found.dir, cwd), "restored");
  const restored: SessionState = { session, modelRuntime };
  state.sessions.set(sessionId, restored);
  state.pending.delete(sessionId);
  return restored;
}

/** 跑一轮：把 Pi 的文本增量发布成事件。 */
export async function runTurn(agentId: string, sessionId: string, text: string): Promise<void> {
  const state = stateOf(agentId);
  const target = state.sessions.get(sessionId);
  if (target === undefined) return;
  markRunning(agentId, { sessionId, startedAt: new Date().toISOString() });
  const unsubscribe = target.session.subscribe((event: unknown) => {
    const mapped = toStreamEvent(event);
    if (mapped !== undefined) publish(agentId, { sessionId, ...mapped });
  });
  try {
    await target.session.prompt(text);
    publish(agentId, { sessionId, type: "done" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    publish(agentId, { sessionId, type: "error", message, kind: classifyFailure({ errorMessage: message, hasContent: false }) ?? "unknown" });
  } finally {
    unsubscribe();
    clearRunning(agentId, sessionId);
    state.pending.delete(sessionId);   // 首轮消息后 Pi 已落盘，文件列表接管
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
  await state.session.abort();
  return true;
}

/** 生成中投入输入：steer 插进当前思考，followUp 本轮结束后处理（都是 Pi 原生队列）。 */
export async function queueSessionInput(agentId: string, sessionId: string, text: string, behavior: "steer" | "followUp"): Promise<boolean> {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === undefined) return false;
  if (behavior === "steer") await state.session.steer(text);
  else await state.session.followUp(text);
  return true;
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
  return { ok: true, level: state.session.thinkingLevel };
}

/** 删除会话：移除文件与内存态；正在运行的拒绝。 */
export async function deleteSession(agentId: string, sessionId: string): Promise<"deleted" | "not_found" | "running"> {
  const state = stateOf(agentId);
  if (isRunning(agentId, sessionId)) return "running";
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
  // Pi 的失败信息（stopReason=error 时的 errorMessage）必须透出：否则界面只看到空回复、不知道为什么
  const out: Array<{ role: string; text: string; blocks: MessageBlock[]; error?: string; failure?: FailureKind }> = [];
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
      const raw = message as { stopReason?: string; errorMessage?: string };
      const errorText = typeof raw.errorMessage === "string" && raw.errorMessage.trim() !== "" ? raw.errorMessage.trim() : undefined;
      // 失败分类：区分超时 / 连不上 / 鉴权 / 限流 / 服务端错误 / 空回复 / 中断 / 截断
      const kind = classifyFailure({ ...(raw.stopReason !== undefined ? { stopReason: raw.stopReason } : {}), ...(errorText !== undefined ? { errorMessage: errorText } : {}), hasContent: blocks.length > 0 || text.trim() !== "" });
      out.push({
        role: "assistant", text, blocks,
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
