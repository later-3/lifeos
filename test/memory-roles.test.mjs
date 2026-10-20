import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeRoot, roleKey, defaultReadOrder } from "../src/memory/roles.ts";

const home = await mkdtemp(join(tmpdir(), "lifeos-memory-roles-"));
process.env.LIFEOS_HOME = home;

test("四种角色的落点：用户 / Agent / Agent×项目私有 / 项目共享", () => {
  assert.equal(storeRoot({ kind: "user" }), join(home, "memory", "user", "default"));
  assert.equal(storeRoot({ kind: "user", userId: "later" }), join(home, "memory", "user", "later"));
  assert.equal(storeRoot({ kind: "agent", agentId: "coder" }), join(home, "agents", "coder", "memory"));
  assert.equal(storeRoot({ kind: "agent_project", agentId: "coder", projectId: "lifeos" }),
    join(home, "agents", "coder", "projects", "lifeos", "memory"));
  assert.equal(storeRoot({ kind: "project", projectId: "lifeos" }), join(home, "projects", "lifeos", "memory"));
});

test("角色 key 稳定且互不冲突", () => {
  const keys = [
    roleKey({ kind: "user" }),
    roleKey({ kind: "agent", agentId: "coder" }),
    roleKey({ kind: "agent_project", agentId: "coder", projectId: "lifeos" }),
    roleKey({ kind: "project", projectId: "lifeos" }),
  ];
  assert.equal(new Set(keys).size, 4, JSON.stringify(keys));
});

test("默认读取顺序：私有 → 项目共享 → Agent → 用户", () => {
  assert.deepEqual(defaultReadOrder({ agentId: "coder", projectId: "lifeos" }).map((r) => r.kind),
    ["agent_project", "project", "agent", "user"]);
});
