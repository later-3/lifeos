// 项目概览端点（Task 0010）：GET /api/agents/:id/projects/:pid/overview
// 覆盖（testing 2.5 先失败路径 + 2.1 隔离）：404 agent / 404 project；夹具家目录上的计数正确
// （含"目录缺失 = 0"、"AGENTS.md 不计"、knowledge 递归）；默认项目 path=null。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { createAgent } from "../src/agents.ts";
import { createTask } from "../src/tasks.ts";
import { registerProject } from "../src/projects.ts";
import { start, startOn } from "./server-harness.mjs";

test("overview：未知 Agent 与未知项目各自返回 404 + code（非 2xx 断言原因）", async () => {
  const { server, base } = await start();
  try {
    const noAgent = await fetch(`${base}/api/agents/nobody/projects/workspace/overview`);
    assert.equal(noAgent.status, 404);
    assert.equal((await noAgent.json()).error.code, "agent_not_found");

    const noProject = await fetch(`${base}/api/agents/lifeosagent/projects/not-registered/overview`);
    assert.equal(noProject.status, 404);
    assert.equal((await noProject.json()).error.code, "project_not_found");
  } finally { server.close(); }
});

test("overview：默认项目 path=null、isDefault=true、默认 Task 计入 running", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-overview-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  const agent = await createAgent({ name: "Overview Agent" });
  assert.ok(!("code" in agent));
  const { server, base } = await startOn(home);
  try {
    const body = await (await fetch(`${base}/api/agents/${agent.id}/projects/workspace/overview`)).json();
    assert.equal(body.path, null);
    assert.equal(body.isDefault, true);
    assert.deepEqual(body.tasks, { total: 1, running: 1 }, "默认 Task（进行中）计入 running");
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(home, { recursive: true, force: true, maxRetries: 3 }); }
});

test("overview：外部项目计数正确（目录缺失=0、AGENTS.md 不计、knowledge 递归、tools/specs 只数目录）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-overview-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  const agent = await createAgent({ name: "Overview Counts" });
  assert.ok(!("code" in agent));
  const workdir = join(home, "work", "proj-x");
  await mkdir(workdir, { recursive: true });
  const bound = await registerProject(agent.id, workdir);
  assert.ok(!("code" in bound));
  const shared = join(home, "projects", bound.project.id);

  const { server, base } = await startOn(home);
  try {
    // 先断言"目录缺失 = 0"：绑定后共享层只有骨架，还没有知识库/案例/工具目录。
    const before = await (await fetch(`${base}/api/agents/${agent.id}/projects/${bound.project.id}/overview`)).json();
    assert.deepEqual(before.assets, { knowledge: 0, cases: 0, tools: 0, specs: 0 });
    assert.equal(before.path, workdir);
    assert.equal(before.isDefault, false);

    // 造夹具：knowledge 递归计 .md（排除 AGENTS.md）；cases 只计顶层 .md；tools/specs 只计非点子目录。
    await mkdir(join(shared, "knowledge", "sub"), { recursive: true });
    await writeFile(join(shared, "knowledge", "a.md"), "x");
    await writeFile(join(shared, "knowledge", "AGENTS.md"), "说明文件，不算知识条目");
    await writeFile(join(shared, "knowledge", "sub", "c.md"), "x");
    await writeFile(join(shared, "knowledge", "d.txt"), "非 md 不计");
    await mkdir(join(shared, "cases"), { recursive: true });
    await writeFile(join(shared, "cases", "2026-01-01.md"), "x");
    await writeFile(join(shared, "cases", "notes.txt"), "非 md 不计");
    await mkdir(join(shared, "tools", "tool-a"), { recursive: true });
    await writeFile(join(shared, "tools", "readme.md"), "文件不算工具");
    await mkdir(join(shared, "specs", "theme-a"), { recursive: true });
    await mkdir(join(shared, "specs", ".hidden"), { recursive: true });
    await writeFile(join(shared, "specs", "index.json"), "{}");

    const second = await createTask({ agentId: agent.id, projectId: bound.project.id },
      { title: "已完成的一件小事", type: "general", category: "G" });
    assert.ok(!("code" in second), `建任务失败：${"code" in second ? second.message : ""}`);
    const taskMd = join(second.task.path, "task.md");
    const text = await readFile(taskMd, "utf8");
    await writeFile(taskMd, text.replace("状态：进行中", "状态：已完成"));

    const body = await (await fetch(`${base}/api/agents/${agent.id}/projects/${bound.project.id}/overview`)).json();
    assert.deepEqual(body.assets, { knowledge: 2, cases: 1, tools: 1, specs: 1 });
    assert.deepEqual(body.tasks, { total: 2, running: 1 }, "默认 Task 进行中 + 手工完成的那个不计 running");
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(home, { recursive: true, force: true, maxRetries: 3 }); }
});
