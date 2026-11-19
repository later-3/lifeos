// Task 工作区挂载点的唯一判据（协议 §3.7；Task 0004 · P1）。
//
// 覆盖三种输入，缺一不可：
//   ① 真挂载点：`<taskDir>/home`、`<taskDir>/repo`、`<taskDir>/worktree`（历史形态）→ true
//   ② 名字像但不是挂载点（外部仓库里的 `src/store/home`、`.git/worktrees/home`）→ false
//   ③ 挂载点**里面的**深层文件（`<taskDir>/home/agents/.../task.md`）→ false  ← 活性断言
//
// 第 ③ 条是这条契约的边界，也是最容易写错的一条：判据必须是「名字 + 父目录是 Task 目录」，
// 不能是「路径里含 `/home/`」——后者会让 `home:check` 把整棵子树当成"挂载点"跳过，
// 真实漂移静默消失（testing.md 2.4：门禁要能变红）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { createTask } from "../src/tasks.ts";
import { locateSources } from "../src/review.ts";
import { isWorktreeMount, worktreeMountKindOf } from "../src/worktree-mount.ts";

const TASK = "/lifeos/agents/coder/projects/lifeos/tasks/0028-连接池修复：事件通道换-WebSocket";
const deep = (tail) => join(TASK, tail);

test("T1 P1 要求的五种输入（完成标准 9）", () => {
  assert.equal(isWorktreeMount(deep("home")), true, "home/ 是挂载点");
  assert.equal(isWorktreeMount(deep("repo")), true, "repo/ 是挂载点");
  assert.equal(isWorktreeMount(deep("worktree")), true, "worktree/ 是历史形态的挂载点");
  assert.equal(isWorktreeMount(deep("cases")), false, "普通目录不是挂载点");
  assert.equal(
    isWorktreeMount(deep("home/agents/a/projects/p/tasks/0001/task.md")),
    false,
    "**挂载点里面的文件不是挂载点**——判成 true 会让 home:check 整棵跳过，真阳性静默消失",
  );
});

test("T1b 活性：挂载点内部逐级都不是挂载点（只认挂载点本身）", () => {
  for (const tail of [
    "home/agents",
    "home/agents/a",
    "home/agents/a/projects/p/tasks",
    "home/agents/a/projects/p/tasks/0001",
    "home/agents/a/projects/p/tasks/0001/task.md",
    "home/agents/a/projects/p/tasks/0001/cases",
    "repo/src/main.ts",
    "repo/src",
    "worktree/pi/packages/tui",
  ]) {
    assert.equal(isWorktreeMount(deep(tail)), false, `${tail} 在挂载点里，不是挂载点本身`);
  }
});

test("T2 名字像但不是挂载点：父目录不是 Task 目录的一律 false", () => {
  // 真实存在的三处（2026-11-19 家目录实测）：外部参考仓库、git 自己的 worktree 管理目录、样本工程
  for (const path of [
    "/lifeos/reference/lobehub/src/store/home",
    "/lifeos/reference/LynkCo-DiPlay/samples/home",
    "/lifeos/.git/worktrees/home",
    "/lifeos/agents/coder/projects/lifeos/specs/home",   // 协作层里的同名目录
    "/lifeos/projects/workspace/repo",                   // 共享层里的同名目录
  ]) {
    assert.equal(isWorktreeMount(path), false, `${path} 不是 Task 挂载点`);
  }
});

test("T3 只按名字判定会误判（这条解释为什么必须加「父目录是 Task 目录」这一条）", () => {
  const path = "/lifeos/reference/lobehub/src/store/home";
  assert.equal(path.split("/").includes("home"), true, "路径里确实含 home");
  assert.equal(isWorktreeMount(path), false, "但它不是挂载点");
});

test("T4 嵌套与边界形态：挂载点本身为 true 的前提是父目录是 Task 目录", () => {
  assert.equal(worktreeMountKindOf(deep("home")), "home");
  assert.equal(worktreeMountKindOf(deep("repo")), "repo");
  assert.equal(worktreeMountKindOf(deep("worktree")), "worktree");
  assert.equal(worktreeMountKindOf(deep("cases")), undefined);
  // 默认 Task 的目录名 `0001-default` 同样是 Task 目录
  assert.equal(isWorktreeMount("/x/tasks/0001-default/home"), true);
  // 父目录不是 `NNNN-` 形态（目录名漂移）→ 不认；这类 Task 目录本身已由 home:check 报错
  assert.equal(isWorktreeMount("/x/tasks/legacy-home/home"), false);
  // 末尾带分隔符也认（调用方可能拼了 '/'）
  assert.equal(isWorktreeMount(`${deep("home")}/`), true);
  // 工作区里**嵌套**的 Task 目录（家目录副本里确实存在：0006 的 home/ 里还有一份 0006 的 home/）：
  // 那条路径本身就是它的挂载点 → true。与 T1b 不矛盾：T1b 测的是「挂载点里面的**文件**」，
  // 而不是「里面另一个合法 Task 目录的挂载点」。`home:check` 走到外层 `home/` 就不进去了，
  // 所以这条只为把语义说清，不是为了让它被递归到。
  assert.equal(isWorktreeMount("/x/tasks/0006-a/home/agents/a/projects/p/tasks/0006-a/home"), true);
});

