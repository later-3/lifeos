// 状态聚合：会话 → 项目 → 助手（Task 0005 · 2026-11-04 定稿）。
//
// **未读只有一种概念**：一次回合结束了、用户还没看过。它有两个结果 ——
// 正常结束（绿）与异常结束（红），规则完全相同：看过就消失。
// 所以 Status 的两个终态字段名带 unread 前缀：`unreadDone` / `unreadError`。
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStatus } from "../frontend/src/status-map.ts";

/** 造一条会话行：只关心四态。 */
const s = (state, agentId = "a", projectId) => ({
  meta: { agentId, ...(projectId !== undefined ? { projectId } : {}) },
  activity: { state },
});
/** 造服务端聚合项（三计数，两个终态都是"未读"）。 */
const agg = (agentId, projectId, running, unreadDone, unreadError) => ({
  agentId, ...(projectId !== undefined ? { projectId } : {}), running, unreadDone, unreadError,
});
const P = (agentId, projectId) => `${agentId}\u0000${projectId}`;

test("T61 服务端三计数直接落到助手层与项目层", async () => {
  const r = deriveStatus({
    sessions: {},
    aggregate: [agg("alpha", "p1", 2, 5, 1), agg("beta", "p9", 0, 3, 0)],
  }, { visible: false });
  assert.deepEqual(r.agents.alpha, { running: 2, unreadDone: 5, unreadError: 1 });
  assert.deepEqual(r.agents.beta, { running: 0, unreadDone: 3, unreadError: 0 });
  assert.deepEqual(r.projects[P("alpha", "p1")], { running: 2, unreadDone: 5, unreadError: 1 });
});

test("T62 助手列能同时显示多个 Agent 的数字（不点进去也要看得到）", async () => {
  const r = deriveStatus({
    sessions: {},
    aggregate: [agg("alpha", "p1", 1, 2, 0), agg("beta", "p9", 0, 0, 1), agg("gamma", "p2", 2, 0, 0)],
  }, { visible: false });
  assert.deepEqual(r.agents.alpha, { running: 1, unreadDone: 2, unreadError: 0 });
  assert.deepEqual(r.agents.beta, { running: 0, unreadDone: 0, unreadError: 1 });
  assert.deepEqual(r.agents.gamma, { running: 2, unreadDone: 0, unreadError: 0 });
});

test("T63 三种数字互相独立（同一批会话可以同时有跑、完成、失败）", async () => {
  const r = deriveStatus({ sessions: {}, aggregate: [agg("alpha", "p1", 3, 7, 2)] }, { visible: false });
  assert.deepEqual(r.agents.alpha, { running: 3, unreadDone: 7, unreadError: 2 });
});

test("T64 没有项目归属的会话进助手层，不臆造项目键", async () => {
  const r = deriveStatus({ sessions: {}, aggregate: [agg("alpha", undefined, 1, 2, 0)] }, { visible: false });
  assert.deepEqual(r.agents.alpha, { running: 1, unreadDone: 2, unreadError: 0 });
  assert.deepEqual(Object.keys(r.projects), []);
});

test("T65 焦点会话的未读被扣掉（行上看不到绿点，数字也要跟着减）", async () => {
  const r = deriveStatus({
    aggregate: [agg("alpha", "p1", 0, 2, 0)],
    sessions: { A1: s("unread", "alpha", "p1"), A2: s("unread", "alpha", "p1") },
  }, { agentId: "alpha", sessionId: "A1", visible: true });
  assert.equal(r.sessions.A1.unread, false, "正在看的会话不显示绿点");
  assert.equal(r.sessions.A2.unread, true);
});

test("T66 聚合只来自 aggregate，不被会话行覆盖（状态机模型）", async () => {
  // 2026-11-04 改：running 的真相在 sessionSlots（补丁直接改它、覆盖所有 Agent）。
  // 用会话行去覆盖会 ① 把别的 Agent 的 running 抹成 0 ② 行滞后时数字停在旧值（实测过）。
  const r = deriveStatus({
    aggregate: [agg("alpha", "p1", 2, 5, 1), agg("beta", "p9", 3, 0, 0)],
    sessions: { A1: s("running", "alpha", "p1") },
  }, { agentId: "alpha", visible: false });
  assert.equal(r.agents.alpha.running, 2, "alpha 的运行数来自聚合（2），不被 1 条会话行覆盖");
  assert.equal(r.agents.beta.running, 3, "别的 Agent 的运行数不能被抹成 0");
  assert.equal(r.agents.alpha.unreadDone, 5, "未读数同样只信聚合");
});

test("T67 **未读数不能被会话行覆盖**（修掉的真实 bug：6 会变成 1）", async () => {
  const r = deriveStatus({
    aggregate: [agg("alpha", "p1", 0, 6, 0)],
    sessions: { A1: s("unread", "alpha", "p1") },   // 前端只有 1 条（别的项目没加载）
  }, { visible: false });
  assert.equal(r.agents.alpha.unreadDone, 6, "前端只见到 1 条，不能让数字从 6 掉到 1");
});

test("T68 没有 aggregate 时退化为只看手上的会话行（首帧/断线可用）", async () => {
  const r = deriveStatus({
    sessions: { A1: s("running", "alpha", "p1"), A2: s("failure", "alpha", "p2") },
  }, { visible: false });
  assert.equal(r.sessions.A1.running, true);
  assert.equal(r.sessions.A2.failure, true);
  assert.equal(Object.keys(r.agents).length, 0, "没有服务端聚合就数不出层级计数，不编");
});

test("T69 空输入：三层都是空对象", async () => {
  const r = deriveStatus({ sessions: {} }, { visible: true });
  assert.deepEqual(r.projects, {});
  assert.deepEqual(r.agents, {});
  assert.deepEqual(r.sessions, {});
});

