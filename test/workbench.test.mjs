// 全局工作台（S1）的三个只读接口：/api/tasks、/api/projects、/api/days。
//
// 断言原则（specs/code/testing 2.5）：断 HTTP 层的**行为与形状**，不断内部实现。
// 每个用例都从"改源头 → 接口跟着变"入手，证明来源唯一、没有第二份副本：
//   · 任务 = `task.md`（含工作区穿透）；· 项目 = `project.json`；· 归日 = 消息内 timestamp。
//
// 真实家目录的绝对数字（132/135、5 个项目、13/14 位助手）**不作为断言**：
// 那些数会随时间涨。这里断言的是**规则**（数量相等、键的形状、归日口径），
// 真实数字写在任务 `log.md` 的实测记录里。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startOn } from "./server-harness.mjs";
import { installHome } from "../src/home.ts";
import { flushLogs, initLogs } from "../src/logging.ts";
import { createAgent } from "../src/agents.ts";
import { registerProject } from "../src/projects.ts";
import { createTask } from "../src/tasks.ts";
import { clearSessionScanCache } from "../src/session-rows.ts";
import { dateHeadingOf, isDateString } from "../src/workbench.ts";

/** 全新临时家目录（装模板），不启服务。 */
async function freshHome() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-wb-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  clearSessionScanCache();
  return home;
}

const ctx = (agentId, projectId) => ({ agentId, projectId });

/** 删临时家目录：服务端异步写日志可能还没收尾，失败不算用例失败（不是断言对象）。 */
const cleanup = (path) => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});

/** 造一个会话文件（Pi 真实条目形状）；`at` 是**本地** Date，测试因此不受时区影响。 */
async function writeSession(home, agentId, projectId, sessionId, entries) {
  const dir = join(home, "agents", agentId, "projects", projectId, "sessions");
  await mkdir(dir, { recursive: true });
  const lines = [
    JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: entries[0]?.at?.toISOString() ?? new Date().toISOString(), cwd: "/tmp" }),
  ];
  for (const entry of entries) {
    lines.push(JSON.stringify({
      type: "message",
      timestamp: entry.at.toISOString(),
      message: { role: entry.role, content: [{ type: "text", text: entry.role === "user" ? "问题" : "回答" }], ...(entry.role === "assistant" ? { stopReason: "stop" } : {}) },
    }));
  }
  const file = join(dir, `2026-11-01T00-00-00-000Z_${sessionId}.jsonl`);
  await writeFile(file, lines.join("\n") + "\n", "utf8");
  return file;
}

/** 本地时间的 Date（`new Date(2026, 10, 1, 12)` = 本地 2026-11-01 12:00）。 */
const local = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min, 0);

// ——————————————————————————————————————————————————————————————
// /api/tasks
// ——————————————————————————————————————————————————————————————

test("S1-8 /api/tasks：条目 = TaskSummary + agentId/projectId/state，含 daily，按 projectId → number 排序", async () => {
  const home = await freshHome();
  const created = await createTask(ctx("lifeosagent", "workspace"), { title: "归一状态", type: "general", category: "G" });
  assert.ok(!("code" in created));
  // 把它的状态改成一个真实的"带括号+粗体"原值
  const taskMd = join(created.task.docPath, "task.md");
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(taskMd, "utf8");
  await writeFile(taskMd, text.replace(/^状态：.*$/m, "状态：**已完成**（2026-11-04 合并进 main）"), "utf8");

  const { server, base } = await startOn(home);
  try {
    const response = await fetch(`${base}/api/tasks`);
    assert.equal(response.status, 200);
    const items = (await response.json()).items;
    // 至少也要真的测到东西（testing 2.26：空集上的"全都符合"恒真）
    assert.ok(items.length >= 2, `应有出厂默认 Task + 新建 Task，实际 ${items.length}`);

    const daily = items.filter((item) => item.type === "daily");
    // 每个 Agent × 项目恰好一个 daily（出厂家目录有 lifeosagent 的 workspace 与 lifeos 两个项目）
    const scopes = new Set(items.map((item) => `${item.agentId}\u0000${item.projectId}`));
    assert.equal(daily.length, scopes.size, "每个 Agent × 项目一个 daily，且 daily 必须**在**返回里（排除它是呈现层的决定）");
    const mine = items.find((item) => item.id === created.task.id);
    assert.ok(mine !== undefined, "新建的 Task 必须出现");
    assert.equal(mine.agentId, "lifeosagent");
    assert.equal(mine.projectId, "workspace");
    assert.equal(mine.state, "已完成", "带 `**` 与括号的原值要归一（不是「其他」）");
    assert.match(mine.status, /^\*\*已完成\*\*/, "`status` 原文保留（详情要能看原话）");
    assert.equal(typeof mine.docPath, "string", "复用 TaskSummary：docPath 等字段都在");

    const keys = items.map((item) => `${item.projectId}\u0000${String(item.number).padStart(6, "0")}`);
    assert.deepEqual(keys, [...keys].sort(), "排序：projectId 升序 → number 升序");
  } finally { server.close(); await cleanup(home); }
});

