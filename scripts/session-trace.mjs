#!/usr/bin/env node
/**
 * 单条会话的**交互时间线**核对工具（Task 0014 · D13「能做工具就做工具」）。
 *
 * ## 为什么有这个工具
 *
 * 2026-11-07 的现场：用户报"这条会话发不出消息、界面也不说为什么"。
 * 真因藏在**六层**里，人工拼装了十几轮工具调用才拼出来：
 *
 * | 层 | 在哪 |
 * |---|---|
 * | 1 会话来源（谁发起的） | 会话文件里的 `lifeos_peer` 条目 |
 * | 2 每一轮谁发起 | 会话文件里的 `lifeos_turn_origin` 条目（Task 0014 新增） |
 * | 3 每一轮结果 | 最后一条 assistant 的 `stopReason` / `durationMs` |
 * | 4 当前在不在跑 | `/api/runtime`（服务端内存） |
 * | 5 回合账本 | `/api/agents/:a/sessions/:s/turns/last` |
 * | 6 **被拒的请求** | `~/.lifeos/logs/backend-<date>.jsonl` 的 http 行（它们**没进会话**） |
 *
 * 第 6 层是最容易被忽略的一层：请求被服务端拒绝了，会话里根本不会有记录，
 * 所以"看会话文件"永远看不出"为什么发不出去"。
 *
 * ## 用法
 *
 *   node scripts/session-trace.mjs --agent frontend-developer --session 01a1b478
 *   node scripts/session-trace.mjs --agent coder --session 01a1b4a4 --json
 *   node scripts/session-trace.mjs --session 01a1b478 --base http://127.0.0.1:43138
 *
 * ## 纪律
 *
 * - **只读**：不发消息、不点会话（点开会把未读标成已看，毁现场）、不写任何文件；
 * - 不新增日志：它读已有的 `logs/backend-<date>.jsonl`；
 * - 退出码 0 = 没有发现不一致；1 = 发现不一致（可用于巡检）。
 *
 * ## 与 `session-state.mjs` 的分工
 *
 * - `session-state`：管"**徽标数字**为什么不对"（disk / sse / api / dom 四层）；
 * - `session-trace`：管"**这一轮为什么跑不了 / 谁发起的**"（单条会话的时间线）。
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = process.env.LIFEOS_HOME?.trim() || join(homedir(), ".lifeos");

// ── 参数 ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);
const AGENT = argOf("agent");
let SESSION = argOf("session");
const BASE = argOf("base") ?? "http://127.0.0.1:43120";
const AS_JSON = has("json");

if (SESSION === undefined) {
  console.error(`用法：node scripts/session-trace.mjs --agent <id> --session <id 前缀> [--base <url>] [--json]

不给 --agent 时会在所有 Agent 里找这个 sessionId（慢，但能救"忘了是哪个 Agent"的场景）。`);
  process.exit(2);
}

const out = [];
const say = (line = "") => { out.push(line); if (!AS_JSON) console.log(line); };

// ── 1 定位会话文件 ────────────────────────────────────────────────
async function findSessionFile(agentFilter) {
  const agentsDir = join(HOME, "agents");
  const agents = agentFilter !== undefined
    ? [agentFilter]
    : (await readdir(agentsDir, { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory()).map((e) => e.name);
  for (const agentId of agents) {
    const projectsDir = join(agentsDir, agentId, "projects");
    const projects = (await readdir(projectsDir, { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory()).map((e) => e.name);
    for (const projectId of projects) {
      const dir = join(projectsDir, projectId, "sessions");
      const files = (await readdir(dir).catch(() => []));
      const hit = files.find((name) => name.endsWith(`_${SESSION}.jsonl`) || name.includes(SESSION));
      if (hit !== undefined) return { agentId, projectId, path: join(dir, hit), file: hit };
    }
  }
  return undefined;
}

// ── 2 解析会话文件 ────────────────────────────────────────────────
function parseSession(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try { rows.push(JSON.parse(line)); } catch { /* 坏行跳过，如实跳过不补造 */ }
  }
  const header = rows.find((r) => r?.type === "session");
  const info = [...rows].reverse().find((r) => r?.type === "session_info");
  const peer = [...rows].reverse().find((r) => r?.type === "custom" && r?.customType === "lifeos_peer");
  const activeTask = [...rows].reverse().find((r) => r?.type === "custom" && r?.customType === "lifeos_active_task");

  // 逐轮：origin 与其后第一条 user 消息配对（与 messagesOf 同一规则：一条 origin 只用一次）
  const turns = [];
  let pendingOrigin;
  for (const row of rows) {
    if (row?.type === "custom" && row?.customType === "lifeos_turn_origin") {
      pendingOrigin = row.data;
      continue;
    }
    if (row?.type !== "message") continue;
    const role = row.message?.role;
    if (role === "user") {
      turns.push({
        at: row.timestamp ?? "",
        origin: pendingOrigin,
        // 老会话没记 origin：标 (推断)，不当成事实
        originText: pendingOrigin === undefined ? "用户(推断)" : describeOrigin(pendingOrigin),
        state: "?", durationMs: undefined, detail: "",
      });
      pendingOrigin = undefined;
      continue;
    }
    if (role === "assistant") {
      const last = turns[turns.length - 1];
      if (last === undefined) continue;
      const stop = row.message?.stopReason ?? "";
      const err = typeof row.message?.errorMessage === "string" ? row.message.errorMessage.trim() : "";
      const dur = typeof row.message?.durationMs === "number" ? row.message.durationMs : undefined;
      if (stop === "error") { last.state = "error"; last.detail = err.slice(0, 90); }
      else if (stop === "aborted") { last.state = "aborted"; }
      else if (stop === "stop" || stop === "toolUse") { last.state = last.state === "error" ? last.state : "done"; }
      if (dur !== undefined) last.durationMs = (last.durationMs ?? 0) + dur;
      // 一轮可能有多条 assistant（工具循环）：保留最后一次的终态与累计耗时
      if (stop === "error") { last.state = "error"; last.detail = err.slice(0, 90); }
      else if (stop !== "toolUse" && last.state !== "error") last.state = stop === "aborted" ? "aborted" : "done";
    }
  }
  // origin 有了、但后面没有 user 消息（本轮在 prompt 之前就失败，消息没落盘）：
  // 这一轮**真实发生过**（用户点了发送），不能因为"会话文件里没有 user 条目"就消失。
  if (pendingOrigin !== undefined) {
    turns.push({
      at: "",
      origin: pendingOrigin,
      originText: describeOrigin(pendingOrigin),
      state: "未落盘",
      durationMs: undefined,
      detail: "这一轮在写入消息前就失败了（见日志 backend-*.jsonl 的 runTurn 行）",
    });
  }
  return { header, info, peer, activeTask, turns, rows };
}

