// HTTP 接口：只读 Agent + 会话列表/读取 + 一条按 Agent 的事件流（带快照与序号，可续传）。
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createSession, deleteSession, getSession, messagesOf, renameSession, runTurn, snapshotOf, subscribeAgent } from "./agent-host.ts";
import { resolveHome } from "./home.ts";

export type AgentDefinition = { id: string; name: string; description?: string; defaultProjectId?: string; defaultSessionId?: string };

const agentsRoot = () => join(resolveHome(), "agents");

async function readAgent(id: string): Promise<AgentDefinition | undefined> {
  try { return JSON.parse(await readFile(join(agentsRoot(), id, "agent.json"), "utf8")) as AgentDefinition; }
  catch { return undefined; }
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
        if (title === "" && entry.type === "message" && entry.message?.role === "user") title = textOf(entry.message).slice(0, 40);
      } catch { /* 跳过坏行 */ }
    }
    if (sessionId === "") continue;
    items.push({ sessionId, title: displayName !== "" ? displayName : title, updatedAt: (await stat(path)).mtime.toISOString(), messages: lines.length, isDefault: sessionId === defaultSessionId });
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

  // project 列表：扫描 agents/<id>/*/，**注册判据 = 有 project.json**（与 agents/*/agent.json 判据同构）；
  // 只有任务/日记记录、无 manifest 的目录（如 harness 的 projects/lifeos/）不算用户可见项目。
  app.get("/api/agents/:id/projects", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const root = join(agentsRoot(), agent.id, "projects");
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const defaultId = agent.defaultProjectId ?? "workspace";
    const items: Array<{ id: string; name: string; isDefault: boolean }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = await readFile(join(root, entry.name, "project.json"), "utf8")
        .then((text) => JSON.parse(text) as { name?: unknown }, () => undefined);
      if (manifest === undefined) continue;   // 无 manifest → 未注册为项目
      items.push({ id: entry.name, name: typeof manifest.name === "string" ? manifest.name : entry.name, isDefault: entry.name === defaultId });
    }
    items.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    return c.json({ items });
  });

  app.get("/api/agents/:id/projects/:pid/sessions", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = problem("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const pid = c.req.param("pid");
    if (!await stat(join(agentsRoot(), agent.id, "projects", pid)).then(() => true, () => false)) {
      const error = problem("project_not_found", "找不到这个 project", 404); return c.json(error.body, error.status);
    }
    const running = snapshotOf(agent.id).running;
    const items = (await listSessions(agent.id, pid, agent.defaultSessionId)).map((item) => ({ ...item, running: running.some((run) => run.sessionId === item.sessionId) }));
    return c.json({ items });
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
    return c.json({ sessionId: await createSession(agent.id, cwd) });
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

  app.use("/*", serveStatic({ root: "./frontend/dist" }));
  app.get("/*", serveStatic({ path: "./frontend/dist/index.html" }));

  return app;
}
