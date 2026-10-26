// 绑定项目与默认 Task 的完整性：成功时默认 Task 立即可用；失败时不留半成品。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "./server-harness.mjs";

const tempDir = async (prefix) => await mkdtemp(join(tmpdir(), prefix));

test("绑定项目：默认 Task 立即创建（0001-default 全套骨架）", async () => {
  const { server, base, home } = await start();
  const dir = await tempDir("lifeos-proj-");
  try {
    const response = await fetch(`${base}/api/agents/lifeosagent/projects`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: dir }),
    });
    assert.equal(response.status, 201);
    const { project, defaultTask } = await response.json();
    // 契约里必须带上默认 Task：绑定即创建，调用方不用再猜
    assert.equal(defaultTask.id, "0001", "默认 Task 编号应为 0001");
    assert.equal(defaultTask.title, "默认");
    const tasksDir = join(home, "agents", "lifeosagent", "projects", project.id, "tasks");
    const entries = await readdir(tasksDir);
    assert.ok(entries.some((name) => name.endsWith("-default")), `tasks 里应有默认 Task，实际 ${entries.join(",")}`);
    assert.ok(existsSync(join(tasksDir, entries.find((name) => name.endsWith("-default")), "task.md")), "默认 Task 应带 task.md");
  } finally { server.close(); await rm(dir, { recursive: true, force: true }); }
});

test("绑定项目：默认 Task 建不出来时返回可读 422，且不留半绑定目录", async () => {
  const { server, base, home } = await start();
  const dir = await tempDir("lifeos-proj-");
  try {
    // 先记下操作前的状态（出厂家目录本来就有项目），失败后再比对，不写死期望值
    const beforeProjects = (await (await fetch(`${base}/api/agents/lifeosagent/projects`)).json()).items.map((item) => item.id).sort();
    const beforeDirs = (await readdir(join(home, "agents", "lifeosagent", "projects"))).sort();
    // 真实制造失败：删掉 daily 模板（默认 Task 依赖它）
    await rm(join(home, "interaction-harness", "task-types", "daily"), { recursive: true, force: true });
    const response = await fetch(`${base}/api/agents/lifeosagent/projects`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: dir }),
    });
    assert.equal(response.status, 422, "应返回可读的 422，而不是 500 纯文本");
    const body = await response.json();
    assert.equal(body.error.code, "default_task_failed");
    assert.match(body.error.message, /默认 Task 创建失败/);

    // 不留半成品：项目列表与绑定目录都应回到操作前
    const afterProjects = (await (await fetch(`${base}/api/agents/lifeosagent/projects`)).json()).items.map((item) => item.id).sort();
    assert.deepEqual(afterProjects, beforeProjects, "失败后项目列表应回到操作前");
    const afterDirs = (await readdir(join(home, "agents", "lifeosagent", "projects"))).sort();
    assert.deepEqual(afterDirs, beforeDirs, "失败后绑定目录应已回滚");
  } finally { server.close(); await rm(dir, { recursive: true, force: true }); }
});

test("绑定已存在的目录再次添加：幂等，不重复建默认 Task", async () => {
  const { server, base, home } = await start();
  const dir = await tempDir("lifeos-proj-");
  try {
    const first = await fetch(`${base}/api/agents/lifeosagent/projects`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: dir }),
    });
    assert.equal(first.status, 201);
    const { project } = await first.json();
    const second = await fetch(`${base}/api/agents/lifeosagent/projects`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: dir }),
    });
    assert.equal(second.status, 200, "已绑定项目再添加应为 200（非 201）");
    const tasksDir = join(home, "agents", "lifeosagent", "projects", project.id, "tasks");
    const defaults = (await readdir(tasksDir)).filter((name) => name.endsWith("-default"));
    assert.equal(defaults.length, 1, `默认 Task 应只有一个，实际 ${defaults.join(",")}`);
  } finally { server.close(); await rm(dir, { recursive: true, force: true }); }
});
