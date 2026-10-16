// HTTP 接口：只读 Agent + 会话列表/读取 + 一条按 Agent 的事件流（带快照与序号，可续传）。
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createSession, getSession, messagesOf, runTurn, sessionDir, snapshotOf, subscribeAgent } from "./agent-host.ts";
import { resolveHome } from "./home.ts";

export type AgentDefinition = { id: string; name: string; description?: string };

const agentsRoot = () => join(resolveHome(), "agents");

async function readAgent(id: string): Promise<AgentDefinition | undefined> {
  try { return JSON.parse(await readFile(join(agentsRoot(), id, "agent.json"), "utf8")) as AgentDefinition; }
  catch { return undefined; }
}

function problem(code: string, message: string, status: 400 | 404) {
  return { body: { error: { code, message } }, status } as const;
}

/** 会话列表：读该 Agent 的会话文件（Pi 的 JSONL），取首句作为标题。 */
async function listSessions(agentId: string) {
  const dir = sessionDir(agentId);
  const names = await readdir(dir).catch(() => [] as string[]);
  const items = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    const content = await readFile(path, "utf8");
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    let title = "";
    let sessionId = "";
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { type?: string; id?: string; message?: { role?: string; content?: unknown } };
        if (entry.type === "session" && typeof entry.id === "string") sessionId = entry.id;
        if (title === "" && entry.type === "message" && entry.message?.role === "user") title = textOf(entry.message).slice(0, 40);
      } catch { /* 跳过坏行 */ }
    }
    if (sessionId === "") continue;
    items.push({ sessionId, title, updatedAt: (await stat(path)).mtime.toISOString(), messages: lines.length });
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
    const items = (await listSessions(agent.id)).map((item) => ({ ...item, running: running.some((run) => run.sessionId === item.sessionId) }));
    return c.json({ items });
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
