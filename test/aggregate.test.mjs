// aggregateStatus：跨 Agent 的状态聚合（Task 0005 · P8）。
//
// 2026-11-04 定稿（用户裁决）：**未读只有一种概念** —— 一次回合结束了、用户还没看过。
// 它有两个结果：正常结束（绿）/ 异常结束（红），**规则完全相同：看过就消失，不持久记录**。
// 所以徽标回答「有几件事要你看」，与会话行的点永远同步。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";

const home = await mkdtemp(join(tmpdir(), "lifeos-agg-"));
await installHome(process.cwd(), home);
process.env.LIFEOS_HOME = home;

const { sessionViewsOf } = await import("../src/session-views.ts");
const { aggregateStatus } = await import("../src/agent-host.ts");

const at = "2026-11-04T10:00:00.000Z";
const of = (agentId) => aggregateStatus().find((e) => e.agentId === agentId);

test("T80 两个结果各数各的：正常结束进 unreadDone，异常结束进 unreadError", async () => {
  const views = sessionViewsOf();
  views.markCompleted("alpha", "d1", at, "p1", { state: "done" });
  views.markCompleted("alpha", "d2", at, "p1", { state: "done" });
  views.markCompleted("alpha", "e1", at, "p1", { state: "error", failureKind: "auth" });

  const alpha = of("alpha");
  assert.deepEqual({ r: alpha.running, d: alpha.unreadDone, e: alpha.unreadError }, { r: 0, d: 2, e: 1 });
  assert.equal(alpha.projectId, "p1");
});

test("T81 看过就消失 —— 两种结果规则完全相同（这是用户最在意的一条）", async () => {
  const views = sessionViewsOf();
  const A = "view-test";
  views.markCompleted(A, "done-1", at, "p1", { state: "done" });
  views.markCompleted(A, "err-1", at, "p1", { state: "error", failureKind: "auth" });
  assert.deepEqual({ d: of(A).unreadDone, e: of(A).unreadError }, { d: 1, e: 1 }, "初始各 1");

  // 看掉正常结束那个
  views.markViewed(A, "done-1", at);
  assert.deepEqual({ d: of(A).unreadDone, e: of(A).unreadError }, { d: 0, e: 1 }, "绿点消失，红色不受影响");

  // 看掉异常结束那个
  views.markViewed(A, "err-1", at);
  assert.equal(of(A), undefined, "两个都看过 → 整个分组消失（不再有要你看的事）");
});

test("T82 不持久记录：看过后不会因为再查一次又冒出来", async () => {
  const views = sessionViewsOf();
  const A = "no-resurrect";
  views.markCompleted(A, "s1", at, "p1", { state: "error", failureKind: "timeout" });
  assert.equal(of(A).unreadError, 1);
  views.markViewed(A, "s1", at);
  assert.equal(of(A), undefined);
  // 再查三次，仍然是空的（聚合是纯派生，不是"每次重新判定一次未读"）
  for (let i = 0; i < 3; i++) assert.equal(of(A), undefined, "看过了就是看过了");
});

test("T83 只返回有数的分组（零值分组不占位）", async () => {
  for (const entry of aggregateStatus()) {
    assert.ok(entry.running + entry.unreadDone + entry.unreadError > 0, `${entry.agentId} 不该是空分组`);
  }
});

test("T84 多次调用结果稳定（纯派生，不消耗状态）", async () => {
  const views = sessionViewsOf();
  views.markCompleted("stable", "s1", at, "p1", { state: "done" });
  assert.deepEqual(aggregateStatus(), aggregateStatus());
});

