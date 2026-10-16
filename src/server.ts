// HTTP 接口：只读 Agent + 会话/消息/事件流。id 全部来自我们定义的 Agent id 与 Pi 生成的会话 id。
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createSession, getSession, messagesOf, runTurn, subscribeSession } from "./agent-host.ts";
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
    return c.json({ accepted: true });
  });

  app.get("/api/agents/:id/sessions/:sessionId/events", (c) => {
    const agentId = c.req.param("id");
    const sessionId = c.req.param("sessionId");
    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        const unsubscribe = subscribeSession(agentId, sessionId, (event) => {
          void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
          if (event.type !== "delta") { unsubscribe(); void stream.close(); resolve(); }
        });
      });
    });
  });

  // 前端静态产物（pnpm build 之后存在）；API 路由优先。
  app.use("/*", serveStatic({ root: "./frontend/dist" }));
  app.get("/*", serveStatic({ path: "./frontend/dist/index.html" }));

  return app;
}
