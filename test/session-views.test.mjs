// T39–T41：服务端未读事实（任务 0007 P2）——完成即未读、查看即清、重启不丢、写入节流。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionViews } from "../src/session-views.ts";

function harness(now0 = Date.parse("2026-10-25T01:00:00Z")) {
  let now = now0;
  const store = { text: undefined, writes: 0 };
  const views = createSessionViews({
    now: () => now,
    load: async () => store.text,
    persist: async (text) => { store.text = text; store.writes += 1; },
    throttleMs: 5000,
  });
  return { views, store, advance: (ms) => { now += ms; }, at: (ms) => new Date(now0 + ms).toISOString() };
}

test("T39 完成即未读；在该会话查看（viewed 晚于 completed）后清除未读", async () => {
  const h = harness();
  await h.views.load();
  h.views.markCompleted("A", "s1", h.at(0));
  assert.deepEqual(h.views.unread(), [{ agentId: "A", sessionId: "s1", completedAt: h.at(0) }]);
  h.views.markViewed("A", "s1", h.at(1000));
  assert.deepEqual(h.views.unread(), [], "查看时间晚于完成时间 → 不再未读");
  h.views.markCompleted("A", "s1", h.at(2000));   // 再完成一次 → 又未读
  assert.equal(h.views.unread().length, 1);
});

test("T40 重启后未读仍在：状态落盘，新进程 load 后可见", async () => {
  const h = harness();
  await h.views.load();
  h.views.markCompleted("B", "s9", h.at(0));
  await h.views.flush();
  const restarted = createSessionViews({
    now: () => Date.parse("2026-10-25T09:00:00Z"),
    load: async () => h.store.text,
    persist: async () => undefined,
    throttleMs: 5000,
  });
  await restarted.load();
  assert.deepEqual(restarted.unread().map((x) => `${x.agentId}/${x.sessionId}`), ["B/s9"]);
});

test("T41 查看标记节流：5 秒内重复 markViewed 不写盘；超过窗口才写", async () => {
  const h = harness();
  await h.views.load();
  h.views.markCompleted("A", "s1", h.at(0));
  await h.views.flush();
  const base = h.store.writes;
  h.views.markViewed("A", "s1", h.at(10));
  h.views.markViewed("A", "s1", h.at(20));          // 节流内
  await h.views.flush();
  assert.equal(h.store.writes, base + 1, "只写一次");
  h.advance(6000);
  h.views.markCompleted("A", "s1", h.at(7000));
  h.views.markViewed("A", "s1", h.at(7001));
  await h.views.flush();
  assert.equal(h.store.writes, base + 3, "窗口过后再写（完成 + 查看）");
});

test("T57 删除会话 = 遗忘它的未读记录（否则侧栏永远亮着一个指向已删会话的点）；遗忘需落盘", async () => {
  const h = harness();
  await h.views.load();
  h.views.markCompleted("A", "gone", h.at(0));
  h.views.markCompleted("A", "kept", h.at(0));
  await h.views.flush();
  h.views.forget("A", "gone");
  await h.views.flush();
  assert.deepEqual(h.views.unread().map((x) => x.sessionId), ["kept"]);
  const restarted = createSessionViews({ now: () => 0, load: async () => h.store.text, persist: async () => undefined, throttleMs: 5000 });
  await restarted.load();
  assert.deepEqual(restarted.unread().map((x) => x.sessionId), ["kept"], "重启后也不复活");
});

test("T60 清理孤儿未读：指向已不存在会话的记录被移除（修复前删除留下的残留会让蓝点永远去不掉）", async () => {
  const h = harness();
  await h.views.load();
  h.views.markCompleted("A", "alive", h.at(0));
  h.views.markCompleted("A", "ghost", h.at(0));
  await h.views.flush();
  await h.views.prune(async (_agentId, sessionId) => sessionId === "alive");
  await h.views.flush();
  assert.deepEqual(h.views.unread().map((x) => x.sessionId), ["alive"]);
  const restarted = createSessionViews({ now: () => 0, load: async () => h.store.text, persist: async () => undefined, throttleMs: 5000 });
  await restarted.load();
  assert.deepEqual(restarted.unread().map((x) => x.sessionId), ["alive"], "清理结果落盘");
});