test("T85 删除的闭环：删一条 → 数字减少 → 全删光后分组消失", async () => {
  const views = sessionViewsOf();
  const A = "delete-test";
  views.markCompleted(A, "d1", at, "p1", { state: "done" });
  views.markCompleted(A, "d2", at, "p1", { state: "done" });
  views.markCompleted(A, "e1", at, "p1", { state: "error", failureKind: "auth" });
  assert.deepEqual({ d: of(A).unreadDone, e: of(A).unreadError }, { d: 2, e: 1 });

  views.forget(A, "d1");
  assert.deepEqual({ d: of(A).unreadDone, e: of(A).unreadError }, { d: 1, e: 1 }, "删一条绿，绿减一");
  views.forget(A, "e1");
  assert.deepEqual({ d: of(A).unreadDone, e: of(A).unreadError }, { d: 1, e: 0 }, "删红的，红归零");
  views.forget(A, "d2");
  assert.equal(of(A), undefined, "全删光 → 分组消失");
});

test("T86 删除后重建同名会话：计数从零重来，不残留旧终态", async () => {
  const views = sessionViewsOf();
  const A = "recreate-test";
  views.markCompleted(A, "s1", at, "p1", { state: "error", failureKind: "auth" });
  assert.equal(of(A).unreadError, 1);
  views.forget(A, "s1");
  assert.equal(of(A), undefined);
  views.markCompleted(A, "s1", at, "p1", { state: "done" });
  assert.deepEqual({ d: of(A).unreadDone, e: of(A).unreadError }, { d: 1, e: 0 }, "旧失败不残留");
});

test("T87 没有终态的老记录不计（不知道它怎么结束的，就不编一个）", async () => {
  const views = sessionViewsOf();
  views.markCompleted("legacy", "old-1", at, "p9");
  assert.equal(of("legacy"), undefined, "只有 completedAt、没有 lastState → 不猜");
});

test("T88 在跑的会话只算 running，不重复计入未读（四态互斥）", async () => {
  // 这条在纯单测里无法造"运行中"（需要真实回合），所以只断言不变量：
  // 三个数各自独立，running 与两个 unread 不会来自同一条会话。
  const views = sessionViewsOf();
  views.markCompleted("mutex", "s1", at, "p1", { state: "done" });
  const one = of("mutex");
  assert.equal(one.running, 0, "没有真实回合 → 0");
  assert.equal(one.unreadDone, 1);
});

// —— T89 aggregateSlotOf：删除时"该减哪一格"必须与 aggregateStatus 同一套规则 ——
test("T89 aggregateSlotOf 与 aggregateStatus 对同一条会话的判断一致（未读完成 / 未读失败 / 都不算）", async () => {
  const { aggregateSlotOf } = await import("../src/agent-host.ts");
  const views = sessionViewsOf();

  views.markCompleted("slot-a", "d1", at, "p1", { state: "done" });
  views.markCompleted("slot-a", "e1", at, "p1", { state: "error", failureKind: "auth" });
  assert.equal(aggregateSlotOf("slot-a", "d1"), "unreadDone");
  assert.equal(aggregateSlotOf("slot-a", "e1"), "unreadError");

  // 看过之后 → 不再占任何一格（与聚合一致：groups 里这个 Agent 会消失）
  views.markViewed("slot-a", "d1", at);
  assert.equal(aggregateSlotOf("slot-a", "d1"), undefined, "已看过 → 删除它不需要减任何数字");
  assert.equal(of("slot-a").unreadDone, 0, "聚合也不计它");

  // 不存在的会话
  assert.equal(aggregateSlotOf("slot-a", "nope"), undefined);
});

test("T89b 每条会话的 slot 汇总起来，必须等于 aggregateStatus 的数字（同一规则的两个入口）", async () => {
  const { aggregateSlotOf } = await import("../src/agent-host.ts");
  const views = sessionViewsOf();
  const A = "slot-sum";
  const ids = ["a1", "a2", "a3", "a4"];
  views.markCompleted(A, "a1", at, "p1", { state: "done" });
  views.markCompleted(A, "a2", at, "p1", { state: "done" });
  views.markCompleted(A, "a3", at, "p1", { state: "error", failureKind: "auth" });
  views.markCompleted(A, "a4", at, "p1", { state: "error", failureKind: "timeout" });
  views.markViewed(A, "a4", at);   // 看掉一条

  const slots = ids.map((id) => aggregateSlotOf(A, id));
  const counted = { unreadDone: slots.filter((s) => s === "unreadDone").length, unreadError: slots.filter((s) => s === "unreadError").length };
  const agg = of(A);
  assert.deepEqual(counted, { unreadDone: agg.unreadDone, unreadError: agg.unreadError }, "逐条判定与聚合总数必须一致");
  assert.deepEqual(counted, { unreadDone: 2, unreadError: 1 });
});

