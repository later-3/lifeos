// HTTP 接口：只读 Agent + 会话列表/读取 + 一条按 Agent 的事件流（带快照与序号，可续传）。
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createSession, deleteSession, getSession, messagesOf, pendingSessions, projectIdOfSession, readSessionEntries, renameSession, runTurn, sessionCwd, snapshotOf, subscribeAgent } from "./agent-host.ts";
import { browse, listTree, readContent, readRoots, registerRoot } from "./fs.ts";
import { readProjectManifest, readProjectManifests, registerProject } from "./projects.ts";
import { archiveAgent, createAgent } from "./agents.ts";
import { resolveHome } from "./home.ts";

// 项目相关字段只剩 hiddenProjectIds（"从列表移除"的 UI 状态，可逆）。
// boundProjectIds 是旧设计的死字段（写而不读），已删；旧文件里的同名键在写回时被剥掉。
export type AgentDefinition = { id: string; name: string; description?: string; defaultProjectId?: string; defaultSessionId?: string; hiddenProjectIds?: string[]; archivedAt?: string };

const agentsRoot = () => join(resolveHome(), "agents");

async function readAgent(id: string): Promise<AgentDefinition | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(agentsRoot(), id, "agent.json"), "utf8")) as AgentDefinition & { boundProjectIds?: unknown };
    // 旧设计的死字段：读到就顺手清掉（一次性、幂等），别让它继续躺在用户文件里
    if ("boundProjectIds" in parsed) {
      const { boundProjectIds: _legacy, ...clean } = parsed;
      void writeAgent(clean);
      return clean;
    }
    return parsed;
  } catch { return undefined; }
}

