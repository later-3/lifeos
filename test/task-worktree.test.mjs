// Task 的工作区（协议 §3.7）：建 Task 真的建出两个 worktree，并且主区保持干净。
//
// 覆盖三件容易出错、且出错**不报错**的事：
//   T1 家目录工作区确实建出来了，且 sparse 裁剪生效（别的 Agent 与未绑定的 project 不在里面）
//   T2 文档写在工作区里、主区那份不出现（读到的是工作区副本；`listTasks` 能穿透）
//   T3 主区 `git status` 干净（worktree 目录被 .gitignore 挡掉）
//   T4 项目仓有 path 时同时建出 repo/；没有 path 时只建 home/
//
// 隔离：临时家目录 + 临时 git 仓，绝不碰 `~/.lifeos`（`specs/code/testing/testing.md` 2.1）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { installHome } from "../src/home.ts";
import { createTask, listTasks } from "../src/tasks.ts";

const run = promisify(execFile);

async function git(cwd, args) {
  return (await run("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { timeout: 60_000 })).stdout;
}

/** 装一个临时家目录并把它 init 成 git 仓（协议前提：家目录是 git 仓才有工作区）。 */
async function installedGitHome() {
  const base = await mkdtemp(join(tmpdir(), "lifeos-wt-"));
  const home = join(base, "home");
  await installHome(process.cwd(), home);
  await git(home, ["init", "-q", "-b", "main"]);
  await writeFile(join(home, ".gitignore"), await readFile(join(process.cwd(), ".lifeos", ".gitignore"), "utf8"));
  await git(home, ["add", "-A"]);
  await git(home, ["commit", "-q", "-m", "init"]);
  return { base, home };
}

const exists = async (path) => (await stat(path).catch(() => undefined)) !== undefined;

test("T1/T2/T3 无 path 的项目（workspace）：只建 home/，裁剪生效，文档在工作区里", async () => {
  const { home } = await installedGitHome();
  process.env.LIFEOS_HOME = home;
  const ctx = { agentId: "lifeosagent", projectId: "workspace" };

  const created = await createTask(ctx, { title: "工作区测试", category: "G", type: "general" });
  assert.ok(!("code" in created), `createTask 失败：${JSON.stringify(created)}`);
  const task = created.task;

  // 结构：主区 task 目录里只有 worktree 挂载点
  assert.equal(await exists(join(task.path, "home")), true, "应建出 home/");
  assert.equal(await exists(join(task.path, "repo")), false, "workspace 没有 path，不该有 repo/");
  assert.equal(await exists(join(task.path, "task.md")), false, "主区不该有 task.md（它在工作区里）");

  // 文档落点
  assert.notEqual(task.docPath, task.path);
  assert.ok(task.docPath.startsWith(join(task.path, "home")), `docPath 应在工作区里：${task.docPath}`);
  assert.equal(await exists(join(task.docPath, "task.md")), true, "工作区里应有 task.md");

  // 裁剪：自己的在、别人的不在、未绑定的 project 不在
  const wt = join(task.path, "home");
  assert.equal(await exists(join(wt, "agents", "lifeosagent", "agent.json")), true, "自己的身份文件应在");
  assert.equal(await exists(join(wt, "agents", "reviewer")), false, "别的 Agent 不该在");
  assert.equal(await exists(join(wt, "projects", "workspace")), true, "共享 workspace 应在");
  assert.equal(await exists(join(wt, "projects", "ziji")), false, "未绑定的 project 不该在");
  assert.equal(await exists(join(wt, "interaction-harness", "protocol.md")), true, "协议目录应在");

  // 主区干净
  assert.equal((await git(home, ["status", "--porcelain"])).trim(), "", "主区 git status 应为空");

  // 读侧穿透：列表能看见这个 Task，且 docPath 指向工作区
  const listed = (await listTasks(ctx)).find((item) => item.id === task.id);
  assert.ok(listed !== undefined, "listTasks 应能穿透读到新 Task");
  assert.equal(listed.docPath, task.docPath);
  assert.equal(listed.title, "工作区测试");
});

test("T4 项目有 path 且是 git 仓：同时建出 repo/", async () => {
  const { base, home } = await installedGitHome();
  process.env.LIFEOS_HOME = home;

  // 造一个项目仓，并把它绑到该 Agent
  const projectPath = join(base, "proj");
  await mkdir(projectPath, { recursive: true });
  await writeFile(join(projectPath, "README.md"), "# proj\n");
  await git(projectPath, ["init", "-q", "-b", "main"]);
  await git(projectPath, ["add", "-A"]);
  await git(projectPath, ["commit", "-q", "-m", "init"]);

  const projectDir = join(home, "projects", "demo");
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "project.json"), JSON.stringify({ id: "demo", name: "demo", path: projectPath }));
  await mkdir(join(home, "agents", "lifeosagent", "projects", "demo"), { recursive: true });

  const ctx = { agentId: "lifeosagent", projectId: "demo" };
  const created = await createTask(ctx, { title: "双工作区", category: "G", type: "general" });
  assert.ok(!("code" in created), `createTask 失败：${JSON.stringify(created)}`);
  const task = created.task;

  assert.equal(await exists(join(task.path, "home")), true, "应有家目录工作区");
  assert.equal(await exists(join(task.path, "repo")), true, "应有项目工作区");
  assert.equal(await exists(join(task.path, "repo", "README.md")), true, "repo/ 应是项目检出");
  assert.equal(await exists(join(task.path, "home", "projects", "demo")), true, "新绑定的 project 应出现在裁剪结果里");
  assert.equal((await git(home, ["status", "--porcelain"])).trim(), "", "主区仍应干净");
});