test("T70 聚合层不做 99 上限（截断是显示层的事）", async () => {
  const r = deriveStatus({ sessions: {}, aggregate: [agg("alpha", "p1", 120, 150, 8)] }, { visible: false });
  assert.deepEqual(r.agents.alpha, { running: 120, unreadDone: 150, unreadError: 8 });
});

// ——————————————————————————————————————————————————————————————
// 状态机：补丁如何改槽位（2026-11-05 用户实测 bug 的回归）
// ——————————————————————————————————————————————————————————————
//
// 这两个用例对应一个真实故障：用户点开一个**正在跑**的会话，
// 行上蓝点在呼吸，但项目行/助手行**没有数字**。
//
// 根因：点开会话 → 服务端 focus → `markSessionViewed` 推 `{ unread: null }`
// → 前端原来一律 `setSlot(..., undefined)`，把整条槽位删掉（含 running）。
//
// 现在规则：`{ unread: null }` 只清"未读"，**在跑的保持不动**。

/** 迷你版状态机（与 App.tsx 的 setSlot / clearUnreadSlot 同一规则）。 */
const makeSlots = () => {
  const map = new Map();
  const setSlot = (sessionId, agentId, projectId, slot) => {
    if (slot === undefined) { map.delete(sessionId); return; }
    const current = map.get(sessionId);
    // projectId 只增不减
    const effective = projectId ?? current?.projectId;
    map.set(sessionId, { agentId, ...(effective !== undefined ? { projectId: effective } : {}), slot });
  };
  const clearUnreadSlot = (sessionId) => {
    const current = map.get(sessionId);
    if (current === undefined) return;
    if (current.slot === "running") return;   // 在跑的不受"已读"影响
    map.delete(sessionId);
  };
  const apply = (sessionId, agentId, projectId, patch) => {
    if ("unread" in patch && patch.unread !== null && patch.unread !== undefined) {
      setSlot(sessionId, agentId, projectId, patch.failure != null ? "unreadError" : "unreadDone");
    } else if ("unread" in patch && patch.unread === null) {
      clearUnreadSlot(sessionId);
    } else if ("running" in patch && patch.running !== null && patch.running !== undefined) {
      setSlot(sessionId, agentId, projectId, "running");
    } else if ("running" in patch && patch.running === null) {
      setSlot(sessionId, agentId, projectId, undefined);
    }
  };
  return { map, apply };
};

test("T67 点开正在跑的会话（{unread:null}）不清掉 running 槽位", () => {
  const { map, apply } = makeSlots();
  apply("s1", "a", "p1", { running: { since: "2026-11-05T00:00:00Z" } });
  assert.equal(map.get("s1")?.slot, "running", "开跑后应占 running 格");

  // 用户点开它 → 服务端推 {unread: null}（此时它根本没有未读）
  apply("s1", "a", "p1", { unread: null });

  assert.equal(map.get("s1")?.slot, "running", "在跑的会话不能被「已读」清掉");
  assert.equal(map.get("s1")?.projectId, "p1", "项目归属也要保住");
});

test("T68 点开已完成未读的会话（{unread:null}）清掉槽位", () => {
  const { map, apply } = makeSlots();
  apply("s1", "a", "p1", { unread: { since: "2026-11-05T00:00:00Z" } });
  assert.equal(map.get("s1")?.slot, "unreadDone");

  apply("s1", "a", "p1", { unread: null });

  assert.equal(map.get("s1"), undefined, "未读被看过 → 这条不再计数");
});

test("T69 不带 projectId 的补丁不把槽位挪到「无项目桶」", () => {
  const { map, apply } = makeSlots();
  apply("s1", "a", "p1", { running: { since: "2026-11-05T00:00:00Z" } });

  // 历史上 focus 端点推的补丁不带 projectId
  apply("s1", "a", undefined, { running: { since: "2026-11-05T00:00:05Z" } });

  assert.equal(map.get("s1")?.projectId, "p1", "projectId 只增不减：不能被 undefined 覆盖");
});

// ——————————————————————————————————————————————————————————————
// 焦点判定不看 visible（2026-11-08 用户裁决的回归）
// ——————————————————————————————————————————————————————————————
//
// 用户原话：
// > 他只要当前在这个 session 上，你就不要管他去干嘛了，我们只做我们自己的逻辑……
// > 我们只能保证当前页面上是什么状态、怎么去流转，我们的状态机该怎么去转，
// > 你不可能管到他到底看没看呀。
//
// 现象：回合结束时标签页恰好不可见 → 记成未读 → 用户切走 → 服务端再也不会清
// → "我明明在这个会话里，绿点却一直挂着，还非得再切回去再切出来才消失"。

test("T72 停在某个会话上时，即使标签页不可见，它的未读也不算数", () => {
  const facts = {
    sessions: { s1: { meta: { agentId: "a" }, activity: { state: "unread" } } },
    aggregate: [{ agentId: "a", running: 0, unreadDone: 1, unreadError: 0 }],
  };
  for (const visible of [true, false]) {
    const derived = deriveStatus(facts, { agentId: "a", sessionId: "s1", visible });
    assert.equal(derived.sessions.s1?.unread, false, `visible=${visible}：停在这个会话上就不算未读`);
  }
});

test("T73 停在别的会话上时，这个会话的未读仍然算数", () => {
  const facts = {
    sessions: { s1: { meta: { agentId: "a" }, activity: { state: "unread" } } },
    aggregate: [{ agentId: "a", running: 0, unreadDone: 1, unreadError: 0 }],
  };
  const derived = deriveStatus(facts, { agentId: "a", sessionId: "other", visible: true });
  assert.equal(derived.sessions.s1?.unread, true, "没停在这个会话上 → 未读该显示");
});
