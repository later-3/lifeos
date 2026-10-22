// 2026-10-22 协议 §16：workspace 双层、规范分层、默认 Task、模板四层覆盖。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { buildPromptParts } from "../src/assembly.ts";
import { createSession, getSession, deleteSession } from "../src/agent-host.ts";
import { createTask, ensureDailyTask, listTasks, localDate } from "../src/tasks.ts";
import { registerProject } from "../src/projects.ts";
import { ensureSharedWorkspace, readGlobalProject } from "../src/project-registry.ts";

async function freshHome() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-specs-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  return home;
}

async function writeSpec(root, id, body = "# 本地规范\n\n- 必须这样做\n") {
  await mkdir(join(root, id), { recursive: true });
  await writeFile(join(root, id, "AGENTS.md"), body);
  await writeFile(join(root, "index.json"), JSON.stringify({ schemaVersion: 1, specs: [{ id, path: `${id}/AGENTS.md` }] }) + "\n");
}

test("规范分层：共享 workspace 常驻；项目/Agent/Task 层只加载可见的正文", async () => {
  const home = await freshHome();
  const parts = await buildPromptParts("lifeosagent", "workspace");
  assert.match(parts.harnessSection, /多 Agent 协作规范/, "共享 workspace 的协作规范必须进 prompt");
  assert.ok(parts.sources.includes(join(home, "projects", "workspace", "specs", "agent-collaboration", "AGENTS.md")));

  const a = await mkdtemp(join(tmpdir(), "lifeos-spec-a-"));
  const b = await mkdtemp(join(tmpdir(), "lifeos-spec-b-"));
  const pa = await registerProject("lifeosagent", a);
  const pb = await registerProject("lifeosagent", b);
  assert.ok(!("code" in pa) && !("code" in pb));
  await writeSpec(join(home, "projects", pa.project.id, "specs"), "project-a", "# 项目 A 规范\n");
  await writeSpec(join(home, "agents", "lifeosagent", "projects", "workspace", "specs"), "agent-wide", "# Agent 跨项目规范\n");

  const partsA = await buildPromptParts("lifeosagent", pa.project.id);
  assert.match(partsA.harnessSection, /项目 A 规范/, "当前项目共享 specs 要加载");
  assert.match(partsA.harnessSection, /Agent 跨项目规范/, "Agent 私有 workspace specs 对所有项目加载");

  const partsB = await buildPromptParts("lifeosagent", pb.project.id);
  assert.doesNotMatch(partsB.harnessSection, /项目 A 规范/, "不能跨项目注入 A 的规范");
  assert.match(partsB.harnessSection, /Agent 跨项目规范/, "Agent 私有规范仍可见");
});

test("默认 Task：同一天同 Agent×Project 只建一个，会话引用 activeTaskId 并注入 task.md", async () => {
  const home = await freshHome();
  const ctx = { agentId: "lifeosagent", projectId: "workspace" };
  const date = localDate();
  const first = await ensureDailyTask(ctx, date);
  const again = await ensureDailyTask(ctx, date);
  assert.equal(again.id, first.id, "同一天必须复用默认 Task");
  const taskMd = await readFile(join(first.path, "task.md"), "utf8");
  assert.match(taskMd, new RegExp(`日期：${date}`));
  assert.match(taskMd, /默认：是/);
  assert.ok((await listTasks(ctx)).some((task) => task.id === first.id && task.isDefault === true));

  const sessionId = await createSession("lifeosagent", home, "workspace");
  const state = await getSession("lifeosagent", sessionId, home);
  assert.equal(state?.taskId, first.id, "会话应引用当天默认 Task");
  const parts = await buildPromptParts("lifeosagent", "workspace", first.id);
  assert.match(parts.harnessSection, /当前 Task · /);
  assert.match(parts.harnessSection, new RegExp(`daily-${date}`));
  await deleteSession("lifeosagent", sessionId);
});

test("模板四层：项目共享 template.json 覆盖协议默认，只选一份", async () => {
  const home = await freshHome();
  const dir = await mkdtemp(join(tmpdir(), "lifeos-task-template-"));
  const registered = await registerProject("lifeosagent", dir);
  assert.ok(!("code" in registered));
  const pid = registered.project.id;
  const templateDir = join(home, "projects", pid, "task-types", "general");
  await mkdir(templateDir, { recursive: true });
  await writeFile(join(templateDir, "template.json"), JSON.stringify({
    schemaVersion: 1,
    type: "general",
    categories: { G: { label: "G 项目自定义", docs: [{ file: "00-custom.md", title: "00 自定义", sections: ["只属于这个项目"] }] } },
  }) + "\n");

  const result = await createTask({ agentId: "lifeosagent", projectId: pid }, { title: "模板覆盖", type: "general", category: "G" });
  assert.ok(!("code" in result));
  assert.deepEqual(result.task.docs, ["00-custom.md"]);
  assert.match(await readFile(join(result.task.path, "task.md"), "utf8"), /类别：G 项目自定义/);
});

test("共享 workspace 是全局特殊项目：无 path，且不会把顶层 projects 当成某个 Agent 的旧数据", async () => {
  const home = await freshHome();
  const workspace = await ensureSharedWorkspace();
  assert.equal(workspace.id, "workspace");
  assert.equal(workspace.path, undefined);
  assert.equal((await readGlobalProject("workspace"))?.path, undefined);
  const manifest = JSON.parse(await readFile(join(home, "projects", "workspace", "project.json"), "utf8"));
  assert.equal(manifest.id, "workspace");
  assert.equal("path" in manifest, false);
});
