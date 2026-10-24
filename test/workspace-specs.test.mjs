// 2026-10-22 协议 §16：workspace 双层、规范分层、默认 Task、模板四层覆盖。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { buildPromptParts } from "../src/assembly.ts";
import { createSession, getSession, deleteSession } from "../src/agent-host.ts";
import { createTask, ensureDailyShard, ensureDefaultTask, listTasks, localDate } from "../src/tasks.ts";
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
  assert.ok(parts.sources.includes(join(home, "projects", "workspace", "specs", "agent-collaboration", "agent-collaboration.md")));

  const a = await mkdtemp(join(tmpdir(), "lifeos-spec-a-"));
  const b = await mkdtemp(join(tmpdir(), "lifeos-spec-b-"));
  const pa = await registerProject("lifeosagent", a);
  const pb = await registerProject("lifeosagent", b);
  assert.ok(!("code" in pa) && !("code" in pb));
  await writeSpec(join(home, "projects", pa.project.id, "specs"), "project-a", "# 项目 A 规范\n");
  await writeSpec(join(home, "agents", "lifeosagent", "projects", "workspace", "specs"), "agent-wide", "# Agent 跨项目规范\n");

  const partsA = await buildPromptParts("lifeosagent", pa.project.id);
  assert.match(partsA.harnessSection, /项目 A 规范/, "当前项目共享 specs 要加载");
  // 协议 §4.3：Agent × 项目（默认项目 = workspace）的规范只在它自己的项目里加载，不跨项目注入
  assert.doesNotMatch(partsA.harnessSection, /Agent 跨项目规范/, "Agent 默认 workspace 的规范不跨项目注入");

  const partsB = await buildPromptParts("lifeosagent", pb.project.id);
  assert.doesNotMatch(partsB.harnessSection, /项目 A 规范/, "不能跨项目注入 A 的规范");
  const partsWs = await buildPromptParts("lifeosagent", "workspace");
  assert.match(partsWs.harnessSection, /Agent 跨项目规范/, "Agent 默认 workspace 的规范在 workspace 项目里加载");
});

test("默认 Task（协议 §6.1）：每 Agent×项目一个；当天分片按需创建；会话引用默认 Task 并注入其说明与状态", async () => {
  const home = await freshHome();
  const ctx = { agentId: "lifeosagent", projectId: "workspace" };
  const first = await ensureDefaultTask(ctx);
  const again = await ensureDefaultTask(ctx);
  assert.equal(again.id, first.id, "默认 Task 只能有一个");
  assert.equal(first.id, "0001");
  assert.equal(first.dirName, "0001-default");
  assert.equal(first.isDefault, true);
  const taskMd = await readFile(join(first.path, "task.md"), "utf8");
  assert.match(taskMd, /^类型：daily$/m);
  assert.doesNotMatch(taskMd, /^日期：/m, "默认 Task 按天分片，不写日期字段");

  const date = localDate();
  const shard = await ensureDailyShard(ctx, date);
  assert.equal(shard.file, join(first.path, "daily", `${date}.md`));
  assert.match(await readFile(shard.file, "utf8"), new RegExp(`# ${date}`));
  assert.ok((await listTasks(ctx)).some((task) => task.id === first.id && task.isDefault === true));

  const sessionId = await createSession("lifeosagent", home, "workspace");
  const state = await getSession("lifeosagent", sessionId, home);
  assert.equal(state?.taskId, first.id, "会话应引用默认 Task（NNNN）");
  const parts = await buildPromptParts("lifeosagent", "workspace", first.id);
  assert.match(parts.harnessSection, /当前 Task · 0001-default\/task\.md/);
  assert.match(parts.harnessSection, /任务类型规则 · daily\/AGENTS\.md/);
  assert.doesNotMatch(parts.harnessSection, /daily-\d{4}-\d{2}-\d{2}/, "不再有按日期建的 Task");
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

test("规范不跨项目泄漏：LifeOS 的 code specs 只进 lifeos 项目；共享 workspace 规范按设计跨项目", async () => {
  const home = await freshHome();
  const other = await buildPromptParts("lifeosagent", "demo-external");
  assert.doesNotMatch(other.harnessSection, /生成状态由显式事件/, "code/frontend 不进其他项目");
  assert.doesNotMatch(other.harnessSection, /运行日志前后端一致/, "code/backend 不进其他项目");
  assert.doesNotMatch(other.harnessSection, /前端开发的固定流程/, "项目层流程规范不进其他项目");
  assert.match(other.harnessSection, /多 Agent 协作规范/, "共享 workspace 的协作规范按设计跨项目");
  const ws = await buildPromptParts("lifeosagent", "workspace");
  assert.doesNotMatch(ws.harnessSection, /生成状态由显式事件/, "workspace 会话也不带生活项目 code specs");
  const lifeos = await buildPromptParts("lifeosagent", "lifeos");
  assert.match(lifeos.harnessSection, /生成状态由显式事件/, "code/frontend 正文在 lifeos 项目内可用");
  assert.match(lifeos.harnessSection, /运行日志前后端一致/, "code/backend 正文在 lifeos 项目内可用");
});

test("任务入口逐文件点名：lifeos 项目建 Task → task.md 列出五份 code specs + 项目规范/流程；不写不存在的路径", async () => {
  const home = await freshHome();
  const result = await createTask({ agentId: "lifeosagent", projectId: "lifeos" }, { title: "入口点名", category: "B" });
  assert.ok(!("code" in result));
  const file = await readFile(join(result.task.path, "task.md"), "utf8");
  const expect = ["specs/code/frontend/code.md", "specs/code/backend/code.md", "specs/code/testing/testing.md", "specs/code/api/api.md", "specs/code/architecture/architecture.md", "specs/development-harness/development-harness.md", "specs/review/review.md", "knowledge/reference-baseline.md"];
  for (const path of expect) assert.match(file, new RegExp(path.replaceAll("/", "\\/")), `入口应点名 ${path}`);
  assert.doesNotMatch(file, /不存在|__TEMPLATE__/, "不应出现占位或幻觉路径");
});
