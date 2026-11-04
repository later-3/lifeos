// 会话行对象（任务 0005 · P1/P2）：四态优先级、字段来源、缺失语义、时间语义、计数分项。
//
// 断言原则（specs/code/testing 2.5）：断言用户/调用方可验证的**行为与字段**，不断言内部实现。
// 每条用例都从"改源头 → 该字段跟着变"入手，证明**来源唯一、不读别处的副本**。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { rowActivityOf, displayTitleOf } from "../src/row-activity.ts";
import { clearSessionScanCache, sessionRowsOf, sessionsByTask } from "../src/session-rows.ts";
import { ensureSharedLayer } from "../src/project-skeleton.ts";

/** 造一个会话文件（按 Pi 的真实条目形状：session 头 + 各类条目）。 */
function sessionLines(input) {
  const lines = [
    JSON.stringify({ type: "session", version: 3, id: input.id, timestamp: input.createdAt ?? "2026-11-01T00:00:00.000Z", cwd: "/tmp" }),
  ];
  if (input.name !== undefined) {
    lines.push(JSON.stringify({ type: "session_info", id: "si-1", timestamp: input.createdAt ?? "2026-11-01T00:00:00.000Z", name: input.name }));
  }
  for (const entry of input.entries ?? []) lines.push(JSON.stringify(entry));
  return lines.join("\n") + "\n";
}

const userEntry = (at, text = "你好") => ({
  type: "message", timestamp: at, message: { role: "user", content: [{ type: "text", text }] },
});
const assistantEntry = (at, extra = {}) => ({
  type: "message", timestamp: at, message: { role: "assistant", content: [{ type: "text", text: "回复" }], stopReason: "stop", ...extra },
});
const toolResultEntry = (at) => ({
  type: "message", timestamp: at, message: { role: "toolResult", content: [{ type: "text", text: "ok" }], toolName: "read" },
});
const systemEntry = (at) => ({
  type: "message", timestamp: at, message: { role: "system", content: [{ type: "text", text: "sys" }] },
});

