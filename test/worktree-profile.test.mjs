// Task 工作区的裁剪规则（协议 §3.7 / §4.2）：纯函数穷举。
//
// 为什么必须穷举：这条规则写错**不报任何错**——
//   - 多放行一条 → 别的 Agent 或未绑定的共享 project 进了这个 Agent 的工作区；
//   - 少放行一条 → 他新绑定的项目在工作区里不存在，`write` 静默写到主区去。
// `specs/code/backend/code.md` 2.7 要求这类判定抽成纯函数并穷举断言。
import { test } from "node:test";
import assert from "node:assert/strict";
import { worktreeProfileOf, allowedProjectsOf, SHARED_WORKSPACE } from "../src/worktree-profile.ts";

/** 用 gitignore 语义判定"这个路径在不在 profile 里"（后匹配者胜）。 */
function included(patterns, path) {
  let hit = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    const body = negated ? pattern.slice(1) : pattern;
    if (matches(body, path)) hit = !negated;
  }
  return hit;
}

function matches(pattern, path) {
  if (pattern === "/*") return /^\/[^/]+/.test(path);
  if (pattern.endsWith("*")) return path.startsWith(pattern.slice(0, -1));
  return path.startsWith(pattern);
}

test("自己的东西全给：agents/<自己>/ 下任意路径都放行", () => {
  const patterns = worktreeProfileOf({ agentId: "coder", boundProjects: ["lifeos"] });
  for (const path of [
    "/agents/coder/agent.json",
    "/agents/coder/identity.md",
    "/agents/coder/memory/config.yaml",
    "/agents/coder/projects/lifeos/tasks/0016-x/task.md",
    "/agents/coder/projects/workspace/tasks/0001-default/daily/2026-11-10.md",
  ]) {
    assert.equal(included(patterns, path), true, `应放行：${path}`);
  }
});

test("别的 Agent 一律不给（连身份文件也不给）", () => {
  const patterns = worktreeProfileOf({ agentId: "coder", boundProjects: ["lifeos"] });
  for (const path of [
    "/agents/reviewer/agent.json",
    "/agents/frontend-developer/projects/lifeos/tasks/0009-x/task.md",
    "/agents/coder2/identity.md", // 前缀相似但不是自己
  ]) {
    assert.equal(included(patterns, path), false, `不该放行：${path}`);
  }
});

test("共享 workspace 恒放行；挂载在根上的协议目录与用户层也放行", () => {
  const patterns = worktreeProfileOf({ agentId: "coder", boundProjects: [] });
  for (const path of [
    "/projects/workspace/specs/index.json",
    "/interaction-harness/protocol.md",
    "/interaction-harness/task-types/development/template.json",
    "/users/xu/profile.md",
    "/.gitignore",
    "/install-receipt.json",
  ]) {
    assert.equal(included(patterns, path), true, `应放行：${path}`);
  }
});

test("未绑定的共享 project 不给；绑定的给", () => {
  const patterns = worktreeProfileOf({ agentId: "coder", boundProjects: ["lifeos"] });
  assert.equal(included(patterns, "/projects/lifeos/specs/index.json"), true);
  assert.equal(included(patterns, "/projects/ziji/specs/index.json"), false);
  assert.equal(included(patterns, "/projects/ziji-media-studio/flywheel.md"), false);
});

test("多个绑定都放行（不是只放第一个）", () => {
  const patterns = worktreeProfileOf({ agentId: "zhiji", boundProjects: ["lifeos", "ziji", "ziji-media-studio"] });
  for (const path of ["/projects/lifeos/a.md", "/projects/ziji/b.md", "/projects/ziji-media-studio/c.md", "/projects/workspace/d.md"]) {
    assert.equal(included(patterns, path), true, `应放行：${path}`);
  }
});

test("boundProjects 里重复写 workspace 不产生重复模式（它是恒放行的）", () => {
  const withDup = worktreeProfileOf({ agentId: "coder", boundProjects: [SHARED_WORKSPACE, "lifeos"] });
  const without = worktreeProfileOf({ agentId: "coder", boundProjects: ["lifeos"] });
  assert.deepEqual(withDup, without);
});

test("allowedProjectsOf 反推出的集合 = workspace + 绑定（用于诊断）", () => {
  assert.deepEqual(allowedProjectsOf(worktreeProfileOf({ agentId: "zhiji", boundProjects: ["ziji"] })), ["workspace", "ziji"]);
  assert.deepEqual(allowedProjectsOf(worktreeProfileOf({ agentId: "coder", boundProjects: [] })), ["workspace"]);
});

test("模式顺序固定：先排 agents、再放自己；先排 projects、再放行（gitignore 后写覆盖先写）", () => {
  const patterns = worktreeProfileOf({ agentId: "coder", boundProjects: ["lifeos"] });
  assert.deepEqual(patterns.slice(0, 5), ["/*", "!/agents/*", "/agents/coder/", "!/projects/*", "/projects/workspace/"]);
  assert.equal(patterns[5], "/projects/lifeos/");
  assert.equal(patterns.length, 6);
});
