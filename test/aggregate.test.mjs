// aggregateStatus：跨 Agent 的三计数聚合（Task 0005 · P8-3）。
//
// 这是"助手列能显示所有 Agent 数字"的服务端部分，必须有测试：
// 它依赖 session-views 单例与运行注册表，所以用**隔离家目录**（写只入临时目录，testing 2.1）。
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

test("T80 三计数：正常结束 / 异常结束分别计入，且互不串味儿", async () => {
  const views = sessionViewsOf();
  views.markCompleted("alpha", "s-done-1", at, "p1", { state: "done" });
  views.markCompleted("alpha", "s-done-2", at, "p1", { state: "done" });
  views.markCompleted("alpha", "s-fail-1", at, "p1", { state: "error", failureKind: "auth" });
  views.markCompleted("beta", "b-done", at, "p9", { state: "done" });

  const agg = aggregateStatus();
  const alphaP1 = agg.find((e) => e.agentId === "alpha" && e.projectId === "p1");
  assert.deepEqual({ running: alphaP1.running, completed: alphaP1.completed, failed: alphaP1.failed },
    { running: 0, completed: 2, failed: 1 }, "alpha/p1：2 完成 + 1 失败");
  const betaP9 = agg.find((e) => e.agentId === "beta");
  assert.deepEqual({ completed: betaP9.completed, failed: betaP9.failed }, { completed: 1, failed: 0 });
});

test("T81 已读不改变任何计数（徽标回答「发生过什么」，不回答「我看没看」）", async () => {
  const views = sessionViewsOf();
  const before = aggregateStatus().find((e) => e.agentId === "alpha" && e.projectId === "p1");
  // 把 s-done-1 标为已读
  views.markViewed("alpha", "s-done-1", at);
  const after = aggregateStatus().find((e) => e.agentId === "alpha" && e.projectId === "p1");
  assert.deepEqual(
    { c: after.completed, f: after.failed },
    { c: before.completed, f: before.failed },
    "查看一个已完成会话，完成数不能减少（这正是旧实现 6→5 的病根）",
  );
  assert.equal(views.unread().some((u) => u.sessionId === "s-done-1"), false, "但它确实不再是未读");
});

test("T82 没有终态的老记录不计：不知道它怎么结束的，就不编一个", async () => {
  const views = sessionViewsOf();
  // 只有 completedAt、没有 lastState（模拟旧版本写的记录）
  views.markCompleted("gamma", "old-1", at, "p2");
  const agg = aggregateStatus();
  const gamma = agg.find((e) => e.agentId === "gamma");
  assert.equal(gamma, undefined, "旧记录没有 lastState → 三个计数都不含它（不是默认为 completed）");
});

test("T83 只返回有数的分组（零值分组不占位）", async () => {
  const agg = aggregateStatus();
  for (const entry of agg) {
    assert.ok(entry.running + entry.completed + entry.failed > 0, `${entry.agentId}/${entry.projectId} 不该是空分组`);
  }
});

test("T84 多次调用结果稳定（聚合是纯派生，不消耗状态）", async () => {
  const a = aggregateStatus();
  const b = aggregateStatus();
  assert.deepEqual(a, b);
});

// —— T85 删除的闭环：会话删了，聚合数字必须跟着减（否则助手列一直在骗人）——
test("T85 删除会话后，它的终态从聚合里消失（数字 → 减少 → 归零）", async () => {
  const views = sessionViewsOf();
  // 造一个独立 Agent，避免与前几条用例互相影响
  const A = "delete-test";
  views.markCompleted(A, "d1", at, "p1", { state: "done" });
  views.markCompleted(A, "d2", at, "p1", { state: "done" });
  views.markCompleted(A, "d3", at, "p1", { state: "error", failureKind: "auth" });

  const one = aggregateStatus().find((e) => e.agentId === A);
  assert.deepEqual({ c: one.completed, f: one.failed }, { c: 2, f: 1 }, "初始：2 完成 1 失败");

  // 删一条正常结束的 → 完成数减一
  views.forget(A, "d1");
  const two = aggregateStatus().find((e) => e.agentId === A);
  assert.deepEqual({ c: two.completed, f: two.failed }, { c: 1, f: 1 });

  // 删掉失败的 → 失败数减一
  views.forget(A, "d3");
  const three = aggregateStatus().find((e) => e.agentId === A);
  assert.deepEqual({ c: three.completed, f: three.failed }, { c: 1, f: 0 });

  // 全删光 → 这个 Agent 不再出现在聚合里（零值分组不占位，助手行也不该有徽标）
  views.forget(A, "d2");
  assert.equal(aggregateStatus().find((e) => e.agentId === A), undefined, "归零后整个分组消失");
});

test("T86 删除后再重建同名会话：计数从零重来，不残留旧终态", async () => {
  const views = sessionViewsOf();
  const A = "recreate-test";
  views.markCompleted(A, "s1", at, "p1", { state: "error", failureKind: "auth" });
  assert.deepEqual(aggregateStatus().find((e) => e.agentId === A)?.failed, 1);

  views.forget(A, "s1");
  assert.equal(aggregateStatus().find((e) => e.agentId === A), undefined, "删掉后归零");

  views.markCompleted(A, "s1", at, "p1", { state: "done" });
  const again = aggregateStatus().find((e) => e.agentId === A);
  assert.deepEqual({ c: again.completed, f: again.failed }, { c: 1, f: 0 }, "旧失败不残留");
});
