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
import { execFileSync } from "node:child_process";
import { createTask } from "../src/tasks.ts";
import { locateSources, computeReviewDiff } from "../src/review.ts";
import { start } from "./server-harness.mjs";

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

test("HTTP：GET review-sources 响应带 taskDir（前端手点按钮用它开面板，0018）", async () => {
  // 回归：手点"检视当前 Task 的改动"曾经拿 items[].path（= <taskDir>/home）当 taskDir 开面板，
  // 等于对着 worktree 根算 diff → 0 文件 / "不是 git 仓库"（用户实测）。响应现在显式回 taskDir。
  const { server, base, home } = await start();
  try {
    const taskDir = join(home, "agents", "lifeosagent", "projects", "workspace", "tasks", "0099-x");
    await mkdir(join(taskDir, "home"), { recursive: true });
    const response = await fetch(`${base}/api/agents/lifeosagent/projects/workspace/tasks/0099-x/review-sources`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.taskDir, taskDir, "响应顶层必须回 taskDir（主区 Task 目录，不是源目录）");
    const lifeos = body.items?.find((item) => item.kind === "lifeos");
    assert.equal(lifeos?.path, join(taskDir, "home"), "lifeos 源仍是 <taskDir>/home，别和 taskDir 混淆");
  } finally { server.close(); }
});




test("skip-worktree 的路径不得进 worktree diff 快照（0018：submodule→软链的 typechange 噪声）", async () => {
  const { home } = await installedGitHome();
  process.env.LIFEOS_HOME = home;
  const taskDir = join(home, "agents", "a", "projects", "p", "tasks", "0001-x");
  const worktree = join(taskDir, "repo");
  await mkdir(worktree, { recursive: true });
  await git(worktree, ["init", "-q", "-b", "main"]);
  await writeFile(join(worktree, "code.ts"), "a\n");
  await git(worktree, ["add", "code.ts"]);
  // index 里造一条 submodule（gitlink，mode 160000）——真实仓里 pi 就是这个形态
  //（hash-object 用文件输入：execFile 没有 input 选项，--stdin 会永远等 stdin 卡死测试）
  await writeFile(join(worktree, ".pi-raw"), "pi-target\n");
  const link = (await run("git", ["-C", worktree, "hash-object", "-w", ".pi-raw"])).stdout.trim();
  await import("node:fs/promises").then((fs) => fs.rm(join(worktree, ".pi-raw")));
  execFileSync("git", ["-C", worktree, "update-index", "--add", "--cacheinfo", `160000,${link},pi`]);
  await git(worktree, ["commit", "-q", "-m", "init"]);
  // 本地特殊检出：pi 变软链 + skip-worktree（git 视而不见）
  await import("node:fs/promises").then((fs) => fs.symlink("/some/target", join(worktree, "pi")));
  execFileSync("git", ["-C", worktree, "update-index", "--skip-worktree", "pi"]);
  // 未跟踪文件必须仍进 diff
  await writeFile(join(worktree, "new-doc.md"), "新增\n");

  const diff = await computeReviewDiff(taskDir);
  const wt = diff.items.find((item) => item.source.kind === "worktree");
  const paths = wt.files.map((file) => file.path);
  assert.ok(!paths.includes("pi"), `skip-worktree 的 pi 不该出现，实际：${paths.join(", ")}`);
  assert.ok(paths.includes("new-doc.md"), `未跟踪文件应出现，实际：${paths.join(", ")}`);
  assert.ok(paths.includes("code.ts") === false, "已跟踪未改的文件不该出现");
});