function describeOrigin(data) {
  if (data === undefined || data === null) return "?";
  if (data.kind === "user") return "用户";
  if (data.kind !== "agent") return "?";
  const name = typeof data.name === "string" && data.name !== "" ? data.name : data.agentId;
  return `${name}（${data.via ?? "agent"}）`;
}

// ── 3 读日志里的"被拒请求"（第 6 层：它们没进会话）───────────────
async function rejectedRequests(sessionId) {
  const logsDir = join(HOME, "logs");
  const files = (await readdir(logsDir).catch(() => []))
    .filter((name) => name.startsWith("backend-") && name.endsWith(".jsonl"))
    .sort()
    .slice(-3);   // 最近三天足够定位现场
  const hits = [];
  for (const name of files) {
    const text = await readFile(join(logsDir, name), "utf8").catch(() => "");
    for (const line of text.split("\n")) {
      if (line.trim() === "" || !line.includes(sessionId)) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const details = row?.details ?? {};
      const status = details.status;
      if (typeof status !== "number" || status < 300) continue;
      const path = String(details.path ?? "");
      if (!path.includes("/messages") && !path.includes("/abort") && !path.includes("/retry")) continue;
      hits.push({ ts: row.ts, method: details.method, path, status, code: details.code });
    }
  }
  return hits.sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

// ── 4 服务端当前状态 ──────────────────────────────────────────────
async function apiGet(path) {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) return undefined;
    return await res.json();
  } catch { return undefined; }
}

// ── 主流程 ────────────────────────────────────────────────────────
const found = await findSessionFile(AGENT);
if (found === undefined) {
  console.error(`找不到会话 ${SESSION}${AGENT === undefined ? "" : `（Agent ${AGENT}）`}。家目录：${HOME}`);
  process.exit(2);
}
SESSION = found.file.replace(/^.*_/, "").replace(/\.jsonl$/, "");

const text = await readFile(found.path, "utf8");
const parsed = parseSession(text);
const rejected = await rejectedRequests(SESSION);
const meta = await apiGet(`/api/agents/${found.agentId}/sessions/${SESSION}`);
const turnLast = await apiGet(`/api/agents/${found.agentId}/sessions/${SESSION}/turns/last`);
const runtime = await apiGet(`/api/runtime`);
const runningNow = (runtime?.running ?? []).some((r) => r.sessionId === SESSION);