/** 写回 agent.json（改名/项目列表变更等）：原子替换、0600；顺手剥掉旧设计的残留字段。 */
async function writeAgent(agent: AgentDefinition): Promise<void> {
  const { boundProjectIds: _legacy, ...clean } = agent as AgentDefinition & { boundProjectIds?: unknown };
  const path = join(agentsRoot(), agent.id, "agent.json");
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(clean, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

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
 * 项目目录：`<home>/agents/<agent>/projects/<pid>/`（协议 §15.1「结构即事实」）。
 * 每个 Agent 同构：目录在就是项目，显示名 = 目录名（用户 2026-10-18 定：workspace 就显示 workspace，
 * 不用「工作区」这类展示名）；外部项目显示其真实目录名（basename of path）。
 */
const agentProjectsRoot = (agentId: string) => join(agentsRoot(), agentId, "projects");

/** 扫描某 Agent 的项目目录（只看目录，文件忽略；排序稳定）。 */
async function scanProjectDirs(agentId: string): Promise<string[]> {
  const entries = await readdir(agentProjectsRoot(agentId), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
}

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
const agentConfigPath = (id: string) => join(agentsRoot(), id, "projects", "workspace", "config.json");

/** 原子写文本文件（tmp + rename）。 */
async function writeTextAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

/** 头像魔数嗅探：png / jpeg / webp。 */
function sniffImage(buffer: Buffer): { ext: string; mime: string } | undefined {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  return undefined;
}

function problem(code: string, message: string, status: 400 | 404 | 409) {
  return { body: { error: { code, message } }, status } as const;
}

/** 某 project 的会话目录：结构即事实（`agents/<id>/projects/<pid>/sessions/`，协议 §15.1）。 */
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
    const running = snapshotOf(agent.id).running;
    const items = (await listSessions(agent.id, agent.defaultProjectId ?? "workspace", agent.defaultSessionId)).map((item) => ({ ...item, running: running.some((run) => run.sessionId === item.sessionId) }));
    return c.json({ items });
  });

  // project 列表 = 内置 workspace + boundProjectIds 解析（§5.6 定稿：绑定清单才是权威；
  // 扫描即枚举、不建 registry；harness 记录目录不在绑定清单中 → 天然不出现）。
  app.get("/api/agents/:id/projects", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const defaultId = agent.defaultProjectId ?? "workspace";
    const manifests = await readProjectManifests(agent.id);
    const hidden = new Set(agent.hiddenProjectIds ?? []);
    const items: Array<{ id: string; name: string; isDefault: boolean; path?: string }> = [];

    // 列表 = projects/ 下的目录 − 已移除项（用户 2026-10-18 定：有多少个目录就多少行；外部项目名称=真实目录名）
    for (const dir of await scanProjectDirs(agent.id)) {
      if (hidden.has(dir)) continue;
      const manifest = manifests.get(dir);
      const name = dir === "workspace" ? "workspace" : manifest !== undefined ? basename(manifest.path) || dir : dir;
      const path = dir === "workspace" ? undefined : manifest?.path ?? join(agentProjectsRoot(agent.id), dir);
      items.push({ id: dir, name, isDefault: dir === defaultId, ...(path !== undefined ? { path } : {}) });
    }
    items.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
    return c.json({ items });
  });

  app.get("/api/agents/:id/projects/:pid/sessions", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const pid = c.req.param("pid");
    if (await resolveProject(agent, pid) === undefined) {
      const error = problem("project_not_found", "找不到这个 project（未注册或未绑定）", 404); return c.json(error.body, error.status);
    }
    const running = snapshotOf(agent.id).running;
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
    const registered = await registerProject(agent.id, body.path);
    if ("code" in registered) return fsError(c, registered);
    const defaultId = agent.defaultProjectId ?? "workspace";
    const project = { id: registered.project.id, name: registered.project.name, path: registered.project.path, isDefault: registered.project.id === defaultId };
    // 之前"从列表移除"过的，再打开同一路径 = 重新出现（摘掉 hidden 标记）
    const hidden = (agent.hiddenProjectIds ?? []).filter((item) => item !== project.id);
    if (hidden.length !== (agent.hiddenProjectIds ?? []).length) await writeAgent({ ...agent, hiddenProjectIds: hidden });
    return c.json({ project }, registered.created ? 201 : 200);
  });

  // 「从列表移除」（2026-10-18 拍板 A）：写 hiddenProjectIds；目录、manifest、会话/记录全部保留；内置 workspace 不可移除。
  app.delete("/api/agents/:id/projects/:pid", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const pid = c.req.param("pid");
    const defaultId = agent.defaultProjectId ?? "workspace";
    if (pid === "workspace" || pid === defaultId) {
      const error = problem("cannot_unbind_default", "默认项目不可解绑", 400); return c.json(error.body, error.status);
    }
    // 「移除」= 从该助手的列表移除（写 hiddenProjectIds），目录与会话文件原样保留（协议：结构即事实）。
    // 重新注册同一路径（POST /projects）会把 pid 从 hidden 里摘掉，列表里再次出现。
    const hidden = agent.hiddenProjectIds ?? [];
    if (hidden.includes(pid)) {
      const error = problem("project_not_found", "该 Agent 下没有这个项目", 404); return c.json(error.body, error.status);
    }
    const dirExists = (await scanProjectDirs(agent.id)).includes(pid);
    if (!dirExists) {
      const error = problem("project_not_found", "该 Agent 下没有这个项目", 404); return c.json(error.body, error.status);
    }
    await writeAgent({ ...agent, hiddenProjectIds: hidden.includes(pid) ? hidden : [...hidden, pid] });
    return c.json({ hidden: pid });
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
    return c.json({ sessionId: c.req.param("sessionId"), messages: messagesOf(state) });
  });

  app.post("/api/agents/:id/sessions/:sessionId/messages", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const body = await c.req.json().catch(() => undefined) as { text?: unknown } | undefined;
    if (body === undefined || typeof body.text !== "string" || body.text.trim() === "") {
      const error = problem("invalid_request", "需要 text 字段（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const sessionId = c.req.param("sessionId");
    if (await getSession(agent.id, sessionId, await cwdOfSession(agent, sessionId)) === undefined) {
      const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status);
    }
    void runTurn(agent.id, sessionId, body.text);
    return c.json({ accepted: true }, 202);
  });

  // 一条流承载该 Agent 的所有会话：先快照，再按序号推事件（since 可续传）。
  app.get("/api/agents/:id/events", (c) => {
    const agentId = c.req.param("id");
    const since = Number(c.req.query("since") ?? "0") || 0;
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify(snapshotOf(agentId)) });
      await new Promise<void>((resolve) => {
        const unsubscribe = subscribeAgent(agentId, since, (event) => { void stream.writeSSE({ event: event.type, data: JSON.stringify(event) }); });
        c.req.raw.signal.addEventListener("abort", () => { unsubscribe(); void stream.close(); resolve(); });
      });
    });
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
    const providers = await readFile(join(resolveHome(), "config", "models.json"), "utf8")
      .then((text) => (JSON.parse(text) as { providers?: Record<string, unknown> }).providers ?? {}, () => ({}));
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
    return c.json({ config });
  });
  app.put("/api/agents/:id/config", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const body = await c.req.json().catch(() => undefined) as { defaultProvider?: unknown; defaultModel?: unknown; defaultThinkingLevel?: unknown } | undefined;
    if (body === undefined || typeof body.defaultProvider !== "string" || body.defaultProvider.trim() === "" ||
        typeof body.defaultModel !== "string" || body.defaultModel.trim() === "") {
      const error = problem("invalid_request", "需要 defaultProvider 与 defaultModel（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const config = {
      schemaVersion: 1,
      defaultProvider: body.defaultProvider.trim(),
      defaultModel: body.defaultModel.trim(),
      ...(typeof body.defaultThinkingLevel === "string" && body.defaultThinkingLevel !== "" ? { defaultThinkingLevel: body.defaultThinkingLevel } : {}),
    };
    await mkdir(join(agentsRoot(), agent.id, "workspace"), { recursive: true });
    await writeTextAtomic(agentConfigPath(agent.id), JSON.stringify(config, null, 2) + "\n");
    return c.json({ config });
  });

  // —— 文件浏览器（docs/design/file-browser.md P1）：根白名单；browse 仅选择器专用（只列目录）。 ——
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
