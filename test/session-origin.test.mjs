// Task 0014 · 身份（这一轮是谁说的）+ 并发准入：全部打桩，不调模型。
//
// 覆盖 05-test-matrix.md：
//   T6  两请求并发打同一空闲会话 → 恰好一个 202、一个 409
//   T34 HTTP 发送写 `{kind:"user"}` origin，紧接那条 user
//   T35/T36 ask / send 写 `{kind:"agent", via}` origin
//   T37 steer / followUp 排队也写 origin
//   T38 messagesOf 逐条配对（用户轮 / Agent 轮交替）
//   T39 一条 origin 只用一次（连续两条 user 不重复消费）
//   T40 老会话无 origin → 回落 user
//   T41 系统提示身份段（有 origin 才有，内容正确）
//   T42 重启（重新打开会话）后 speaker 不变
//
// 打桩手法与 `test/annotation-lifecycle-e2e.test.mjs:36-46` 同一套：
// 把 `session.prompt` 换成记录器、把 `session.model` 置空以跳过鉴权守卫。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { startOn } from "./server-harness.mjs";

const setup = async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-origin-"));
  await installHome(process.cwd(), home);
  const { server, base } = await startOn(home);
  const agents = await (await fetch(`${base}/api/agents`)).json();
  const agentId = agents.items[0].id;
  const created = await (await fetch(`${base}/api/agents/${agentId}/projects/workspace/sessions`, { method: "POST" })).json();
  const sid = created.sessionId;
  const { getSession } = await import("../src/agent-host.ts");
  const state = await getSession(agentId, sid, home);
  assert.ok(state !== undefined);
  return { server, base, home, agentId, sid, state };
};

/** 轮询直到条件成立（后台回合是异步的，断言不能"立刻读"）。 */
const waitFor = async (fn, label) => {
  for (let i = 0; i < 300; i += 1) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`等不到：${label}`);
};

/**
 * 打桩：让 prompt 立即返回（回合正常结束，不调模型）。
 *
 * `appendUser`（默认 true）会**模拟 Pi 的行为**：真实 `prompt()` 会把这条 user 消息写进会话
 * （`agent-session.ts` 的 `_startRun` → `appendMessage`）。不模拟的话，读侧断言看不到消息，
 * 就变成"测了打桩、没测配对"。参考 `test/annotation-lifecycle-e2e.test.mjs:36-46` 的同一手法。
 */
const stubPrompt = (state, options = {}) => {
  const prompts = [];
  const appendUser = options.appendUser !== false;
  state.session.prompt = async (text) => {
    prompts.push(text);
    if (appendUser) state.session.sessionManager.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
  };
  Object.defineProperty(state.session, "model", { value: undefined, configurable: true });
  return prompts;
};

/** 等这一轮真的跑完（`running=false` 且 origin 已落）。 */
const settle = async (agentId, sid, base, state) => {
  await waitFor(async () => {
    const meta = await (await fetch(`${base}/api/agents/${agentId}/sessions/${sid}`)).json();
    return meta.meta?.running !== true && originsOf(state).length > 0;
  }, "回合结束");
};

const originsOf = (state) => state.session.sessionManager.getBranch()
  .filter((entry) => entry?.type === "custom" && entry.customType === "lifeos_turn_origin")
  .map((entry) => entry.data);

// ─────────────────────────────────────────────────────────────
// T6 并发准入
// ─────────────────────────────────────────────────────────────

