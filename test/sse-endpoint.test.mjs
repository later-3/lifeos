// T43–T46：全局事件流真实端点契约（任务 0007 P3）——快照优先、回合级广播、细节级焦点路由、未知连接 404。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { publish } from "../src/events.ts";
import { startOn } from "./server-harness.mjs";

async function readUntil(reader, predicate, timeoutMs = 2000) {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !predicate(buffer)) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve(undefined), Math.max(1, deadline - Date.now()))),
    ]);
    if (chunk === undefined || chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
  }
  return buffer;
}

function firstSnapshot(buffer) {
  const match = buffer.match(/event: snapshot\ndata: (.+)\n/);
  assert.ok(match, "连接必须先发 snapshot");
  return JSON.parse(match[1]);
}

test("T43–T46 全局流：快照优先、回合级跨 Agent 送达、细节级只给焦点、未知连接 404", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-events-http-"));
  await installHome(process.cwd(), home);
  const { server, base } = await startOn(home);
  const response = await fetch(`${base}/api/events`);
  const reader = response.body.getReader();
  try {
    const head = await readUntil(reader, (b) => b.includes("event: snapshot") && b.includes("\n\n"));
    const snapshot = firstSnapshot(head);
    assert.equal(typeof snapshot.connectionId, "string", "快照带 connectionId（焦点上报要用）");
    assert.equal(typeof snapshot.seq, "number");
    assert.ok(Array.isArray(snapshot.running), "快照带跨 Agent 运行列表");
    assert.ok(Array.isArray(snapshot.unread), "快照带服务端未读");

    // T44：焦点在 A 的 s-a；B 的回合级事件要到达；B 的细节事件不得到达
    const focus = await fetch(`${base}/api/events/focus`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: snapshot.connectionId, agentId: "lifeosagent", sessionId: "s-a", visible: true }),
    });
    assert.equal(focus.status, 200);
    publish("pi-agent", { sessionId: "s-b", type: "turn", turnId: "tb1", state: "done" });
    publish("pi-agent", { sessionId: "s-b", type: "text_delta_probe", text: "SHOULD-NOT-ARRIVE" });
    const seenB = await readUntil(reader, (b) => b.includes("tb1"));
    assert.match(seenB, /"agentId":"pi-agent"/, "回合级事件带 agentId 送达");
    assert.doesNotMatch(seenB, /SHOULD-NOT-ARRIVE/, "非焦点的细节事件不得送达");

    // T45：焦点切到 B 的 s-b 后，同一条连接立即收到它的细节事件
    await fetch(`${base}/api/events/focus`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: snapshot.connectionId, agentId: "pi-agent", sessionId: "s-b", visible: true }),
    });
    publish("pi-agent", { sessionId: "s-b", type: "delta", index: 0, text: "FOCUS-OK" });
    const seenFocus = await readUntil(reader, (b) => b.includes("FOCUS-OK"));
    assert.match(seenFocus, /FOCUS-OK/, "焦点切换后细节流生效");

    // T46：未知连接 → 404（前端据此重连，拿新快照）
    const unknown = await fetch(`${base}/api/events/focus`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: "no-such-connection", visible: true }),
    });
    assert.equal(unknown.status, 404);
  } finally {
    await reader.cancel();
    server.close();
  }
});

// T66：快照里的未读带 projectId（状态映射的项目层靠它；任务 0008）
import { sessionViewsOf } from "../src/session-views.ts";
test("T66 全局快照的未读条目带 projectId（否则项目层与数量无法聚合）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-events-proj-"));
  await installHome(process.cwd(), home);
  const { server, base } = await startOn(home);
  // 用真实创建的会话（孤儿清理会删掉不存在的会话，这一点本身也要保证：真实会话不被误清）
  const created = await (await fetch(`${base}/api/agents/lifeosagent/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
  const probe = created.sessionId;
  sessionViewsOf().markCompleted("lifeosagent", probe, new Date().toISOString(), "proj-x");   // 快照在连接时生成，先写
  const reader = (await fetch(`${base}/api/events`)).body.getReader();
  try {
    const head = await readUntil(reader, (b) => b.includes(probe));
    const snapshot = firstSnapshot(head);
    const entry = snapshot.unread.find((u) => u.sessionId === probe);
    assert.ok(entry, "未读快照包含该会话");
    assert.equal(entry.projectId, "proj-x");
  } finally {
    await reader.cancel();
    server.close();
  }
});