test("S1-9 /api/tasks **必须**看到只存在于工作区文档里的 Task（只扫主区会安静地漏掉）", async () => {
  const home = await freshHome();
  const created = await createTask(ctx("lifeosagent", "workspace"), { title: "只在工作区", type: "general", category: "G" });
  assert.ok(!("code" in created));
  const task = created.task;

  // 真实形态：文档在工作区（`<taskDir>/home/agents/.../tasks/<dir>/`），主区只有 `home/` 挂载点。
  const worktreeDoc = join(task.path, "home", "agents", "lifeosagent", "projects", "workspace", "tasks", task.dirName);
  await mkdir(worktreeDoc, { recursive: true });
  const { readFile, rename } = await import("node:fs/promises");
  await writeFile(join(worktreeDoc, "task.md"), await readFile(join(task.docPath, "task.md"), "utf8"), "utf8");
  await rm(join(task.path, "task.md"));

  const { server, base } = await startOn(home);
  try {
    const items = (await (await fetch(`${base}/api/tasks`)).json()).items;
    const found = items.find((item) => item.id === task.id);
    assert.ok(found !== undefined, "主区没有 task.md、工作区里有时，Task 必须仍然出现在 /api/tasks（否则看板安静地少一块）");
    assert.equal(found.docPath, worktreeDoc, "docPath 指向工作区里那份（读侧穿透）");
  } finally { server.close(); await cleanup(home); }
});

test("S1-10 /api/tasks 覆盖所有 Agent × 项目；归档 Agent 与已移除项目不出现", async () => {
  const home = await freshHome();
  const second = await createAgent({ name: "Second Agent" });
  assert.ok(!("code" in second));
  // second 只绑 workspace（createAgent 自带默认 Task）；再给它一个外部项目
  const dir = await mkdtemp(join(tmpdir(), "lifeos-wb-ext-"));
  const bound = await registerProject(second.id, dir);
  assert.ok(!("code" in bound));

  const { server, base } = await startOn(home);
  try {
    const items = (await (await fetch(`${base}/api/tasks`)).json()).items;
    const byAgent = new Map();
    for (const item of items) byAgent.set(item.agentId, (byAgent.get(item.agentId) ?? 0) + 1);
    assert.equal(byAgent.get("lifeosagent"), 2, "lifeosagent 的默认 Task + 新建的那个");
    assert.equal(byAgent.get(second.id), 2, "第二个 Agent 的默认 Task + 外部项目的默认 Task");
    assert.ok(items.some((item) => item.agentId === second.id && item.projectId === bound.project.id), "外部项目的 Task 要在里面");

    // 归档后整组消失（与 /api/agents 同口径）
    await fetch(`${base}/api/agents/${second.id}`, { method: "DELETE" });
    const after = (await (await fetch(`${base}/api/tasks`)).json()).items;
    assert.equal(after.some((item) => item.agentId === second.id), false, "归档 Agent 的 Task 不出现（归档 = 从列表消失）");
  } finally { server.close(); await cleanup(home); await cleanup(dir); }
});

