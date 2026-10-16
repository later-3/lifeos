// HTTP 接口：只读 Agent + 会话/消息/事件流。
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createTurn, getSession, runTurn, subscribe } from "./agent-host.ts";
import { resolveHome } from "./home.ts";

export type AgentDefinition = { id: string; name: string; description?: string };

const agentsRoot = () => join(resolveHome(), "agents");

async function readAgent(id: string): Promise<AgentDefinition | undefined> {
  try {
    return JSON.parse(await readFile(join(agentsRoot(), id, "agent.json"), "utf8")) as AgentDefinition;
  } catch {
    return undefined;
  }
}

function fail(code: string, message: string, status: 400 | 404) {
  return { status, body: { error: { code, message } } } as const;
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
    if (agent === undefined) { const error = fail("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    return c.json(agent);
  });

  app.post("/api/agents/:id/sessions", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = fail("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    return c.json({ sessionId: crypto.randomUUID() });
  });

  app.get("/api/agents/:id/sessions/:sessionId", async (c) => {
    const session = await getSession(c.req.param("id"), c.req.param("sessionId"), cwd);
    const messages = session.messages.flatMap((message) =>
      message.role === "user" || message.role === "assistant" ? [{ role: message.role, text: textOf(message) }] : []);
    return c.json({ sessionId: c.req.param("sessionId"), messages });
  });

  app.post("/api/agents/:id/sessions/:sessionId/messages", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === undefined) { const error = fail("agent_not_found", "找不到这个 Agent", 404); return c.json(error.body, error.status); }
    const body = await c.req.json().catch(() => undefined) as { text?: unknown } | undefined;
    if (body === undefined || typeof body.text !== "string" || body.text.trim() === "") {
      const error = fail("invalid_request", "需要 text 字段（非空字符串）", 400); return c.json(error.body, error.status);
    }
    const session = await getSession(agent.id, c.req.param("sessionId"), cwd);
    const turnId = createTurn();
    void runTurn(turnId, session, body.text);
    return c.json({ turnId });
  });

  app.get("/api/agents/:id/turns/:turnId/events", (c) => {
    const turnId = c.req.param("turnId");
    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        const unsubscribe = subscribe(turnId, (event) => {
          void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
          if (event.type === "done" || event.type === "error") { unsubscribe(); resolve(); }
        });
        if (subscribe.length === 0) resolve();
      });
    });
  });

  return app;
}

function textOf(message: unknown): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => (part as { type?: string; text?: string }).type === "text" ? [part.text ?? ""] : []).join("");
}