/** 建一个最小家目录 + 一个项目 + 若干会话文件。 */
async function fixture(sessions) {
  // 每个用例用独立的临时家目录，路径天然不同；仍显式清一次缓存，
  // 这样"缓存串味儿"这类问题不会因为路径恰好不同而被掩盖。
  clearSessionScanCache();
  const home = await mkdtemp(join(tmpdir(), "lifeos-rows-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  const projectId = "workspace";
  const dir = join(home, "agents", "lifeosagent", "projects", projectId, "sessions");
  await mkdir(dir, { recursive: true });
  for (const item of sessions) await writeFile(join(dir, item.fileName), item.content, "utf8");
  return { home, projectId, dir };
}

// —— T1 四态优先级：running > failure > unread > idle（穷举 2³）——
test("T1 rowActivityOf 穷举：四态互斥，优先级 running > failure > unread > idle", () => {
  const now = Date.parse("2026-11-03T00:00:00Z");
  const running = "2026-11-02T23:59:00Z";
  const unread = "2026-11-02T23:00:00Z";
  const failure = { kind: "network", detail: "Connection error." };

  assert.equal(rowActivityOf({ now }).state, "idle", "都没有 → idle");
  assert.equal(rowActivityOf({ unreadSince: unread, now }).state, "unread");
  assert.equal(rowActivityOf({ failure, now }).state, "failure");
  assert.equal(rowActivityOf({ failure, unreadSince: unread, now }).state, "failure", "失败优先于未读");
  assert.equal(rowActivityOf({ runningSince: running, now }).state, "running");
  assert.equal(rowActivityOf({ runningSince: running, unreadSince: unread, now }).state, "running", "在跑优先于未读");
  assert.equal(rowActivityOf({ runningSince: running, failure, now }).state, "running", "在跑优先于失败");
  assert.equal(rowActivityOf({ runningSince: running, failure, unreadSince: unread, now }).state, "running", "三者都有 → 在跑");
});

test("T1b 运行耗时由 since 与 now 算出；非法 since 不产生 NaN", () => {
  const activity = rowActivityOf({ runningSince: "2026-11-02T23:59:30Z", now: Date.parse("2026-11-03T00:00:00Z") });
  assert.equal(activity.running && activity.running.elapsedMs, 30_000);
  const broken = rowActivityOf({ runningSince: "not-a-date", now: Date.parse("2026-11-03T00:00:00Z") });
  assert.equal(broken.running && broken.running.elapsedMs, 0, "坏时间戳不产生 NaN");
});

// —— T2 时间语义：lastActivityAt 不取 mtime ——
test("T2 时间：lastActivityAt = 最后一条 user/assistant；fileModifiedAt 才是 mtime（不冒充活动时间）", async () => {
  const { projectId } = await fixture([
    {
      fileName: "2026-11-01T00-00-00-000Z_sess-time.jsonl",
      content: sessionLines({
        id: "sess-time",
        createdAt: "2026-11-01T00:00:00.000Z",
        entries: [userEntry("2026-11-01T00:01:00.000Z"), assistantEntry("2026-11-01T00:02:00.000Z")],
      }).replace(/\n$/, "") + "\n" + JSON.stringify({ type: "thinking_level_change", timestamp: "2026-11-05T00:00:00.000Z" }) + "\n",
    },
  ]);
  const rows = await sessionRowsOf("lifeosagent", projectId);
  const row = rows.find((r) => r.sessionId === "sess-time");
  assert.ok(row, "会话应出现在列表里");
  assert.equal(row.time.lastMessageAt, "2026-11-01T00:02:00.000Z");
  assert.equal(row.time.lastActivityAt, "2026-11-01T00:02:00.000Z", "活动时间 = 消息时间，**不是**后面那条改设置的时间");
  // 文件里还有一条 2026-11-05 的 thinking_level_change（改思考级别）：
  // 它被写进文件 → mtime 变新，但**绝不能**污染"最后活动时间"。
  assert.ok(row.time.lastActivityAt < "2026-11-04", "改设置的条目（11-05）不能把活动时间推后");
  assert.notEqual(row.time.lastActivityAt, row.time.fileModifiedAt, "mtime 与活动时间是两个字段，不混用");
  assert.equal("mtime" in row.time, false, "字段名不叫 mtime —— 叫 fileModifiedAt，语义写在名字里");
});

test("T2b lastMessageAt 只认 user/assistant：最后一条 toolResult 不算对话活动", async () => {
  const { projectId } = await fixture([
    {
      fileName: "2026-11-01T00-00-00-000Z_sess-tool.jsonl",
      content: sessionLines({
        id: "sess-tool",
        entries: [
          userEntry("2026-11-01T00:01:00.000Z"),
          assistantEntry("2026-11-01T00:02:00.000Z"),
          toolResultEntry("2026-11-01T00:03:00.000Z"),
        ],
      }),
    },
  ]);
  const rows = await sessionRowsOf("lifeosagent", projectId);
  const row = rows.find((r) => r.sessionId === "sess-tool");
  assert.equal(row.time.lastMessageAt, "2026-11-01T00:02:00.000Z", "toolResult 不推进对话活动时间");
  assert.equal(row.counts.toolResult, 1, "但 toolResult 仍计入计数");
});

// —— T3 计数分项 ——
test("T3 counts 分项：按 role 归类，total = 四项之和（不是文件行数）", async () => {
  const { projectId } = await fixture([
    {
      fileName: "2026-11-01T00-00-00-000Z_sess-counts.jsonl",
      content: sessionLines({
        id: "sess-counts",
        createdAt: "2026-11-01T00:00:00.000Z",
        name: "计数测试",
        entries: [
          systemEntry("2026-11-01T00:00:30.000Z"),
          userEntry("2026-11-01T00:01:00.000Z"),
          assistantEntry("2026-11-01T00:02:00.000Z"),
          toolResultEntry("2026-11-01T00:03:00.000Z"),
          assistantEntry("2026-11-01T00:04:00.000Z"),
        ],
      }),
    },
  ]);
  const rows = await sessionRowsOf("lifeosagent", projectId);
  const counts = rows.find((r) => r.sessionId === "sess-counts").counts;
  assert.deepEqual(counts, { user: 1, assistant: 2, toolResult: 1, system: 1, total: 5 });
  assert.equal(
    counts.total,
    counts.user + counts.assistant + counts.toolResult + counts.system,
    "total 必须等于四项之和",
  );
  assert.notEqual(counts.total, 6, "不是文件行数（session 头与 session_info 不计入）");
});

// —— T4 标题：来源唯一，display 是同源派生 ——
test("T4 标题：display 来自同一份 raw；有 session_info 用名字，没有则用首条用户消息", async () => {
  const longText = "请用 lifeos_ask 问 coder：" + "很长的内容".repeat(20);
  const { projectId } = await fixture([
    {
      fileName: "2026-11-01T00-00-00-000Z_sess-raw.jsonl",
      content: sessionLines({ id: "sess-raw", entries: [userEntry("2026-11-01T00:01:00.000Z", longText)] }),
    },
    {
      fileName: "2026-11-01T00-00-01-000Z_sess-named.jsonl",
      content: sessionLines({ id: "sess-named", name: "我给它起的名字", entries: [userEntry("2026-11-01T00:01:00.000Z", "原始首句")] }),
    },
  ]);
  const rows = await sessionRowsOf("lifeosagent", projectId);
  const noName = rows.find((r) => r.sessionId === "sess-raw");
  const named = rows.find((r) => r.sessionId === "sess-named");

  assert.equal(named && named.title.raw, "我给它起的名字", "重命名过的会话以 session_info 为准");
  assert.equal(named && named.title.display, "我给它起的名字");
  assert.equal(noName && noName.title.raw, longText, "raw 保留原文（不截断）");
  assert.equal(noName && noName.title.display.length, 50, "display 受显示宽度限制（去引导语后仍可能超长）");
  // display 的规则是 `shortTitleOf`（去引导语）+ 限长，所以它是 raw 的**中间一段**而不是前缀。
  // 关键：每个字都来自 raw（同源派生），且引导语被去掉。
  for (const ch of noName.title.display) assert.ok(noName.title.raw.includes(ch), "display 的字符必须都来自 raw");
  assert.equal(noName.title.display, displayTitleOf(noName.title.raw), "同一条 raw 只有一种 display（前后端不会算出两个名字）");
});

test("T4b 空标题：raw 与 display 都是空串（后端不编名字）", async () => {
  const { projectId } = await fixture([
    { fileName: "2026-11-01T00-00-00-000Z_sess-empty.jsonl", content: sessionLines({ id: "sess-empty" }) },
  ]);
  const rows = await sessionRowsOf("lifeosagent", projectId);
  assert.equal(rows[0].title.raw, "");
  assert.equal(rows[0].title.display, "");
});

// —— T5 Task 名：来自 task.md，一次建映射，不读副本 ——
test("T5 task：activeTaskId 指向的 Task 带出 title/status/type；改 task.md 标题，行跟着变", async () => {
  const { home, projectId } = await fixture([
    {
      fileName: "2026-11-01T00-00-00-000Z_sess-task.jsonl",
      content: sessionLines({
        id: "sess-task",
        entries: [
          userEntry("2026-11-01T00:01:00.000Z"),
          { type: "custom", timestamp: "2026-11-01T00:01:01.000Z", customType: "lifeos_active_task", data: { taskId: "0007" } },
        ],
      }),
    },
  ]);
  const taskDir = join(home, "agents", "lifeosagent", "projects", projectId, "tasks", "0007-改造标题");
  await mkdir(taskDir, { recursive: true });
  await writeFile(join(taskDir, "task.md"), [
    "# 改造标题", "", "ID: 0007", "类型：development", "类别：A 改产品行为", "状态：进行中",
    "归属：lifeosagent/workspace/0007", "参与者：—", "目标：测试用",
  ].join("\n"), "utf8");

  const first = await sessionRowsOf("lifeosagent", projectId);
  assert.deepEqual(first[0].task, { id: "0007", title: "改造标题", status: "进行中", type: "development" });

  // 改源头（task.md 的标题行）→ 行对象跟着变，证明不读别处的副本
  await writeFile(join(taskDir, "task.md"), [
    "# 改过的标题", "", "ID: 0007", "类型：development", "类别：A 改产品行为", "状态：已完成",
    "归属：lifeosagent/workspace/0007", "参与者：—", "目标：测试用",
  ].join("\n"), "utf8");
  const second = await sessionRowsOf("lifeosagent", projectId);
  assert.equal(second[0].task && second[0].task.title, "改过的标题");
  assert.equal(second[0].task && second[0].task.status, "已完成");
});

test("T5b 孤儿指针：activeTaskId 指向不存在的 Task → null（不编 title）", async () => {
  const { projectId } = await fixture([
    {
      fileName: "2026-11-01T00-00-00-000Z_sess-orphan.jsonl",
      content: sessionLines({
        id: "sess-orphan",
        entries: [
          userEntry("2026-11-01T00:01:00.000Z"),
          { type: "custom", timestamp: "2026-11-01T00:01:01.000Z", customType: "lifeos_active_task", data: { taskId: "9999" } },
        ],
      }),
    },
  ]);
  const rows = await sessionRowsOf("lifeosagent", projectId);
  assert.equal(rows[0].task, null, "孤儿指针不编造 Task");
});

test("T5c 没有 Task 指针 → null", async () => {
  const { projectId } = await fixture([
    { fileName: "2026-11-01T00-00-00-000Z_sess-notask.jsonl", content: sessionLines({ id: "sess-notask", entries: [userEntry("2026-11-01T00:01:00.000Z")] }) },
  ]);
  const rows = await sessionRowsOf("lifeosagent", projectId);
  assert.equal(rows[0].task, null);
});

// —— T6 失败原文：不脱敏、不截断 ——
test("T6 failure.detail = 落盘原文（不脱敏、不截断）", async () => {
  const detail = '530 {"type":"https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-530/"} Connection error.';
  const { projectId } = await fixture([
    {
      fileName: "2026-11-01T00-00-00-000Z_sess-fail.jsonl",
      content: sessionLines({
        id: "sess-fail",
        entries: [
          userEntry("2026-11-01T00:01:00.000Z"),
          assistantEntry("2026-11-01T00:02:00.000Z", { stopReason: "error", errorMessage: detail }),
        ],
      }),
    },
  ]);
  const rows = await sessionRowsOf("lifeosagent", projectId);
  assert.equal(rows[0].activity.state, "failure");
  assert.equal(rows[0].activity.failure && rows[0].activity.failure.detail, detail, "原文完整给出，不截断不脱敏");
  // 分类归 `network` 而不是 `server`：这条报文**同时**含 5xx 与 "Connection error"，
  // 而 `classifyFailure()` 里 NETWORK 排在 SERVER 之前（为对齐 Pi 的可重试语义，
  // Task 0007 特意把 `connection error` 加进 NETWORK —— `src/failure.ts:44`）。
  // 本测试只关心"原文完整、不脱敏、不截断"；分类优先级归 `failure.ts` 自己管，不在这里另立规则。
  assert.equal(rows[0].activity.failure && rows[0].activity.failure.kind, "network", "含 Connection error → network（NETWORK 先于 SERVER）");
});

test("T6b 历史失败不算当前状态：之后成功的 assistant 或用户新消息会清掉红点", async () => {
  const { projectId } = await fixture([
    {
      fileName: "2026-11-01T00-00-00-000Z_sess-recover.jsonl",
      content: sessionLines({
        id: "sess-recover",
        entries: [
          userEntry("2026-11-01T00:01:00.000Z"),
          assistantEntry("2026-11-01T00:02:00.000Z", { stopReason: "error", errorMessage: "Connection error." }),
          assistantEntry("2026-11-01T00:03:00.000Z"),
        ],
      }),
    },
  ]);
  const rows = await sessionRowsOf("lifeosagent", projectId);
  assert.notEqual(rows[0].activity.state, "failure", "后面成功回复过 → 不再是失败态");
});

// —— T7 项目：name 以 project.json 为准 ——
test("T7 项目名：project.json 的 name 优先，basename(path) 只兜底", async () => {
  const { home } = await fixture([
    { fileName: "2026-11-01T00-00-00-000Z_sess-proj.jsonl", content: sessionLines({ id: "sess-proj", entries: [userEntry("2026-11-01T00:01:00.000Z")] }) },
  ]);
  // 项目名与 path 末段不同：如果代码用 basename，就会显示 "worktree"
  await ensureSharedLayer(join(home, "projects", "proj-named"), { id: "proj-named", name: "我的项目名", path: "/tmp/some/worktree" });
  const projSessions = join(home, "agents", "lifeosagent", "projects", "proj-named", "sessions");
  await mkdir(projSessions, { recursive: true });
  await writeFile(join(projSessions, "2026-11-01T00-00-00-000Z_sess-proj.jsonl"),
    sessionLines({ id: "sess-proj", entries: [userEntry("2026-11-01T00:01:00.000Z")] }), "utf8");

  const rows = await sessionRowsOf("lifeosagent", "proj-named");
  assert.equal(rows[0].project.name, "我的项目名", "manifest 的 name 优先，不是 path 末段的 worktree");
  assert.equal(rows[0].project.id, "proj-named");
});

test("T7b 项目 icon：有就带出，没有该键不出现（不编占位）", async () => {
  const { home } = await fixture([]);
  await ensureSharedLayer(join(home, "projects", "proj-icon"), { id: "proj-icon", name: "带图标", path: "/tmp/icon-demo", icon: "🎨" });
  const dir = join(home, "agents", "lifeosagent", "projects", "proj-icon", "sessions");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "2026-11-01T00-00-00-000Z_s.jsonl"), sessionLines({ id: "s", entries: [userEntry("2026-11-01T00:01:00.000Z")] }), "utf8");

  const withIcon = await sessionRowsOf("lifeosagent", "proj-icon");
  assert.equal(withIcon[0].project.icon, "🎨");

  const plain = await sessionRowsOf("lifeosagent", "workspace");
  const anyRow = plain[0];
  if (anyRow !== undefined) assert.equal("icon" in anyRow.project, false, "没有图标时该键不出现");
});

