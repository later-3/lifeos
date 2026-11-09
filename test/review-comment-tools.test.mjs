// S4-c：Agent 读写评论的两个工具（先红后绿）。
//
// 设计依据（backend 2.6：业务动作只在共享模块，Pi 工具与 HTTP 都是外壳）：
//  - 工具只做参数校验 + 转调 `src/review-comments.ts`，与 HTTP 路由共用同一份实现；
//  - 名字进 `LIFEOS_TOOL_NAMES` 白名单（否则注册了也调不到，见 agent-tools 头注）；
//  - Agent 写完，前端刷新即可见（同一份后端数据，不需要会话/事件）。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "review-tools-home-"));
process.env.LIFEOS_HOME = HOME;

const { createAgentTools } = await import("../src/agent-tools.ts");
const { readComments } = await import("../src/review-comments.ts");

// 真实夹具：`resolveTaskDir` 从 `<home>/agents/<a>/projects/<p>/tasks/` 找目录，
// 所以必须在临时 home 下真的建一个（不能靠注入假函数——那会测不到真实解析）。
const TASKS_ROOT = join(HOME, "agents", "lifeosagent", "projects", "p", "tasks");
const TASK_DIR = join(TASKS_ROOT, "0010-review-mode");
mkdirSync(TASK_DIR, { recursive: true });
writeFileSync(join(TASK_DIR, "task.md"), "# 0010 检视模式\n\n状态：进行中\n");
const ctx = { agentId: "lifeosagent", projectId: "p" };

const tools = createAgentTools(ctx);
const byName = (name) => {
  // createAgentTools 返回数组或对象——两种形态都兼容
  const list = Array.isArray(tools) ? tools : Object.values(tools);
  const found = list.find((t) => t.name === name);
  return found;
};

test("S4c·1 两个工具都已注册", () => {
  assert.ok(byName("lifeos_review_comments"), "缺 lifeos_review_comments");
  assert.ok(byName("lifeos_review_comment_add"), "缺 lifeos_review_comment_add");
});

test("S4c·2 读：无评论 → 明确说没有（不是空字符串）", async () => {
  // 独立 task（S4c·3 会往 0010 写，共用夹具会让本用例假红——C187 的夹具串状态教训）
  mkdirSync(join(TASKS_ROOT, "0002-empty"), { recursive: true });
  writeFileSync(join(TASKS_ROOT, "0002-empty", "task.md"), "# 0002\n");
  const tool = byName("lifeos_review_comments");
  const result = await tool.execute("call-1", { taskId: "0002" });
  const text = result.content[0].text;
  assert.match(text, /No review comments/i, text);
  assert.deepEqual(result.details.comments, []);
});

test("S4c·3 写：Agent 写一条 → 落盘，作者是 agent（id 来自 ctx）", async () => {
  const add = byName("lifeos_review_comment_add");
  const result = await add.execute("call-2", {
    taskId: "0010", source: "worktree", path: "README.md", side: "new", start: 3, end: 5,
    body: "这 3 行建议合并成一个函数", marks: ["critic"],
  });
  assert.ok(result.details.comment?.id, JSON.stringify(result.details));
  const saved = await readComments(TASK_DIR);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].author.kind, "agent");
  assert.equal(saved[0].body, "这 3 行建议合并成一个函数");
  assert.deepEqual(saved[0].marks, ["critic"]);
});

test("S4c·4 读：写出后能读到，且带作者/位置/语气（Agent 能分清是谁的）", async () => {
  const read = byName("lifeos_review_comments");
  const result = await read.execute("call-3", { taskId: "0010" });
  const text = result.content[0].text;
  assert.match(text, /README\.md/, text);
  assert.match(text, /L3-L5|3-5/, text);
  assert.equal(result.details.comments.length, 1);
});

test("S4c·5 写：非法 side → 抛错（错误信息说清允许值），不落盘", async () => {
  const add = byName("lifeos_review_comment_add");
  await assert.rejects(
    () => add.execute("call-4", { taskId: "0010", source: "worktree", path: "a.ts", side: "middle", start: 1, end: 1, body: "x" }),
    /side|old|new/i,
  );
  assert.equal((await readComments(TASK_DIR)).length, 1, "非法请求不能落盘");
});

