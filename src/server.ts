// HTTP 接口：只读 Agent + 会话列表/读取 + 一条按 Agent 的事件流（带快照与序号，可续传）。
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { writeTextAtomic } from "./atomic-file.ts";
import { createBoundedSink } from "./bounded-sink.ts";
import { setFocusOf, subscribeBus } from "./events.ts";
import { drainingForMs, expireDrainIfStale, isDraining, runningOf, setDraining } from "./session-runtime.ts";
import { sessionViewsOf } from "./session-views.ts";
import { basename, join } from "node:path";
import {
  abortSession, applyAgentDefaultModel, broadcast, compactSession, createSession, deleteSession, getSession, messagesOf, sessionImageBytesOf, pendingSessions,
  applyAgentDefaultThinking, nameSessionFromFirstMessage, pruneSessionViewsOnce, projectIdOfSession, sessionExists, sessionIntegrity, turnLastOf, queueSessionInput, readSessionEntries, renameSession, runTurn, sessionCwd, sessionMeta,
  setSessionModel, setSessionThinking, globalSnapshot, THINKING_LEVELS,
} from "./agent-host.ts";
import { browse, listTree, readContent, readRoots, registerRoot } from "./fs.ts";
import { bindProject, listAgentProjects, readProjectManifest, readProjectManifests, unbindProject } from "./projects.ts";
import { archiveAgent, createAgent, readAgent, writeAgent, type AgentDefinition } from "./agents.ts";
import { DEFAULT_PI_THINKING_LEVEL, resolveModelChoice } from "./assembly.ts";
import { listTasks } from "./tasks.ts";
import { resolveHome } from "./home.ts";
import { appendFrontendRows, log } from "./logging.ts";
import { randomUUID } from "node:crypto";
import { bodyLimit } from "hono/body-limit";
import { declaredImageSupport, MAX_SESSION_IMAGE_BYTES, validateImages } from "./image-input.ts";

/** 每连接发送积压上限（字节）：超过即视为过载，关闭连接让客户端重连（对齐 pi-web 的高水位 512KB）。 */
const STREAM_HIGH_WATER_BYTES = 512 * 1024;
/**
 * 心跳间隔（具名事件 `ping`，客户端可见）：客户端据此判断连接是否已死（经代理的断开可能不触发 error）。
 * 注释帧（`: ping`）浏览器的 EventSource 看不见，所以必须是具名事件。
 */
const STREAM_PING_MS = 10_000;

// 项目相关字段只剩 hiddenProjectIds（"从列表移除"的 UI 状态，可逆）。
// boundProjectIds 是旧设计的死字段（写而不读），已删；旧文件里的同名键在写回时被剥掉。
const agentsRoot = () => join(resolveHome(), "agents");

type ResolvedProject = { id: string; name: string; path?: string };

/**
 * 会话的 cwd：**由它所属项目决定**，与后端进程的启动目录无关。
 * 修过的 bug：曾经用 `process.cwd()`（后端从哪儿启动就是哪儿）当 cwd →
 * 恢复旧会话时工具作用域跑偏（还会顺带把用户仓库的 AGENTS.md 注入 project_context）。
 */
export async function cwdOfSession(agent: AgentDefinition, sessionId: string): Promise<string> {
  const pid = await projectIdOfSession(agent.id, sessionId);
  if (pid !== undefined) {
    const project = await resolveProject(agent, pid);
    return project === undefined || project.id === "workspace" ? resolveHome() : project.path ?? resolveHome();
  }
  return sessionCwd(agent.id, sessionId) ?? resolveHome();     // 刚建、还没落盘：用内存态；都没有 → 家目录
}

/**
 * 项目目录：`<home>/agents/<agent>/projects/<pid>/`（协议 §12.1「结构即事实」）。
 * 每个 Agent 同构：目录在就是项目，显示名 = 目录名（用户 2026-10-18 定：workspace 就显示 workspace，
 * 不用「工作区」这类展示名）；外部项目显示其真实目录名（basename of path）。
 */
const agentProjectsRoot = (agentId: string) => join(agentsRoot(), agentId, "projects");

/**
 * 解析项目（名称一律取真实目录名）：
 * - workspace：内置默认项目（cwd = 家目录）；
 * - 外部项目：该 Agent 私有层有 manifest → cwd = manifest.path；
 * - 内部项目：projects/<pid> 目录存在即可用（cwd = 该目录）——「结构即事实」，不要求先注册。
 */
async function resolveProject(agent: AgentDefinition, pid: string): Promise<ResolvedProject | undefined> {
  if (pid === "workspace") return { id: "workspace", name: "workspace" };
  const manifest = await readProjectManifest(agent.id, pid);
  if (manifest !== undefined) return { id: manifest.id, name: basename(manifest.path) || manifest.name, path: manifest.path };
  // 旧 URL（?project=<uuid>）兼容：目录名已迁移为可读名，按 legacyId/id 反查
  for (const entry of (await readProjectManifests(agent.id)).values()) {
    if (entry.id === pid || entry.legacyId === pid) return { id: entry.id, name: basename(entry.path) || entry.name, path: entry.path };
  }
  const info = await stat(join(agentProjectsRoot(agent.id), pid)).catch(() => undefined);
  if (info?.isDirectory() === true) return { id: pid, name: pid, path: join(agentProjectsRoot(agent.id), pid) };
  return undefined;
}

