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
