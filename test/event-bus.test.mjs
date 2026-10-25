// T30–T36：全局事件总线（任务 0007 P1）——回合级广播、细节级焦点路由、快照缓冲不丢不重、过载即摘除。
import { test } from "node:test";
import assert from "node:assert/strict";
import { publish, broadcast, subscribeBus, setFocusOf, isDetailEvent, eventsSeq } from "../src/events.ts";

const delta = (text) => ({ type: "delta", index: 0, text });
const sink = (id, { focus, limit = Infinity } = {}) => {
  const received = [];
  let overflowed = false;
  const sub = {
    id, focus,
    offer(event) { if (received.length >= limit) return false; received.push(event); return true; },
    overflowed() { overflowed = true; },
  };
  return { sub, received, get overflowed() { return overflowed; } };
};

test("T30 回合级事件（turn/done/error/agents_changed）发给所有连接，不管焦点在哪", async () => {
  const a = sink("conn-a", { focus: { agentId: "A", sessionId: "s1", visible: true } });
  const b = sink("conn-b");           // 没有焦点
  const ha = subscribeBus(a.sub); const hb = subscribeBus(b.sub);
  ha.ready(); hb.ready();
  publish("B", { sessionId: "s9", type: "turn", turnId: "t1", state: "done" });
  publish("B", { sessionId: "s9", type: "done", turnId: "t1" });
  broadcast({ type: "agents_changed" });
  assert.deepEqual(a.received.map((e) => e.type), ["turn", "done", "agents_changed"]);
  assert.deepEqual(b.received.map((e) => e.type), ["turn", "done", "agents_changed"]);
  ha.close(); hb.close();
});

test("T31 细节事件（delta 等）只发给焦点匹配的连接：非焦点会话不洪泛", async () => {
  const focused = sink("conn-f", { focus: { agentId: "A", sessionId: "s1", visible: true } });
  const other = sink("conn-o", { focus: { agentId: "A", sessionId: "s2", visible: true } });
  const hf = subscribeBus(focused.sub); const ho = subscribeBus(other.sub);
  hf.ready(); ho.ready();
  publish("A", { sessionId: "s1", ...delta("hi") });
  publish("B", { sessionId: "s1", ...delta("x") });   // 同 sessionId 不同 Agent：不得串
  assert.equal(focused.received.length, 1);
  assert.equal(focused.received[0].agentId, "A");
  assert.equal(other.received.length, 0);
  hf.close(); ho.close();
});

test("T32 焦点切换后路由立即生效（PUT focus 不需要重连）", async () => {
  const c = sink("conn-switch", { focus: { agentId: "A", sessionId: "s1", visible: true } });
  const h = subscribeBus(c.sub); h.ready();
  assert.equal(setFocusOf("conn-switch", { agentId: "B", sessionId: "s7", visible: true }), true);
  publish("A", { sessionId: "s1", ...delta("old-focus") });
  publish("B", { sessionId: "s7", ...delta("new-focus") });
  assert.deepEqual(c.received.map((e) => e.text), ["new-focus"]);
  assert.equal(setFocusOf("no-such-connection", undefined), false, "未知连接返回 false（路由层据此 404）");
  h.close();
});

test("T33 seq 是全局单调递增（跨 Agent 不重号），回合级与细节级共用一个序列", async () => {
  const before = eventsSeq();
  const x = publish("A", { sessionId: "s1", ...delta("1") });
  const y = publish("B", { sessionId: "s2", type: "turn", turnId: "t", state: "running" });
  const z = broadcast({ type: "agents_changed" });
  assert.equal(x.seq, before + 1);
  assert.equal(y.seq, before + 2);
  assert.equal(z.seq, before + 3);
  assert.equal(x.agentId, "A");
  assert.equal(y.agentId, "B");
});

test("T34 快照优先：订阅后、ready 前到达的事件被缓冲，ready 后按序补发；不丢不重", async () => {
  const c = sink("conn-snap", { focus: { agentId: "A", sessionId: "s1", visible: true } });   // 焦点在 s1，细节事件才会到
  const h = subscribeBus(c.sub);
  publish("A", { sessionId: "s1", type: "turn", turnId: "t1", state: "running" });   // 快照生成期间
  publish("A", { sessionId: "s1", ...delta("d1") });
  assert.equal(c.received.length, 0, "ready 前不得直接推送");
  h.ready();
  publish("A", { sessionId: "s1", ...delta("d2") });
  assert.deepEqual(c.received.map((e) => e.seq), [...new Set(c.received.map((e) => e.seq))], "无重复");
  assert.equal(c.received.length, 3, "缓冲的两条 + ready 后的一条");
  assert.ok(h.seq < c.received[0].seq, "基线之后的事件才会被推送");
  h.close();
});

test("T35 过载即摘除：该连接 offer 失败 → overflowed 回调、之后不再收到；其他连接不受影响", async () => {
  const slow = sink("conn-slow", { limit: 1 });
  const fast = sink("conn-fast");
  const hs = subscribeBus(slow.sub); const hf = subscribeBus(fast.sub);
  hs.ready(); hf.ready();
  publish("A", { sessionId: "s1", type: "turn", turnId: "t1", state: "running" });   // slow 收下
  publish("A", { sessionId: "s1", type: "turn", turnId: "t1", state: "done" });      // slow 过载
  publish("A", { sessionId: "s1", type: "done", turnId: "t1" });                    // slow 已摘除
  assert.equal(slow.overflowed, true);
  assert.equal(slow.received.length, 1);
  assert.equal(fast.received.length, 3, "快连接全部收到");
  hf.close();
});

test("T36 close 之后不再投递；isDetailEvent 的分类与契约一致", async () => {
  const c = sink("conn-close");
  const h = subscribeBus(c.sub); h.ready();
  h.close();
  publish("A", { sessionId: "s1", ...delta("after-close") });
  broadcast({ type: "agents_changed" });
  assert.equal(c.received.length, 0);
  for (const t of ["turn", "done", "error", "agents_changed"]) assert.equal(isDetailEvent(t), false, t);
  for (const t of ["delta", "thinking", "tool_start", "tool_result", "retrying", "message_start"]) assert.equal(isDetailEvent(t), true, t);
});
