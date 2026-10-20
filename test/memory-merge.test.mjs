import test from "node:test";
import assert from "node:assert/strict";
import { mergeRoleHits } from "../src/memory/merge.ts";

const role = (kind) => ({ kind });
const hit = (id, score) => ({ id, score, text: id });

test("多角色合并：按给定顺序、按 id 去重、截断", () => {
  const merged = mergeRoleHits([
    { role: role("agent_project"), hits: [hit("a", 0.9), hit("shared", 0.8)] },
    { role: role("project"), hits: [hit("shared", 0.7), hit("p", 0.6)] },
    { role: role("user"), hits: [hit("u", 0.5)] },
  ], 10);
  assert.deepEqual(merged.map((h) => h.id), ["a", "shared", "p", "u"]);
  assert.equal(merged[1].role.kind, "agent_project", "先到先得：共享条目保留更具体角色的来源");
  assert.deepEqual(mergeRoleHits([{ role: role("user"), hits: [hit("x", 1)] }], 0), []);
});