// ——————————————————————————————————————————————————————————————
// /api/projects
// ——————————————————————————————————————————————————————————————

test("S1-11 /api/projects：合并键 = 全局 pid；无 project.json 的目录不出现；不返回任务计数", async () => {
  const home = await freshHome();
  // 只有 registry 条目、没有 project.json 的目录（真实家目录里的 longagentshare 就是这个形态）
  await mkdir(join(home, "projects", "share-only"), { recursive: true });
  // 一个真实外部项目（两个 Agent 都绑定它 → 合并成一个条目、agentIds 两个）
  const dir = await mkdtemp(join(tmpdir(), "lifeos-wb-proj-"));
  const one = await registerProject("lifeosagent", dir);
  assert.ok(!("code" in one));
  const second = await createAgent({ name: "Third Agent" });
  assert.ok(!("code" in second));
  const two = await registerProject(second.id, dir);
  assert.ok(!("code" in two));
  assert.equal(two.project.id, one.project.id, "同一个目录必须是同一个全局 pid");

  const { server, base } = await startOn(home);
  try {
    const response = await fetch(`${base}/api/projects`);
    assert.equal(response.status, 200);
    const items = (await response.json()).items;
    assert.ok(items.length >= 3, `出厂 workspace + lifeos + 外部项目，实际 ${items.length}`);
    assert.equal(items.some((item) => item.id === "share-only"), false, "没有 project.json 的目录不出现");

    const shared = items.find((item) => item.id === one.project.id);
    assert.ok(shared !== undefined);
    assert.deepEqual(shared.agentIds, ["lifeosagent", second.id].sort(), "同一个项目被两个 Agent 绑定时合并成一项，agentIds 排序稳定");
    assert.equal(shared.path, dir);
    assert.ok(shared.name.length > 0);
    for (const item of items) {
      assert.equal("taskCount" in item, false, "不返回任务计数（同一个数字不能有第二个来源）");
      assert.ok(Array.isArray(item.agentIds));
    }
    const workspace = items.find((item) => item.id === "workspace");
    assert.equal(workspace.path, undefined, "workspace 没有 path（不暴露家目录）");
    assert.equal(workspace.name, "workspace");
  } finally { server.close(); await cleanup(home); await cleanup(dir); }
});

test("S1-12 /api/projects：项目名以 project.json 的 name 为准，不用 basename(path)", async () => {
  const home = await freshHome();
  const dir = await mkdtemp(join(tmpdir(), "worktree-"));       // basename = `worktree-xxx`
  const registered = await registerProject("lifeosagent", dir);
  assert.ok(!("code" in registered));
  // 改名：真实形态就是用户在 project.json 里写了可读名
  const manifestPath = join(home, "projects", registered.project.id, "project.json");
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await writeFile(manifestPath, JSON.stringify({ ...manifest, name: "可读的项目名" }, null, 2) + "\n", "utf8");

  const { server, base } = await startOn(home);
  try {
    const items = (await (await fetch(`${base}/api/projects`)).json()).items;
    const item = items.find((entry) => entry.id === registered.project.id);
    assert.equal(item.name, "可读的项目名", "名字来源是 project.json，不是目录名/basename(path)");
  } finally { server.close(); await cleanup(home); await cleanup(dir); }
});

// ——————————————————————————————————————————————————————————————
// /api/days
// ——————————————————————————————————————————————————————————————

