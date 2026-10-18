// HTTP 接口：只读 Agent + 会话列表/读取 + 一条按 Agent 的事件流（带快照与序号，可续传）。
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSession, deleteSession, getSession, messagesOf, pendingSessions, renameSession, runTurn, snapshotOf, subscribeAgent } from "./agent-host.ts";
import { browse, listTree, readContent, readRoots, registerRoot } from "./fs.ts";
import { getShared, readSharedProjects, registerShared } from "./projects.ts";
import { resolveHome } from "./home.ts";

export type AgentDefinition = { id: string; name: string; description?: string; defaultProjectId?: string; defaultSessionId?: string; boundProjectIds?: string[] };

const agentsRoot = () => join(resolveHome(), "agents");

async function readAgent(id: string): Promise<AgentDefinition | undefined> {
  try { return JSON.parse(await readFile(join(agentsRoot(), id, "agent.json"), "utf8")) as AgentDefinition; }
  catch { return undefined; }
}

/** 写回 agent.json（绑定/解绑等注册动作）：原子替换、0600。 */
async function writeAgent(agent: AgentDefinition): Promise<void> {
  const path = join(agentsRoot(), agent.id, "agent.json");
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(agent, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

type ResolvedProject = { id: string; name: string; path?: string };

/** 解析项目（agent.md §5.6 定稿）：workspace=内置私有 manifest；外部=已绑定 + 共用层 manifest（私有目录按需、此处不碰）。 */
async function resolveProject(agent: AgentDefinition, pid: string): Promise<ResolvedProject | undefined> {
  if (pid === "workspace") {
    const manifest = await readFile(join(agentsRoot(), agent.id, "projects", "workspace", "project.json"), "utf8")
      .then((text) => JSON.parse(text) as { name?: unknown }, () => undefined);
    return { id: "workspace", name: typeof manifest?.name === "string" ? manifest.name : "工作区" };
  }
  if (!(agent.boundProjectIds ?? []).includes(pid)) return undefined;
  const shared = await getShared(pid);
  if (shared === undefined) return undefined;
  return { id: shared.id, name: shared.name, path: shared.path };
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

export function createApp(cwd = process.cwd()) {
  const app = new Hono();

  app.get("/api/agents", async (c) => {
    const entries = await readdir(agentsRoot(), { withFileTypes: true }).catch(() => []);
    const items: AgentDefinition[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const agent = await readAgent(entry.name);
      if (agent !== undefined) items.push(agent);
    }
    return c.json({ items });
  });

  app.get("/api/agents/:id", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
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
    const items: Array<{ id: string; name: string; isDefault: boolean; path?: string }> = [];
    const workspace = await resolveProject(agent, "workspace");
    if (workspace !== undefined) items.push({ id: "workspace", name: workspace.name, isDefault: defaultId === "workspace" });
    const shared = await readSharedProjects();
    for (const pid of agent.boundProjectIds ?? []) {
      if (pid === "workspace") continue;
      const project = shared.get(pid);
      if (project === undefined) continue;
      items.push({ id: pid, name: project.name, path: project.path, isDefault: pid === defaultId });
    }
    items.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
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

  // 注册外部项目 + 绑定（合成一步，2026-10-18 拍板）：同 path 幂等复用 pid=uuidv7；只写家目录共用层与 agent.json。
  app.post("/api/agents/:id/projects", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const body = await c.req.json().catch(() => undefined) as { path?: unknown } | undefined;
    if (body === undefined || typeof body.path !== "string" || body.path.trim() === "") {
      const error = problem("invalid_request", "需要 path 字段（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const registered = await registerShared(body.path);
    if ("code" in registered) return fsError(c, registered);
    const defaultId = agent.defaultProjectId ?? "workspace";
    const project = { id: registered.project.id, name: registered.project.name, path: registered.project.path, isDefault: registered.project.id === defaultId };
    const bound = agent.boundProjectIds ?? [];
    if (bound.includes(project.id)) return c.json({ project }, 200);
    await writeAgent({ ...agent, boundProjectIds: [...bound, project.id] });
    return c.json({ project }, 201);
  });

  // 解绑（2026-10-18 拍板 A）：仅移出 boundProjectIds；项目注册与会话/记录全部保留；内置 workspace 不可解绑。
  app.delete("/api/agents/:id/projects/:pid", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const pid = c.req.param("pid");
    const defaultId = agent.defaultProjectId ?? "workspace";
    if (pid === "workspace" || pid === defaultId) {
      const error = problem("cannot_unbind_default", "默认项目不可解绑", 400); return c.json(error.body, error.status);
    }
    const bound = agent.boundProjectIds ?? [];
    if (!bound.includes(pid)) {
      const error = problem("project_not_bound", "该 Agent 未绑定这个项目", 404); return c.json(error.body, error.status);
    }
    await writeAgent({ ...agent, boundProjectIds: bound.filter((item) => item !== pid) });
    return c.json({ unbound: pid });
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
    if (await getSession(agent.id, sessionId, cwd) === undefined) {
      const error = problem("session_not_found", "找不到这个会话", 404); return c.json(error.body, error.status);
    }
    await renameSession(agent.id, sessionId, body.name.trim().slice(0, 80), cwd);
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
    const state = await getSession(c.req.param("id"), c.req.param("sessionId"), cwd);
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
    if (await getSession(agent.id, sessionId, cwd) === undefined) {
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