// —— T8 排序：用 lastActivityAt，不用 mtime ——
test("T8 排序：按 lastActivityAt 降序（不是 mtime）", async () => {
  const { projectId } = await fixture([
    {
      fileName: "2026-11-01T00-00-00-000Z_sess-old.jsonl",
      content: sessionLines({ id: "sess-old", createdAt: "2026-11-01T00:00:00.000Z", name: "旧会话", entries: [userEntry("2026-11-01T00:01:00.000Z")] }),
    },
    {
      fileName: "2026-11-02T00-00-00-000Z_sess-new.jsonl",
      content: sessionLines({ id: "sess-new", createdAt: "2026-11-02T00:00:00.000Z", name: "新会话", entries: [userEntry("2026-11-02T00:01:00.000Z")] }),
    },
  ]);
  const rows = await sessionRowsOf("lifeosagent", projectId);
  const mine = rows.map((r) => r.sessionId).filter((id) => id === "sess-new" || id === "sess-old");
  assert.deepEqual(mine, ["sess-new", "sess-old"], "最近活动的在前");
});

// —— T9 显示标题的截断规则 ——
test("T9 displayTitleOf：复用 session-title.ts 的规则（去引导语 + 限长），不重写一份", () => {
  assert.equal(displayTitleOf("短标题"), "短标题");
  // `shortTitleOf` 的既有规则：`请用 lifeos_ask` 属于 LEADING_FILLER，被整段去掉 → "问 coder"
  assert.equal(displayTitleOf("请用 lifeos_ask 问 coder"), "问 coder", "去掉引导语（与 shortTitleOf 完全一致，不另写一份）");
  assert.equal(displayTitleOf("请用 lifeos_ask 问 coder"), displayTitleOf("请用 lifeos_ask 问 coder"));
  assert.equal(displayTitleOf("x".repeat(50)).length, 50);
  assert.equal(displayTitleOf("x".repeat(51)).length, 50);
});

