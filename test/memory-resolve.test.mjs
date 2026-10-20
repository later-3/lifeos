import test from "node:test";
import assert from "node:assert/strict";
import { resolveMemoryRole } from "../src/memory/resolve.ts";

const base = { agentId: "coder", currentProjectId: "lifeos" };

test("四种 scope → 对应角色；projectId 默认当前项目", () => {
  assert.deepEqual(resolveMemoryRole({ ...base, scope: "agent_project", action: "record" }),
    { role: { kind: "agent_project", agentId: "coder", projectId: "lifeos" } });
  assert.deepEqual(resolveMemoryRole({ ...base, scope: "project", action: "record" }),
    { role: { kind: "project", projectId: "lifeos" } });
  assert.deepEqual(resolveMemoryRole({ ...base, scope: "agent", action: "record" }),
    { role: { kind: "agent", agentId: "coder" } });
  assert.deepEqual(resolveMemoryRole({ ...base, scope: "user", action: "record" }), { role: { kind: "user" } });
});

test("跨项目：只允许 scope=project 的检索；写/删与其他 scope 一律拒绝", () => {
  assert.deepEqual(resolveMemoryRole({ ...base, scope: "project", targetProjectId: "other", action: "search" }),
    { role: { kind: "project", projectId: "other" } });
  assert.ok("error" in resolveMemoryRole({ ...base, scope: "project", targetProjectId: "other", action: "record" }));
  assert.ok("error" in resolveMemoryRole({ ...base, scope: "agent_project", targetProjectId: "other", action: "search" }));
  assert.ok("error" in resolveMemoryRole({ ...base, scope: "agent", targetProjectId: "other", action: "search" }));
  assert.ok("error" in resolveMemoryRole({ ...base, scope: "user", targetProjectId: "other", action: "search" }));
});
