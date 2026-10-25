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