// —— T10 项目名不再取 checkout 目录名（任务 0005 修掉的真实 bug）——
test("T10 项目名：manifest.name 优先于目录 basename（worktree 绑定后不再显示成 worktree）", async () => {
  const rows = await sessionRowsOf("lifeosagent", "workspace");
  assert.ok(rows.length >= 0);
  // 直接验证 project-registry 的语义：name 是项目自己的名字，与 path 末段无关
  const { ensureSharedLayer } = await import("../src/project-skeleton.ts");
  const home = process.env.LIFEOS_HOME;
  await ensureSharedLayer(join(home, "projects", "proj-worktree-demo"), {
    id: "proj-worktree-demo",
    name: "真实的项目名",
    path: "/tmp/some/branch/worktree",   // 末段是 worktree，但 name 不是
  });
  const dir = join(home, "agents", "lifeosagent", "projects", "proj-worktree-demo", "sessions");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "2026-11-01T00-00-00-000Z_s.jsonl"),
    sessionLines({ id: "s", entries: [userEntry("2026-11-01T00:01:00.000Z")] }), "utf8");
  const [row] = await sessionRowsOf("lifeosagent", "proj-worktree-demo");
  assert.equal(row.project.name, "真实的项目名", "name = project.json 的 name");
  assert.notEqual(row.project.name, "worktree", "不是 path 末段");
});

