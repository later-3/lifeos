// Task 0014 · D13：定位工具 `session-trace` 的契约（不打模型）。
//
// 守护点：它能回答"六层"里的关键问题——会话来源、逐轮发起方与终态、**被拒的请求**（不进会话文件）、
// 当前运行态、以及"第一处不一致"。这些正是 2026-11-07 现场花了十几轮工具调用才拼出来的东西。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { installHome } from "../src/home.ts";

const run = promisify(execFile);

const AGENT = "lifeosagent";
const SID = "0199aaaa-0000-7000-8000-00000000tr01";

/** 造一个会话文件：1 轮 agent 发起 + 1 轮用户发起，第一轮失败。 */
async function setup() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-trace-"));
  await installHome(process.cwd(), home);
  const dir = join(home, "agents", AGENT, "projects", "workspace", "sessions");
  await mkdir(dir, { recursive: true });
  const rows = [
    { type: "session", version: 3, id: SID, timestamp: "2026-11-07T05:00:00.000Z", cwd: home },
    { type: "session_info", id: "i1", parentId: null, timestamp: "2026-11-07T05:00:00.000Z", name: "与 Coder 的对话" },
    { type: "custom", customType: "lifeos_peer", data: { peerAgentId: "coder", targetAgentId: AGENT, projectId: "workspace", initiatorTaskId: "0009" }, id: "p1", parentId: null, timestamp: "2026-11-07T05:00:01.000Z" },
    // 第 1 轮：coder 发起 → 失败
    { type: "custom", customType: "lifeos_turn_origin", data: { kind: "agent", agentId: "coder", name: "Coder", via: "lifeos_send" }, id: "o1", parentId: null, timestamp: "2026-11-07T05:00:02.000Z" },
    { type: "message", id: "u1", parentId: "o1", timestamp: "2026-11-07T05:00:03.000Z", message: { role: "user", content: [{ type: "text", text: "来自 coder" }], timestamp: 1 } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-11-07T05:00:10.000Z", message: {
      role: "assistant", content: [], api: "openai-completions", provider: "x", model: "m",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "error", errorMessage: "503: workspace_billing_scope_unavailable", durationMs: 7000 } },
    // 第 2 轮：用户发起 → 正常
    { type: "custom", customType: "lifeos_turn_origin", data: { kind: "user" }, id: "o2", parentId: "a1", timestamp: "2026-11-07T06:00:00.000Z" },
    { type: "message", id: "u2", parentId: "o2", timestamp: "2026-11-07T06:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "我接着催" }], timestamp: 2 } },
    { type: "message", id: "a2", parentId: "u2", timestamp: "2026-11-07T06:00:05.000Z", message: {
      role: "assistant", content: [{ type: "text", text: "好" }], api: "openai-completions", provider: "x", model: "m",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", durationMs: 4000 } },
  ];
  await writeFile(join(dir, `2026-11-07T05-00-00-000Z_${SID}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  // 日志：一条被拒请求（409）——**它不在会话文件里**，工具必须能从日志读出来
  await mkdir(join(home, "logs"), { recursive: true });
  await writeFile(join(home, "logs", "backend-2026-11-07.jsonl"), [
    JSON.stringify({ ts: "2026-11-07T06:10:00.000Z", level: "info", module: "http", msg: "request",
      details: { method: "POST", path: `/api/agents/${AGENT}/sessions/${SID}/messages`, status: 409, code: "session_running", millis: 2 } }),
  ].join("\n") + "\n");
  return { home };
}

const trace = async (home, extra = []) => {
  const { stdout } = await run("node", [join(process.cwd(), "scripts/session-trace.mjs"),
    "--agent", AGENT, "--session", SID, "--base", "http://127.0.0.1:1", ...extra],
  { env: { ...process.env, LIFEOS_HOME: home } }).catch((error) => ({ stdout: error.stdout ?? "" }));
  return stdout;
};

test("会话来源：从 lifeos_peer 读出「和谁在对话、发起方 Task」", async () => {
  const { home } = await setup();
  const text = await trace(home);
  assert.match(text, /agent:coder/, "要点名对端");
  assert.match(text, /发起方 Task 0009/);
  assert.match(text, /与 Coder 的对话/, "标题");
});

test("逐轮时间线：每轮各自的发起方与终态（Agent 轮失败 / 用户轮成功）", async () => {
  const { home } = await setup();
  const text = await trace(home);
  const lines = text.split("\n").filter((line) => /^\s+\d+\s+\d\d-\d\d/.test(line));
  assert.equal(lines.length, 2, `应有两轮，实际：\n${lines.join("\n")}`);
  assert.match(lines[0], /Coder（lifeos_send）/, "第一轮由 coder 发起");
  assert.match(lines[0], /error/, "第一轮失败");
  assert.match(lines[0], /billing_scope_unavailable/, "要带失败原文");
  assert.match(lines[1], /用户/, "第二轮是用户");
  assert.match(lines[1], /done/, "第二轮正常");
});

test("被拒的请求：从日志读出来（它们不在会话文件里）", async () => {
  const { home } = await setup();
  const text = await trace(home);
  assert.match(text, /被拒的请求（1 条/);
  assert.match(text, /409 session_running/);
});

test("第一处不一致：最后一轮失败要明确说出来", async () => {
  const { home } = await setup();
  const text = await trace(home);
  assert.match(text, /发现不一致/, "有失败轮就要点出来");
  assert.match(text, /最后一轮失败|会话文件/, "");
});

test("老会话（无 origin）：标 (推断)，不当成事实", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-trace-old-"));
  await installHome(process.cwd(), home);
  const dir = join(home, "agents", AGENT, "projects", "workspace", "sessions");
  await mkdir(dir, { recursive: true });
  const rows = [
    { type: "session", version: 3, id: SID, timestamp: "2026-11-01T05:00:00.000Z", cwd: home },
    { type: "message", id: "u1", parentId: null, timestamp: "2026-11-01T05:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "老数据" }], timestamp: 1 } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-11-01T05:00:02.000Z", message: {
      role: "assistant", content: [{ type: "text", text: "嗯" }], api: "x", provider: "x", model: "m",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop" } },
  ];
  await writeFile(join(dir, `2026-11-01T05-00-00-000Z_${SID}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const text = await trace(home);
  assert.match(text, /用户\(推断\)/, "没有 origin 要标推断，不冒充事实");
  assert.match(text, /所有轮都没有 lifeos_turn_origin/);
});

test("--json：机器可读（问题清单在 problems 里）", async () => {
  const { home } = await setup();
  const text = await trace(home, ["--json"]);
  const json = JSON.parse(text.slice(text.indexOf("{")));
  assert.equal(json.sessionId, SID);
  assert.equal(json.peer.peerAgentId, "coder");
  assert.equal(json.turns.length, 2);
  assert.equal(json.rejected.length, 1);
  assert.ok(Array.isArray(json.problems) && json.problems.length > 0, "problems 要能给出结论");
});

test("会话不存在：明确报错，不静默返回空", async () => {
  const { home } = await setup();
  const result = await run("node", [join(process.cwd(), "scripts/session-trace.mjs"),
    "--agent", AGENT, "--session", "no-such-session", "--base", "http://127.0.0.1:1"],
  { env: { ...process.env, LIFEOS_HOME: home } }).catch((error) => error);
  assert.equal(result.code, 2, "找不到要退出码 2");
  assert.match(String(result.stderr), /找不到会话/);
});
