// T47–T52：前端事件路由（任务 0007 P4）——纯函数：事件 + 焦点 → 动作。App 只执行动作，不做判断。
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeEvent } from "../frontend/src/event-router.ts";

const focusA = { agentId: "A", sessionId: "s1", visible: true };
const turn = (agentId, sessionId, state, seq = 10) => ({ seq, agentId, sessionId, type: "turn", turnId: `t-${sessionId}`, state });
const done = (agentId, sessionId, seq = 11) => ({ seq, agentId, sessionId, type: "done", turnId: `t-${sessionId}` });

test("T47 后台会话的 turn(running) 只进运行事实，不进消息管道、不弹提示", async () => {
  const actions = routeEvent(turn("B", "s9", "running"), focusA, 0);
  assert.deepEqual(actions.map((a) => a.kind), ["run"]);
});

test("T48 后台会话完成 → 运行事实 + 列表刷新 + 带动作的完成提示（点击可切过去）", async () => {
  const actions = routeEvent(done("B", "s9"), focusA, 0);
  const kinds = actions.map((a) => a.kind);
  assert.ok(kinds.includes("completion"), "必须产生完成提示");
  assert.ok(kinds.includes("refresh-groups"));
  const c = actions.find((a) => a.kind === "completion");
  assert.deepEqual({ agentId: c.agentId, sessionId: c.sessionId, outcome: c.outcome }, { agentId: "B", sessionId: "s9", outcome: "done" });
});

test("T49 焦点会话且页面可见时完成 → 不弹提示（用户正在看）", async () => {
  const actions = routeEvent(done("A", "s1"), focusA, 0);
  assert.equal(actions.some((a) => a.kind === "completion"), false);
  assert.equal(actions.some((a) => a.kind === "message"), true, "焦点会话的终态进消息管道");
});

test("T50 基线之前的事件（快照之前的重放）一律丢弃", async () => {
  assert.deepEqual(routeEvent(done("B", "s9", 5), focusA, 5).map((a) => a.kind), ["drop"]);
});

test("T51 细节事件只属于焦点会话；其他会话的 delta 必须丢弃（不串到当前消息）", async () => {
  const delta = { seq: 20, agentId: "B", sessionId: "s9", type: "delta", index: 0, text: "x" };
  assert.deepEqual(routeEvent(delta, focusA, 0).map((a) => a.kind), ["drop"]);
  const mine = { ...delta, agentId: "A", sessionId: "s1" };
  assert.deepEqual(routeEvent(mine, focusA, 0).map((a) => a.kind), ["message"]);
});

// T52 的 Agent 二选一语义已由状态映射取代（见 test/status-map.test.mjs T61–T63）

// T59：流是否"死了"（任务 0007 补充：经代理的 SSE 断开可能不触发 error，必须有客户端看门狗）
import { isStreamStale } from "../frontend/src/event-router.ts";
test("T59 流陈旧判定：超过阈值没有任何帧（含心跳）才算死；刚收到过不算", async () => {
  assert.equal(isStreamStale(1_000, 1_000 + 24_999, 25_000), false);
  assert.equal(isStreamStale(1_000, 1_000 + 25_000, 25_000), true);
  assert.equal(isStreamStale(0, 0, 25_000), false, "刚建立连接的时刻不算陈旧");
});

// —— T71–T73 行补丁（任务 0005）：不触发列表重取、不做焦点过滤、基线之前丢弃 ——
test("T71 row 事件只产生一个 row 动作，**不**触发 refresh-groups（不重取整个列表）", async () => {
  const row = { seq: 30, agentId: "A", sessionId: "s1", type: "row", patch: { running: { since: "T0", phase: "tool", tool: "read" } } };
  const actions = routeEvent(row, focusA, 0);
  assert.deepEqual(actions.map((a) => a.kind), ["row"], "只有一个动作");
  assert.equal(actions.some((a) => a.kind === "refresh-groups"), false, "绝不能触发全量重取");
  assert.equal(actions[0].sessionId, "s1");
  assert.deepEqual(actions[0].patch, row.patch, "补丁原样传给执行侧");
});

test("T72 row 事件不做焦点过滤：非焦点会话的运行态也要更新列表", async () => {
  const other = { seq: 31, agentId: "B", sessionId: "s9", type: "row", patch: { running: null } };
  const actions = routeEvent(other, focusA, 0);   // 焦点在 A/s1，事件属于 B/s9
  assert.deepEqual(actions.map((a) => a.kind), ["row"], "别的会话的补丁照样要应用（列表要显示它在跑）");
});

test("T73 row 事件遵守基线：快照之前的重放一律丢弃", async () => {
  const stale = { seq: 5, agentId: "A", sessionId: "s1", type: "row", patch: { running: null } };
  assert.deepEqual(routeEvent(stale, focusA, 5).map((a) => a.kind), ["drop"]);
});