// —— Agent 配置工具（2026-10-18）——
const SENSITIVE_KEY = /^(api[-_]?key|authorization|access[-_]?token|secret|password)$/i;

/** 返回给前端前剔除任何密钥类字段（models.json 含用户 apiKey，绝不能带出）。 */
function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) if (!SENSITIVE_KEY.test(key)) out[key] = stripSecrets(val);
    return out as unknown as T;
  }
  return value;
}

const identityPath = (id: string) => join(agentsRoot(), id, "identity.md");

/** models.json 的 providers（唯一解析点；清单接口与"默认模型必须来自清单"校验共用）。 */
async function readModelsConfig(): Promise<Record<string, unknown>> {
  return readFile(join(resolveHome(), "config", "models.json"), "utf8")
    .then((text) => (JSON.parse(text) as { providers?: Record<string, unknown> }).providers ?? {}, () => ({}));
}

/**
 * 模型是否声明图片输入：读 models.json 里该 provider/model 的 `input` 数组。
 * 返回 undefined 表示无法判断（模型不在清单里）——此时不拦，交给 provider 自己报错，
 * 避免"清单没同步"导致用户明明能发图却被我们挡住。
 */
async function declaredModelImageSupport(choice: { defaultProvider: string; defaultModel: string } | undefined): Promise<boolean | undefined> {
  if (choice === undefined) return undefined;
  const providers = await readModelsConfig();
  const provider = providers[choice.defaultProvider] as { models?: unknown } | undefined;
  if (provider === undefined || !Array.isArray(provider.models)) return undefined;
  const model = provider.models.find((item) => (item as { id?: string }).id === choice.defaultModel) as { input?: unknown } | undefined;
  if (model === undefined) return undefined;
  return declaredImageSupport(model.input);
}

/** provider → model id 列表（保存 Agent 默认模型时的校验用）。 */
async function readModelsProviders(): Promise<Record<string, string[]>> {
  const providers = await readModelsConfig();
  const out: Record<string, string[]> = {};
  for (const [id, value] of Object.entries(providers)) {
    const models = (value as { models?: Array<{ id?: unknown }> } | undefined)?.models ?? [];
    out[id] = models.flatMap((model) => (typeof model.id === "string" ? [model.id] : []));
  }
  return out;
}
const agentConfigPath = (id: string) => join(agentsRoot(), id, "projects", "workspace", "config.json");

/** 头像魔数嗅探：png / jpeg / webp。 */
function sniffImage(buffer: Buffer): { ext: string; mime: string } | undefined {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  return undefined;
}

function problem(code: string, message: string, status: 400 | 404 | 409 | 413 | 422 | 503) {
  return { body: { error: { code, message } }, status } as const;
}

/** 某 project 的会话目录：结构即事实（`agents/<id>/projects/<pid>/sessions/`，协议 §12.1）。 */
function projectSessionsDir(agentId: string, projectId: string): string {
  return join(agentsRoot(), agentId, "projects", projectId, "sessions");
}

/** 会话列表：标题优先 `session_info` 展示名（重命名写的就是它），否则取首句；
 * `defaultSessionId`（agent.json）命中的那条标为默认会话。 */
async function listSessions(agentId: string, projectId: string, defaultSessionId?: string) {
  const dir = projectSessionsDir(agentId, projectId);
  const names = await readdir(dir).catch(() => [] as string[]);
  const items = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    const content = await readFile(path, "utf8");
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    let title = "";
    let displayName = "";
    let sessionId = "";
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { type?: string; id?: string; name?: string; message?: { role?: string; content?: unknown } };
        if (entry.type === "session" && typeof entry.id === "string") sessionId = entry.id;
        if (entry.type === "session_info" && typeof entry.name === "string" && entry.name.trim() !== "") displayName = entry.name;
        if (title === "" && entry.type === "message" && entry.message?.role === "user") title = textOf(entry.message);
      } catch { /* 跳过坏行 */ }
    }
    if (sessionId === "") continue;
    items.push({ sessionId, title: displayName !== "" ? displayName : title, updatedAt: (await stat(path)).mtime.toISOString(), messages: lines.length, isDefault: sessionId === defaultSessionId });
  }
  // 合并未落盘的内存会话（Pi 延迟写文件：无消息的新会话只存在于内存——不并入则“新建会话”在列表里隐身）。
  const fileIds = new Set(items.map((item) => item.sessionId));
  for (const pending of pendingSessions(agentId)) {
    if (pending.projectId !== projectId || fileIds.has(pending.sessionId)) continue;
    items.push({
      sessionId: pending.sessionId,
      title: pending.name ?? "",
      updatedAt: pending.at,
      messages: 0,
      isDefault: pending.sessionId === defaultSessionId,
    });
  }
  return items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function textOf(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => (part as { type?: string; text?: string }).type === "text" ? [part.text ?? ""] : []).join("");
}

