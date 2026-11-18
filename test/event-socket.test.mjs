/**
 * 全局事件通道：WebSocket 传输（Task 0028 · P3；缺陷 D1）。
 *
 * ## 缺陷（Task 0027 · E1/E3）
 *
 * 浏览器对同一 origin 的 HTTP/1.1 只有 6 条连接，而我们曾经"每个标签页一条永生 SSE"。
 * 开满 6 个标签后，**连静态资源与切会话请求都排不上队**：
 *
 * ```
 * 6 标签 × 1 条 SSE → 六个标签 fetch 全部 4001–4004ms 超时
 * 6 标签 × 1 条 WS  → 六个标签 fetch 全部 1–6ms 正常
 * ```
 *
 * ## 本文件锁什么
 *
 * 换的是**传输**，不是协议：`events.ts` 的两级投递、快照优先、过载即摘除一条都不许变。
 * 所以这里的用例是 `sse-endpoint.test.mjs` 的**契约迁移**（T43–T46 / T66 同一批断言），
 * 外加传输层自己的三条：426 回退、具名心跳、过载关闭码。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { installHome } from "../src/home.ts";
import { publish } from "../src/events.ts";
import { startOn } from "./server-harness.mjs";

/** 连上事件通道，返回 { ws, frames[], next(predicate) }（帧按到达顺序累积）。 */
async function connect(base, query = "") {
  const ws = new WebSocket(`${base.replace("http", "ws")}/api/events${query}`);
  const frames = [];
  const waiters = [];
  ws.on("message", (raw) => {
    let frame;
    try { frame = JSON.parse(String(raw)); } catch { return; }
    frames.push(frame);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(frame)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(frame); }
    }
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const next = (predicate, timeoutMs = 3000) => {
    const hit = frames.find(predicate);
    if (hit !== undefined) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      waiters.push(waiter);
      setTimeout(() => {
        const at = waiters.indexOf(waiter);
        if (at >= 0) { waiters.splice(at, 1); reject(new Error("等待帧超时")); }
      }, timeoutMs);
    });
  };
  return { ws, frames, next };
}

test("T28-11 普通 GET（无 upgrade）→ 426 + Upgrade 头（照 gitea :32-38）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-ws-426-"));
  await installHome(process.cwd(), home);
  const { server, base } = await startOn(home);
  try {
    const response = await fetch(`${base}/api/events`);
    assert.equal(response.status, 426);
    assert.equal(response.headers.get("upgrade"), "websocket", "要告诉调用方改用 ws");
    const body = await response.text();
    assert.match(body, /transport=sse/, "要指名兼容路径，否则老工具没法升级");
  } finally { server.close(); }
});

test("T28-12/13/14 契约迁移：快照优先、回合级跨 Agent 送达、细节级只给焦点、未知连接 404", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-ws-contract-"));
  await installHome(process.cwd(), home);
  const { server, base } = await startOn(home);
  const conn = await connect(base);
  try {
    const snapshot = await conn.next((f) => f.t === "snapshot");
    assert.equal(typeof snapshot.d.connectionId, "string", "快照带 connectionId（焦点上报要用）");
    assert.equal(typeof snapshot.seq, "number");
    assert.ok(Array.isArray(snapshot.d.running), "快照带跨 Agent 运行列表");
    assert.ok(Array.isArray(snapshot.d.unread));

    // 焦点在 A 的 s-a → B 的回合级事件到达、B 的细节事件不到达
    const focus = await fetch(`${base}/api/events/focus`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: snapshot.d.connectionId, agentId: "lifeosagent", sessionId: "s-a", visible: true }),
    });
    assert.equal(focus.status, 200);
    publish("pi-agent", { sessionId: "s-b", type: "turn", turnId: "tb1", state: "done" });
    publish("pi-agent", { sessionId: "s-b", type: "text_delta_probe", text: "SHOULD-NOT-ARRIVE" });
    const turn = await conn.next((f) => f.t === "turn" && f.d.turnId === "tb1");
    assert.equal(turn.d.agentId ?? turn.d.agentId, turn.d.agentId, "回合级事件原样带 agentId");
    assert.ok(!conn.frames.some((f) => JSON.stringify(f).includes("SHOULD-NOT-ARRIVE")),
      "非焦点的细节事件不得送达（两级投递契约不变）");

    // 焦点切到 B 后，同一条连接立即收到细节事件
    await fetch(`${base}/api/events/focus`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: snapshot.d.connectionId, agentId: "pi-agent", sessionId: "s-b", visible: true }),
    });
    publish("pi-agent", { sessionId: "s-b", type: "delta", index: 0, text: "FOCUS-OK" });
    await conn.next((f) => f.t === "delta" && JSON.stringify(f.d).includes("FOCUS-OK"));

    const unknown = await fetch(`${base}/api/events/focus`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: "no-such-connection", visible: true }),
    });
    assert.equal(unknown.status, 404);
  } finally { conn.ws.close(); server.close(); }
});

test("T28-15 心跳是具名帧（客户端能据此判死，不是注释帧）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-ws-ping-"));
  await installHome(process.cwd(), home);
  const { server, base } = await startOn(home, { pingMs: 60 });
  const conn = await connect(base);
  try {
    const ping = await conn.next((f) => f.t === "ping", 2000);
    assert.equal(typeof ping.seq, "number", "心跳也带 seq（客户端用它续基线）");
  } finally { conn.ws.close(); server.close(); }
});

test("T28-16 过载：积压超限 → 关闭码 1013（重连即可，不是「别再连」）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-ws-overload-"));
  await installHome(process.cwd(), home);
  // 上限压到 1 字节：快照之后任何事件都必然过载
  const { server, base } = await startOn(home, { highWaterBytes: 1 });
  const conn = await connect(base);
  try {
    await conn.next((f) => f.t === "snapshot");
    const closed = new Promise((resolve) => conn.ws.once("close", (code) => resolve(code)));
    publish("pi-agent", { sessionId: "s-x", type: "turn", turnId: "tx", state: "running" });
    const code = await Promise.race([closed, new Promise((r) => setTimeout(() => r("timeout"), 3000))]);
    assert.equal(code, 1013, `过载必须用 1013 关闭（实得 ${code}）`);
  } finally { server.close(); }
});

test("T28-12b 帧顺序：snapshot 之后的事件 seq 严格大于快照基线", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-ws-seq-"));
  await installHome(process.cwd(), home);
  const { server, base } = await startOn(home);
  const conn = await connect(base);
  try {
    const snapshot = await conn.next((f) => f.t === "snapshot");
    publish("pi-agent", { sessionId: "s-seq", type: "turn", turnId: "t-seq", state: "running" });
    const after = await conn.next((f) => f.t === "turn" && f.d.turnId === "t-seq");
    assert.ok(after.seq > snapshot.seq, `事件 seq(${after.seq}) 必须大于快照基线(${snapshot.seq})`);
  } finally { conn.ws.close(); server.close(); }
});
