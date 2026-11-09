// 检视候选接口：失败路径先写（backend 2.5 + api 2.1）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { start } from "./server-harness.mjs";

test("D31API·1 不存在的 agent → 404 agent_not_found", async () => {
  const { server, base } = await start();
  try {
    const r = await fetch(`${base}/api/agents/nobody/projects/p1/review-candidates`);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error.code, "agent_not_found");
  } finally { server.close(); }
});

test("D31API·2 不存在的 project → 404 project_not_found", async () => {
  const { server, base } = await start();
  try {
    const r = await fetch(`${base}/api/agents/lifeosagent/projects/nope/review-candidates`);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error.code, "project_not_found");
  } finally { server.close(); }
});

test("D31API·3 正常返回 { items, elapsedMs }（列表统一包 items）", async () => {
  const { server, base } = await start();
  try {
    const r = await fetch(`${base}/api/agents/lifeosagent/projects/workspace/review-candidates`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.items), JSON.stringify(body).slice(0, 120));
    assert.equal(typeof body.elapsedMs, "number");
    // 默认 Task 必然在列表里
    assert.ok(body.items.some((item) => item.taskId === "0001"), JSON.stringify(body.items.map((i) => i.taskId)));
  } finally { server.close(); }
});

test("D31API·4 每个候选项字段齐全（前端选择器与徽标要用）", async () => {
  const { server, base } = await start();
  try {
    const r = await fetch(`${base}/api/agents/lifeosagent/projects/workspace/review-candidates`);
    const body = await r.json();
    for (const item of body.items) {
      for (const key of ["taskId", "title", "type", "status", "taskDir", "hasWorktree", "worktreeChanged", "docChangedFiles", "docOnlyDaily", "substantive"]) {
        assert.ok(key in item, `${item.taskId} 缺字段 ${key}`);
      }
      assert.equal(typeof item.substantive, "boolean");
      assert.equal(typeof item.docChangedFiles, "number");
    }
  } finally { server.close(); }
});
