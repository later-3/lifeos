// 起真实服务（随机端口）测只读接口与错误路径。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { installHome } from "../src/home.ts";
import { createApp } from "../src/server.ts";

async function start() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-test-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  const server = serve({ fetch: createApp(process.cwd()).fetch, port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}`, home };
}

test("GET /api/agents 列出默认 Agent", async () => {
  const { server, base } = await start();
  try {
    const response = await fetch(`${base}/api/agents`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items.map((item) => item.id), ["lifeosagent"]);
  } finally { server.close(); }
});

test("GET /api/agents/:id 返回定义，未知 id 返回 404 错误结构", async () => {
  const { server, base } = await start();
  try {
    const found = await fetch(`${base}/api/agents/lifeosagent`);
    assert.equal(found.status, 200);
    assert.equal((await found.json()).name, "Life Agent");

    const missing = await fetch(`${base}/api/agents/nobody`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "agent_not_found");
  } finally { server.close(); }
});

test("GET /api/agents/:id/sessions 返回会话列表", async () => {
  const { server, base } = await start();
  try {
    const response = await fetch(`${base}/api/agents/lifeosagent/sessions`);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray((await response.json()).items));
  } finally { server.close(); }
});

test("POST messages 校验输入", async () => {
  const { server, base } = await start();
  try {
    const response = await fetch(`${base}/api/agents/lifeosagent/sessions/s1/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "" }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_request");
  } finally { server.close(); }
});

test("出厂默认会话随模板预置：列表首条即它，第一条消息是 Agent 打招呼", async () => {
  const { server, base, home } = await start();
  try {
    const list = await (await fetch(`${base}/api/agents/lifeosagent/sessions`)).json();
    assert.equal(list.items.length, 1, "新装家目录应只有出厂默认会话这一条");
    const sid = list.items[0].sessionId;
    assert.equal(list.items[0].isDefault, true, "出厂会话应带默认标记（agent.json defaultSessionId）");

    // 加载即显示：第一条 = assistant 打招呼（不调模型，直接来自预置文件）
    const { messages } = await (await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}`)).json();
    assert.equal(messages[0].role, "assistant");
    assert.match(messages[0].text, /你好，我是 Life Agent/);

    // 文件事实：预置在 workspace/sessions/ 下，首行是 session 头
    const { readdir, readFile } = await import("node:fs/promises");
    const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
    const file = (await readdir(dir)).find((name) => name.includes(sid));
    assert.ok(file, "预置会话文件应在 workspace/sessions/ 下");
    const header = JSON.parse((await readFile(join(dir, file), "utf8")).split("\n")[0]);
    assert.equal(header.type, "session");
    assert.equal(header.id, sid);
  } finally { server.close(); }
});

test("手动新建的会话是空白的（开场只属于出厂默认会话）", async () => {
  const { server, base } = await start();
  try {
    const created = await fetch(`${base}/api/agents/lifeosagent/sessions`, { method: "POST" });
    assert.equal(created.status, 200);
    const { sessionId } = await created.json();
    const { messages } = await (await fetch(`${base}/api/agents/lifeosagent/sessions/${sessionId}`)).json();
    assert.deepEqual(messages, []);
    const list = await (await fetch(`${base}/api/agents/lifeosagent/sessions`)).json();
    const createdItem = list.items.find((item) => item.sessionId === sessionId);
    assert.notEqual(createdItem?.isDefault, true, "手动新建的会话不应被标为默认");
  } finally { server.close(); }
});

test("三层结构：project 列表返回默认工作区，按 project 列会话，未知 project 404", async () => {
  const { server, base } = await start();
  try {
    const projects = await (await fetch(`${base}/api/agents/lifeosagent/projects`)).json();
    assert.deepEqual(projects.items, [{ id: "workspace", name: "工作区", isDefault: true }]);

    const sessions = await (await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`)).json();
    assert.ok(sessions.items.length >= 1, "默认工作区下应有出厂会话");

    const missing = await fetch(`${base}/api/agents/lifeosagent/projects/nope/sessions`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "project_not_found");
  } finally { server.close(); }
});

test("消息块：thinking / toolCall / toolResult 按 Pi 真实结构返回", async () => {
  const { server, base, home } = await start();
  try {
    const { writeFile } = await import("node:fs/promises");
    const sid = "11111111-2222-4333-8444-555555555555";
    const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
    const entries = [
      { type: "session", version: 3, id: sid, timestamp: "2026-10-17T01:00:00.000Z", cwd: "" },
      { type: "message", id: "m1", parentId: sid, timestamp: "2026-10-17T01:00:00.001Z", message: { role: "user", content: "查一下" } },
      { type: "message", id: "m2", parentId: "m1", timestamp: "2026-10-17T01:00:00.002Z", message: { role: "assistant", content: [
        { type: "thinking", thinking: "先看目录" },
        { type: "toolCall", id: "c1", name: "ls", arguments: { path: "." } } ] } },
      { type: "message", id: "m3", parentId: "m2", timestamp: "2026-10-17T01:00:00.003Z", message: { role: "toolResult", toolCallId: "c1", toolName: "ls", content: [{ type: "text", text: "a.ts" }], isError: false, timestamp: 0 } },
      { type: "message", id: "m4", parentId: "m3", timestamp: "2026-10-17T01:00:00.004Z", message: { role: "assistant", content: [{ type: "text", text: "有一个文件" }] } },
    ];
    await writeFile(join(dir, `2026-10-17T01-00-00-000Z_${sid}.jsonl`), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const { messages } = await (await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}`)).json();
    assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "assistant"]);
    const blocks = messages[1].blocks;
    assert.deepEqual(blocks.map((b) => b.type), ["thinking", "toolCall"]);
    assert.equal(blocks[1].name, "ls");
    assert.equal(blocks[1].result, "a.ts", "toolResult 应挂回对应 toolCall");
    assert.equal(blocks[1].isError, false);
    assert.equal(messages[2].text, "有一个文件");
  } finally { server.close(); }
});

test("重命名会话：列表标题优先 session_info 展示名", async () => {
  const { server, base } = await start();
  try {
    const list = await (await fetch(`${base}/api/agents/lifeosagent/sessions`)).json();
    const sid = list.items[0].sessionId;
    const renamed = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "我的默认会话" }),
    });
    assert.equal(renamed.status, 200);
    const after = await (await fetch(`${base}/api/agents/lifeosagent/sessions`)).json();
    assert.equal(after.items.find((item) => item.sessionId === sid).title, "我的默认会话");
    const bad = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "  " }),
    });
    assert.equal(bad.status, 400);
  } finally { server.close(); }
});

test("删除会话：从列表消失，重复删除 404", async () => {
  const { server, base } = await start();
  try {
    const created = await (await fetch(`${base}/api/agents/lifeosagent/sessions`, { method: "POST" })).json();
    const first = await fetch(`${base}/api/agents/lifeosagent/sessions/${created.sessionId}`, { method: "DELETE" });
    assert.equal(first.status, 200);
    const list = await (await fetch(`${base}/api/agents/lifeosagent/sessions`)).json();
    assert.equal(list.items.some((item) => item.sessionId === created.sessionId), false);
    const again = await fetch(`${base}/api/agents/lifeosagent/sessions/${created.sessionId}`, { method: "DELETE" });
    assert.equal(again.status, 404);
    assert.equal((await again.json()).error.code, "session_not_found");
  } finally { server.close(); }
});