// —— T74–T75 删除补丁必须带 projectId 与 was（Task 0005 · P8 补）——
// 背景：客户端收到 removed 只删了行，助手行的数字没减（用户实测「删了一个未读，数量没有减少」）。
// 根因是补丁没告诉客户端"该减哪一格、在哪个分组"。
test("T74 removed 补丁把 projectId 与 was 一路带到执行侧", async () => {
  const ev = {
    seq: 40, agentId: "A", sessionId: "s1", projectId: "p1", type: "row",
    patch: { removed: true, was: "unreadDone" },
  };
  const actions = routeEvent(ev, focusA, 0);
  assert.deepEqual(actions.map((a) => a.kind), ["row"]);
  assert.equal(actions[0].projectId, "p1", "客户端要靠它定位该减哪个分组的数字");
  assert.deepEqual(actions[0].patch, { removed: true, was: "unreadDone" });
});

test("T75 没有 projectId 的补丁也要能路由（不能因为缺字段就丢掉整条）", async () => {
  const ev = { seq: 41, agentId: "A", sessionId: "s1", type: "row", patch: { removed: true } };
  const actions = routeEvent(ev, focusA, 0);
  assert.deepEqual(actions.map((a) => a.kind), ["row"]);
  assert.equal(actions[0].projectId, undefined);
});

// —— T76–T77 运行/终态补丁要能驱动聚合（Task 0005 · 2026-11-04 用户实测）——
// 背景：会话开跑时服务端**只发 row 补丁、不重发快照** → 前端 agentAggregate 不更新
// → 用户看到"一个 session 正在回复，但正在跑的数字不出现"。
// 组件层逻辑在 App.tsx（bumpAggregate），这里保证**补丁本身带够信息**：
//   · 开跑/结束：patch.running 有值 / null
//   · 终态：patch.unread 有值 + 失败时 patch.failure 有值（决定进 unreadDone 还是 unreadError）
test("T76 开跑补丁带 running；结束补丁带 running:null + unread", async () => {
  const start = { seq: 50, agentId: "A", sessionId: "s1", projectId: "p1", type: "row", patch: { running: { since: "T0", phase: "waiting" } } };
  const a1 = routeEvent(start, focusA, 0);
  assert.equal(a1[0].patch.running.phase, "waiting", "开跑必须带 running（前端据此 +1）");

  const done = { seq: 51, agentId: "A", sessionId: "s1", projectId: "p1", type: "row", patch: { running: null, unread: { since: "T9" } } };
  const a2 = routeEvent(done, focusA, 0);
  assert.equal(a2[0].patch.running, null, "结束必须发 running:null（前端据此 -1）");
  assert.ok(a2[0].patch.unread !== undefined, "并同时带 unread（前端据此给 unreadDone +1）");
});

test("T77 失败终态补丁必须带 failure —— 前端靠它区分「失败待看」还是「完成待看」", async () => {
  const failed = {
    seq: 52, agentId: "A", sessionId: "s1", projectId: "p1", type: "row",
    patch: { running: null, unread: { since: "T9" }, failure: { kind: "auth", detail: "401" }, lastActivityAt: "T9" },
  };
  const actions = routeEvent(failed, focusA, 0);
  assert.equal(actions[0].patch.failure.kind, "auth", "失败补丁必须带 failure；不带就会被当成 unreadDone");
  assert.ok(actions[0].patch.unread !== undefined);
});

// ── D32：Agent 请求打开检视面板（review_open 事件分流）────────────────────

test("D32·R1 review_open 分流成 review-open 动作（带 taskId/taskDir/agentId/projectId）", () => {
  const event = {
    seq: 5, type: "review_open", taskId: "0010",
    taskDir: "/h/agents/a/projects/p/tasks/0010-x", agentId: "a", projectId: "p",
  };
  const actions = routeEvent(event, { visible: true }, 0);
  assert.deepEqual(actions, [{
    kind: "review-open", taskId: "0010", taskDir: "/h/agents/a/projects/p/tasks/0010-x", agentId: "a", projectId: "p",
  }]);
});

test("D32·R2 review_open 缺 taskId 或 taskDir → 丢弃（不猜）", () => {
  const base = { seq: 5, type: "review_open", agentId: "a", projectId: "p" };
  assert.deepEqual(routeEvent({ ...base, taskDir: "/x" }, { visible: true }, 0), [{ kind: "drop", reason: "stale" }]);
  assert.deepEqual(routeEvent({ ...base, taskId: "0001" }, { visible: true }, 0), [{ kind: "drop", reason: "stale" }]);
});

test("D32·R3 基线之前的 review_open 被丢弃（快照优先，C119 推广）", () => {
  const event = { seq: 3, type: "review_open", taskId: "0001", taskDir: "/x", agentId: "a", projectId: "p" };
  assert.deepEqual(routeEvent(event, { visible: true }, 5), [{ kind: "drop", reason: "stale" }]);
});