// —— T20 批量分组（P6）：一遍扫描给出"每个 Task 下有哪些会话"，取代 N×全扫 ——
test("T20 sessionsByTask：一次扫描按 taskId 分组，结果与逐 Task 全扫一致", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-rows-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
  await mkdir(dir, { recursive: true });

  const taskEntry = (id) => ({ type: "custom", timestamp: "2026-11-01T00:00:30.000Z", customType: "lifeos_active_task", data: { taskId: id } });
  // 三个会话：分属两个 Task，外加一个没有 Task 的（不该进任何分组）
  await writeFile(join(dir, "a.jsonl"), sessionLines({ id: "s-a", entries: [taskEntry("0001"), userEntry("2026-11-01T00:01:00.000Z")] }), "utf8");
  await writeFile(join(dir, "b.jsonl"), sessionLines({ id: "s-b", entries: [taskEntry("0001"), userEntry("2026-11-01T00:02:00.000Z")] }), "utf8");
  await writeFile(join(dir, "c.jsonl"), sessionLines({ id: "s-c", entries: [taskEntry("0002"), userEntry("2026-11-01T00:03:00.000Z")] }), "utf8");
  await writeFile(join(dir, "d.jsonl"), sessionLines({ id: "s-d", entries: [userEntry("2026-11-01T00:04:00.000Z")] }), "utf8");

  const grouped = await sessionsByTask("lifeosagent", "workspace");
  assert.equal(grouped.get("0001").length, 2, "0001 下两个会话");
  assert.equal(grouped.get("0002").length, 1);
  assert.equal(grouped.has(undefined), false, "没有 Task 指针的会话不进任何分组");
  // 排序：最近活动在前（与列表同口径，不是 mtime）
  assert.deepEqual(grouped.get("0001").map((x) => x.sessionId), ["s-b", "s-a"], "s-b 更晚 → 排前面");
  // 与 sessionRowsOf 的 task 字段一致：分组与行对象同源，两边不可能说法不同。
  // 0001 是 installHome 装的默认 Task（存在 → 能解析出标题）；0002 没有目录
  // → 行对象给 `null`（**缺失语义**：指针指向不存在的 Task，不编一个 title），
  // 但**分组仍按指针**把它归到 0002 下 —— 这两件事必须分开，否则要么丢会话、要么造假标题。
  const rows = await sessionRowsOf("lifeosagent", "workspace");
  const byId = new Map(rows.map((r) => [r.sessionId, r]));
  for (const item of grouped.get("0001")) {
    assert.equal(byId.get(item.sessionId).task?.id, "0001");
    assert.equal(byId.get(item.sessionId).task?.title, "默认", "0001 存在 → 标题可用");
  }
  assert.equal(byId.get("s-c").task, null, "0002 目录不存在 → 行对象不编标题");
  assert.equal(grouped.get("0002").length, 1, "但分组照指针走，不因为解析不到就把会话丢掉");
});