test("S4c·6 写：非法行号（end < start 会归一；0 会拒绝）", async () => {
  const add = byName("lifeos_review_comment_add");
  await assert.rejects(
    () => add.execute("call-5", { taskId: "0010", source: "worktree", path: "b.ts", side: "new", start: 0, end: 0, body: "x" }),
    /start|range|行号/i,
  );
});

test("S4c·7 读：task 不存在 → 抛可行动的错误（提示用 lifeos_task_list），不静默返回空", async () => {
  // 设计取舍：读"存在的 task 但没评论" → 明确说没有（S4c·2）；
  //          读"不存在的 task" → 抛错并指路（否则 Agent 会把"打错编号"当成"用户没评论"）。
  const read = byName("lifeos_review_comments");
  await assert.rejects(
    () => read.execute("call-6", { taskId: "9999" }),
    /No task 9999|lifeos_task_list/,
  );
});

test("S4c·8 两个工具名都在 LIFEOS_TOOL_NAMES 白名单里（否则注册了也调不到）", async () => {
  const { LIFEOS_TOOL_NAMES } = await import("../src/tool-names.ts");
  assert.ok(LIFEOS_TOOL_NAMES.includes("lifeos_review_comments"), "白名单缺 lifeos_review_comments");
  assert.ok(LIFEOS_TOOL_NAMES.includes("lifeos_review_comment_add"), "白名单缺 lifeos_review_comment_add");
});

// ── S4-h：Agent 的回复与关闭（闭环链路的另一半）──────────────────────────

test("S4h·T1 两个新工具已注册（回复 / 关闭）", () => {
  assert.ok(byName("lifeos_review_comment_reply"), "缺 lifeos_review_comment_reply");
  assert.ok(byName("lifeos_review_comment_resolve"), "缺 lifeos_review_comment_resolve");
});

test("S4h·T2 Agent 回复用户的评论 → awaiting 变成 user（交棒给用户去查看/关闭）", async () => {
  mkdirSync(join(TASKS_ROOT, "0003-reply"), { recursive: true });
  writeFileSync(join(TASKS_ROOT, "0003-reply", "task.md"), "# 0003\n");
  const { upsertComment } = await import("../src/review-comments.ts");
  const root = await upsertComment(join(TASKS_ROOT, "0003-reply"), {
    taskId: "0003", author: { kind: "user", id: "xu-later" },
    anchor: { source: "worktree", path: "README.md", side: "new", start: 1, end: 1 },
    body: "这里为什么这么写？", marks: ["query"], state: "open",
  });
  const reply = byName("lifeos_review_comment_reply");
  const result = await reply.execute("call-r1", { taskId: "0003", id: root.id, body: "因为它要兼容 v1 数据，见 review-comments.ts:readComments" });
  assert.match(result.content[0].text, /Replied in thread/);
  assert.equal(result.details.comment.awaiting, "user", "Agent 回复后没有交棒给用户");
  assert.equal(result.details.comment.replies.length, 1);
  assert.equal(result.details.comment.replies[0].author.id, "lifeosagent");
});

test("S4h·T3 Agent 关不掉用户提的评论（403 如实抛出，不假装成功）", async () => {
  const { upsertComment, readComments: read } = await import("../src/review-comments.ts");
  mkdirSync(join(TASKS_ROOT, "0004-owned"), { recursive: true });
  writeFileSync(join(TASKS_ROOT, "0004-owned", "task.md"), "# 0004\n");
  const root = await upsertComment(join(TASKS_ROOT, "0004-owned"), {
    taskId: "0004", author: { kind: "user", id: "xu-later" },
    anchor: { source: "worktree", path: "a.ts", side: "new", start: 2, end: 2 },
    body: "用户的意见", marks: [], state: "open",
  });
  const resolve = byName("lifeos_review_comment_resolve");
  await assert.rejects(() => resolve.execute("call-r2", { taskId: "0004", id: root.id }), /不能关闭|提出者/);
  const still = (await read(join(TASKS_ROOT, "0004-owned")))[0];
  assert.equal(still.state, "open", "被拒之后状态却变了——权限校验没生效");
});