test("S1-13 /api/days：缺参数 / 格式不对 / 假日期 / from>to 一律 400 invalid_range（断言 code）", async () => {
  const home = await freshHome();
  const { server, base } = await startOn(home);
  try {
    const cases = [
      ["", "缺两个参数"],
      ["?from=2026-11-01", "缺 to"],
      ["?to=2026-11-01", "缺 from"],
      ["?from=2026-11-1&to=2026-11-02", "格式不对（月份必须两位）"],
      ["?from=2026-13-01&to=2026-13-02", "不是真实日期（13 月）"],
      ["?from=2026-02-30&to=2026-03-01", "不是真实日期（2 月 30 日）"],
      ["?from=2026-11-05&to=2026-11-01", "from 晚于 to"],
    ];
    for (const [query, why] of cases) {
      const response = await fetch(`${base}/api/days${query}`);
      assert.equal(response.status, 400, `${why} → 400`);
      assert.equal((await response.json()).error.code, "invalid_range", `${why} → invalid_range`);
    }
  } finally { server.close(); await cleanup(home); }
});

test("S1-14 /api/days：会话按**消息内 timestamp** 归日，不用文件 mtime", async () => {
  const home = await freshHome();
  const file = await writeSession(home, "lifeosagent", "workspace", "utc-mtime-probe", [
    { role: "user", at: local(2026, 11, 1, 10) },
    { role: "assistant", at: local(2026, 11, 1, 10, 1) },
  ]);
  // 文件 mtime 拨到 11-20（真实情形：批量 model_change 也会写文件，mtime 骗人）
  await utimes(file, local(2026, 11, 20, 9), local(2026, 11, 20, 9));

  const { server, base } = await startOn(home);
  try {
    const keep = (await (await fetch(`${base}/api/days?from=2026-11-01&to=2026-11-01`)).json()).items;
    const day = keep.find((entry) => entry.date === "2026-11-01");
    assert.ok(day !== undefined, "消息时间所在的那天必须有这一天");
    const ref = day.activity.find((entry) => entry.kind === "session" && entry.sessionId === "utc-mtime-probe");
    assert.ok(ref !== undefined, `11-01 的 activity 应含这个会话，实际 ${JSON.stringify(day.activity)}`);
    assert.equal(ref.at, local(2026, 11, 1, 10).toISOString(), "`at` = 那天第一条用户消息的时间（真实时刻）");
    assert.equal(ref.agentId, "lifeosagent");
    assert.equal(ref.projectId, "workspace");
    assert.equal(typeof ref.title, "string");

    const fake = (await (await fetch(`${base}/api/days?from=2026-11-20&to=2026-11-20`)).json()).items;
    assert.equal(fake.some((entry) => entry.activity.some((a) => a.sessionId === "utc-mtime-probe")), false,
      "mtime 那天**不能**出现（按 mtime 归日会多报，实测 5 倍）");
  } finally { server.close(); await cleanup(home); }
});

test("S1-15 /api/days：只算至少有一条 role=user 消息的会话；一天内有几条消息也只算一条", async () => {
  const home = await freshHome();
  await writeSession(home, "lifeosagent", "workspace", "assistant-only", [
    { role: "assistant", at: local(2026, 11, 3, 10) },
  ]);
  await writeSession(home, "lifeosagent", "workspace", "two-user-turns", [
    { role: "user", at: local(2026, 11, 3, 9) },
    { role: "assistant", at: local(2026, 11, 3, 9, 1) },
    { role: "user", at: local(2026, 11, 3, 15) },
    { role: "assistant", at: local(2026, 11, 3, 15, 1) },
  ]);

  const { server, base } = await startOn(home);
  try {
    const items = (await (await fetch(`${base}/api/days?from=2026-11-03&to=2026-11-03`)).json()).items;
    const day = items.find((entry) => entry.date === "2026-11-03");
    assert.ok(day !== undefined);
    const ids = day.activity.filter((entry) => entry.kind === "session").map((entry) => entry.sessionId);
    assert.deepEqual(ids, ["two-user-turns"], "只有 assistant 的会话不算「那天有对话」；同一会话一天只算一条");
  } finally { server.close(); await cleanup(home); }
});