// —— T21–T23 fingerprint 缓存（Task 0005 · P8-6）——
// 目的：列表/tasks/聚合都会走扫描；不缓存每次 156ms（69 文件实测），缓存命中 1ms。
// 风险：缓存过期 → 用户改了会话却看到旧数据。所以"什么时候必须失效"比"命中"更重要。
test("T21 缓存命中返回同一结果；文件追加后指纹变化 → 必须重扫（不能给旧数据）", async () => {
  const { projectId } = await fixture([
    { fileName: "2026-11-01T00-00-00-000Z_s1.jsonl",
      content: sessionLines({ id: "s1", name: "原标题", entries: [userEntry("2026-11-01T00:01:00.000Z")] }) },
  ]);
  const first = await sessionRowsOf("lifeosagent", projectId);
  assert.equal(first[0].title.display, "原标题");

  // 追加一条 session_info 改名：模真实的 append-only 写入
  const dir = join(process.env.LIFEOS_HOME, "agents", "lifeosagent", "projects", projectId, "sessions");
  await writeFile(join(dir, "2026-11-01T00-00-00-000Z_s1.jsonl"),
    sessionLines({ id: "s1", name: "新标题", entries: [userEntry("2026-11-01T00:01:00.000Z")] }), "utf8");
  // 确保 mtime 确实推进（同一毫秒内写两次时 mtimeMs 可能相同，size 也会变化兜底）
  await new Promise((r) => setTimeout(r, 10));

  const second = await sessionRowsOf("lifeosagent", projectId);
  assert.equal(second[0].title.display, "新标题", "文件变了就必须重扫 —— 缓存过期会显示旧标题");
});