test("T5 消费方接得上：检视的扫描分支仍认历史 worktree/ 作为项目代码源", async () => {
  // 为什么要有这条：`review.ts` 原来只跳 `home/`（0018 用户实测：home 不是代码）。
  // 如果改成"跳过所有挂载点"，历史形态（reviewer 0003：只有 worktree/、没有 repo/）的
  // 项目代码源会**静默消失**——完成标准 4/11 直接坏掉，而且不报任何错。
  const home = await mkdtemp(join(tmpdir(), "lifeos-mount-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  const created = await createTask({ agentId: "lifeosagent", projectId: "workspace" }, { title: "历史形态", category: "G", type: "general" });
  assert.ok(!("code" in created), `createTask 失败：${JSON.stringify(created)}`);
  const task = created.task;

  const legacy = join(task.path, "worktree");
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, ".git"), "gitdir: /nowhere\n", "utf8");

  const sources = await locateSources(task.path);
  const code = sources.find((source) => source.kind === "worktree");
  assert.ok(code !== undefined, `应找到项目代码源，实际：${JSON.stringify(sources.map((s) => [s.kind, s.path]))}`);
  assert.equal(code.path, legacy, "历史 worktree/ 必须仍被认成项目代码源");
});

test("T6 活性（home-check）：挂载点内部缺说明文件仍必须报——判宽了会静默少报", async () => {
  // 这是完成标准 9 括号里那句话的可执行版本：「否则真阳性会静默消失」。
  // 把 `isWorktreeMount` 改成"路径里含 /home/ 就算"→ 文档树被整棵跳过 → 本条变红。
  const home = await mkdtemp(join(tmpdir(), "lifeos-mount-live-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  const agentId = "lifeosagent";
  const projectId = "workspace";
  const created = await createTask({ agentId, projectId }, { title: "活性检查", category: "G", type: "general" });
  assert.ok(!("code" in created), `createTask 失败：${JSON.stringify(created)}`);
  const task = created.task;

  // 工作区形态：文档在 <taskDir>/home/agents/<a>/projects/<p>/tasks/<dir>/
  const doc = join(task.path, "home", "agents", agentId, "projects", projectId, "tasks", task.dirName);
  await mkdir(doc, { recursive: true });
  for (const file of ["task.md", "AGENTS.md", "concept-space.md", "flywheel.md", "01-background.md", "02-plan.md"]) {
    await writeFile(join(doc, file), file === "task.md" ? `# 活性检查\n\nID: ${task.id}\n类型：general\n类别：G 普通任务\n状态：进行中\n` : `# ${file}\n`);
  }
  for (const sub of ["specs", "cases", "knowledge", "tools", "todo"]) await mkdir(join(doc, sub), { recursive: true });
  await writeFile(join(doc, "specs", "AGENTS.md"), "# specs\n");   // 只给这一个说明文件，其余三个故意缺

  const { checkHome } = await import("../src/home-check.ts");
  const report = await checkHome(home);
  const missing = report.errors.filter((line) => line.includes(`${task.dirName}/`) && line.includes("缺少说明文件 AGENTS.md"));
  assert.deepEqual(
    missing.map((line) => line.split("/").at(-2)).sort(),
    ["cases", "knowledge", "todo", "tools"],
    `挂载点内部缺说明文件的目录必须被报出来（判宽了会整棵跳过），实际：\n${report.errors.join("\n")}`,
  );
  // 反向：挂载点**自身**不该被要求说明文件（这就是它被跳过的正当理由）
  assert.deepEqual(
    report.errors.filter((line) => line.includes(`${task.dirName}/home/）`) || line.includes(`${task.dirName}/home/ `) || line.endsWith(`${task.dirName}/home/`)),
    [],
    `home/ 自身不该要求说明文件：\n${report.errors.join("\n")}`,
  );
});