test("T65 未读记录带 projectId（状态映射的项目层需要它）；旧记录缺 projectId 时回填，回填不到的清理", async () => {
  const h = harness();
  await h.views.load();
  h.views.markCompleted("A", "s1", h.at(0), "p1");
  h.views.markCompleted("A", "s2", h.at(0));          // 老调用方式：不带 projectId
  assert.deepEqual(h.views.unread().map((x) => [x.sessionId, x.projectId]), [["s1", "p1"], ["s2", undefined]]);
  const filled = await h.views.backfill(async (_a, sid) => (sid === "s2" ? "p7" : undefined));
  assert.equal(filled, 1);
  assert.deepEqual(h.views.unread().find((x) => x.sessionId === "s2").projectId, "p7");
  await h.views.flush();
  const restarted = createSessionViews({ now: () => 0, load: async () => h.store.text, persist: async () => undefined, throttleMs: 5000 });
  await restarted.load();
  assert.equal(restarted.unread().find((x) => x.sessionId === "s2").projectId, "p7", "回填结果落盘");
});

// —— T43–T46 终态索引（Task 0005 · P8-1）——
// 目的：让"这个 Agent 有几个失败会话"变成一次索引读，而不是扫全部会话文件。
// 反例背景：改之前 failure 只能由 sessionRowsOf 扫 JSONL 得到，实测 69 个文件 156ms、
// 全链路 532ms —— 放进快照/聚合就是每 2.5 秒一次全扫。
test("T43 markCompleted 带终态：done/error 都能读回，且状态条目与未读是同一份记录", async () => {
  const h = harness();
  await h.views.load();
  h.views.markCompleted("A", "s1", h.at(0), "p1", { state: "done" });
  h.views.markCompleted("A", "s2", h.at(1000), "p1", { state: "error", failureKind: "auth" });

  assert.deepEqual(h.views.outcomeOf("A", "s1"), { state: "done" });
  assert.deepEqual(h.views.outcomeOf("A", "s2"), { state: "error", failureKind: "auth" });
  assert.equal(h.views.outcomeOf("A", "nope"), undefined, "没有记录 → undefined，不编一个默认终态");

  const states = h.views.states();
  assert.deepEqual(states.map((s) => [s.sessionId, s.lastState, s.projectId]), [["s1", "done", "p1"], ["s2", "error", "p1"]]);
});

test("T43b states() 不看已读：用户看过之后，聚合仍要知道这条会话是怎么结束的", async () => {
  const h = harness();
  await h.views.load();
  h.views.markCompleted("A", "s1", h.at(0), "p1", { state: "error", failureKind: "timeout" });
  h.views.markViewed("A", "s1", h.at(5000));
  assert.equal(h.views.unread().length, 0, "看过了 → 不再未读");
  assert.equal(h.views.states().length, 1, "但状态条目还在（聚合要数失败数，与看没看无关）");
  assert.equal(h.views.states()[0].lastState, "error");
});

test("T44 更早的补写不覆盖最近终态（completedAt 取较晚者，终态跟着它走）", async () => {
  const h = harness();
  await h.views.load();
  h.views.markCompleted("A", "s1", h.at(10_000), "p1", { state: "error", failureKind: "server" });
  // 迟到的旧终态：时间更早 → completedAt 不变，终态也不能被改成 done
  h.views.markCompleted("A", "s1", h.at(1_000), "p1", { state: "done" });
  assert.equal(h.views.outcomeOf("A", "s1").state, "error", "最近一次是 error，晚到的更早记录不能改写它");
  assert.equal(h.views.outcomeOf("A", "s1").failureKind, "server");
  // 真正更晚的一次：这次要生效，且 failureKind 必须被清掉（不能留着上次的）
  h.views.markCompleted("A", "s1", h.at(20_000), "p1", { state: "done" });
  assert.deepEqual(h.views.outcomeOf("A", "s1"), { state: "done" }, "失败之后成功了 → 不该还带着旧 failureKind");
});

test("T45 重启后终态仍在（落盘 + load 恢复），且与 completedAt 同源判定", async () => {
  const h = harness();
  await h.views.load();
  h.views.markCompleted("B", "s9", h.at(0), "p2", { state: "error", failureKind: "rate_limit" });
  await h.views.flush();

  const restarted = createSessionViews({
    now: () => Date.parse("2026-10-25T09:00:00Z"),
    load: async () => h.store.text,
    persist: async () => {},
    throttleMs: 5000,
  });
  await restarted.load();
  assert.deepEqual(restarted.outcomeOf("B", "s9"), { state: "error", failureKind: "rate_limit" });
  assert.equal(restarted.states()[0].projectId, "p2", "项目归属也一起恢复（聚合按项目分组要用）");
});

test("T46 不传 outcome 时保持原行为（旧调用点不需要改），且不会凭空造终态", async () => {
  const h = harness();
  await h.views.load();
  h.views.markCompleted("A", "s1", h.at(0));   // 只有完成事实，没有终态
  assert.equal(h.views.outcomeOf("A", "s1"), undefined, "没给终态就不能编一个");
  assert.equal(h.views.unread().length, 1, "未读行为与改之前一致");
});
