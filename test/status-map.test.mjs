// T61–T63：状态映射（任务 0008）——会话 → 项目 → Agent 的运行与未读派生；查看即消；数量按会话计。
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStatus } from "../frontend/src/status-map.ts";

const facts = {
  sessions: {
    A1: { agentId: "a", projectId: "p1" },
    A2: { agentId: "a", projectId: "p1" },
    A3: { agentId: "a", projectId: "p2" },
    B1: { agentId: "b", projectId: "p9" },
  },
  running: ["A2"],
  unread: ["A1", "A3", "B1"],
};
const P = (agentId, projectId) => `${agentId}\u0000${projectId}`;

test("T61 聚合：会话 → 项目 → Agent；运行向上'或'，未读数量向上'求和'（按会话个数计）", async () => {
  const focus = { agentId: "a", sessionId: "A1", visible: true };   // 正在看 A1
  const s = deriveStatus(facts, focus);
  assert.equal(s.sessions.A2.running, true);
  assert.equal(s.sessions.A2.unread, false, "运行中且不在 unread 输入里 → 不计未读");
  assert.equal(s.sessions.A1.unread, false, "焦点会话（页面可见）不计未读");
  assert.equal(s.sessions.A3.unread, true);
  assert.deepEqual(s.projects[P("a", "p1")], { running: true, unread: 0 }, "p1：A2 在跑，A1 已看");
  assert.deepEqual(s.projects[P("a", "p2")], { running: false, unread: 1 });
  assert.deepEqual(s.projects[P("b", "p9")], { running: false, unread: 1 });
  assert.deepEqual(s.agents.a, { running: true, unread: 1 }, "Agent a：运行中 + 1 个未读（A3）");
  assert.deepEqual(s.agents.b, { running: false, unread: 1 });
});

test("T62 隐藏页签时焦点会话不算已读（回到页面可见后才清）", async () => {
  const s = deriveStatus(facts, { agentId: "a", sessionId: "A1", visible: false });
  assert.equal(s.sessions.A1.unread, true);
  assert.deepEqual(s.projects[P("a", "p1")], { running: true, unread: 1 });
  assert.equal(s.agents.a.unread, 2, "A1 + A3");
});

test("T63 查看即消：未读输入移除该会话 → 所有上层数量同步减一（派生，不另写）", async () => {
  const viewed = { ...facts, unread: ["A3", "B1"] };
  const s = deriveStatus(viewed, { agentId: "a", sessionId: "A1", visible: true });
  assert.equal(s.sessions.A1.unread, false);
  assert.equal(s.agents.a.unread, 1);
  assert.equal(s.projects[P("a", "p1")].unread, 0);
});

test("T64 没有项目信息的会话只计入 Agent 层，不产生项目键（不得臆造项目）", async () => {
  const s = deriveStatus({ sessions: { X: { agentId: "a" } }, running: [], unread: ["X"] }, { visible: false });
  assert.equal(s.agents.a.unread, 1);
  assert.deepEqual(Object.keys(s.projects), []);
});

// T67–T69：层级计数（任务 0009）——Agent 的数字 = 需要查看的 Project 个数；Project 的数字 = 未查看的会话个数。
const P2 = (agentId, projectId) => `${agentId}\u0000${projectId}`;
test("T67 你的例子：Agent 有两个 Project；P1 有 3 个未看会话，看了 1 个 → P1 数字 3→2、绿点仍在，Agent 数字不变（仍有两个 Project 未看完）", async () => {
  const sessions = {
    x1: { agentId: "a", projectId: "P1" }, x2: { agentId: "a", projectId: "P1" }, x3: { agentId: "a", projectId: "P1" },
    y1: { agentId: "a", projectId: "P2" },
  };
  const before = deriveStatus({ sessions, running: [], unread: ["x1", "x2", "x3", "y1"] }, { visible: false });
  assert.equal(before.projects[P2("a", "P1")].unread, 3);
  assert.equal(before.projects[P2("a", "P2")].unread, 1);
  assert.equal(before.agents.a.unread, 2, "Agent 数字 = 需要查看的 Project 个数（P1、P2 两个）");
  // 看了 x1（查看 = 从未读输入移除）
  const after = deriveStatus({ sessions, running: [], unread: ["x2", "x3", "y1"] }, { visible: false });
  assert.equal(after.projects[P2("a", "P1")].unread, 2, "P1 数字 3→2");
  assert.equal(after.projects[P2("a", "P1")].unread > 0, true, "P1 绿点仍在");
  assert.equal(after.agents.a.unread, 2, "Agent 数字不变：P1 仍需查看");
});

test("T68 Project 看完全部会话 → Project 绿点消失；Agent 数字随之减少（只有这时 Agent 才少一个）", async () => {
  const sessions = { x1: { agentId: "a", projectId: "P1" }, x2: { agentId: "a", projectId: "P1" }, y1: { agentId: "a", projectId: "P2" } };
  const s = deriveStatus({ sessions, running: [], unread: ["y1"] }, { visible: false });
  assert.equal(s.projects[P2("a", "P1")].unread, 0, "P1 已看完：数字为 0（绿点消失）");
  assert.equal(s.agents.a.unread, 1, "Agent 只剩 P2 需要查看");
});

test("T69 没有 projectId 的未读会话：Agent 层按一个未归属的 Project 计，不产生 Project 键", async () => {
  const s = deriveStatus({ sessions: { z1: { agentId: "a" }, z2: { agentId: "a" } }, running: [], unread: ["z1", "z2"] }, { visible: false });
  assert.equal(s.agents.a.unread, 1, "两个未归属会话 = 一个未归属 Project");
  assert.deepEqual(Object.keys(s.projects), []);
});