// —— T90 先失败、后成功：失败**不能**被成功抹掉（Task 0005 · 2026-11-04 用户实测）——
// 现场：coder 的某个会话 08:32 失败、09:19 失败、09:34 失败（额度用尽）、09:39 成功。
// 用户看到过那两次失败提示，但助手行的失败数字是 0 —— 因为 lastState 被成功覆盖了。
test("T90 失败两次后成功：只要没看过失败，失败数仍为 1（成功不抹掉失败）", async () => {
  const views = sessionViewsOf();
  const A = "fail-then-ok";
  const t1 = "2026-11-04T08:32:31.000Z";
  const t2 = "2026-11-04T09:34:54.000Z";
  const t3 = "2026-11-04T09:39:31.000Z";

  views.markCompleted(A, "s1", t1, "p1", { state: "error", failureKind: "network" });
  views.markCompleted(A, "s1", t2, "p1", { state: "error", failureKind: "server" });
  views.markCompleted(A, "s1", t3, "p1", { state: "done" });   // 后来成功了

  const a = of(A);
  assert.equal(a.unreadError, 1, "两次失败（都没看过）→ 必须仍有 1 条失败待查看");
  assert.equal(a.unreadDone, 0, "后来那次成功也被算进来吗？不 —— 见下条断言");

  // unread() 也要能报出"这是失败"，否则前端进不了 unreadError
  const u = views.unread().find((x) => x.agentId === A);
  assert.equal(u?.state, "error", "失败优先于成功（更需要处理）");
});

test("T90b 看过之后失败清除；此后再成功，只算成功", async () => {
  const views = sessionViewsOf();
  const A = "fail-then-ok-viewed";
  views.markCompleted(A, "s1", "2026-11-04T08:32:31.000Z", "p1", { state: "error", failureKind: "network" });
  assert.equal(of(A).unreadError, 1);
  views.markViewed(A, "s1", "2026-11-04T08:35:00.000Z");
  assert.equal(of(A), undefined, "看过了 → 失败消失");

  views.markCompleted(A, "s1", "2026-11-04T09:39:31.000Z", "p1", { state: "done" });
  assert.deepEqual({ e: of(A).unreadError, d: of(A).unreadDone }, { e: 0, d: 1 }, "之后成功 → 只有完成待看");
});

test("T90c 成功之后再失败：立刻变成失败待查看，且清掉旧的已看标记", async () => {
  const views = sessionViewsOf();
  const A = "ok-then-fail";
  views.markCompleted(A, "s1", "2026-11-04T08:00:00.000Z", "p1", { state: "done" });
  views.markViewed(A, "s1", "2026-11-04T08:01:00.000Z");
  assert.equal(of(A), undefined);

  views.markCompleted(A, "s1", "2026-11-04T09:00:00.000Z", "p1", { state: "error", failureKind: "auth" });
  assert.equal(of(A).unreadError, 1, "新的失败要重新算未读");
  assert.equal(views.unread().find((x) => x.agentId === A)?.state, "error");
});

test("T90d 失败与成功各自独立计数：不同会话互不影响", async () => {
  const views = sessionViewsOf();
  const A = "mix";
  views.markCompleted(A, "f1", "2026-11-04T08:00:00.000Z", "p1", { state: "error", failureKind: "auth" });
  views.markCompleted(A, "d1", "2026-11-04T08:10:00.000Z", "p1", { state: "done" });
  assert.deepEqual({ e: of(A).unreadError, d: of(A).unreadDone }, { e: 1, d: 1 });
  views.markViewed(A, "f1", "2026-11-04T08:20:00.000Z");
  assert.deepEqual({ e: of(A).unreadError, d: of(A).unreadDone }, { e: 0, d: 1 }, "看掉失败，成功不受影响");
});