test("S1-16 /api/days：log 按 `## YYYY-MM-DD` 标题归日，模板占位词与围栏里的 ## 不算", async () => {
  const home = await freshHome();
  const created = await createTask(ctx("lifeosagent", "workspace"), { title: "日志日期", type: "development", category: "C" });
  assert.ok(!("code" in created), `createTask 失败：${JSON.stringify(created)}`);
  const logPath = join(created.task.docPath, "log.md");
  await writeFile(logPath, [
    "# 日志",
    "",
    "## 过程记录（按时间追加）",       // 模板占位：不算
    "",
    "## 重要事项",                     // 模板占位：不算
    "",
    "## 2026-11-05 · 第一轮",
    "",
    "```md",
    "## 2026-11-06 代码块里的不算标题",
    "```",
    "",
    "## 2026-11-07 · 第二轮",
    "## 2026-11-07 同一天的第二条",
    "## 复盘（2026-11-08）",            // 括号里带日期：这一版**不解析**
    "## 2026-11-09",
    "",
  ].join("\n"), "utf8");

  const { server, base } = await startOn(home);
  try {
    const items = (await (await fetch(`${base}/api/days?from=2026-11-01&to=2026-11-30`)).json()).items;
    const logsOf = (date) => (items.find((entry) => entry.date === date)?.activity ?? []).filter((entry) => entry.kind === "log");
    assert.deepEqual(logsOf("2026-11-05").map((entry) => entry.heading), ["第一轮"], "日期与分隔符被剥掉，正文留下");
    assert.deepEqual(logsOf("2026-11-06"), [], "围栏代码块里的 ## 不是标题");
    assert.equal(logsOf("2026-11-07").length, 2, "同一天多条各算一条");
    assert.deepEqual(logsOf("2026-11-08"), [], "括号里带日期的自由标题这一版不解析（宁可少，不猜）");
    assert.deepEqual(logsOf("2026-11-09").map((entry) => entry.heading), ["2026-11-09"], "去完为空时 heading 回落到日期");
    const first = logsOf("2026-11-05")[0];
    assert.equal(first.at, new Date(2026, 10, 5).toISOString(),
      "log 的 at = 该日本地零点换算成 ISO（时区确定的同一基准，契约 R1）");
    assert.equal(first.taskId, created.task.id);
    assert.equal(first.taskTitle, created.task.title);
    assert.equal(first.agentId, "lifeosagent");
    assert.equal("documents" in items[0], true);
  } finally { server.close(); await cleanup(home); }
});

// R1（契约补充冻结 §6-R1）：`at` 必须是**同一个时钟基准**——时区确定的时刻。
// 旧实现 log 写 `<date>T00:00:00`（本地字面、无时区）、session 写 UTC ISO，
// 于是「按 at 升序」不等于时间升序：architect 实测 2026-11-18 有 6 条本地 07:xx 的会话
// （时间戳 T23:xxZ，UTC 前一天）排到了「零点 log」前面。这种错不报错、不红测试，
// 只在界面上“顺序有点怪”，所以必须有一条专门的排序断言锁住。
test("S1-16b /api/days：同一天里 log 的 at 排在该日会话之前，且两个 kind 同一时钟基准（R1）", async () => {
  const home = await freshHome();
  const created = await createTask(ctx("lifeosagent", "workspace"), { title: "R1 时钟基准", type: "development", category: "C" });
  assert.ok(!("code" in created));
  const logPath = join(created.task.docPath, "log.md");
  await writeFile(logPath, ["# 日志", "", "## 2026-11-18 · 当天有进展", ""].join("\n"), "utf8");
  // 会话：本地 2026-11-18 07:20 —— 东八区的时间戳是 2026-11-17T23:20:xxZ（UTC 前一天）。
  // 这正是 architect 实测的形态：会话在“本地当天早上”，UTC 字面却像前一天。
  const file = await writeSession(home, "lifeosagent", "workspace", "r1-clock-probe", [
    { role: "user", at: local(2026, 11, 18, 7, 20) },
    { role: "assistant", at: local(2026, 11, 18, 7, 21) },
  ]);
  await utimes(file, local(2026, 11, 19, 9), local(2026, 11, 19, 9));   // mtime 误导（防按 mtime 归日）

  const { server, base } = await startOn(home);
  try {
    const day = (await (await fetch(`${base}/api/days?from=2026-11-18&to=2026-11-18`)).json()).items
      .find((entry) => entry.date === "2026-11-18");
    assert.ok(day !== undefined, "当天必须有这一天");
    assert.equal(day.activity.length, 2, "1 条 log + 1 条 session");
    const [first, second] = day.activity;
    assert.equal(first.kind, "log", "log（本地零点）必须排在该日 07:xx 会话**之前**");
    assert.equal(second.kind, "session");

    // 两个 kind 的 at 都必须能被 new Date() 解析成同一基准（时区确定的时刻）。
    const logAt = new Date(first.at);
    const sessionAt = new Date(second.at);
    assert.equal(Number.isNaN(logAt.getTime()), false, "log 的 at 是合法时刻（不是本地字面）");
    assert.equal(Number.isNaN(sessionAt.getTime()), false);
    assert.ok(logAt.getTime() < sessionAt.getTime(), "at 升序 = 时间升序（R1 的本义）");
    assert.match(first.at, /\.\d{3}Z$/, "log 的 at 是 toISOString 形态（带毫秒与 Z）");
  } finally { server.close(); await cleanup(home); }
});