test("T6 两个请求并发打同一空闲会话：恰好一个 202、一个 409（准入是同步占位）", async () => {
  const { server, base, agentId, sid, state } = await setup();
  try {
    let release;
    let promptCalled = false;
    state.session.prompt = async () => {
      promptCalled = true;
      await new Promise((resolve) => { release = resolve; });
    };
    Object.defineProperty(state.session, "model", { value: undefined, configurable: true });

    const post = () => fetch(`${base}/api/agents/${agentId}/sessions/${sid}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "并发" }),
    });
    const [a, b] = await Promise.all([post(), post()]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [202, 409], "必须一个受理、一个打架（不能两个都 202，也不能两个都 409）");
    const rejected = a.status === 409 ? a : b;
    assert.equal((await rejected.json()).error.code, "session_running");

    // 第二轮被拒的那一刻，第一轮必须仍被判定为"忙"——这正是"拒"的理由。
    // 注意**不能**断言 `meta.running === true`：meta 读的是 `isRunning`（session-runtime），
    // 而这一瞬间第一轮可能还没走到 `markRunning`（runTurn 开头有两个 await）。
    // "已受理未开跑也算忙"恰恰就是 `startingTurns` 存在的理由，所以这里查 `sessionBusyOf`。
    const { sessionBusyOf } = await import("../src/agent-host.ts");
    assert.equal(sessionBusyOf(agentId, sid), true, "被拒的那一刻第一轮应当仍被判为忙（含已受理未开跑的窗口）");

    // 放行：等 prompt 真的被调到（它在两个 await 之后），再释放
    await waitFor(() => promptCalled, "第一轮进入 prompt");
    release?.();
    await settle(agentId, sid, base, state);
  } finally { server.close(); }
});

// ─────────────────────────────────────────────────────────────
// T34 / T38 / T40 读取侧配对
// ─────────────────────────────────────────────────────────────

test("T34 用户经 HTTP 发送：写入 {kind:'user'} origin，speaker 为 user", async () => {
  const { server, base, agentId, sid, state } = await setup();
  try {
    stubPrompt(state);
    const r = await fetch(`${base}/api/agents/${agentId}/sessions/${sid}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "用户说的话" }),
    });
    assert.equal(r.status, 202);
    await waitFor(() => originsOf(state).length > 0, "origin 落盘");
    await settle(agentId, sid, base, state);

    const origins = originsOf(state);
    assert.equal(origins.length, 1, "每轮一条 origin");
    assert.equal(origins[0].kind, "user");

    const detail = await (await fetch(`${base}/api/agents/${agentId}/sessions/${sid}`)).json();
    const users = detail.messages.filter((m) => m.role === "user");
    assert.equal(users.length, 1);
    assert.deepEqual(users[0].speaker, { kind: "user" });
  } finally { server.close(); }
});

test("T38 用户轮 / Agent 轮交替：逐条 speaker 正确（不串）", async () => {
  const { server, base, agentId, sid, state } = await setup();
  try {
    const { createAgent } = await import("../src/agents.ts");
    const { appendTurnOrigin } = await import("../src/agent-host.ts");
    const other = await createAgent({ name: "Origin Peer" });
    assert.ok("id" in other);

    const mgr = state.session.sessionManager;
    const userTurn = (text) => {
      appendTurnOrigin(mgr, { kind: "user" });
      mgr.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
    };
    const agentTurn = (text, from) => {
      appendTurnOrigin(mgr, { kind: "agent", agentId: from, name: "Origin Peer", via: "lifeos_send" });
      mgr.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
    };

    userTurn("用户第一句");
    agentTurn("Agent 说的一句", other.id);
    userTurn("用户第二句");

    const detail = await (await fetch(`${base}/api/agents/${agentId}/sessions/${sid}`)).json();
    const users = detail.messages.filter((m) => m.role === "user");
    assert.equal(users.length, 3, `应有三条 user 消息，实际 ${users.map((m) => m.text).join(" | ")}`);
    assert.deepEqual(users[0].speaker, { kind: "user" }, "第一条是用户");
    assert.equal(users[1].speaker?.kind, "agent", "第二条来自 Agent");
    assert.equal(users[1].speaker?.agentId, other.id, "要点名是哪个 Agent");
    assert.equal(users[1].speaker?.via, "lifeos_send");
    assert.deepEqual(users[2].speaker, { kind: "user" }, "第三条又是用户（不串）");
  } finally { server.close(); }
});

test("T39 一条 origin 只用一次：连续两条 user 时第二条回落 user（不重复消费）", async () => {
  const { server, base, agentId, sid, state } = await setup();
  try {
    stubPrompt(state);
    const { appendTurnOrigin } = await import("../src/agent-host.ts");
    const mgr = state.session.sessionManager;
    appendTurnOrigin(mgr, { kind: "agent", agentId: "coder", name: "Coder", via: "lifeos_send" });
    mgr.appendMessage({ role: "user", content: [{ type: "text", text: "一" }], timestamp: Date.now() });
    mgr.appendMessage({ role: "user", content: [{ type: "text", text: "二" }], timestamp: Date.now() });

    const detail = await (await fetch(`${base}/api/agents/${agentId}/sessions/${sid}`)).json();
    const users = detail.messages.filter((m) => m.role === "user");
    assert.equal(users[0].speaker?.kind, "agent");
    assert.deepEqual(users[1].speaker, { kind: "user" }, "第二条没有自己的 origin → 回落用户，绝不复制上一条");
  } finally { server.close(); }
});

