// HTTP 接口：只读 Agent + 会话列表/读取 + 一条按 Agent 的事件流（带快照与序号，可续传）。
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { writeTextAtomic } from "./atomic-file.ts";
import { createBoundedSink } from "./bounded-sink.ts";
import { MAX_WATCHING, setFocusOf, subscribeBus } from "./events.ts";
import { peerMarkerOf } from "./peer.ts";
import { drainingForMs, expireDrainIfStale, isDraining, runningOf, setDraining } from "./session-runtime.ts";
import { sessionRowsOf, sessionsByTask } from "./session-rows.ts";
import { sessionViewsOf } from "./session-views.ts";
import { basename, join } from "node:path";
import { computeReviewDiff, locateSources, readReviewBlob, type ReviewError } from "./review.ts";
import { clearComments, readComments, removeComment, removeReply, addReply, upsertReply, setCommentAwaiting, setCommentState, toCommentInput, upsertComment } from "./review-comments.ts";
import { clearViewed, readViewed, setFileViewed, setFilesViewed } from "./review-viewed.ts";
import { listCandidates } from "./review-candidates.ts";
import { resolveTaskDir } from "./tasks.ts";
import {
  abortRetryOf, abortSession, annotationsOf, appendAnnotation, consumeAnnotations, toStoredAnnotation,
  applyAgentDefaultModel, broadcast, compactSession, createSession, deleteSession, getSession, messagesOf, sessionImageBytesOf, pendingSessions,
  applyAgentDefaultThinking, nameSessionFromFirstMessage, pruneSessionViewsOnce, reserveTurn, sessionExists, sessionIntegrity, turnLastOf, queueSessionInput, readSessionEntries, renameSession, runTurn, sessionCwd, sessionMeta, payloadMetaOf,
  setSessionModel, setSessionThinking, globalSnapshot, THINKING_LEVELS, markSessionViewed, projectIdOfSession,
} from "./agent-host.ts";
import { browse, listTree, readContent, readRoots, registerRoot } from "./fs.ts";
import { bindProject, listAgentProjects, readProjectManifest, readProjectManifests, unbindProject } from "./projects.ts";
import { archiveAgent, createAgent, readAgent, writeAgent, type AgentDefinition } from "./agents.ts";
import {
  MAX_AVATAR_BYTES, avatarExists, normalizeName, readProfile, readProfileAvatar, storeProfileAvatar, writeProfile,
} from "./profile.ts";
import { DEFAULT_PI_THINKING_LEVEL, resolveModelChoice } from "./assembly.ts";
import { listTasks } from "./tasks.ts";
import { classifyFailure } from "./failure.ts";
import { resolveHome } from "./home.ts";
import { appendFrontendRows, log } from "./logging.ts";
import { cacheControlOf, looksLikeFile, REVALIDATE_CACHE } from "./static.ts";
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

function problem(code: string, message: string, status: 400 | 403 | 404 | 409 | 413 | 422 | 503) {
  return { body: { error: { code, message } }, status } as const;
}

/** 某 project 的会话目录：结构即事实（`agents/<id>/projects/<pid>/sessions/`，协议 §12.1）。 */
function projectSessionsDir(agentId: string, projectId: string): string {
  return join(agentsRoot(), agentId, "projects", projectId, "sessions");
}

