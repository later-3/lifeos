// 检视的两个源（协议 §3.7）：有工作区就走工作区，没有就退回历史形态。
//
// 最要紧的一条是 **diff 必须含未跟踪文件**：新建 Task 的文档全是未跟踪的，
// 裸 `git diff <base>` 根本看不到它们 —— 检视会显示“这个 Task 什么都没改”。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { installHome } from "../src/home.ts";
import { createTask } from "../src/tasks.ts";
import { locateSources, computeReviewDiff } from "../src/review.ts";

const run = promisify(execFile);
const git = async (cwd, args) =>
  (await run("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { timeout: 60_000 })).stdout;

async function installedGitHome() {
  const base = await mkdtemp(join(tmpdir(), "lifeos-rev-"));
  const home = join(base, "home");
  await installHome(process.cwd(), home);
  await git(home, ["init", "-q", "-b", "main"]);
  await writeFile(join(home, ".gitignore"), await readFile(join(process.cwd(), ".lifeos", ".gitignore"), "utf8"));
  await git(home, ["add", "-A"]);
  await git(home, ["commit", "-q", "-m", "init"]);
  return { base, home };
}

test("有 home/ 工作区：文档源指向它；未跟踪的新文档出现在 diff 里", async () => {
  const { home } = await installedGitHome();
  process.env.LIFEOS_HOME = home;
  const ctx = { agentId: "lifeosagent", projectId: "workspace" };
  const created = await createTask(ctx, { title: "检视两源", category: "G", type: "general" });
  assert.ok(!("code" in created), JSON.stringify(created));
  const task = created.task;

  // 文档源 = 工作区，不是主区目录
  const sources = await locateSources(task.path);
  const docSource = sources.find((source) => source.kind === "lifeos");
  assert.equal(docSource.path, join(task.path, "home"));
  assert.equal(docSource.branch, `task/${ctx.agentId}/${ctx.projectId}/${task.id}`);

  // 主区里这个 Task 的文档全是未跟踪的（Checkout 时还不存在）→ 必须靠“含未跟踪”的 diff 才看得见
  const diff = await computeReviewDiff(task.path);
  const docDiff = diff.items.find((item) => item.source.kind === "lifeos");
  assert.ok(docDiff.files.length > 0, "新建 Task 的文档应出现在文档源 diff 里");
  assert.ok(docDiff.files.some((file) => file.path.endsWith("/task.md")), `应含 task.md，实际：${docDiff.files.map((f) => f.path)}`);
  assert.ok(docDiff.files.some((file) => file.path.endsWith("/01-background.md")), "应含类型文档");
  assert.ok(docDiff.files.every((file) => file.status === "added"), "新建 Task 的文档都是新增");
});

test("共享层文档改动进文档源（Task 目录之外的改动不再看不见）", async () => {
  const { home } = await installedGitHome();
  process.env.LIFEOS_HOME = home;
  const ctx = { agentId: "lifeosagent", projectId: "workspace" };
  const created = await createTask(ctx, { title: "改共享规范", category: "G", type: "general" });
  assert.ok(!("code" in created), JSON.stringify(created));
  const task = created.task;

  const spec = join(task.path, "home", "projects", "workspace", "flywheel.md");
  await writeFile(spec, "# 飞轮（改过的）\n");

  const diff = await computeReviewDiff(task.path);
  const docDiff = diff.items.find((item) => item.source.kind === "lifeos");
  const paths = docDiff.files.map((file) => file.path);
  assert.ok(paths.includes("projects/workspace/flywheel.md"), `共享层改动应出现，实际：${paths.join(", ")}`);
  assert.equal(docDiff.files.find((file) => file.path === "projects/workspace/flywheel.md").status, "modified");
});

test("老 Task（没有 home/）退回历史形态：文档源 = Task 目录", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-legacy-"));
  const taskDir = join(home, "agents", "a", "projects", "p", "tasks", "0001-old");
  await mkdir(taskDir, { recursive: true });
  await writeFile(join(taskDir, "task.md"), "# old\n\nID: 0001\n");
  process.env.LIFEOS_HOME = home;

  const sources = await locateSources(taskDir);
  const docSource = sources.find((source) => source.kind === "lifeos");
  assert.equal(docSource.path, taskDir, "没有工作区时文档源就是 Task 目录本身");
});

test("代码源：repo/ 优先于 evidence/worktree（两种都在时取 repo/）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-pick-"));
  const taskDir = join(home, "tasks", "0002-x");
  for (const sub of ["repo", "evidence/worktree"]) {
    const dir = join(taskDir, sub);
    await mkdir(dir, { recursive: true });
    await git(dir, ["init", "-q", "-b", "main"]);
    await writeFile(join(dir, "a.txt"), "a\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "init"]);
  }
  process.env.LIFEOS_HOME = home;
  const sources = await locateSources(taskDir);
  const codeSource = sources.find((source) => source.kind === "worktree");
  assert.equal(codeSource.path, join(taskDir, "repo"));
});
