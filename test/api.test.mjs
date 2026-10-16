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