// `listSessions` 与 `textOf` 已删除（任务 0005）：会话行的组装下沉到 `src/session-rows.ts`，
// 这里不再保留第二份扫描实现——两份实现正是 `peer` 一处字符串一处对象的来源。

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

  // 四个端点（/sessions ×2、/rows ×2）只差"哪个项目"，其余一律同一份组装：
  // SessionRow 是**一个形状一处实现**（Task 0005 的核心目标），HTTP 层不得各拼一次。
  const rowsOf = (agent: { id: string; defaultSessionId?: string | undefined }, projectId: string) =>
    sessionRowsOf(agent.id, projectId, {
      ...(agent.defaultSessionId !== undefined ? { defaultSessionId: agent.defaultSessionId } : {}),
    });

  // 会话列表（默认项目）：与 `/projects/:pid/sessions` **同一个实现**（`sessionRowsOf`），
  // 不再两份各拼一次（现状已漂移出 `peer` 一处字符串一处对象，见任务 0005 · 01 §3 第 1 条）。
  app.get("/api/agents/:id/sessions", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    return c.json({ items: await rowsOf(agent, agent.defaultProjectId ?? "workspace") });
  });

  // 行对象端点（Task 0005 · P6）：`/rows` 是 `SessionRow` 语义上的正式入口。
  //
  // 为什么不直接改名 `/sessions`：那个名字暗示"会话列表"，而返回的是**行对象**
  // （带 Task 名、项目图标、四态、计数分项）。名字与内容不符会让后来人误读接口。
  // 旧端点保留（前端与外部调用还在用），两者**同一个实现**，不各拼一份。
  app.get("/api/agents/:id/rows", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    return c.json({ items: await rowsOf(agent, agent.defaultProjectId ?? "workspace") });
  });

  app.get("/api/agents/:id/projects/:pid/rows", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const pid = c.req.param("pid");
    if (await resolveProject(agent, pid) === undefined) {
      const error = problem("project_not_found", "找不到这个 project（未注册或未绑定）", 404); return c.json(error.body, error.status);
    }
    return c.json({ items: await rowsOf(agent, pid) });
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
    // 与 `/api/agents/:id/sessions` **同一个实现**：一次组装出完整的 SessionRow
    // （标题/项目/Task 名/对端/计数/时间/四态），不再由 HTTP 层各自拼。
    return c.json({ items: await rowsOf(agent, pid) });
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
    // 每个 Task 带上"它下面有哪些会话"（Task 0015 · T14）——界面与 Agent 都能回答
    // "这个 Task 聊了哪些对话"。
    //
    // Task 0005 · P6：原来是**每个 Task 各全扫一遍会话目录**（N 个 Task = N × 26 个文件）。
    // 现在一次扫描按 taskId 分组（`sessionsByTask`），与列表行对象同源。
    const items = await listTasks({ agentId: agent.id, projectId: project.id });
    const grouped = await sessionsByTask(agent.id, project.id);
    const withSessions = items.map((task) => ({ ...task, sessions: grouped.get(task.id) ?? [] }));
    return c.json({ items: withSessions });
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

  /**
   * 批注读取（Task 0003 · P5）。
   * 批注存在会话的 custom entry 里（`lifeos_annotation`），不在 messages 投影里，
   * 所以要单独一个端点——前端 `loadMessages` 之后拉一次。
   */
  app.get("/api/agents/:id/sessions/:sessionId/annotations", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const sessionId = c.req.param("sessionId");
    const state = await getSession(agent.id, sessionId, await cwdOfSession(agent, sessionId));
    if (state === undefined) { const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status); }
    return c.json({ annotations: annotationsOf(state.session.sessionManager) });
  });

  /**
   * 批注写入（Task 0003 · P5）：边标边存，与发消息解耦。
   * 为什么不用"随消息一起存"：用户可能标完先不发；那种批注不应该丢。
   */
  app.post("/api/agents/:id/sessions/:sessionId/annotations", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const body = await c.req.json().catch(() => undefined) as {
      op?: unknown; annotation?: unknown; ids?: unknown; consumedBy?: unknown;
    } | undefined;
    const op = body?.op;
    if (op !== "add" && op !== "update" && op !== "remove" && op !== "consume") {
      const error = problem("invalid_request", "op 必须是 add / update / remove / consume", 400); return c.json(error.body, error.status);
    }

    // consume：一批 pending 批注被某一轮消费（发送成功）。**一次落盘**，见 agent-host 的说明。
    if (op === "consume") {
      const ids = body?.ids;
      const consumedBy = body?.consumedBy;
      if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string" || id === "")) {
        const error = problem("invalid_request", "consume 需要非空的 ids（字符串数组）", 400); return c.json(error.body, error.status);
      }
      if (typeof consumedBy !== "string" || consumedBy === "") {
        const error = problem("invalid_request", "consume 需要 consumedBy（该轮用户消息 id）", 400); return c.json(error.body, error.status);
      }
      const sessionId = c.req.param("sessionId");
      const state = await getSession(agent.id, sessionId, await cwdOfSession(agent, sessionId));
      if (state === undefined) { const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status); }
      consumeAnnotations(state.session.sessionManager, ids as string[], consumedBy);
      return c.json({ ok: true, consumed: ids.length });
    }
    const raw = body?.annotation as Record<string, unknown> | undefined;
    if (raw === undefined || typeof raw.id !== "string" || raw.id === "") {
      const error = problem("invalid_request", "annotation.id 必须是非空字符串", 400); return c.json(error.body, error.status);
    }
    // remove 只需要 id；add/update 要完整字段（consume 已在上面单独返回）
    const stored = op === "remove"
      ? { id: raw.id } as never
      : toStoredAnnotation(raw);
    if (stored === undefined) {
      const error = problem("invalid_request", "annotation 字段不完整（需要 messageId/blockIndex/start/end/quote/marks）", 400);
      return c.json(error.body, error.status);
    }
    const sessionId = c.req.param("sessionId");
    const state = await getSession(agent.id, sessionId, await cwdOfSession(agent, sessionId));
    if (state === undefined) { const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status); }
    // peer 会话由对端驱动：这里允许写批注（不涉及发消息），但前端目前已禁用。
    appendAnnotation(state.session.sessionManager, op, stored);
    return c.json({ ok: true });
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
      sessionId: c.req.param("sessionId"), messages: messagesOf(state),
      // payload 是观测（Task 0012 P1）：图片/文本字节 + 上限从哪来；limit=null 表示该 provider 未声明上限
      meta: { ...sessionMeta(agent.id, state), payload: await payloadMetaOf(state) },
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

  // 入站请求体上限（浏览器 → Life OS）。注意：这是**我们自己的**限额，与"出站到网关"的 3.5MB 上限是两件事
  // （后者见 knowledge/design/image-input.md 与 src/payload-limit.ts，且校验发生在鉴权之后，探针测不到）
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
    // 发言权：**只看“这一轮是否在跑”**，不看会话来源（Task 0014 · D4/D6）。
    // 旧实现在这里无条件拒绝对话会话（`peer_conversation_readonly`），
    // 理由写的是“用户插话会打乱对方正在跑的回合”——理由关并发，结论却是永久只读，
    // 而且普通会话根本没有并发守卫。现在两条入口同一条规则，判定只在 `runTurn`/`sessionBusyOf` 一处。
    //
    // 顺序要求：`behavior` 必须先于“新回合”判定被解析——否则生成中想插话也会被 409 吃掉。
    const behavior = body.behavior === "steer" || body.behavior === "followUp" ? body.behavior : undefined;
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
    // 新回合：先**同步占位**拿到判决（202 / 409），再后台跑整轮。
    // 只 `await runTurn()` 是不可行的（实测 300s 超时）：它是 async，会连带等整轮结束，
    // 202 就一直不返回。所以占位与执行分开（02-design L1/L2）。
    const slot = reserveTurn(agent.id, sessionId);
    if (slot === undefined) {
      const error = problem("session_running",
        "这一轮还没结束，新消息没有发出：等它跑完再发 / 生成中按 Enter 插话（steer）/ 点停止（Esc）打断后重发", 409);
      return c.json(error.body, error.status);
    }
    nameSessionFromFirstMessage(agent.id, sessionId, body.text);   // 同步命名：返回 202 时标题已生效（会话维护，提交 a08a21e）
    const turn = runTurn(agent.id, sessionId, body.text, { images: images.images, reserved: slot });
    void turn.then((result) => {
      if (result.ok) return;
      // 占位成功却拿到 busy：理论上不可达（占位就是判据）。释放占位并记日志，不静默吞。
      slot.release();
      void log.error("http", "messages", "占位成功但 runTurn 回报 busy", { sessionId, agentId: agent.id });
    }).catch((error: unknown) => {
      void log.error("http", "messages", "runTurn 抛出未捕获错误", {
        sessionId, agentId: agent.id, details: { message: error instanceof Error ? error.message : String(error) },
      });
    });
    // 202 立刻带回 turnId：调用方（前端/工具/排查工具）要用它认领这一轮（Task 0014 · L4）。
    return c.json({ accepted: true, images: images.images.length, turnId: slot.turnId }, 202);
  });

  // 打断（Pi abort()）：run 的 finally 会照常发 done，前端据此收尾
  app.post("/api/agents/:id/sessions/:sessionId/abort", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const aborted = await abortSession(agent.id, c.req.param("sessionId"));
    if (!aborted) { const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status); }
    return c.json({ aborted: true });
  });

  // 只取消正在进行的自动重试，不打断整轮（Task 0007 · A2）。
  // Pi CLI 在重试退避期间按 Esc 走的是 abortRetry()（interactive-mode.ts:3749-3752），语义与 abort() 不同：
  // 取消重试 = "别试了，我自己处理"；abort = "整轮别跑了"。我们此前只有后者。
  app.post("/api/agents/:id/sessions/:sessionId/retry/abort", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    if (!(await sessionExists(agent.id, c.req.param("sessionId")))) {
      const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status);
    }
    if (!abortRetryOf(agent.id, c.req.param("sessionId"))) {
      const error = problem("not_retrying", "这个会话当前没有在自动重试", 409); return c.json(error.body, error.status);
    }
    return c.json({ retryAborted: true });
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
    // 同时查看的会话（右侧抽屉里的对端 Agent 会话）：校验形状 + 去重 + 上限，形状不对直接 400。
    const rawWatching = (body as { watching?: unknown }).watching;
    let watching: Array<{ agentId: string; sessionId: string }> = [];
    if (rawWatching !== undefined) {
      if (!Array.isArray(rawWatching)) {
        const error = problem("invalid_request", "watching 必须是数组", 400); return c.json(error.body, error.status);
      }
      const seen = new Set<string>();
      for (const entry of rawWatching) {
        const item = entry as { agentId?: unknown; sessionId?: unknown };
        if (typeof item.agentId !== "string" || item.agentId === "" || typeof item.sessionId !== "string" || item.sessionId === "") {
          const error = problem("invalid_request", "watching 的每一项都需要 agentId 与 sessionId（非空字符串）", 400); return c.json(error.body, error.status);
        }
        const key = `${item.agentId}/${item.sessionId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        watching.push({ agentId: item.agentId, sessionId: item.sessionId });
      }
      if (watching.length > MAX_WATCHING) {
        const error = problem("too_many_watching", `同时查看的会话最多 ${MAX_WATCHING} 条`, 400); return c.json(error.body, error.status);
      }
    }
    const focus = hasTarget
      ? {
        agentId: body.agentId as string, sessionId: body.sessionId as string, visible: body.visible,
        ...(watching.length > 0 ? { watching } : {}),
      }
      : undefined;
    if (!setFocusOf(body.connectionId, focus)) {
      const error = problem("connection_not_found", "事件连接不存在（已断开）；请重连后重新上报焦点", 404); return c.json(error.body, error.status);
    }
    // 与回合结束时的已读走**同一个函数**（见 agent-host 的 markSessionViewed 注释）。
    //
    // **必须带上 projectId**（2026-11-05 修）：原来的注释说"缺省不影响前端应用补丁"是错的 ——
    // 前端用补丁里的 projectId 建/改状态槽位，传 undefined 会把这条会话的数字
    // 从"某个项目"挪到"该 Agent 的无项目桶"，项目行上的数字就消失了。
    // 这里多一次 `projectIdOfSession()`（先查内存 pending、再查落盘，命中即返回），
    // 实测 <1ms，且只在用户切会话时发生，不在热路径上。
    if (focus !== undefined && focus.visible) {
      const projectId = await projectIdOfSession(focus.agentId, focus.sessionId);
      markSessionViewed(focus.agentId, focus.sessionId, new Date().toISOString(), projectId);
    }
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
  // ===== 用户档案（2026-11-02）：你本人，不是 Agent =====
  // 用户是**实体**（Task 0015 · T9）：`users/<id>/user.json` + `avatar.*`；不再写 config/profile.json。
  // 不引入“用户 Agent”实体：用户不是 Agent，也不进 Agent N:M Project 那套语义。
  app.get("/api/profile", async (c) => {
    const profile = await readProfile(resolveHome());
    // 档案里挂着已删除的头像文件时，如实告诉前端“没有头像”，不给 404 图片地址
    const hasAvatar = await avatarExists(resolveHome(), profile);
    return c.json({ id: profile.id, name: profile.name, avatar: hasAvatar ? profile.avatar ?? null : null });
  });

  app.put("/api/profile", async (c) => {
    const body = await c.req.json().catch(() => undefined) as { name?: unknown } | undefined;
    if (body === undefined) {
      const error = problem("invalid_request", "需要 JSON 请求体", 400); return c.json(error.body, error.status);
    }
    const current = await readProfile(resolveHome());
    const name = normalizeName(body.name);
    if (name === undefined) {
      const error = problem("invalid_request", "名字不能为空", 400); return c.json(error.body, error.status);
    }
    // 改名不改 id（id 稳定是硬约定）：把当前 id 一起传回写层
    const written = await writeProfile(resolveHome(), { ...current, name });
    return c.json({ id: written.id, name: written.name, avatar: written.avatar ?? null });
  });

  app.post("/api/profile/avatar", async (c) => {
    const body = await c.req.json().catch(() => undefined) as { data?: unknown } | undefined;
    if (body === undefined || typeof body.data !== "string" || body.data === "") {
      const error = problem("invalid_request", "需要 { data: <base64> }", 400); return c.json(error.body, error.status);
    }
    // 先在内存里量体积：超过上限不落盘（头像只显示 24–32px，1MB 已很宽）
    const bytes = Buffer.from(body.data, "base64");
    if (bytes.byteLength === 0) {
      const error = problem("invalid_image", "图片数据不是合法 base64", 400); return c.json(error.body, error.status);
    }
    if (bytes.byteLength > MAX_AVATAR_BYTES) {
      const error = problem("avatar_too_large", `头像最大 ${MAX_AVATAR_BYTES / (1024 * 1024)}MB`, 413); return c.json(error.body, error.status);
    }
    const avatar = await storeProfileAvatar(resolveHome(), body.data);
    if (avatar === undefined) {
      const error = problem("unsupported_image_type", "头像支持 png / jpeg / webp（按文件头判断）", 400); return c.json(error.body, error.status);
    }
    const current = await readProfile(resolveHome());
    const written = await writeProfile(resolveHome(), { ...current, avatar });
    return c.json({ id: written.id, name: written.name, avatar });
  });

  app.delete("/api/profile/avatar", async (c) => {
    const current = await readProfile(resolveHome());
    const { avatar: _dropped, ...rest } = current;
    const written = await writeProfile(resolveHome(), rest);
    return c.json({ id: written.id, name: written.name, avatar: null });
  });

  app.get("/api/profile/avatar", async (c) => {
    const profile = await readProfile(resolveHome());
    const buffer = await readProfileAvatar(resolveHome(), profile);
    if (buffer === undefined) {
      const error = problem("no_avatar", "未设置图片头像", 404); return c.json(error.body, error.status);
    }
    const file = profile.avatar?.file ?? "";
    const mime = file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : "image/jpeg";
    // 与 Agent 头像同形：Hono 要 Uint8Array<ArrayBuffer>，Buffer 的 buffer 可能是 SharedArrayBuffer
    return c.body(new Uint8Array(buffer), 200, { "Content-Type": mime, "Cache-Control": "no-store" });
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

  // ── 检视模式（Task 0010 · P1）：只读，零 git 写操作（D6）─────────────────

  /** resolveTaskDir 复用（tasks.ts），失败形状与 /tasks 端点一致。 */
  app.get("/api/agents/:id/projects/:pid/tasks/:taskId/review-sources", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const pid = c.req.param("pid");
    const taskId = c.req.param("taskId");
    if (pid === undefined || pid === "" || taskId === undefined || taskId === "") {
      const error = problem("invalid_request", "需要 pid 与 taskId", 400); return c.json(error.body, error.status);
    }
    const project = await resolveProject(agent, pid);
    if (project === undefined) { const error = problem("project_not_found", "找不到这个 project", 404); return c.json(error.body, error.status); }
    const taskDir = await resolveTaskDir({ agentId: agent.id, projectId: project.id }, taskId);
    if (taskDir === undefined) { const error = problem("task_not_found", "找不到这个 task", 404); return c.json(error.body, error.status); }
    const items = await locateSources(taskDir);
    return c.json({ items });
  });

  /**
   * 检视候选（D31）：列某个 agent × project 下**哪些 Task 有东西可检视**。
   *
   * 为什么按 agent×project 而不是一次列全库：Task 本就是 per agent×project 的（协议 §3.7），
   * 且实测 15 个 Task 约 0.93s / 83 个 1.24s——按层列，单次都在 1s 内。
   *
   * 三个字段体现 C2 分层：`worktreeChanged` / `docChangedFiles` / `docOnlyDaily`；
   * `substantive` 是汇总（worktree 变了 或 文档有非 daily 改动）。
   */
  app.get("/api/agents/:id/projects/:pid/review-candidates", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const pid = c.req.param("pid");
    const project = await resolveProject(agent, pid);
    if (project === undefined) { const error = problem("project_not_found", "找不到这个 project", 404); return c.json(error.body, error.status); }
    const result = await listCandidates(agent.id, project.id);
    log.info("review-candidates", "list", "列检视候选", {
      details: {
        agentId: agent.id, projectId: project.id, total: result.items.length,
        substantive: result.items.filter((item) => item.substantive).length,
        pendingForUser: result.items.reduce((sum, item) => sum + item.pendingForUser, 0),
        elapsedMs: result.elapsedMs,
      },
    });
    return c.json({
      items: result.items.map((item) => ({
        taskId: item.taskId, title: item.title, type: item.type, status: item.status,
        taskDir: item.taskDir, hasWorktree: item.hasWorktree, worktreeChanged: item.worktreeChanged,
        docChangedFiles: item.docChangedFiles, docOnlyDaily: item.docOnlyDaily, substantive: item.substantive,
        commentsTotal: item.commentsTotal, openComments: item.openComments, pendingForUser: item.pendingForUser,
      })),
      elapsedMs: result.elapsedMs,
    });
  });

  /**
   * 检视 diff：body { taskDir }（由 sources 端点给出的路径——不接受任意目录，防越权）。
   * 单源失败不拖垮整体（degraded）；错误可见（console.error + 响应里带 degraded）。
   */
  app.post("/api/review/diff", async (c) => {
    const body = await c.req.json().catch(() => undefined) as { taskDir?: unknown } | undefined;
    if (body === undefined || typeof body.taskDir !== "string" || body.taskDir.trim() === "") {
      const error = problem("invalid_request", "需要 taskDir 字段（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const result = await computeReviewDiff(body.taskDir);
    if ("error" in result && result.error !== undefined) {
      const e = result.error as ReviewError;
      return c.json({ error: { code: e.code, message: e.message } }, e.status);
    }
    return c.json({ items: result.items });
  });

  /**
   * 取某个文件在某一侧的全文（S1·G1a）：折叠未改行「展开更多」时调用。
   * 查询：taskDir / source(worktree|lifeos) / path / side(old|new)。失败形状同 /api/review/diff。
   */
  app.get("/api/review/blob", async (c) => {
    const taskDir = c.req.query("taskDir");
    const source = c.req.query("source");
    const path = c.req.query("path");
    const side = c.req.query("side");
    if (taskDir === undefined || taskDir.trim() === "" || source === undefined || path === undefined || side === undefined) {
      const error = problem("invalid_request", "需要 taskDir、source、path、side 四个参数", 400); return c.json(error.body, error.status);
    }
    const result = await readReviewBlob({ taskDir, source, path, side });
    if ("error" in result) {
      const e = result.error as ReviewError;
      return c.json({ error: { code: e.code, message: e.message } }, e.status);
    }
    return c.json(result);
  });

  /**
   * 检视评论（S4-b）：**独立于对话**——只要给 taskDir 就能读写，不带 sessionId/agentId。
   *
   * 为什么按 taskDir 而不是会话：评论绑"检视对象（taskId）"，见 `src/review-comments.ts` 头注
   * （Gerrit 的 Change-Id 范式：代码重写/变基后评论不丢）。
   *
   * 列表统一包 `{ items }`（api 规范 2.1）；错误统一 `{ error: { code, message } }`。
   */
  app.get("/api/review/comments", async (c) => {
    const taskDir = c.req.query("taskDir");
    if (taskDir === undefined || taskDir.trim() === "") {
      const error = problem("invalid_request", "需要 taskDir 查询参数（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const items = await readComments(taskDir);
    log.info("review-comments", "list", "读取评论", { details: { taskDir: basename(taskDir), count: items.length } });
    return c.json({ items });
  });

  /**
   * 写评论：`{ taskDir, op: "add"|"update"|"remove", comment?, id? }`。
   *
   * - `add` / `update` 语义相同（同键覆盖 = 编辑），返回 201 + 落盘后的记录；
   * - `remove` 只需 `id`，幂等（第二次 `removed: false`）；
   * - 字段不合法 → 400（不落盘，避免脏数据进 state 文件）。
   */
  app.post("/api/review/comments", async (c) => {
    const body = await c.req.json().catch(() => undefined) as {
      taskDir?: unknown; op?: unknown; comment?: unknown; id?: unknown;
    } | undefined;
    const taskDir = typeof body?.taskDir === "string" ? body.taskDir.trim() : "";
    if (taskDir === "") {
      const error = problem("invalid_request", "需要 taskDir 字段（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const op = body?.op;
    if (op !== "add" && op !== "update" && op !== "remove" && op !== "clear" && op !== "state"
      && op !== "reply" && op !== "reply-update" && op !== "reply-remove" && op !== "awaiting") {
      const error = problem("invalid_request", "op 必须是 add / update / remove / clear / state / reply / reply-update / reply-remove / awaiting", 400); return c.json(error.body, error.status);
    }

    /**
     * reply / reply-update / reply-remove（S4-h）：线程里的回复。
     * body：`{ taskDir, op:"reply", id, reply:{ author, body } }`
     *       `{ taskDir, op:"reply-update", id, reply:{ id, author, body } }`
     *       `{ taskDir, op:"reply-remove", id, replyId, by }`
     * 权限：回复的**作者本人或用户**能改/删；已关闭的线程不能新增回复（要回复先重开）。
     */
    if (op === "reply" || op === "reply-update" || op === "reply-remove") {
      const id = typeof body?.id === "string" ? body.id : "";
      if (id === "") {
        const error = problem("invalid_request", `${op} 需要 id（评论 id）`, 400); return c.json(error.body, error.status);
      }
      const asActor = (raw: unknown): { kind: "user" | "agent"; id: string } | undefined => {
        if (typeof raw !== "object" || raw === null) return undefined;
        const r = raw as { kind?: unknown; id?: unknown };
        if ((r.kind !== "user" && r.kind !== "agent") || typeof r.id !== "string" || r.id === "") return undefined;
        return { kind: r.kind, id: r.id };
      };
      try {
        if (op === "reply-remove") {
          const replyId = typeof (body as { replyId?: unknown }).replyId === "string" ? String((body as { replyId?: unknown }).replyId) : "";
          if (replyId === "") {
            const error = problem("invalid_request", "reply-remove 需要 replyId", 400); return c.json(error.body, error.status);
          }
          const by = asActor((body as { by?: unknown }).by);
          if (by === undefined) {
            const error = problem("invalid_request", "reply-remove 需要 by { kind, id }", 400); return c.json(error.body, error.status);
          }
          const updated = await removeReply(taskDir, id, replyId, by);
          log.info("review-comments", "reply-remove", "删除回复", { details: { taskDir: basename(taskDir), id, replyId, by: `${by.kind}:${by.id}` } });
          return c.json({ comment: updated });
        }
        const replyRaw = (body as { reply?: unknown }).reply;
        const replyObj = typeof replyRaw === "object" && replyRaw !== null ? replyRaw as { id?: unknown; author?: unknown; body?: unknown } : undefined;
        if (replyObj === undefined || typeof replyObj.body !== "string") {
          const error = problem("invalid_request", `${op} 需要 reply:{ author, body }`, 400); return c.json(error.body, error.status);
        }
        const author = asActor(replyObj.author);
        if (author === undefined) {
          const error = problem("invalid_request", "reply.author 需要 kind=user|agent 与非空 id", 400); return c.json(error.body, error.status);
        }
        if (op === "reply") {
          const updated = await addReply(taskDir, id, { author, body: replyObj.body });
          log.info("review-comments", "reply", "追加回复", { details: { taskDir: basename(taskDir), id, author: `${author.kind}:${author.id}`, replies: updated.replies.length, awaiting: updated.awaiting } });
          return c.json({ comment: updated }, 201);
        }
        const replyId = typeof replyObj.id === "string" ? replyObj.id : "";
        if (replyId === "") {
          const error = problem("invalid_request", "reply-update 需要 reply.id", 400); return c.json(error.body, error.status);
        }
        const updated = await upsertReply(taskDir, id, { id: replyId, author, body: replyObj.body });
        log.info("review-comments", "reply-update", "编辑回复", { details: { taskDir: basename(taskDir), id, replyId } });
        return c.json({ comment: updated });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // “找不到”与“没权限”要分开：404 与 403 语义不同（api 规范 2.3）
        const notFound = problem("comment_not_found", message, 404);
        return /找不到/.test(message) ? c.json(notFound.body, notFound.status) : c.json(problem("forbidden", message, 403).body, 403);
      }
    }

    /**
     * awaiting（S4-h · G1）：“这条现在等谁”的手动设置（交棒）。
     * body：`{ taskDir, id, awaiting: "user"|"agent"|null, by:{kind,id} }`
     */
    if (op === "awaiting") {
      const id = typeof body?.id === "string" ? body.id : "";
      if (id === "") {
        const error = problem("invalid_request", "awaiting 需要 id", 400); return c.json(error.body, error.status);
      }
      const raw = (body as { awaiting?: unknown }).awaiting;
      if (raw !== "user" && raw !== "agent" && raw !== null) {
        const error = problem("invalid_request", "awaiting 必须是 user / agent / null", 400); return c.json(error.body, error.status);
      }
      const byRaw = (body as { by?: unknown }).by;
      const by = typeof byRaw === "object" && byRaw !== null ? byRaw as { kind?: unknown; id?: unknown } : undefined;
      const actor: { kind: "user" | "agent"; id: string } | undefined = by !== undefined && (by.kind === "user" || by.kind === "agent") && typeof by.id === "string" && by.id !== ""
        ? { kind: by.kind, id: by.id }
        : undefined;
      if (actor === undefined) {
        const error = problem("invalid_request", "awaiting 需要 by { kind, id }", 400); return c.json(error.body, error.status);
      }
      const updated = await setCommentAwaiting(taskDir, id, raw, actor);
      if (updated === undefined) {
        const error = problem("comment_not_found", "找不到这条评论", 404); return c.json(error.body, error.status);
      }
      log.info("review-comments", "awaiting", "改等待方", { details: { taskDir: basename(taskDir), id, awaiting: raw, by: `${actor.kind}:${actor.id}` } });
      return c.json({ comment: updated });
    }

    /**
     * state：改评论状态（S4-e · A18/A19）。body 需要 `id`、`state`、`by { kind, id }`。
     * 权限在 `setCommentState` 里校验（只有提出者或用户本人能关闭）——
     * 403 而不是 400：这是"没权限"，不是"参数错"（api 规范 2.3）。
     */
    if (op === "state") {
      const id = typeof body?.id === "string" ? body.id : "";
      const state = (body as { state?: unknown } | undefined)?.state;
      const by = (body as { by?: unknown } | undefined)?.by;
      if (id === "") {
        const error = problem("invalid_request", "state 需要 id（非空字符串）", 400); return c.json(error.body, error.status);
      }
      if (state !== "draft" && state !== "open" && state !== "resolved") {
        const error = problem("invalid_request", "state 必须是 draft / open / resolved", 400); return c.json(error.body, error.status);
      }
      if (typeof by !== "object" || by === null) {
        const error = problem("invalid_request", "state 需要 by { kind, id }（谁在改）", 400); return c.json(error.body, error.status);
      }
      const actor = by as { kind?: unknown; id?: unknown };
      if ((actor.kind !== "user" && actor.kind !== "agent") || typeof actor.id !== "string" || actor.id === "") {
        const error = problem("invalid_request", "by 需要 kind=user|agent 与非空 id", 400); return c.json(error.body, error.status);
      }
      try {
        const updated = await setCommentState(taskDir, id, state, { kind: actor.kind, id: actor.id });
        if (updated === undefined) {
          const error = problem("comment_not_found", "找不到这条评论", 404); return c.json(error.body, error.status);
        }
        log.info("review-comments", "state", "改评论状态", { details: { taskDir: basename(taskDir), id, state, by: `${actor.kind}:${actor.id}` } });
        return c.json({ comment: updated });
      } catch (error) {
        // 权限不足：403 + 原因（不掩盖成 400）
        const message = error instanceof Error ? error.message : String(error);
        const denied = problem("forbidden", message, 403);
        return c.json(denied.body, denied.status);
      }
    }

    // clear：清空该 Task 的全部评论（用户"清空这个 Task 的检视意见"，也是测试隔离需要）
    if (op === "clear") {
      await clearComments(taskDir);
      log.info("review-comments", "clear", "清空评论", { details: { taskDir: basename(taskDir) } });
      return c.json({ cleared: true });
    }

    if (op === "remove") {
      const id = body?.id;
      if (typeof id !== "string" || id === "") {
        const error = problem("invalid_request", "remove 需要 id（非空字符串）", 400); return c.json(error.body, error.status);
      }
      const removed = await removeComment(taskDir, id);
      log.info("review-comments", "remove", "删除评论", { details: { taskDir: basename(taskDir), id, removed } });
      return c.json({ removed });
    }

    // taskId：请求里给了就用（Agent/脚本可能显式指定），否则从 taskDir 目录名推断（`0010-标题` → `0010`）
    const declaredTaskId = typeof (body?.comment as Record<string, unknown> | undefined)?.taskId === "string"
      ? String((body!.comment as Record<string, unknown>).taskId)
      : /^(\d{4})/.exec(basename(taskDir))?.[1] ?? basename(taskDir);
    const input = toCommentInput(body?.comment, declaredTaskId);
    if (input === undefined) {
      const error = problem("invalid_request", "comment 字段不合法（需要 author/anchor{source,path,side,start,end}/body）", 400);
      return c.json(error.body, error.status);
    }
    const saved = await upsertComment(taskDir, input);
    log.info("review-comments", "upsert", "写入评论", {
      details: {
        taskDir: basename(taskDir), id: saved.id, author: `${saved.author.kind}:${saved.author.id}`,
        path: saved.anchor.path, range: `${saved.anchor.start}-${saved.anchor.end}`, state: saved.state,
      },
    });
    return c.json({ comment: saved }, 201);
  });

  /**
   * 检视「已看」进度（G10）：`GET ?taskDir=` → `{ items }`；`POST` → 见下。
   *
   * 为什么存服务端而不是 localStorage（difit 的做法）：换设备/换浏览器仍保留，且 Agent 可读
   * （"哪些文件用户已经看过"是检视状态的合法一部分，与评论同一取舍）。记录带 diff 内容哈希，
   * 文件改了之后前端会显示"变了，需要重看"——不会骗人。
   *
   * POST body：
   *  - `{ taskDir, op:"set", paths:[{ path, hash }], viewed:boolean }` —— 批量标记/取消（勾选目录用它）
   *  - `{ taskDir, op:"clear" }` —— 清空该 Task 的进度
   */
  app.get("/api/review/viewed", async (c) => {
    const taskDir = c.req.query("taskDir");
    if (taskDir === undefined || taskDir.trim() === "") {
      const error = problem("invalid_request", "需要 taskDir 查询参数（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const items = await readViewed(taskDir);
    log.info("review-viewed", "list", "读取已看进度", { details: { taskDir: basename(taskDir), count: items.length } });
    return c.json({ items });
  });

  app.post("/api/review/viewed", async (c) => {
    const body = await c.req.json().catch(() => undefined) as {
      taskDir?: unknown; op?: unknown; paths?: unknown; viewed?: unknown;
    } | undefined;
    const taskDir = typeof body?.taskDir === "string" ? body.taskDir.trim() : "";
    if (taskDir === "") {
      const error = problem("invalid_request", "需要 taskDir 字段（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const taskId = /^(\d{4})/.exec(basename(taskDir))?.[1] ?? basename(taskDir);

    if (body?.op === "clear") {
      await clearViewed(taskDir);
      log.info("review-viewed", "clear", "清空已看进度", { details: { taskDir: basename(taskDir) } });
      return c.json({ cleared: true });
    }
    if (body?.op !== "set") {
      const error = problem("invalid_request", "op 必须是 set / clear", 400); return c.json(error.body, error.status);
    }
    if (!Array.isArray(body.paths) || body.paths.length === 0) {
      const error = problem("invalid_request", "set 需要非空的 paths 数组（每项 { path, hash }）", 400); return c.json(error.body, error.status);
    }
    const entries: Array<{ path: string; hash: string }> = [];
    for (const raw of body.paths) {
      if (typeof raw !== "object" || raw === null) continue;
      const item = raw as { path?: unknown; hash?: unknown };
      if (typeof item.path !== "string" || item.path === "") continue;
      if (typeof item.hash !== "string" || item.hash === "") continue;
      entries.push({ path: item.path, hash: item.hash });
    }
    if (entries.length === 0) {
      const error = problem("invalid_request", "paths 里没有任何合法项（需要 path 与非空 hash）", 400); return c.json(error.body, error.status);
    }
    const viewed = body.viewed !== false;
    const items = entries.length === 1
      ? await setFileViewed(taskDir, taskId, entries[0]!.path, entries[0]!.hash, viewed)
      : await setFilesViewed(taskDir, taskId, entries, viewed);
    log.info("review-viewed", "set", "标记已看", {
      details: { taskDir: basename(taskDir), count: entries.length, viewed, total: items.length },
    });
    return c.json({ items });
  });

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

  // 静态产物（Task 0008）：
  // 1) 缓存分级 —— 带 hash 的 `/assets/*` 永久缓存；`index.html` / `sw.js` 一律回源校验。
  //    这两条算错的后果是**页面永久白屏**，且浏览器不给任何提示（见 src/static.ts 顶部）。
  // 2) 缺失的文件 404，不回退 index.html —— 否则旧 hash 的产物请求会拿回一份 HTML，
  //    浏览器按 module script 加载失败，`#root` 永远空（实测记录在 src/static.ts）。
  const distOptions = {
    root: "./frontend/dist",
    onFound: (path: string, c: Context) => {
      c.header("Cache-Control", cacheControlOf(c.req.path));
    },
  };
  app.use("/*", serveStatic(distOptions));
  // 页面回退只给**看起来不是文件**的路径（前端状态全在 query 里，没有路径路由）。
  app.get("/*", async (c, next) => {
    if (looksLikeFile(c.req.path)) return next();
    c.header("Cache-Control", REVALIDATE_CACHE);
    return serveStatic({ path: "./frontend/dist/index.html" })(c, next);
  });

  return app;
}
