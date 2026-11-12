// Task 的合并（协议 §3.7：合并只由用户触发）。
//
// 四条纪律各一条断言：干净合入 / 冲突回滚 / 主区脏就拒绝 / 没有工作区就跳过。
// 最重要的一条是**冲突必须回滚**：留一个 conflict 状态的仓，用户后续每一步都是坑。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { installHome } from "../src/home.ts";
import { createTask } from "../src/tasks.ts";
import { mergeTask } from "../src/task-merge.ts";

const run = promisify(execFile);
const git = async (cwd, args) =>
  (await run("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { timeout: 60_000 })).stdout;
const exists = async (path) => (await stat(path).catch(() => undefined)) !== undefined;

async function installedGitHome() {
  const base = await mkdtemp(join(tmpdir(), "lifeos-merge-"));
  const home = join(base, "home");
  await installHome(process.cwd(), home);
  await git(home, ["init", "-q", "-b", "main"]);
  await writeFile(join(home, ".gitignore"), await readFile(join(process.cwd(), ".lifeos", ".gitignore"), "utf8"));
  await git(home, ["add", "-A"]);
  await git(home, ["commit", "-q", "-m", "init"]);
  return { base, home };
}

async function newTask(home, title) {
  process.env.LIFEOS_HOME = home;
  const created = await createTask({ agentId: "lifeosagent", projectId: "workspace" }, { title, category: "G", type: "general" });
  assert.ok(!("code" in created), JSON.stringify(created));
  return created.task;
}

test("干净合入：文档进主区、家目录工作区被删、仓里无残留登记", async () => {
  const { home } = await installedGitHome();
  const task = await newTask(home, "合入测试");
  const spec = join(task.path, "home", "projects", "workspace", "flywheel.md");
  await writeFile(spec, "# 飞轮（改过的）\n");

  const result = await mergeTask(task.path);
  assert.equal(result.ok, true, JSON.stringify(result));
  const homeStep = result.steps.find((step) => step.kind === "home");
  assert.equal(homeStep.status, "merged");

  // 改动进了主区
  assert.match(await readFile(join(home, "projects", "workspace", "flywheel.md"), "utf8"), /改过的/);
  // Task 的文档也进了主区
  assert.equal(await exists(join(task.path, "task.md")), true, "合并后 Task 文档应在主区出现");
  // 工作区被删
  assert.equal(await exists(join(task.path, "home")), false, "合并后工作区应被删除");
  // 仓干净、无残留 worktree 登记
  assert.equal((await git(home, ["status", "--porcelain"])).trim(), "", "合并后主区应干净");
  assert.doesNotMatch(await git(home, ["worktree", "list"]), /合入测试/);
});

test("冲突：回滚并把冲突文件报出来，主区恢复原样（不留 conflict 状态）", async () => {
  const { home } = await installedGitHome();
  const task = await newTask(home, "冲突测试");
  const rel = join("projects", "workspace", "flywheel.md");

  // 工作区里改
  await writeFile(join(task.path, "home", rel), "工作区版本\n");
  // 主区里改同一行并提交（主区必须干净才允许合并）
  await writeFile(join(home, rel), "主区版本\n");
  await git(home, ["add", "-A"]);
  await git(home, ["commit", "-q", "-m", "main 侧改动"]);

  const result = await mergeTask(task.path);
  assert.equal(result.ok, false);
  const homeStep = result.steps.find((step) => step.kind === "home");
  assert.equal(homeStep.status, "conflict");
  assert.ok((homeStep.conflicts ?? []).some((path) => path.endsWith("flywheel.md")), JSON.stringify(homeStep));

  // 回滚：没有 MERGE_HEAD，主区内容仍是主区版本，工作区还在
  assert.equal(await exists(join(home, ".git", "MERGE_HEAD")), false, "冲突后必须 merge --abort");
  assert.match(await readFile(join(home, rel), "utf8"), /主区版本/);
  assert.equal(await exists(join(task.path, "home")), true, "冲突时不该删工作区");
});

test("主区脏：拒绝合并，不新建提交也不动工作区", async () => {
  const { home } = await installedGitHome();
  const task = await newTask(home, "脏主区");
  await writeFile(join(home, "dirty.txt"), "未提交\n");

  const result = await mergeTask(task.path);
  assert.equal(result.ok, false);
  assert.equal(result.steps.find((step) => step.kind === "home").status, "dirty");
  assert.equal(await exists(join(home, "dirty.txt")), true, "不该动主区的脏文件");
  assert.equal(await exists(join(task.path, "home")), true, "不该删工作区");
});

test("没有工作区：skipped，ok 仍为 true（不是错误）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-merge-none-"));
  process.env.LIFEOS_HOME = home;
  const taskDir = join(home, "agents", "a", "projects", "p", "tasks", "0001-old");
  await writeFile(join(home, "keep.txt"), "x\n");
  await git(home, ["init", "-q", "-b", "main"]).catch(() => undefined);

  const result = await mergeTask(taskDir);
  assert.equal(result.ok, true);
  assert.equal(result.steps.filter((step) => step.status === "skipped").length, 2);
});