// ── 输出 ──────────────────────────────────────────────────────────
say("会话身份");
say(`  session  ${SESSION}`);
say(`  Agent    ${found.agentId}    项目 ${found.projectId}`);
say(`  文件     ${found.path}`);
say(`  标题     ${parsed.info?.name ?? "(未命名)"}`);
if (parsed.peer !== undefined) {
  const d = parsed.peer.data ?? {};
  say(`  来源     agent:${d.peerAgentId}${d.targetAgentId !== undefined ? `（目标是 ${d.targetAgentId}）` : ""}` +
    `${d.via !== undefined ? ` 经 ${d.via}` : ""}${d.initiatorTaskId !== undefined ? ` · 发起方 Task ${d.initiatorTaskId}` : ""}`);
} else {
  say("  来源     用户（无 lifeos_peer 标记）");
}
if (parsed.activeTask !== undefined) say(`  当前Task ${parsed.activeTask.data?.taskId ?? "?"}`);

say("");
say(`逐轮时间线（${parsed.turns.length} 轮）`);
if (parsed.turns.length === 0) say("  （没有用户轮）");
else {
  say("  #   时间                  发起方                    状态     耗时     说明");
  parsed.turns.forEach((turn, i) => {
    const at = String(turn.at).slice(5, 19).replace("T", " ");
    const dur = turn.durationMs === undefined ? "—" : `${(turn.durationMs / 1000).toFixed(1)}s`;
    say(`  ${String(i + 1).padEnd(3)} ${at.padEnd(21)} ${turn.originText.padEnd(25)} ${turn.state.padEnd(8)} ${dur.padEnd(8)} ${turn.detail}`);
  });
}

say("");
say(`被拒的请求（${rejected.length} 条；这类请求不会进会话文件，只能从日志看）`);
if (rejected.length === 0) say("  （无）");
else for (const hit of rejected.slice(-10)) {
  say(`  ${String(hit.ts).slice(5, 19).replace("T", " ")}  ${hit.method} ${hit.path.replace(/^\/api\/agents\/[^/]+/, "")} → ${hit.status}${hit.code !== undefined ? ` ${hit.code}` : ""}`);
}

say("");
say("当前运行态");
say(`  session-runtime  ${runningNow ? "running（在跑）" : "idle"}`);
const turn = turnLast?.turn;
say(`  回合账本         ${turn === null || turn === undefined ? "无" : `${turn.state} · ${String(turn.at).slice(5, 19)} · ${turn.turnId}`}`);
say(`  meta.running     ${meta?.meta?.running === true ? "true" : "false"}${meta === undefined ? "（接口取不到）" : ""}`);
say(`  完整性           orphanParents=${meta?.integrity?.orphanParents ?? "?"}`);

// ── 第一处不一致（穷举规则，写在这里而不是散在脚本里）─────────────
say("");
const problems = [];
const lastTurn = parsed.turns[parsed.turns.length - 1];
if (runningNow && turn?.state !== "running") problems.push("running=true 但回合账本不是 running（clearRunning 漏了？账本被覆盖？）");
if (!runningNow && turn?.state === "running") problems.push("回合账本说 running，但运行态说不在跑（进程重启过？）");
if (!runningNow && rejected.some((r) => r.code === "session_running")) problems.push("会话空闲却有 409 session_running → 占位（startingTurns）泄漏");
if (rejected.some((r) => String(r.code ?? "").startsWith("peer_"))) problems.push("会话空闲却有 peer_* 拒绝 → 旧策略残留（本任务应已删除）");
if (lastTurn?.state === "error") problems.push(`最后一轮失败：${lastTurn.detail || "（无原文）"}`);
if (lastTurn?.state === "aborted") problems.push("最后一轮是用户打断（aborted）");
if (parsed.turns.length > 0 && parsed.turns.every((t) => t.origin === undefined)) problems.push("所有轮都没有 lifeos_turn_origin（本任务之前的老会话，界面会显示成用户发言）");

if (problems.length === 0) {
  say("结论：六层一致，没有发现不一致。");
} else {
  say("结论：发现不一致/需要解释的地方——");
  for (const p of problems) say(`  · ${p}`);
}

if (AS_JSON) {
  console.log(JSON.stringify({
    sessionId: SESSION, agentId: found.agentId, projectId: found.projectId, file: found.path,
    peer: parsed.peer?.data ?? null, activeTaskId: parsed.activeTask?.data?.taskId ?? null,
    turns: parsed.turns, rejected, runningNow, turn: turn ?? null,
    meta: meta?.meta ?? null, integrity: meta?.integrity ?? null, problems,
  }, null, 2));
}

if (!existsSync(found.path)) process.exit(2);
process.exit(problems.length === 0 ? 0 : 1);