test("S1-17 /api/days：稀疏（没内容的日子不出现），documents/todos 恒为空数组", async () => {
  const home = await freshHome();
  await writeSession(home, "lifeosagent", "workspace", "one-day", [{ role: "user", at: local(2026, 11, 10, 9) }]);
  const { server, base } = await startOn(home);
  try {
    const items = (await (await fetch(`${base}/api/days?from=2026-11-09&to=2026-11-12`)).json()).items;
    assert.deepEqual(items.map((entry) => entry.date), ["2026-11-10"], "只有那天有事，其余两天不出现（稀疏）");
    for (const entry of items) {
      assert.deepEqual(entry.documents, [], "S1 恒为 []（不是省略字段）");
      assert.deepEqual(entry.todos, [], "S1 恒为 []（不是省略字段）");
      assert.ok(entry.activity.length > 0, "有这一天就意味着至少有活动");
    }
    // 窗口含两端
    const single = (await (await fetch(`${base}/api/days?from=2026-11-10&to=2026-11-10`)).json()).items;
    assert.deepEqual(single.map((entry) => entry.date), ["2026-11-10"], "from == to 是合法的单日窗口");
    const outside = (await (await fetch(`${base}/api/days?from=2026-10-01&to=2026-10-31`)).json()).items;
    assert.deepEqual(outside, [], "窗口外没有内容");
  } finally { server.close(); await cleanup(home); }
});

// —— 纯函数的边界（`dateHeadingOf` / `isDateString`）——

test("S1-18 dateHeadingOf / isDateString 的边界：不认假日期、不认非标题行、不吃正文", () => {
  assert.deepEqual(dateHeadingOf("## 2026-11-05 · 收口"), { date: "2026-11-05", heading: "收口" });
  assert.deepEqual(dateHeadingOf("## 2026-11-05"), { date: "2026-11-05", heading: "2026-11-05" });
  assert.deepEqual(dateHeadingOf("## 2026-11-05T10:00 带时刻"), { date: "2026-11-05", heading: "T10:00 带时刻" });
  // 不是标题 / 日期不在开头 / 假日期
  assert.equal(dateHeadingOf("### 2026-11-05 三级标题"), undefined, "只认二级标题");
  assert.equal(dateHeadingOf("## 复盘 2026-11-05"), undefined, "日期必须在标题开头");
  assert.equal(dateHeadingOf("## 2026-13-05 假月份"), undefined);
  assert.equal(dateHeadingOf("## 2026-11-051 数字串不是日期"), undefined, "日期必须是一个完整的数字 token");
  assert.equal(dateHeadingOf("正文里的 ## 2026-11-05"), undefined);
  assert.equal(dateHeadingOf("## 2026-11-05x 紧跟字母"), undefined, "日期后面紧接字母 = 不是一个单独的日期");

  assert.equal(isDateString("2026-11-05"), true);
  assert.equal(isDateString("2026-02-29"), false, "2026 不是闰年");
  assert.equal(isDateString("2024-02-29"), true, "2024 是闰年");
  assert.equal(isDateString("2026-11-5"), false);
  assert.equal(isDateString("2026-1-05"), false);
  assert.equal(isDateString(""), false);
});

