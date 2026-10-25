// T7：run-facts 纯函数（协议 P1·1.4）——事件折叠 / 三态语义 / 排队区。
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyRunFacts, applyRunEvent, isRunning, hasUnread, markViewed, queueAdd, queueClear, settleStopped } from "../frontend/src/run-facts.ts";

test("T7a snapshot 折叠：snapRunning 是当前在跑集合；不跑的会话不在内", async () => {
  const f = emptyRunFacts();
  const next = applyRunEvent(f, { type: "snapshot", running: [{ sessionId: "A" }, { sessionId: "B" }] }, 0);
  assert.ok(isRunning(next, "A"));
  assert.ok(isRunning(next, "B"));
  assert.ok(!isRunning(next, "C"));
});

test("T7b turn(running)：事件即时点亮运行（不等列表刷新，修'只有结束才刷新'缺口）", async () => {
  const f = emptyRunFacts();
  const next = applyRunEvent(f, { sessionId: "A", type: "turn", turnId: "t1", state: "running" }, 1);
  assert.ok(isRunning(next, "A"), "turn(running) 即视为在跑");
  assert.ok(next.lastTurn.A && next.lastTurn.A.turnId === "t1");
});

test("T7c turn(done)：非焦点会话 → 标完成未读；焦点会话 → 不标", async () => {
  const f = applyRunEvent(emptyRunFacts(), { sessionId: "A", type: "turn", turnId: "t1", state: "running" }, 1);
  const doneBg = applyRunEvent(f, { sessionId: "A", type: "turn", turnId: "t1", state: "done" }, 2, undefined);  // 焦点是别的会话
  assert.ok(hasUnread(doneBg, "A"));
  assert.ok(!isRunning(doneBg, "A"), "终态即不在跑");

  const doneFocus = applyRunEvent(f, { sessionId: "A", type: "turn", turnId: "t1", state: "done" }, 2, "A");
  assert.ok(!hasUnread(doneFocus, "A"), "自己看着它完成不该标未读");
});

test("T7d markViewed：成为焦点即清未读（无时间窗）", async () => {
  let f = applyRunEvent(emptyRunFacts(), { sessionId: "A", type: "turn", turnId: "t1", state: "running" }, 1);
  f = applyRunEvent(f, { sessionId: "A", type: "turn", turnId: "t1", state: "done" }, 2);
  assert.ok(hasUnread(f, "A"));
  const viewed = markViewed(f, "A");
  assert.ok(!hasUnread(viewed, "A"));
  // 再来一次 markViewed 是幂等的（immutable，不复制也可）
  assert.ok(markViewed(viewed, "A") === viewed, "未读时幂等：无变化返回原对象");
});

test("T7e 排队区（本期仅可见）：入列 / 回合收尾即清 / 手动清", async () => {
  let f = emptyRunFacts();
  f = applyRunEvent(f, { sessionId: "A", type: "turn", turnId: "t0", state: "running" }, 1);
  f = queueAdd(f, "A", { behavior: "steer", text: "插一句" });
  assert.ok((f.queue.A ?? []).length === 1, "排队可见");
  f = applyRunEvent(f, { sessionId: "A", type: "turn", turnId: "t1", state: "done" }, 3);
  assert.ok(!f.queue.A, "回合收尾清排队区");
  f = queueAdd(f, "A", { behavior: "followUp", text: "下一轮" });
  f = queueClear(f, "A");
  assert.ok(!f.queue.A, "手动清也生效");
});

test("T7f snapshot 与 turn 的仲裁：turn(done) 之后快照再说在跑 → 仍以快照为准（兜底语义）", async () => {
  let f = applyRunEvent(emptyRunFacts(), { sessionId: "A", type: "turn", turnId: "t1", state: "running" }, 1);
  f = applyRunEvent(f, { sessionId: "A", type: "turn", turnId: "t1", state: "done" }, 2);
  f = applyRunEvent(f, { type: "snapshot", running: [{ sessionId: "A" }] }, 3);
  assert.ok(isRunning(f, "A"), "快照仲裁优先于本地 turn 记忆（断线重连兜底）");
});

test("T7g settleStopped：服务端明确不在跑 → 清残留运行点，不影响别的会话", async () => {
  let f = emptyRunFacts();
  f = applyRunEvent(f, { sessionId: "A", type: "turn", turnId: "t1", state: "running" }, 1);
  f = applyRunEvent(f, { sessionId: "B", type: "turn", turnId: "t2", state: "running" }, 1);
  const next = settleStopped(f, "A", 2);
  assert.equal(isRunning(next, "A"), false);
  assert.equal(isRunning(next, "B"), true, "别的会话的运行点不得被清");
  assert.equal(settleStopped(next, "A", 3), next, "已经不在跑的会话不产生新对象");
});

// T56：快照是服务端真相（任务 0007）——跨 Agent 的运行集合整体替换；快照里没有的残留"运行中"必须清掉（断线期间已结束的回合）。
import { applySnapshotFacts } from "../frontend/src/run-facts.ts";
test("T56 快照整体替换：运行集合与未读来自服务端；断线期间已结束的残留运行点被清掉", async () => {
  let f = applyRunEvent(emptyRunFacts(), { sessionId: "old", type: "turn", turnId: "t0", state: "running" }, 1);
  f = applyRunEvent(f, { sessionId: "other", type: "turn", turnId: "t9", state: "done" }, 2);   // 本地留下的未读
  const next = applySnapshotFacts(f, {
    running: [{ sessionId: "A1" }, { sessionId: "B2" }],
    unread: [{ sessionId: "C3" }],
  }, 10);
  assert.ok(isRunning(next, "A1") && isRunning(next, "B2"), "跨 Agent 的运行中会话都在");
  assert.equal(isRunning(next, "old"), false, "断线期间已结束的残留运行点被清");
  assert.equal(hasUnread(next, "C3"), true, "服务端未读生效");
  assert.equal(hasUnread(next, "other"), false, "快照是真相：本地未读不保留");
});

// T62b：运行事实携带会话归属（agentId / projectId），状态映射要用它做向上聚合（任务 0008）
test("T62b 快照与 turn 事件都把会话归属写入 meta；后来的事件可以补全 projectId", async () => {
  let f = applySnapshotFacts(emptyRunFacts(), {
    running: [{ sessionId: "S1", agentId: "a", projectId: "p1" }],
    unread: [{ sessionId: "S2", agentId: "b", projectId: "p9" }],
  }, 0);
  assert.deepEqual(f.meta.S1, { agentId: "a", projectId: "p1" });
  assert.deepEqual(f.meta.S2, { agentId: "b", projectId: "p9" });
  f = applyRunEvent(f, { sessionId: "S3", agentId: "a", projectId: "p2", type: "turn", turnId: "t", state: "running" }, 1);
  assert.deepEqual(f.meta.S3, { agentId: "a", projectId: "p2" });
});
