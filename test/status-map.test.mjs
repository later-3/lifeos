// 状态聚合：会话 → 项目 → 助手 的三个数量（运行中 / 已完成待查看 / 失败）。
//
// 2026-11-03 重写（Task 0005）：旧版断言 `Status = {running: boolean, unread: number}`，
// 输入是两个 Set（running/unread）。新版只吃会话四态 —— 这样聚合与行上的点同源，
// 不可能出现"行上有点、数字没涨"。
//
// 断言里带 `failure: 0` 的字段是必需的：`deepEqual` 会连"有没有这个键"一起比，
// 少写一个键测试就会红 —— 这正是我们想要的（防止以后又把维度静默丢掉）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStatus } from "../frontend/src/status-map.ts";

/** 造一个会话：只关心四态，其余字段用最小形状。 */
const s = (state, agentId = "a", projectId) => ({
  meta: { agentId, ...(projectId !== undefined ? { projectId } : {}) },
  activity: { state },
});

const P = (agentId, projectId) => `${agentId}\u0000${projectId}`;

// A2 在跑；A1/A3/B1 待查看；A4 失败。A1 与 A2 同在 p1，A3 在 p2，B1 在 p9。
const facts = {
  sessions: {
    A1: s("unread", "a", "p1"),
    A2: s("running", "a", "p1"),
    A3: s("unread", "a", "p2"),
    A4: s("failure", "a", "p2"),
    B1: s("unread", "b", "p9"),
    C1: s("idle", "a", "p1"),
  },
};

test("T61 聚合：三个数量各自求和；零值字段存在但不渲染（由组件决定）", async () => {
  const r = deriveStatus(facts, { visible: false });
  assert.deepEqual(r.projects[P("a", "p1")], { running: 1, unread: 1, failure: 0 }, "p1：A2 在跑 + A1 待查看 + C1 空闲");
  assert.deepEqual(r.projects[P("a", "p2")], { running: 0, unread: 1, failure: 1 }, "p2：A3 待查看 + A4 失败");
  assert.deepEqual(r.projects[P("b", "p9")], { running: 0, unread: 1, failure: 0 });
  // 助手层**累加会话数**（不是项目数）：a 有 1 跑 + 2 待查看 + 1 失败
  assert.deepEqual(r.agents.a, { running: 1, unread: 2, failure: 1 });
  assert.deepEqual(r.agents.b, { running: 0, unread: 1, failure: 0 });
});

test("T61b 助手层是会话数、不是项目数 —— 旧语义会得到 2，新语义得到 2 个会话（同数不同义，用 p2 单会话验证）", async () => {
  // 只留一个项目、两个未读会话：旧语义（项目数）= 1，新语义（会话数）= 2
  const only = { sessions: { X: s("unread", "a", "p1"), Y: s("unread", "a", "p1") } };
  const r = deriveStatus(only, { visible: false });
  assert.equal(r.agents.a.unread, 2, "两个会话都在同一项目里 → 助手显示 2（旧实现会显示 1）");
  assert.equal(r.projects[P("a", "p1")].unread, 2);
});

test("T62 焦点会话（页面可见）不计未读；页面隐藏时仍计", async () => {
  const visible = deriveStatus(facts, { agentId: "a", sessionId: "A1", visible: true });
  assert.equal(visible.sessions.A1.unread, false, "正在看 → 不算未读");
  assert.equal(visible.projects[P("a", "p1")].unread, 0);
  assert.equal(visible.agents.a.unread, 1, "只剩 A3");

  const hidden = deriveStatus(facts, { agentId: "a", sessionId: "A1", visible: false });
  assert.equal(hidden.sessions.A1.unread, true, "页签隐藏不算看过");
  assert.equal(hidden.agents.a.unread, 2);
});

test("T63 查看即消：activity 变 idle → 三层数字同步减一（聚合是纯派生，不另存）", async () => {
  const viewed = { ...facts, sessions: { ...facts.sessions, A1: s("idle", "a", "p1") } };
  const r = deriveStatus(viewed, { visible: true });
  assert.equal(r.agents.a.unread, 1);
  assert.equal(r.projects[P("a", "p1")].unread, 0);
  assert.equal(r.projects[P("a", "p1")].running, 1, "A2 仍在跑，不受影响");
});

test("T64 没有项目归属的会话只进助手层，不臆造项目键", async () => {
  const r = deriveStatus({ sessions: { X: s("unread", "a") } }, { visible: false });
  assert.equal(r.agents.a.unread, 1);
  assert.deepEqual(Object.keys(r.projects), [], "不得凭空造项目");
});

test("T65 失败与待查看互斥（四态互斥的直接后果）：一个会话只计一次", async () => {
  const r = deriveStatus({ sessions: { X: s("failure", "a", "p1") } }, { visible: false });
  assert.deepEqual(r.agents.a, { running: 0, unread: 0, failure: 1 }, "失败不重复计为待查看");
  assert.deepEqual(r.projects[P("a", "p1")], { running: 0, unread: 0, failure: 1 });
});

test("T66 运行中的会话在同一次聚合里也计入 running，且不因焦点被吞掉", async () => {
  const r = deriveStatus({ sessions: { X: s("running", "a", "p1") } }, { agentId: "a", sessionId: "X", visible: true });
  assert.equal(r.projects[P("a", "p1")].running, 1, "正在看的会话在跑，数字照样是 1");
  assert.equal(r.agents.a.running, 1);
});

test("T67 空列表：三层都是空对象，不产生幽灵键", async () => {
  const r = deriveStatus({ sessions: {} }, { visible: true });
  assert.deepEqual(r.projects, {});
  assert.deepEqual(r.agents, {});
  assert.deepEqual(r.sessions, {});
});

test("T68 数量可以超过 99（聚合层不做上限，显示层才写 99+）", async () => {
  const many = { sessions: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`S${i}`, s("unread", "a", "p1")])) };
  const r = deriveStatus(many, { visible: false });
  assert.equal(r.agents.a.unread, 120, "聚合层给真值，截断是显示层的事");
});