export function createApp() {
  const app = new Hono();

  // 未捕获异常也要给可读结构：以前抛出去就是 500 纯文本，界面只能说"请求失败"，看不出为什么。
  app.onError((error, c) => {
    const requestId = String((c as unknown as { get: (key: string) => unknown }).get("requestId") ?? "-");
    console.error(`[http] 未处理异常 ${c.req.method} ${c.req.path} #${requestId}:`, error);
    void log.error("http", "unhandled", "未处理的异常", {
      details: {
        requestId, method: c.req.method, path: c.req.path,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    const body = { error: { code: "internal_error", message: "服务端内部错误（已记录日志）", requestId } };
    return c.json(body, 500);
  });

// 请求行（协议 P1·1.5 / specs 2.10）：每个 HTTP 请求一行 method/path/status/millis/requestId。
app.use(async (c, next) => {
  const expiredFor = expireDrainIfStale();
  if (expiredFor !== undefined) {
    void log.error("session-runtime", "expireDrainIfStale", "排空超时：重启没有发生，已恢复受理", {
      details: { expectedBy: "dev-supervisor", drainedForMs: expiredFor, ttlMs: 60_000 },
    });
  }
  const requestId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  await next();
  const status = c.res.status;
  const path = new URL(c.req.url).pathname;
  void log.info("http", undefined, "request", { details: { method: c.req.method, path, status, millis: Date.now() - startedAt, requestId } });
});

  // 创建助手（模型侧走 lifeos_agent_create 工具，界面暂无入口——用户 2026-10-19 定）
  app.post("/api/agents", async (c) => {
    const body = await c.req.json().catch(() => undefined) as { name?: unknown; description?: unknown } | undefined;
    if (body === undefined || typeof body.name !== "string" || body.name.trim() === "") {
      const error = problem("invalid_request", "需要 name 字段（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const created = await createAgent({
      name: body.name,
      ...(typeof body.description === "string" ? { description: body.description } : {}),
    });
    if ("code" in created) { const error = problem(created.code, created.message, created.status); return c.json(error.body, error.status); }
    return c.json({ agent: created }, created.created ? 201 : 200);
  });

  // 归档助手 = 从列表移除（数据全留，可恢复）；会话运行中 409；最后一个 400
  app.delete("/api/agents/:id", async (c) => {
    const result = await archiveAgent(c.req.param("id"));
    if ("code" in result) { const error = problem(result.code, result.message, result.status); return c.json(error.body, error.status); }
    return c.json(result, 200);
  });

  app.get("/api/agents", async (c) => {
    const entries = await readdir(agentsRoot(), { withFileTypes: true }).catch(() => []);
    const items: AgentDefinition[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const agent = await readAgent(entry.name);
      if (agent !== undefined && agent.archivedAt === undefined) items.push(agent);   // 归档的不再出现
    }
    return c.json({ items });
  });

  app.get("/api/agents/:id", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined || agent.archivedAt !== undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    return c.json(agent);
  });

  app.get("/api/agents/:id/sessions", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const running = runningOf(agent.id);
    const items = (await listSessions(agent.id, agent.defaultProjectId ?? "workspace", agent.defaultSessionId)).map((item) => ({ ...item, running: running.some((run) => run.sessionId === item.sessionId) }));
    return c.json({ items });
  });

  // project 列表 = 内置 workspace + boundProjectIds 解析（§5.6 定稿：绑定清单才是权威；
  // 扫描即枚举、不建 registry；harness 记录目录不在绑定清单中 → 天然不出现）。
  app.get("/api/agents/:id/projects", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    // 列表逻辑下沉到 projects.ts：HTTP 与 lifeos_project_* 工具共用同一份（含 hidden 排除、默认项目置顶）
    return c.json({ items: await listAgentProjects(agent.id) });
  });

  app.get("/api/agents/:id/projects/:pid/sessions", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const pid = c.req.param("pid");
    if (await resolveProject(agent, pid) === undefined) {
      const error = problem("project_not_found", "找不到这个 project（未注册或未绑定）", 404); return c.json(error.body, error.status);
    }
    const running = runningOf(agent.id);
    const items = (await listSessions(agent.id, pid, agent.defaultSessionId)).map((item) => ({ ...item, running: running.some((run) => run.sessionId === item.sessionId) }));
    return c.json({ items });
  });

  // 会话历史：原始条目只读直出（事实源=会话 JSONL；不投影、不改写；分页）
  app.get("/api/agents/:id/sessions/:sessionId/entries", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const sessionId = c.req.param("sessionId");
    const raw = await readSessionEntries(agent.id, sessionId);
    if (raw === undefined) { const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status); }
    const offset = Math.max(0, Number(c.req.query("offset") ?? "0") || 0);
    const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? "200") || 200));
    const entries = raw.entries.slice(offset, offset + limit);
    const labels: Record<string, string> = {};
    for (const entry of raw.entries) {
      if (entry.type !== "label") continue;
      const targetId = entry.targetId;
      const label = entry.label;
      if (typeof targetId !== "string") continue;
      if (typeof label === "string" && label !== "") labels[targetId] = label;
      else delete labels[targetId];
    }
    const leafId = raw.entries.length > 0 ? raw.entries[raw.entries.length - 1]?.id : undefined;
    return c.json({
      sessionId,
      header: raw.header,
      total: raw.entries.length,
      offset,
      limit,
      hasMore: offset + entries.length < raw.entries.length,
      leafId: typeof leafId === "string" ? leafId : undefined,
      labels,
      entries,
    });
  });

  // 注册外部项目 + 绑定（合成一步，2026-10-18 拍板）：同 path 幂等复用 pid=uuidv7；只写家目录共用层与 agent.json。
  app.post("/api/agents/:id/projects", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const body = await c.req.json().catch(() => undefined) as { path?: unknown } | undefined;
    if (body === undefined || typeof body.path !== "string" || body.path.trim() === "") {
      const error = problem("invalid_request", "需要 path 字段（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const bound = await bindProject(agent.id, body.path);
    if ("code" in bound) return fsError(c, bound);
    // 带上默认 Task：绑定即创建，调用方（界面/工具）不用再猜它叫什么
    return c.json({ project: bound.project, defaultTask: { id: bound.defaultTask.id, title: bound.defaultTask.title } }, bound.created ? 201 : 200);
  });

  // 「从列表移除」（2026-10-18 拍板 A）：写 hiddenProjectIds；目录、manifest、会话/记录全部保留；内置 workspace 不可移除。
  app.delete("/api/agents/:id/projects/:pid", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    // 「移除」= 从该助手的列表移除（写 hiddenProjectIds），目录与会话文件原样保留（结构即事实）。
    // 重新注册同一路径（POST /projects）会把 pid 从 hidden 里摘掉，列表里再次出现。
    const result = await unbindProject(agent.id, c.req.param("pid"));
    if (result !== "unbound") { const error = problem(result.code, result.message, result.status); return c.json(error.body, error.status); }
    return c.json({ hidden: c.req.param("pid") });
  });

  // 在某 project 下新建会话：cwd = 项目 path（workspace = ~/.lifeos，拍板2）；外部须已注册且已绑定。
  app.post("/api/agents/:id/projects/:pid/sessions", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const pid = c.req.param("pid");
    const project = await resolveProject(agent, pid);
    if (project === undefined) {
      const error = problem("project_not_found", "找不到这个 project（未注册或未绑定）", 404); return c.json(error.body, error.status);
    }
    const sessionCwd = project.id === "workspace" ? resolveHome() : project.path!;
    return c.json({ sessionId: await createSession(agent.id, sessionCwd, pid) });
  });

  // 当前项目的任务清单（UI 的 /task 切换器读取；不产生文件、不建索引）。
  app.get("/api/agents/:id/projects/:pid/tasks", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const project = await resolveProject(agent, c.req.param("pid"));
    if (project === undefined) { const error = problem("project_not_found", "找不到这个 project", 404); return c.json(error.body, error.status); }
    return c.json({ items: await listTasks({ agentId: agent.id, projectId: project.id }) });
  });

  // 重命名会话（写 Pi session_info 展示名；列表标题优先用它）。
  app.put("/api/agents/:id/sessions/:sessionId", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const body = await c.req.json().catch(() => undefined) as { name?: unknown } | undefined;
    if (body === undefined || typeof body.name !== "string" || body.name.trim() === "") {
      const error = problem("invalid_request", "需要 name 字段（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const sessionId = c.req.param("sessionId");
    if (await getSession(agent.id, sessionId, await cwdOfSession(agent, sessionId)) === undefined) {
      const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status);
    }
    await renameSession(agent.id, sessionId, body.name.trim().slice(0, 80), await cwdOfSession(agent, sessionId));
    return c.json({ sessionId, name: body.name.trim().slice(0, 80) });
  });

  // 删除会话：运行中拒绝（409），否则移除文件与内存态。
  app.delete("/api/agents/:id/sessions/:sessionId", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const result = await deleteSession(agent.id, c.req.param("sessionId"));
    if (result === "not_found") { const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status); }
    if (result === "running") { const error = problem("session_running", "会话正在运行，先打断再删除", 409); return c.json(error.body, error.status); }
    return c.json({ sessionId: c.req.param("sessionId"), deleted: true });
  });

  app.post("/api/agents/:id/sessions", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    return c.json({ sessionId: await createSession(agent.id, resolveHome(), agent.defaultProjectId ?? "workspace") });
  });

  app.get("/api/agents/:id/sessions/:sessionId", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const state = await getSession(agent.id, c.req.param("sessionId"), await cwdOfSession(agent, c.req.param("sessionId")));
    if (state === undefined) { const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status); }
    // 引用完整性（C117）：断裂的分支会让消息"消失"，必须显式报告而不是静默返回 0 条
    const integrity = await sessionIntegrity(agent.id, c.req.param("sessionId"));
    if (integrity !== undefined && integrity.orphanParents > 0) {
      void log.warn("session", "integrity", "会话存在悬空 parentId（分支可能断裂）", {
        agentId: agent.id, sessionId: c.req.param("sessionId"), details: { orphanParents: integrity.orphanParents },
      });
    }
    return c.json({
      sessionId: c.req.param("sessionId"), messages: messagesOf(state), meta: sessionMeta(agent.id, state),
      ...(integrity !== undefined ? { integrity } : {}),
    });
  });
  // 对账端点（协议 P1·1.2）：内存账本（running/done/error）在，进程重启则兜底读 JSONL（done/lost）。
  app.get("/api/agents/:id/sessions/:sessionId/turns/last", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    if (!(await sessionExists(agent.id, c.req.param("sessionId")))) {
      const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status);
    }
    return c.json(await turnLastOf(agent.id, c.req.param("sessionId")));
  });

  // 前端批量上报（协议 P1·1.5）：≤50 条/批、单批 ≤16KiB、逐条写进 frontend-<date>.jsonl。
  app.post("/api/logs", async (c) => {
    const raw = await c.req.text();
    if (raw.length > 16 * 1024) { const error = problem("invalid_request", "批量过大（>16KiB）", 400); return c.json(error.body, error.status); }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { const error = problem("invalid_request", "body 不是合法 JSON", 400); return c.json(error.body, error.status); }
    const events = (parsed as { events?: unknown }).events;
    if (!Array.isArray(events) || events.length === 0 || events.length > 50) {
      const error = problem("invalid_request", "events 必须是 1..50 条的数组", 400); return c.json(error.body, error.status);
    }
    const written = await appendFrontendRows(events as Array<Record<string, unknown>>);
    void log.info("http", undefined, "frontend-logs", { details: { written, requestId: "batch" } });
    return c.json({ written });
  });

  // 请求体上限 = 网关实测能带走的量（32MB 通过、64MB 断开）；超出直接 413，不进入解析
  const messagesBodyLimit = bodyLimit({
    maxSize: MAX_SESSION_IMAGE_BYTES * 2,
    onError: (c) => {
      const error = problem("payload_too_large", `请求体超过 ${(MAX_SESSION_IMAGE_BYTES * 2) / (1024 * 1024)}MB`, 413);
      return c.json(error.body, error.status);
    },
  });
  app.post("/api/agents/:id/sessions/:sessionId/messages", messagesBodyLimit, async (c) => {
    if (isDraining()) {
      const error = problem("backend_draining", "后端正在等待重启（开发热更新）：正在跑的回合结束后会自动重启，请稍后再发", 503); return c.json(error.body, error.status);
    }
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const body = await c.req.json().catch(() => undefined) as { text?: unknown; behavior?: unknown; images?: unknown } | undefined;
    if (body === undefined || typeof body.text !== "string" || body.text.trim() === "") {
      const error = problem("invalid_request", "需要 text 字段（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const sessionId = c.req.param("sessionId");
    const state = await getSession(agent.id, sessionId, await cwdOfSession(agent, sessionId));
    if (state === undefined) {
      const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status);
    }
    // 图片校验：张数、单张大小、魔数、会话字节预算（docs/design/image-input.md 约束表）
    const images = validateImages(body.images, sessionImageBytesOf(state));
    if (!images.ok) {
      const error = problem(images.code, images.message, images.code === "too_many_images" || images.code === "session_image_budget_exceeded" ? 422 : 400);
      return c.json(error.body, error.status);
    }
    if (images.images.length > 0) {
      // 能力门控：模型没声明图片输入就明确拒绝，而不是让 provider 报一个看不懂的错
      const choice = await resolveModelChoice(agent.id);
      const support = await declaredModelImageSupport(choice?.choice);
      if (support === false) {
        const error = problem("model_no_image_input", `当前模型 ${choice?.choice.defaultModel ?? ""} 未声明图片输入能力，请换一个支持看图的模型`, 400);
        return c.json(error.body, error.status);
      }
    }
    // 生成中投入输入：对接 Pi 原生 steer / followUp（不自造客户端队列）
    const behavior = body.behavior === "steer" || body.behavior === "followUp" ? body.behavior : undefined;
    if (behavior !== undefined) {
      const verdict = await queueSessionInput(agent.id, sessionId, body.text, behavior);
      if ("code" in verdict) {
        if (verdict.code === "session_not_found") { const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status); }
        if (verdict.code === "session_idle") {
          const error = problem("session_idle", "会话空闲：改为新回合处理（决策 b）", 409); return c.json(error.body, error.status);
        }
        if (verdict.code === "error") {
          const error = problem("steer_failed", verdict.message, 400); return c.json(error.body, error.status);
        }
        const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status);
      }
      return c.json({ queued: verdict.queued }, 202);
    }
    nameSessionFromFirstMessage(agent.id, sessionId, body.text);   // 同步命名：返回 202 时标题已生效（会话维护，提交 a08a21e）
    void runTurn(agent.id, sessionId, body.text, images.images);
    return c.json({ accepted: true, images: images.images.length }, 202);
  });

  // 打断（Pi abort()）：run 的 finally 会照常发 done，前端据此收尾
  app.post("/api/agents/:id/sessions/:sessionId/abort", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const aborted = await abortSession(agent.id, c.req.param("sessionId"));
    if (!aborted) { const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status); }
    return c.json({ aborted: true });
  });

  // 压缩上下文（Pi compact()；会先 abort 当前 run）
  app.post("/api/agents/:id/sessions/:sessionId/compact", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const result = await compactSession(agent.id, c.req.param("sessionId"));
    if (!result.ok) { const error = problem("compact_failed", result.message, 400); return c.json(error.body, error.status); }
    return c.json({ summary: result.summary });
  });

  // 会话级切模型（Pi setModel()）：{ provider, model }
  app.post("/api/agents/:id/sessions/:sessionId/model", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const body = await c.req.json().catch(() => undefined) as { provider?: unknown; model?: unknown } | undefined;
    if (body === undefined || typeof body.provider !== "string" || typeof body.model !== "string") {
      const error = problem("invalid_request", "需要 provider 与 model 字段", 400); return c.json(error.body, error.status);
    }
    const result = await setSessionModel(agent.id, c.req.param("sessionId"), body.provider, body.model);
    if (!result.ok) {
      // 三种失败分开报：会话不在 / 清单里没有 / Pi 拒绝（如 provider 没配 API key）——原因原样给界面
      if (result.reason === "session_not_found") { const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status); }
      if (result.reason === "model_not_found") { const error = problem("model_not_found", `models.json 里没有 ${body.provider}/${body.model}`, 404); return c.json(error.body, error.status); }
      const error = problem("model_rejected", result.message, 409); return c.json(error.body, error.status);
    }
    return c.json({ provider: body.provider, model: body.model });
  });

  // 会话级思考级别（Pi setThinkingLevel()）：{ level }
  app.post("/api/agents/:id/sessions/:sessionId/thinking", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const body = await c.req.json().catch(() => undefined) as { level?: unknown } | undefined;
    if (body === undefined || typeof body.level !== "string") {
      const error = problem("invalid_request", "需要 level 字段", 400); return c.json(error.body, error.status);
    }
    const level = THINKING_LEVELS.find((item) => item === body.level);
    if (level === undefined) {
      const error = problem("invalid_request", `level 只能是 ${THINKING_LEVELS.join(" / ")}`, 400); return c.json(error.body, error.status);
    }
    const result = setSessionThinking(agent.id, c.req.param("sessionId"), level);
    if (!result.ok) { const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status); }
    // 回实际生效值：Pi 会按模型能力夹取，直接把入参回显就是假数据
    return c.json({ level: result.level });
  });

  // 会话当前 Task 切换（activeTaskId）：只影响下一轮；当前 run 已装配的 prompt 不变。
  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      await pruneSessionViewsOnce();   // 先清孤儿未读，再生成快照（否则快照会把已删会话的蓝点带给界面）
      const connectionId = randomUUID();
      let finished: () => void = () => undefined;
      const finishedPromise = new Promise<void>((resolve) => { finished = resolve; });
      const sink = createBoundedSink({
        write: (event) => stream.writeSSE({ event: event.type, id: String(event.seq), data: JSON.stringify(event) }),
        limitBytes: STREAM_HIGH_WATER_BYTES,
      });
      const bus = subscribeBus({
        id: connectionId,
        offer: (event) => sink.offer(event),
        overflowed: () => { void stream.close(); finished(); },   // 过载：关闭，客户端重连
      });
      // 同步块：订阅之后立刻取快照（bus.seq 即基线）
      const snapshot = { connectionId, seq: bus.seq, ...globalSnapshot() };
      const ping = setInterval(() => { void stream.writeSSE({ event: "ping", data: "{}" }).catch(() => finished()); }, STREAM_PING_MS);
      try {
        await stream.writeSSE({ event: "snapshot", id: String(bus.seq), data: JSON.stringify(snapshot) });
        bus.ready();
        stream.onAbort(() => finished());
        c.req.raw.signal.addEventListener("abort", () => finished());
        await finishedPromise;
      } finally {
        clearInterval(ping);
        bus.close();
        sink.close();
      }
    });
  });

  // 焦点上报：客户端说"我正在看哪个会话、页面是否可见"。细节流据此路由；可见时顺手记为已读。
  app.put("/api/events/focus", async (c) => {
    const body = await c.req.json().catch(() => undefined) as { connectionId?: unknown; agentId?: unknown; sessionId?: unknown; visible?: unknown } | undefined;
    if (body === undefined || typeof body.connectionId !== "string" || typeof body.visible !== "boolean") {
      const error = problem("invalid_request", "需要 connectionId（字符串）与 visible（布尔）", 400); return c.json(error.body, error.status);
    }
    const hasTarget = typeof body.agentId === "string" && body.agentId !== "" && typeof body.sessionId === "string" && body.sessionId !== "";
    const focus = hasTarget
      ? { agentId: body.agentId as string, sessionId: body.sessionId as string, visible: body.visible }
      : undefined;
    if (!setFocusOf(body.connectionId, focus)) {
      const error = problem("connection_not_found", "事件连接不存在（已断开）；请重连后重新上报焦点", 404); return c.json(error.body, error.status);
    }
    if (focus !== undefined && focus.visible) sessionViewsOf().markViewed(focus.agentId, focus.sessionId, new Date().toISOString());
    return c.json({ ok: true });
  });

  // 运行态（诊断与开发 supervisor 用）：跨 Agent 正在跑的回合。
  app.get("/api/runtime", (c) => c.json({
    running: globalSnapshot().running,
    draining: isDraining(),
    ...(drainingForMs() !== undefined ? { drainingForMs: drainingForMs() } : {}),
  }));
  // 排空：拒绝新回合，已在跑的继续跑到结束。supervisor 据 running 计数决定何时重启（进程重启后排空标记自然清除）。
  app.post("/api/runtime/drain", (c) => {
    setDraining(true);
    return c.json({ draining: true, running: globalSnapshot().running.length });
  });

  // —— Agent 配置（2026-10-18 用户需求：基础信息 / 身份 / 头像 / 模型解析 / 个人模型默认落 workspace）——

  // 基础信息：改名/描述（写 agent.json，原子）
  app.put("/api/agents/:id", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const body = await c.req.json().catch(() => undefined) as { name?: unknown; description?: unknown } | undefined;
    if (body === undefined) { const error = problem("invalid_request", "请求体无效", 400); return c.json(error.body, error.status); }
    const updated: AgentDefinition = { ...agent };
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim() === "") {
        const error = problem("invalid_name", "name 需为非空字符串", 400); return c.json(error.body, error.status);
      }
      updated.name = body.name.trim().slice(0, 60);
    }
    if (body.description !== undefined) updated.description = String(body.description).slice(0, 300);
    await writeAgent(updated);
    return c.json(updated);
  });

  // 身份信息 identity.md：读/写
  app.get("/api/agents/:id/identity", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const text = await readFile(identityPath(agent.id), "utf8").catch(() => "");
    return c.json({ text });
  });
  app.put("/api/agents/:id/identity", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const body = await c.req.json().catch(() => undefined) as { text?: unknown } | undefined;
    if (body === undefined || typeof body.text !== "string" || body.text.length > 64 * 1024) {
      const error = problem("invalid_request", "需要 text 字段（≤64KB）", 400); return c.json(error.body, error.status);
    }
    await writeTextAtomic(identityPath(agent.id), body.text);
    return c.json({ ok: true });
  });

  // 头像：上传（png/jpg/webp，≤2MB，魔数校验）或 reset（回自动头像）
  app.post("/api/agents/:id/avatar", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const body = await c.req.json().catch(() => undefined) as { data?: unknown; reset?: unknown } | undefined;
    const avatarDir = join(agentsRoot(), agent.id, "avatar");
    if (body?.reset === true) {
      await rm(avatarDir, { recursive: true, force: true });
      const updated = { ...agent } as AgentDefinition & { avatar?: unknown };
      delete updated.avatar;
      await writeAgent(updated);
      return c.json({ avatar: null });
    }
    if (body === undefined || typeof body.data !== "string" || body.data.length === 0) {
      const error = problem("invalid_request", "需要 data（base64）或 reset", 400); return c.json(error.body, error.status);
    }
    const buffer = Buffer.from(body.data, "base64");
    if (buffer.length > 2 * 1024 * 1024) { const error = problem("image_too_large", "头像不能超过 2MB", 400); return c.json(error.body, error.status); }
    const sniffed = sniffImage(buffer);
    if (sniffed === undefined) { const error = problem("invalid_image", "仅支持 png/jpg/webp", 400); return c.json(error.body, error.status); }
    await mkdir(avatarDir, { recursive: true, mode: 0o700 });
    await rm(avatarDir, { recursive: true, force: true });
    await mkdir(avatarDir, { recursive: true, mode: 0o700 });
    const file = `avatar.${sniffed.ext}`;
    await writeFile(join(avatarDir, file), buffer, { mode: 0o600 });
    const avatar = { kind: "image", file, revision: Date.now() };
    await writeAgent({ ...agent, avatar } as AgentDefinition);
    return c.json({ avatar });
  });
  app.get("/api/agents/:id/avatar", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const avatar = (agent as AgentDefinition & { avatar?: { kind?: string; file?: string } }).avatar;
    if (avatar?.kind !== "image" || typeof avatar.file !== "string") {
      const error = problem("no_avatar", "未设置图片头像", 404); return c.json(error.body, error.status);
    }
    const buffer = await readFile(join(agentsRoot(), agent.id, "avatar", avatar.file)).catch(() => undefined);
    if (buffer === undefined) { const error = problem("no_avatar", "头像文件不存在", 404); return c.json(error.body, error.status); }
    const mime = avatar.file.endsWith(".png") ? "image/png" : avatar.file.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return c.body(buffer, 200, { "Content-Type": mime });
  });

  // 模型解析（只读用户 models.json；响应经 stripSecrets，apiKey 永不外带）+ settings 默认
  app.get("/api/models-config", async (c) => {
    const providers = await readModelsConfig();
    const settings = await readFile(join(resolveHome(), "config", "settings.json"), "utf8")
      .then((text) => JSON.parse(text), () => null);
    const items = Object.entries(providers).map(([id, value]) => {
      const provider = (value ?? {}) as { baseUrl?: string; models?: unknown };
      return { id, baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl : "", models: Array.isArray(provider.models) ? provider.models : [] };
    });
    return c.json(stripSecrets({ providers: items, settings }));
  });

  // Agent 个人模型默认：保存/加载在自己的 workspace 下（用户 2026-10-18 指定）
  app.get("/api/agents/:id/config", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const config = await readFile(agentConfigPath(agent.id), "utf8")
      .then((text) => JSON.parse(text), () => null);
    // 顶部/创建会话都要看“有效默认”：Agent 配置 → 系统 settings → 模型清单第一项。
    const resolved = await resolveModelChoice(agent.id);
    // thinkingLevel 单独给：模型段显示"有效默认"时，档位也要能显示"下一轮会用哪个"（无会话时）
    const effective = resolved?.choice === undefined ? null : {
      ...resolved.choice,
      thinkingLevel: resolved.choice.defaultThinkingLevel ?? DEFAULT_PI_THINKING_LEVEL,
    };
    return c.json({ config, effective, source: resolved?.source ?? null });
  });
  app.put("/api/agents/:id/config", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const body = await c.req.json().catch(() => undefined) as { defaultProvider?: unknown; defaultModel?: unknown; defaultThinkingLevel?: unknown } | undefined;
    if (body === undefined || typeof body.defaultProvider !== "string" || body.defaultProvider.trim() === "" ||
        typeof body.defaultModel !== "string" || body.defaultModel.trim() === "") {
      const error = problem("invalid_request", "需要 defaultProvider 与 defaultModel（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const providerId = body.defaultProvider.trim();
    const modelId = body.defaultModel.trim();
    // 默认模型必须来自清单：不校验的话，清单里没有的 id 会在这里被写进配置，之后新建会话静默回落
    const providers = await readModelsProviders();
    if (providers[providerId] === undefined || !providers[providerId].includes(modelId)) {
      const error = problem("model_not_found", `models.json 里没有 ${providerId}/${modelId}`, 400); return c.json(error.body, error.status);
    }
    const config = {
      schemaVersion: 1,
      defaultProvider: providerId,
      defaultModel: modelId,
      ...(typeof body.defaultThinkingLevel === "string" && body.defaultThinkingLevel !== "" ? { defaultThinkingLevel: body.defaultThinkingLevel } : {}),
    };
    await mkdir(join(agentsRoot(), agent.id, "projects", "workspace"), { recursive: true });
    await writeTextAtomic(agentConfigPath(agent.id), JSON.stringify(config, null, 2) + "\n");
    // 未用 `/model` 覆盖过的会话跟随新默认（用户 2026-10-20：默认变了，顶部/实际模型都要跟着变）
    const applied = await applyAgentDefaultModel(agent.id, config.defaultProvider, config.defaultModel);
    const appliedThinking = config.defaultThinkingLevel === undefined ? 0 : applyAgentDefaultThinking(agent.id, config.defaultThinkingLevel);
    // 头部模型/思考级别可能因此变化（未覆盖的会话跟随默认）→ 广播让前端刷新 meta（写操作必须闭环到界面）
    broadcast({ type: "agents_changed" });
    return c.json({ config, applied, appliedThinking });
  });

  // —— 文件浏览器（.lifeos/projects/lifeos/knowledge/design/file-browser.md P1）：根白名单；browse 仅选择器专用（只列目录）。 ——
  const fsError = (c: Context, error: { code: string; message: string; status: number }) =>
    c.json({ error: { code: error.code, message: error.message } }, error.status as 400);

  app.get("/api/fs/roots", async (c) => c.json({ roots: await readRoots() }));

  app.post("/api/fs/roots", async (c) => {
    const body = await c.req.json().catch(() => undefined) as { path?: unknown } | undefined;
    if (body === undefined || typeof body.path !== "string" || body.path.trim() === "") {
      const error = problem("invalid_request", "需要 path 字段（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const result = await registerRoot(body.path);
    if ("code" in result) return fsError(c, result);
    return c.json({ roots: result.roots }, 201);
  });

  app.get("/api/fs/browse", async (c) => {
    const result = await browse(c.req.query("path"));
    if ("code" in result) return fsError(c, result);
    return c.json(result);
  });

  app.get("/api/fs/tree", async (c) => {
    const path = c.req.query("path");
    if (path === undefined || path === "") {
      const error = problem("invalid_request", "需要 path 查询参数", 400); return c.json(error.body, error.status);
    }
    const result = await listTree(path);
    if ("code" in result) return fsError(c, result);
    return c.json(result);
  });

  app.get("/api/fs/content", async (c) => {
    const path = c.req.query("path");
    if (path === undefined || path === "") {
      const error = problem("invalid_request", "需要 path 查询参数", 400); return c.json(error.body, error.status);
    }
    const result = await readContent(path);
    if ("code" in result) return fsError(c, result);
    return c.json(result);
  });

  app.use("/*", serveStatic({ root: "./frontend/dist" }));
  app.get("/*", serveStatic({ path: "./frontend/dist/index.html" }));

  return app;
}
