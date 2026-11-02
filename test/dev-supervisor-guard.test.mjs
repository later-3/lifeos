// T-0016 supervisor 启动自检（任务 0016）：四种串线必须在启动前就被拒绝，而不是无限重启。
// 依据：2026-11-02 三份实例共用 43130 + 一份共用 ~/.lifeos + 全部共用同一日志（案例 C160）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOG, RESERVED_BACKEND, checkIsolation } from "../scripts/dev-supervisor-guard.mjs";

const ok = { port: 43131, home: "/home/dev/0016", worktree: "/w/0016", logFile: "/tmp/lifeos-0016.log" };

test("T0016-11 合规实例通过自检（无问题清单）", () => {
  assert.deepEqual(checkIsolation(ok), []);
});

test("T0016-12 占用用户保留号 43120 必须被拒绝", () => {
  const problems = checkIsolation({ ...ok, port: RESERVED_BACKEND });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /保留号/);
});

test("T0016-13 端口已被占用时拒绝启动并给出占用者（不再进入重启循环）", () => {
  const problems = checkIsolation({ ...ok, probe: { busy: true, owner: "node pid=1234" } });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /已被占用.*node pid=1234/);
});

test("T0016-14 LIFEOS_HOME 指向用户家目录必须被拒绝（今天 chat-surface 的串线）", () => {
  const problems = checkIsolation({ ...ok, home: "/Users/xulater/.lifeos", expectedHome: "/Users/xulater/.lifeos" });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /用户家目录/);
});

test("T0016-15 在主 worktree 里启动必须被拒绝", () => {
  const problems = checkIsolation({ ...ok, worktree: "/Users/xulater/Code/lifeos", expectedWorktree: "/Users/xulater/Code/lifeos" });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /主 worktree/);
});

test("T0016-16 日志用了共享默认路径必须被拒绝（否则多实例混成一份）", () => {
  const problems = checkIsolation({ ...ok, logFile: DEFAULT_LOG });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /共享默认路径/);
});

test("T0016-17 LIFEOS_HOME 缺失、端口非法都要报问题（不静默放行）", () => {
  assert.equal(checkIsolation({ ...ok, home: "" }).length, 1);
  assert.equal(checkIsolation({ ...ok, port: 0 }).length, 1);
  assert.equal(checkIsolation({ ...ok, port: 70000 }).length, 1);
});

test("T0016-18 多处串线时一次报全（不挤牙膏）", () => {
  const problems = checkIsolation({ ...ok, port: RESERVED_BACKEND, home: "/Users/xulater/.lifeos", expectedHome: "/Users/xulater/.lifeos", logFile: DEFAULT_LOG });
  assert.equal(problems.length, 3);
});

test("T0016-19 端口不在登记表里必须被拒绝（不允许自挑一个空号）", () => {
  // ok.worktree 本身也不在 tasks/<NNNN>/evidence/ 下，会同时报两条：这里断言"含登记问题"
  const problems = checkIsolation({ ...ok, requireRegistration: true });
  assert.ok(problems.some((p) => /不在 dev-port 登记表里/.test(p)), problems.join(" / "));
  assert.ok(problems.some((p) => /不在 Task 的 evidence\/ 下/.test(p)), problems.join(" / "));
});

test("T0016-20 已登记的端口放行；worktree 必须在 Task 的 evidence/ 下", () => {
  const registered = { ...ok, worktree: "/h/.lifeos/agents/a/projects/p/tasks/0016-x/evidence/worktree", requireRegistration: true, registration: { taskId: "0016" } };
  assert.deepEqual(checkIsolation(registered), []);
  const outside = checkIsolation({ ...ok, worktree: "/Users/xulater/Code/lifeos-dev/coder", requireRegistration: true, registration: { taskId: "0016" } });
  assert.equal(outside.length, 1);
  assert.match(outside[0], /不在 Task 的 evidence\/ 下/);
});