test("T22 缓存不跨文件串味：两个会话各自独立", async () => {
  const { projectId } = await fixture([
    { fileName: "2026-11-01T00-00-00-000Z_a.jsonl", content: sessionLines({ id: "s-a", name: "甲", entries: [userEntry("2026-11-01T00:01:00.000Z")] }) },
    { fileName: "2026-11-01T00-01-00-000Z_b.jsonl", content: sessionLines({ id: "s-b", name: "乙", entries: [userEntry("2026-11-01T00:02:00.000Z")] }) },
  ]);
  const rows = await sessionRowsOf("lifeosagent", projectId);
  const byId = new Map(rows.map((r) => [r.sessionId, r]));
  assert.equal(byId.get("s-a").title.display, "甲");
  assert.equal(byId.get("s-b").title.display, "乙");
  // 第二次（全命中）结果必须一致
  const again = await sessionRowsOf("lifeosagent", projectId);
  assert.deepEqual(again.map((r) => [r.sessionId, r.title.display]), rows.map((r) => [r.sessionId, r.title.display]));
});

test("T23 文件被删除后不返回幽灵行（缓存条目不能顶替磁盘事实）", async () => {
  const { projectId } = await fixture([
    { fileName: "2026-11-01T00-00-00-000Z_x.jsonl", content: sessionLines({ id: "s-x", name: "临时", entries: [userEntry("2026-11-01T00:01:00.000Z")] }) },
  ]);
  // 注意：fixture 的 installHome 会装一条出厂会话，所以按 id 过滤，不数总数
  const before = await sessionRowsOf("lifeosagent", projectId);
  assert.ok(before.some((r) => r.sessionId === "s-x"), "删除前有 s-x");
  const dir = join(process.env.LIFEOS_HOME, "agents", "lifeosagent", "projects", projectId, "sessions");
  await rm(join(dir, "2026-11-01T00-00-00-000Z_x.jsonl"));
  const after = await sessionRowsOf("lifeosagent", projectId);
  assert.equal(after.some((r) => r.sessionId === "s-x"), false, "文件没了，行也必须没了（不能拿缓存顶替）");
});