// —— backend 2.9（错误必须可见）：非 ENOENT 的读失败必须留痕，且接口不因它变坏 ——

/** 与 src/logging.ts 同口径的本地日期（backend-<date>.jsonl 文件名）。 */
const logDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 读（或等）本 TEMP 家目录今天的 backend 日志，返回解析后的行。
 *  `until` 可以是"最少几行"（number）**或**谓词（函数）——
 *  写是 fire-and-forget（void log.debug），必须**按内容等**：按行数等会在"目标行还没落盘"
 *  时提前返回，后续行在 cleanup(rm) 之后才写 → ENOENT（S1-19 的 1/2 假红就是这么来的）。 */
async function readLogRows(home, until) {
  const file = join(home, "logs", `backend-${logDay()}.jsonl`);
  const predicate = typeof until === "function" ? until : (rows) => rows.length >= until;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    // **并发全量下必须每轮把 env 设回来**：node --test 默认并发跑多个文件，
    // 其他文件的用例会把 LIFEOS_HOME 切走；log.debug 的落盘路径是 resolveHome()（每次读 env），
    // env 被切走时这一行会写进**别家**的 logs → 本家永远等不到（第二次竞态的根因）。
    process.env.LIFEOS_HOME = home;
    const raw = await readFile(file, "utf8").catch(() => "");
    const rows = raw.trim() === "" ? [] : raw.trim().split("\n").map((line) => JSON.parse(line));
    if (predicate(rows)) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  process.env.LIFEOS_HOME = home;
  return [];
}

