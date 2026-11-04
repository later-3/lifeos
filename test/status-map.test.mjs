// 状态聚合：会话 → 项目 → 助手 的**三个计数**（正在跑 / 已正常结束 / 异常结束）。
//
// 2026-11-04 定稿（用户裁决）：三个徽标，**都不看已读**。
// 为什么不是"未读"：徽标回答「发生过什么」，不回答「我看没看」。
// 早期把"完成"做成"未读"，用户点开一个完成的会话后数字从 6 掉到 5 ——
// 历史事实不该因为读过了而消失。「有未读」由会话行的绿点表达。
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStatus } from "../frontend/src/status-map.ts";

/** 造一条会话行：只关心四态。 */
const s = (state, agentId = "a", projectId) => ({
  meta: { agentId, ...(projectId !== undefined ? { projectId } : {}) },
  activity: { state },
});
/** 造服务端聚合项（三计数）。 */
const agg = (agentId, projectId, running, completed, failed) => ({
  agentId, ...(projectId !== undefined ? { projectId } : {}), running, completed, failed,
});
const P = (agentId, projectId) => `${agentId}\u0000${projectId}`;

test("T61 服务端三计数直接落到助手层与项目层（不看已读）", async () => {
  const r = deriveStatus({
    sessions: {},
    aggregate: [
      agg("alpha", "p1", 2, 5, 1),
      agg("beta", "p9", 0, 3, 0),
    ],
  }, { visible: false });
  assert.deepEqual(r.agents.alpha, { running: 2, completed: 5, failed: 1 });
  assert.deepEqual(r.agents.beta, { running: 0, completed: 3, failed: 0 });
  assert.deepEqual(r.projects[P("alpha", "p1")], { running: 2, completed: 5, failed: 1 });
});

test("T61b 已读不影响任何计数（这是与旧实现的关键区别）", async () => {
  // 服务端给的数就是终态事实；前端再怎么焦点、visible，都不该动 completed/failed
  const facts = { sessions: {}, aggregate: [agg("alpha", "p1", 0, 5, 1)] };
  const focused = deriveStatus(facts, { agentId: "alpha", sessionId: "anything", visible: true });
  const hidden = deriveStatus(facts, { agentId: "alpha", sessionId: "anything", visible: false });
  assert.deepEqual(focused.agents.alpha, hidden.agents.alpha, "焦点/可见性不能改变完成数或失败数");
  assert.deepEqual(focused.agents.alpha, { running: 0, completed: 5, failed: 1 });
});

test("T62 三个计数互相独立：同一批会话可以同时有跑、完成、失败", async () => {
  const r = deriveStatus({
    sessions: {},
    aggregate: [agg("alpha", "p1", 3, 7, 2)],
  }, { visible: false });
  assert.deepEqual(r.agents.alpha, { running: 3, completed: 7, failed: 2 }, "三个数字各数各的，不是互斥选择");
});

test("T63 没有项目归属的会话进助手层，不臆造项目键", async () => {
  const r = deriveStatus({ sessions: {}, aggregate: [agg("alpha", undefined, 1, 2, 0)] }, { visible: false });
  assert.deepEqual(r.agents.alpha, { running: 1, completed: 2, failed: 0 });
  assert.deepEqual(Object.keys(r.projects), []);
});

test("T64 焦点会话的未读仍被扣掉（会话行绿点的语义，与徽标计数无关）", async () => {
  const r = deriveStatus({
    aggregate: [],
    sessions: { A1: s("unread", "alpha", "p1") },
  }, { agentId: "alpha", sessionId: "A1", visible: true });
  assert.equal(r.sessions.A1.unread, false, "正在看的会话，行上不该显示未读绿点");
});

test("T65 运行态用会话行**替换**服务端数（跑不跑是此刻的事实，行更即时）", async () => {
  // 只有"当前打开的 Agent"有完整会话列表 —— 所以替换只对它的数字生效，别的 Agent 仍信服务端
  const r = deriveStatus({
    aggregate: [agg("alpha", "p1", 2, 5, 1)],   // 服务端说 2 个在跑
    sessions: { A1: s("running", "alpha", "p1") },  // 前端只见到 1 个在跑
  }, { agentId: "alpha", visible: false });
  assert.equal(r.agents.alpha.running, 1, "运行数取行（更新）");
  assert.equal(r.agents.alpha.completed, 5, "完成数保持服务端值");
  assert.equal(r.agents.alpha.failed, 1, "失败数保持服务端值");
});

test("T66 **完成数与失败数不能被会话行覆盖**（这是修掉的真实 bug：6 会变成 1）", async () => {
  const r = deriveStatus({
    aggregate: [agg("alpha", "p1", 0, 6, 0)],   // 服务端：6 条完成
    sessions: { A1: s("unread", "alpha", "p1") },  // 前端只有 1 条（别的项目没加载）
  }, { visible: false });
  assert.equal(r.agents.alpha.completed, 6, "前端只见到 1 条，不能让完成数从 6 掉到 1");
  assert.equal(r.projects[P("alpha", "p1")].completed, 6);
});

test("T67 没有 aggregate 时退化为只看手上的会话行（首帧/断线可用）", async () => {
  const r = deriveStatus({
    sessions: { A1: s("running", "alpha", "p1"), A2: s("failure", "alpha", "p2") },
  }, { visible: false });
  assert.equal(r.sessions.A1.running, true);
  assert.equal(r.sessions.A2.failure, true);
  assert.equal(Object.keys(r.agents).length, 0, "没有服务端聚合就数不出层级的计数，不编");
});

test("T68 空输入：三层都是空对象，不产生幽灵键", async () => {
  const r = deriveStatus({ sessions: {} }, { visible: true });
  assert.deepEqual(r.projects, {});
  assert.deepEqual(r.agents, {});
  assert.deepEqual(r.sessions, {});
});

test("T69 多个 Agent 同时有数字（助手列的核心需求：不点进去也能看到）", async () => {
  const r = deriveStatus({
    sessions: {},
    aggregate: [
      agg("alpha", "p1", 1, 2, 0),
      agg("beta", "p9", 0, 0, 1),
      agg("gamma", "p2", 2, 0, 0),
    ],
  }, { visible: false });
  assert.deepEqual(r.agents.alpha, { running: 1, completed: 2, failed: 0 });
  assert.deepEqual(r.agents.beta, { running: 0, completed: 0, failed: 1 });
  assert.deepEqual(r.agents.gamma, { running: 2, completed: 0, failed: 0 });
});

test("T70 聚合层不做 99 上限（截断是显示层的事）", async () => {
  const r = deriveStatus({ sessions: {}, aggregate: [agg("alpha", "p1", 120, 150, 8)] }, { visible: false });
  assert.deepEqual(r.agents.alpha, { running: 120, completed: 150, failed: 8 });
});