test("S4h·T4 Agent 能关自己提的评论；也能重开", async () => {
  const add = byName("lifeos_review_comment_add");
  const resolve = byName("lifeos_review_comment_resolve");
  mkdirSync(join(TASKS_ROOT, "0005-own"), { recursive: true });
  writeFileSync(join(TASKS_ROOT, "0005-own", "task.md"), "# 0005\n");
  const added = await add.execute("call-r3", {
    taskId: "0005", source: "worktree", path: "b.ts", side: "new", start: 1, end: 1, body: "我自己提的", marks: ["todo"],
  });
  const id = added.details.comment.id;
  const closed = await resolve.execute("call-r4", { taskId: "0005", id });
  assert.equal(closed.details.comment.state, "resolved");
  const reopened = await resolve.execute("call-r5", { taskId: "0005", id, resolved: false });
  assert.equal(reopened.details.comment.state, "open");
});

test("S4h·T5 读工具：pendingForMe 只给“还没闭环且等我/没人认领”的（= 我的检视 TODO）", async () => {
  const { upsertComment, setCommentState, setCommentAwaiting } = await import("../src/review-comments.ts");
  const dir = join(TASKS_ROOT, "0006-todo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "task.md"), "# 0006\n");
  const anchor = (p) => ({ source: "worktree", path: p, side: "new", start: 1, end: 1 });
  const waiting = await upsertComment(dir, { taskId: "0006", author: { kind: "user", id: "xu-later" }, anchor: anchor("wait.ts"), body: "等你改", marks: [], state: "open" });
  await setCommentAwaiting(dir, waiting.id, "agent", { kind: "user", id: "xu-later" });
  const nobody = await upsertComment(dir, { taskId: "0006", author: { kind: "user", id: "xu-later" }, anchor: anchor("nobody.ts"), body: "没人认领", marks: [], state: "open" });
  const done = await upsertComment(dir, { taskId: "0006", author: { kind: "user", id: "xu-later" }, anchor: anchor("done.ts"), body: "已闭环", marks: [], state: "open" });
  await setCommentState(dir, done.id, "resolved", { kind: "user", id: "xu-later" });
  const read = byName("lifeos_review_comments");
  const result = await read.execute("call-r6", { taskId: "0006", pendingForMe: true });
  const paths = result.details.comments.map((c) => c.anchor.path).sort();
  assert.deepEqual(paths, ["nobody.ts", "wait.ts"], `pendingForMe 结果不对：${JSON.stringify(paths)}（已关闭的 ${done.anchor.path} 不该出现）`);
  assert.ok(nobody.id);
});

test("S4h·T6 读工具：按 state 过滤（只看已关闭的）", async () => {
  const read = byName("lifeos_review_comments");
  const result = await read.execute("call-r7", { taskId: "0006", state: "resolved" });
  assert.equal(result.details.comments.length, 1);
  assert.equal(result.details.comments[0].state, "resolved");
});

test("S4h·T7 读工具的输出里带回复正文（Agent 要看到前一个人说了什么）", async () => {
  const read = byName("lifeos_review_comments");
  const result = await read.execute("call-r8", { taskId: "0003" });
  assert.match(result.content[0].text, /↳ agent:lifeosagent: 因为它要兼容 v1 数据/, result.content[0].text);
});

test("S4h·T8 四个工具名都在白名单里", async () => {
  const { LIFEOS_TOOL_NAMES } = await import("../src/tool-names.ts");
  for (const name of ["lifeos_review_comments", "lifeos_review_comment_add", "lifeos_review_comment_reply", "lifeos_review_comment_resolve"]) {
    assert.ok(LIFEOS_TOOL_NAMES.includes(name), `白名单缺 ${name}`);
  }
});

// ── P4：总览工具（Agent 的入口）──────────────────────────────────────────

test("P4·T1 lifeos_review_state 已注册且在白名单里", async () => {
  assert.ok(byName("lifeos_review_state"), "缺 lifeos_review_state");
  const { LIFEOS_TOOL_NAMES } = await import("../src/tool-names.ts");
  assert.ok(LIFEOS_TOOL_NAMES.includes("lifeos_review_state"), "白名单缺 lifeos_review_state");
});

test("P4·T2 总览输出：检视对象 + 改动量 + 等待方 + 下一步工具名（一次调用说清四件事）", async () => {
  const state = byName("lifeos_review_state");
  const result = await state.execute("call-p4-1", { taskId: "0003" });
  const text = result.content[0].text;
  assert.match(text, /Review state for task 0003/);
  assert.match(text, /Sources:/);
  assert.match(text, /Changes:/);
  assert.match(text, /Comments:/);
  assert.match(text, /Waiting \(open threads only\): for you/);
  // 下一步必须点名工具与参数形状（Agent 不用猜怎么继续）
  assert.match(text, /lifeos_review_comments\(\{ taskId, pendingForMe: true \}\)/);
  assert.match(text, /lifeos_review_comment_reply/);
  // 详情对象也要给（前端/后续工具可复用，不必再解析文本）
  assert.equal(result.details.overview.taskId, "0003");
  assert.equal(typeof result.details.overview.files.total, "number");
});

test("P4·T3 总览与读工具口径一致：pendingForAgent 条数 = pendingForMe 返回的条数", async () => {
  const state = byName("lifeos_review_state");
  const read = byName("lifeos_review_comments");
  const overview = (await state.execute("call-p4-2", { taskId: "0006" })).details.overview;
  const pending = (await read.execute("call-p4-3", { taskId: "0006", pendingForMe: true })).details.comments;
  assert.equal(overview.comments.pendingForAgent, pending.length,
    `总览说 ${overview.comments.pendingForAgent} 条，读工具给 ${pending.length} 条——两个口径不一致，Agent 会收到自相矛盾的信息`);
});

test("P4·T4 task 不存在 → 抛可行动的错误（不是静默返回空总览）", async () => {
  const state = byName("lifeos_review_state");
  await assert.rejects(() => state.execute("call-p4-4", { taskId: "9999" }), /No task 9999|lifeos_task_list/);
});

test.after(() => { rmSync(HOME, { recursive: true, force: true }); });

// ── D32：Agent 主动打开检视面板 ────────────────────────────────────────────

test("D32·T1 lifeos_review_open 已注册且在白名单里", async () => {
  assert.ok(byName("lifeos_review_open"), "缺 lifeos_review_open");
  const { LIFEOS_TOOL_NAMES } = await import("../src/tool-names.ts");
  assert.ok(LIFEOS_TOOL_NAMES.includes("lifeos_review_open"), "白名单缺 lifeos_review_open");
});

test("D32·T2 调用会广播 review_open 事件（前端据此开面板），带 taskId 与 taskDir", async () => {
  const { subscribeBus, eventsSeq } = await import("../src/events.ts");
  const seen = [];
  const sub = subscribeBus({
    id: "d32-test", focus: () => undefined,
    offer: (event) => { if (event.type === "review_open") seen.push(event); },
    overflowed: () => {},
  });
  sub.ready();
  const open = byName("lifeos_review_open");
  const result = await open.execute("call-open-1", { taskId: "0003" });
  sub.close();
  assert.equal(seen.length, 1, `应广播 1 条 review_open，实际 ${seen.length}`);
  const event = seen[0];
  assert.equal(event.type, "review_open");
  assert.equal(event.taskId, "0003");
  assert.ok(event.taskDir.includes("0003"), event.taskDir);
  assert.equal(event.agentId, "lifeosagent");
  assert.equal(event.projectId, "p");
  assert.match(result.content[0].text, /open the review panel/i);
  assert.ok(eventsSeq() > 0, "事件序号应递增");
});

test("D32·T3 不存在的 task → 抛可行动的错误，且**不广播**", async () => {
  const { subscribeBus } = await import("../src/events.ts");
  const seen = [];
  const sub = subscribeBus({
    id: "d32-test-2", focus: () => undefined,
    offer: (event) => { if (event.type === "review_open") seen.push(event); },
    overflowed: () => {},
  });
  sub.ready();
  const open = byName("lifeos_review_open");
  await assert.rejects(() => open.execute("call-open-2", { taskId: "9999" }), /No task 9999|lifeos_task_list/);
  sub.close();
  assert.equal(seen.length, 0, "失败时不该广播（否则前端会去开一个不存在的检视）");
});