// 造 EISDIR 的方式：把一个 Task 的 `log.md` **换成目录**（readFile 对目录返回 EISDIR）。
// 这比改权限稳：chmod 在部分 CI 环境不生效（root 忽略权限位）。
test("S1-19 backend 2.9：读 log.md 的非 ENOENT 失败（EISDIR）必须留痕，接口仍 200 且其余条目不少", async () => {
  process.env.LIFEOS_LOG_DEBUG = "1";   // 留痕用 debug 级；测试里显式打开（logging 的默认静默不变）
  const home = await freshHome();
  await initLogs();
  clearSessionScanCache();

  // 两个 Task：一个把 log.md 换成目录（造 EISDIR），一个正常写日志 —— 用它证明"其余条目一条不少"。
  const bad = await createTask(ctx("lifeosagent", "workspace"), { title: "EISDIR 探针", type: "development", category: "C" });
  const good = await createTask(ctx("lifeosagent", "workspace"), { title: "正常日志", type: "development", category: "C" });
  assert.ok(!("code" in bad) && !("code" in good));
  const badLog = join(bad.task.docPath, "log.md");
  await rm(badLog);
  await mkdir(badLog);   // 目录！readFile → EISDIR
  await writeFile(join(good.task.docPath, "log.md"), "# 日志\n\n## 2026-11-12 · 正常任务的日志\n", "utf8");

  const { server, base } = await startOn(home);
  try {
    // 服务进程读的也是 env：fetch 触发的扫描在 createApp 的闭包里用 resolveHome()。
    // 并发文件会在 fetch 期间切 env，所以 fetch 前**再设一次**（本行是"扫描窗口"的护栏）。
    process.env.LIFEOS_HOME = home;
    const response = await fetch(`${base}/api/days?from=2026-11-12&to=2026-11-12`);
    // ① 接口仍 200，且正常 Task 的 log 条目一条不少
    assert.equal(response.status, 200, "一条读失败不得把整个索引变 500/空");
    const day = (await response.json()).items.find((entry) => entry.date === "2026-11-12");
    assert.ok(day !== undefined);
    const logs = day.activity.filter((entry) => entry.kind === "log");
    assert.equal(logs.length, 1, "正常 Task 的 log 条目仍然在（失败的那条缺席，但它不拖垮别人）");
    assert.equal(logs[0].taskId, good.task.id);

    // ② 失败必须留痕（非 ENOENT 才记；这里是 EISDIR）
    // 等"含 EISDIR 的行"——不按行数等：行数到位不等于**那一行**到位
    //（测试侧竞态修法；产品侧 catch 是同步判 code，没有这个窗口）。
    const rows = await readLogRows(home, (parsed) =>
      parsed.some((row) => row.module === "workbench" && row.fn === "dayIndex"
        && typeof row.details?.message === "string" && row.details.message.includes("EISDIR")));
    const marks = rows.filter((row) => row.module === "workbench" && row.fn === "dayIndex"
      && typeof row.details?.message === "string" && row.details.message.includes("EISDIR"));
    if (marks.length < 1) {
      // 即时诊断：把"本家用例"的日志文件现状、LIFEOS_HOME 当前值打出来（找到根因后移除）
      const { readdir } = await import("node:fs/promises");
      let filesHere = [];
      try { filesHere = await readdir(join(home, "logs")); } catch { filesHere = ["(logs 目录不存在)"]; }
      const debugLines = (await readFile(join(home, "logs", `backend-${logDay()}.jsonl`), "utf8").catch(() => ""))
        .split("\n").filter((line) => line.includes("workbench")).slice(0, 5);
      console.error("S1-19 诊断：", JSON.stringify({
        envHome: process.env.LIFEOS_HOME,
        caseHome: home,
        sameHome: process.env.LIFEOS_HOME === home,
        filesHere, debugLines,
      }, null, 2));
    }
    assert.ok(marks.length >= 1, `必须有一条留痕（module=workbench fn=dayIndex message 含 EISDIR），实际 ${JSON.stringify(rows)}`);
    // details 里只有 ID 与路径，没有正文（backend 2.10）
    assert.equal((marks[0].details.message ?? "").length < 200, true);
  } finally {
    server.close();
    await cleanup(home);
    delete process.env.LIFEOS_LOG_DEBUG;
  }
});

// ENOENT（无 log.md / 无 project.json）是**正常分支**，不产生任何留痕 ——
// 否则一次冷扫 ~66 次"这个 Task 没有 log.md"会把日志刷成噪音（architect 裁决 2026-11-22）。
test("S1-20 backend 2.9：ENOENT 是正常分支，不留痕（日志里 0 条 workbench 记录）", async () => {
  process.env.LIFEOS_LOG_DEBUG = "1";
  const home = await freshHome();
  await initLogs();
  clearSessionScanCache();
  // 不给任何 Task 写 log.md（development 类创建时不带 log）→ 全是 ENOENT
  const created = await createTask(ctx("lifeosagent", "workspace"), { title: "无日志", type: "development", category: "C" });
  assert.ok(!("code" in created));

  const { server, base } = await startOn(home);
  try {
    const response = await fetch(`${base}/api/days?from=2026-11-01&to=2026-11-30`);
    assert.equal(response.status, 200);
    await readLogRows(home, (rows) => rows.length >= 1).catch(() => []);   // 给写盘一点时间（fire-and-forget）
    const rows = await readLogRows(home, 0);
    const wb = rows.filter((row) => row.module === "workbench");
    assert.deepEqual(wb, [], `ENOENT 不得留痕，实际 ${JSON.stringify(wb)}`);
  } finally {
    server.close();
    await cleanup(home);
    delete process.env.LIFEOS_LOG_DEBUG;
  }
});
