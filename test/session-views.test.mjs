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
