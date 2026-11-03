// 行补丁推送器（任务 0005 · D4）：频率控制的三条规则。
//
// 为什么这几条必须有断言：它们防的是"事件风暴"和"状态丢了"两个方向的错。
// - 不节流 → 一次回合 448 次工具调用就推 448 条，10 个会话并发 = 事件风暴；
// - 简单 debounce → 窗口内最后一次状态被丢掉，列表卡在中间态（比不推更糟）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRowPatchPublisher, phaseOfStreamEvent, ROW_PATCH_MIN_INTERVAL_MS } from "../src/row-patch.ts";

/** 假时钟 + 记录发出的补丁。 */
function harness(options = {}) {
  let now = 1000;
  const sent = [];
  const timers = [];
  const publisher = createRowPatchPublisher({
    now: () => now,
    interval: options.interval ?? ROW_PATCH_MIN_INTERVAL_MS,
    send: (agentId, sessionId, projectId, patch) => sent.push({ agentId, sessionId, projectId, patch, at: now }),
  });
  return {
    publisher, sent,
    advance(ms) { now += ms; },
    now: () => now,
    /** 手动跑掉所有排队的定时器（不依赖真实时间）。 */
    runTimers() {
      // row-patch 用全局 setTimeout：这里直接 flushAll 等价地验证"尾随会被发出"
      publisher.flushAll();
    },
  };
}

// —— T11 只推状态切换，不推正文增量 ——
test("T11 phaseOfStreamEvent：thinking/delta/tool_start 映射，不认识的返回 undefined", () => {
  assert.deepEqual(phaseOfStreamEvent({ type: "thinking" }), { phase: "thinking" });
  assert.deepEqual(phaseOfStreamEvent({ type: "delta" }), { phase: "text" });
  assert.deepEqual(phaseOfStreamEvent({ type: "tool_start", name: "read" }), { phase: "tool", tool: "read" });
  assert.deepEqual(phaseOfStreamEvent({ type: "tool_start" }), { phase: "tool" });
  // 这些不是 phase 变化，不该推（否则正文每帧都在推）
  for (const type of ["message_start", "message_end", "thinking_end", "tool_result", "tool_update", "retrying"]) {
    assert.equal(phaseOfStreamEvent({ type }), undefined, `${type} 不产生 phase 补丁`);
  }
});

// —— T12 首次立即发 ——
test("T12 第一次变化立即发出（不等窗口）", () => {
  const h = harness();
  const immediate = h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "waiting" });
  assert.equal(immediate, true, "首次不等窗口");
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0].patch.running, { since: "T0", phase: "waiting" });
});

// —— T13 值没变就不发（去重）——
test("T13 同一个 phase/tool 连续来不重复推", () => {
  const h = harness();
  h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "thinking" });
  assert.equal(h.sent.length, 1);
  // 大量重复的 thinking（每次 thinking_delta 都会映射成同一个 phase）
  for (let i = 0; i < 200; i++) h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "thinking" });
  assert.equal(h.sent.length, 1, "200 次重复 event 不产生新推送");
});

// —— T14 窗口内合并，且最后一次不丢 ——
test("T14 窗口内多次变化合并成一条，且发出的是**最后一次**状态（不是第一次）", () => {
  const h = harness({ interval: 1000 });
  h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "waiting" });   // 立即发
  assert.equal(h.sent.length, 1);
  h.advance(100);
  h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "thinking" });  // 排队
  h.advance(100);
  h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "tool", tool: "read" });  // 覆盖排队
  h.advance(100);
  h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "text" });      // 再覆盖
  assert.equal(h.sent.length, 1, "窗口内一条都没多发");
  h.runTimers();
  assert.equal(h.sent.length, 2, "尾随补发一条");
  assert.deepEqual(h.sent[1].patch.running, { since: "T0", phase: "text" }, "发的是最后一次状态（不是第一次）");
});

