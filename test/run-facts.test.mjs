// T7：run-facts 纯函数（协议 P1·1.4）——事件折叠 / 三态语义 / 排队区。
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyRunFacts, applyRunEvent, isRunning, hasUnread, markViewed, queueAdd, queueClear } from "../frontend/src/run-facts.ts";

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