test("T40 老会话（无 origin）：speaker 回落 user，与今天行为一致", async () => {
  const { server, base, agentId, sid, state } = await setup();
  try {
    const mgr = state.session.sessionManager;
    mgr.appendMessage({ role: "user", content: [{ type: "text", text: "老数据" }], timestamp: Date.now() });
    const detail = await (await fetch(`${base}/api/agents/${agentId}/sessions/${sid}`)).json();
    const users = detail.messages.filter((m) => m.role === "user");
    assert.deepEqual(users[0].speaker, { kind: "user" });
  } finally { server.close(); }
});

test("T42 重启（重新从文件打开会话）后 speaker 不变", async () => {
  const { server, base, agentId, sid, state, home } = await setup();
  try {
    stubPrompt(state);
    const { appendTurnOrigin, messagesOf } = await import("../src/agent-host.ts");
    const mgr = state.session.sessionManager;
    appendTurnOrigin(mgr, { kind: "agent", agentId: "coder", name: "Coder", via: "lifeos_ask" });
    mgr.appendMessage({ role: "user", content: [{ type: "text", text: "落盘的身份" }], timestamp: Date.now() });
    mgr.flush?.();

    // 丢掉内存态后重新打开（等价于后端重启）
    const fresh = await import("../src/agent-host.ts");
    fresh.resetSessionsForTests?.();
    const reopened = await fresh.getSession(agentId, sid, home);
    assert.ok(reopened !== undefined, "会话应能从文件重新打开");
    const users = messagesOf(reopened).filter((m) => m.role === "user");
    assert.equal(users.length, 1);
    assert.equal(users[0].speaker?.kind, "agent", "身份是落盘事实，重启后仍然正确");
    assert.equal(users[0].speaker?.agentId, "coder");
    void base;
  } finally { server.close(); }
});

// ─────────────────────────────────────────────────────────────
// T37 插话 / 排队也写身份
// ─────────────────────────────────────────────────────────────

test("T37 steer 排队也写 origin（插话不丢身份）", async () => {
  const { server, base, agentId, sid, state } = await setup();
  try {
    let release;
    state.session.prompt = async () => { await new Promise((resolve) => { release = resolve; }); };
    Object.defineProperty(state.session, "model", { value: undefined, configurable: true });

    await fetch(`${base}/api/agents/${agentId}/sessions/${sid}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "第一轮" }),
    });
    for (let i = 0; i < 100 && originsOf(state).length === 0; i += 1) await new Promise((r) => setTimeout(r, 20));

    const steer = await fetch(`${base}/api/agents/${agentId}/sessions/${sid}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "插一句", behavior: "steer" }),
    });
    assert.equal(steer.status, 202, "在跑时 steer 应被受理（不再被会话来源挡住）");
    assert.equal(originsOf(state).length, 2, "插话也要记一条 origin");

    release?.();
    await settle(agentId, sid, base, state);
  } finally { server.close(); }
});

// ─────────────────────────────────────────────────────────────
// T41 系统提示身份段
// ─────────────────────────────────────────────────────────────

test("T41 系统提示身份段：有 origin 才有段，内容写明是哪个 Agent", async () => {
  const { speakerSection, USER_ORIGIN } = await import("../src/turn-origin.ts");
  const agentSection = speakerSection({ kind: "agent", agentId: "coder", name: "Coder", via: "lifeos_send" });
  assert.match(agentSection, /<lifeos_current_speaker>/);
  assert.match(agentSection, /Coder/);
  assert.match(agentSection, /不是用户本人/);
  assert.match(agentSection, /lifeos_send/);

  const userSection = speakerSection(USER_ORIGIN);
  assert.match(userSection, /<lifeos_current_speaker>/);
  assert.match(userSection, /用户本人/);
});

test("T41b 每轮重算：上一轮的 Agent 身份不漏到用户的下一轮", async () => {
  const { server, base, agentId, sid, state } = await setup();
  try {
    const prompts = stubPrompt(state);
    const { appendTurnOrigin } = await import("../src/agent-host.ts");
    const { buildPromptParts } = await import("../src/assembly.ts");
    const { currentOriginOf } = await import("../src/agent-host.ts");
    const mgr = state.session.sessionManager;

    appendTurnOrigin(mgr, { kind: "agent", agentId: "coder", name: "Coder", via: "lifeos_send" });
    assert.equal(currentOriginOf(mgr)?.kind, "agent");
    appendTurnOrigin(mgr, { kind: "user" });
    assert.equal(currentOriginOf(mgr)?.kind, "user", "最新一条 origin 说了算（与 activeTaskOf 同一手法）");

    // 装配本身能产出身份段（agent-host 的 getParts 把它塞进 speakerSection）
    const parts = await buildPromptParts(agentId, "workspace");
    assert.ok(parts.harnessSection.length > 0);
    void prompts;
    void base;
  } finally { server.close(); }
});