// —— T15 终态立即发、不节流 ——
test("T15 终态立即发且带 running: null（清掉运行态），不被窗口拖住", () => {
  const h = harness({ interval: 1000 });
  h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "text" });   // 立即发
  h.advance(50);   // 还在窗口内
  h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "tool", tool: "bash" });  // 排队
  h.publisher.pushTerminal("agent", "s1", "workspace", { unread: { since: "T9" }, lastActivityAt: "T9" });
  assert.equal(h.sent.length, 2, "终态不被窗口拖住");
  assert.equal(h.sent[1].patch.running, null, "终态带 running: null");
  assert.deepEqual(h.sent[1].patch.unread, { since: "T9" });
  h.runTimers();
  assert.equal(h.sent.length, 2, "终态后不再补发排队的那条（已被终态取代）");
});

// —— T16 不同会话互不影响 ——
test("T16 两个会话各自节流，不互相压制", () => {
  const h = harness({ interval: 1000 });
  h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "thinking" });
  h.publisher.pushRunning("agent", "s2", "workspace", { since: "T0", phase: "waiting" });
  assert.equal(h.sent.length, 2, "两个会话各发一条");
  h.advance(10);
  h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "text" });
  h.publisher.pushRunning("agent", "s2", "workspace", { since: "T0", phase: "tool", tool: "read" });
  assert.equal(h.sent.length, 2, "都在各自窗口内 → 都排队");
  h.runTimers();
  assert.equal(h.sent.length, 4, "各自补发");
});

// —— T17 重命名/切 Task 立即发（低频用户动作，不节流）——
test("T17 标题与 Task 补丁立即发，不参与运行态节流", () => {
  const h = harness({ interval: 1000 });
  h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "text" });
  h.advance(10);
  h.publisher.pushNow("agent", "s1", "workspace", { title: { raw: "新名字", display: "新名字" } });
  h.publisher.pushNow("agent", "s1", "workspace", { task: { id: "0007", title: "改造", status: "进行中", type: "development" } });
  assert.equal(h.sent.length, 3, "两个 pushNow 都立即发出");
  assert.deepEqual(h.sent[1].patch.title, { raw: "新名字", display: "新名字" });
  assert.equal(h.sent[2].patch.task.id, "0007");
});

// —— T18 forget 后不再发（会话删了不能还推）——
test("T18 forget 之后，排队中的补丁不再发出", () => {
  const h = harness({ interval: 1000 });
  h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "thinking" });
  h.advance(10);
  h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "text" });   // 排队
  h.publisher.forget("agent", "s1");
  h.runTimers();
  assert.equal(h.sent.length, 1, "只剩那条立即发的；排队的那条被丢掉");
  assert.equal(h.publisher.size(), 0, "登记已清空");
});

// —— T19 稳态下不会无限增长 ——
test("T19 一轮完整的 waiting→thinking→tool→text→终态，只产生 ~5 条补丁（不是几百条）", () => {
  const h = harness({ interval: 1000 });
  // 模拟真实事件序列：大量 thinking_delta / text_delta / 多个工具
  h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "waiting" });
  for (let i = 0; i < 100; i++) h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "thinking" });
  h.advance(1200);
  for (let i = 0; i < 100; i++) h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "text" });
  h.advance(1200);
  for (const tool of ["read", "read", "bash", "grep", "edit"]) {
    h.publisher.pushRunning("agent", "s1", "workspace", { since: "T0", phase: "tool", tool });
    h.advance(1200);
  }
  h.publisher.pushTerminal("agent", "s1", "workspace", { unread: { since: "T9" }, lastActivityAt: "T9" });
  h.runTimers();
  // waiting, thinking, text, tool×3（read 只算一次，因为去重）, 终态
  assert.ok(h.sent.length <= 8, `实际 ${h.sent.length} 条，应 ≤ 8（不是几百条）`);
  assert.equal(h.sent.at(-1).patch.running, null, "最后一条是终态");
});
