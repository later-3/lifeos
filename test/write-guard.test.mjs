// 写入守卫（Task 0004 · P4 · L2）：Agent 的 write/edit/bash 只能落在**当前 Task 的工作区**里。
//
// 为什么必须锁（02-design §2.4b，reviewer 实测）：git 的 ort 对"主区未提交的改动"不设防——
// 两边改同一行、主区脏，merge rc=0、零冲突零提示，改动被**静默冲掉**。
// 而 e2e 实测 Pi 的 write 会 `mkdir -p` 父目录，所以"目录不存在"不能当守卫。
//
// 隔离：临时家目录 + `git init`（`specs/code/testing/testing.md` 2.1）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { installHome } from "../src/home.ts";
import { createTask } from "../src/tasks.ts";
import {
  createLifeOsWriteGuardExtension, decideBash, decideWrite, resetWriteGuardCaches,
  trackedFilesOf, writeGuardStats,
} from "../src/write-guard.ts";
import { HOME_DIR, REPO_DIR } from "../src/task-worktree.ts";

const run = promisify(execFile);
const git = async (cwd, args) =>
  (await run("git", ["-C", cwd, "-c", "core.quotePath=false", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { timeout: 60_000 })).stdout;

const ctx = { agentId: "lifeosagent", projectId: "workspace" };

/** 装临时家目录并 init 成 git 仓（工作区的前提），并在 `main` 上提交一次基线。 */
async function gitHome() {
  const base = await mkdtemp(join(tmpdir(), "lifeos-guard-"));
  const home = join(base, "home");
  await installHome(process.cwd(), home);
  await git(home, ["init", "-q", "-b", "main"]);
  await writeFile(join(home, ".gitignore"), await readFile(join(process.cwd(), ".lifeos", ".gitignore"), "utf8"));
  await git(home, ["add", "-A"]);
  await git(home, ["commit", "-q", "-m", "init"]);
  process.env.LIFEOS_HOME = home;
  resetWriteGuardCaches();
  return home;
}

/** 建一个带工作区的 Task（收窄态）。 */
async function taskWithWorktrees(home, title = "守卫测试") {
  const created = await createTask(ctx, { title, type: "general", category: "G" });
  assert.ok(!("code" in created), JSON.stringify(created));
  return created.task;
}

const decide = (home, taskId, target) => decideWrite({ home, scope: ctx, taskId, target });
const bash = (home, taskId, command, cwd = home) => decideBash({ home, scope: ctx, taskId, command, cwd });

// ── 五条判据 ────────────────────────────────────────────────────────────

test("G1 写当前 Task 的工作区文档 → 允许", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  for (const target of [
    join(task.docPath, "01-background.md"),
    join(task.docPath, "daily", "2026-11-20.md"),
    join(task.docPath, "cases", "2026-11-20.md"),
  ]) {
    assert.deepEqual(await decide(home, task.id, target), { allow: true }, target);
  }
});

test("G1b 写当前 Task 的 repo/ → 允许（项目代码工作区不裁剪）", async () => {
  const home = await gitHome();
  const created = await createTask(ctx, { title: "带代码仓", type: "general", category: "G" });
  assert.ok(!("code" in created), JSON.stringify(created));
  const task = created.task;

  // `workspace` 项目没有 path → 本来就不会建 repo/。这里**造一个真的 repo 工作区**
  // （真 `.git` + 真 marker）：判据对"没建成工作区的 repo/ 目录"是拒的（fake-worktree 前置），
  // 所以夹具必须是真的，否则测的是另一件事。
  const repoPath = join(task.path, REPO_DIR);
  await mkdir(repoPath, { recursive: true });
  await git(repoPath, ["init", "-q", "-b", "main"]);
  await writeFile(join(repoPath, ".lifeos-worktree.json"), JSON.stringify({ kind: "project", taskId: task.id }), "utf8");
  resetWriteGuardCaches();

  assert.deepEqual(await decide(home, task.id, join(repoPath, "src", "x.ts")), { allow: true });
  // 反向：同项目里**没建成工作区**的 repo/ 目录（把 marker 与 .git 都摘掉）必须拒
  const bare = join((await createTask(ctx, { title: "空壳", type: "general", category: "G" })).task.path, REPO_DIR);
  await mkdir(bare, { recursive: true });
  const bareTask = (await import("../src/tasks.ts")).listTasks;
  void bareTask;
  const bareCreated = await createTask(ctx, { title: "空壳2", type: "general", category: "G" });
  assert.ok(!("code" in bareCreated), JSON.stringify(bareCreated));
  const bareRepo = join(bareCreated.task.path, REPO_DIR);
  await mkdir(bareRepo, { recursive: true });
  resetWriteGuardCaches();
  assert.equal((await decide(home, bareCreated.task.id, join(bareRepo, "src", "x.ts"))).allow, false,
    "没建成工作区的 repo/ 目录（无 .git / marker）不许写");
});

test("G1c 写工作区里的共享层（projects/<pid>/runbook/x.md）→ 允许（共享层走 Task）", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  const target = join(task.path, HOME_DIR, "projects", "workspace", "runbook", "x.md");
  assert.deepEqual(await decide(home, task.id, target), { allow: true });
});

test("G1d 写主区 Task 文档（当前 Task 已有工作区）→ 拒，且理由给出工作区路径", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  const verdict = await decide(home, task.id, join(task.path, "task.md"));
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /拒绝写入/);
  assert.ok(verdict.reason.includes(task.docPath), `理由里必须给出 docPath，实际：${verdict.reason}`);
});

test("G2 写 ~/.lifeos/config/models.json → 拒（唯一显式排除）", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  for (const target of [join(home, "config", "models.json"), join(home, "config", "auth.json"), join(home, "config", "x.json")]) {
    const verdict = await decide(home, task.id, target);
    assert.equal(verdict.allow, false, target);
    assert.match(verdict.reason, /config\//, `理由要说清是 config/：${verdict.reason}`);
  }
});

test("G3 写 reference/<clone>/src/a.ts（ignored 且未 tracked）→ 允许", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  const target = join(home, "reference", "lobehub", "src", "a.ts");
  assert.deepEqual(await decide(home, task.id, target), { allow: true });
});

test("G3b 写 reference/AGENTS.md（ignored 但 tracked）→ 拒（它是主区文档）", async () => {
  const home = await gitHome();
  await mkdir(join(home, "reference"), { recursive: true });
  await writeFile(join(home, "reference", "AGENTS.md"), "# reference\n", "utf8");
  await git(home, ["add", "-f", "reference/AGENTS.md"]);
  await git(home, ["commit", "-q", "-m", "add -f reference"]);
  resetWriteGuardCaches();
  const task = await taskWithWorktrees(home);
  const verdict = await decide(home, task.id, join(home, "reference", "AGENTS.md"));
  assert.equal(verdict.allow, false, "ignored 但 tracked = git 看得见 = 主区文档");
});

test("G4 写项目主区（家目录之外）→ 拒", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  const verdict = await decide(home, task.id, "/Users/xulater/Code/lifeos/src/x.ts");
  assert.equal(verdict.allow, false);
});

test("G5 默认 Task 写 daily/<今天>.md（docRoot 回落主区）→ 允许（最高频路径）", async () => {
  const home = await gitHome();
  const { ensureDefaultTask } = await import("../src/tasks.ts");
  const daily = await ensureDefaultTask(ctx);
  // 默认 Task 也有工作区（家目录是 git 仓），所以 docRoot 是工作区；主区那条也必须是允许的
  const target = join(daily.docPath, "daily", "2026-11-20.md");
  assert.deepEqual(await decide(home, daily.id, target), { allow: true });
  // 反向：**没有**工作区的 Task（家目录不是 git 仓）docRoot 回落主区，那条路径必须允许
  const noGit = await mkdtemp(join(tmpdir(), "lifeos-guard-plain-"));
  const plainHome = join(noGit, "home");
  await installHome(process.cwd(), plainHome);
  process.env.LIFEOS_HOME = plainHome;
  resetWriteGuardCaches();
  const plain = await createTask(ctx, { title: "无工作区", type: "general", category: "G" });
  assert.ok(!("code" in plain), JSON.stringify(plain));
  assert.equal(plain.task.docPath, plain.task.path, "没有工作区时 docRoot 回落主区");
  assert.deepEqual(await decide(plainHome, plain.task.id, join(plain.task.docPath, "daily", "2026-11-20.md")), { allow: true });
});

test("G6 相对路径按 cwd 解析（不能靠相对路径绕过）", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  // cwd 设为 Task 目录：`task.md` 就是主区挂载点下那份
  const verdict = await decideBash({
    home, scope: ctx, taskId: task.id, command: "echo x > task.md", cwd: task.path,
  });
  assert.equal(verdict.allow, false, `相对路径也必须被解析出来：${JSON.stringify(verdict)}`);
});

test("G7 守卫不误伤：程序写 logs/ state/ 不经过工具层（只断言判据对它们也不拦）", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  // logs/ state/ 在 .gitignore 里且未 tracked → git 看不见 → 允许
  for (const target of [join(home, "logs", "backend-2026-11-20.jsonl"), join(home, "state", "session-views.json")]) {
    assert.deepEqual(await decide(home, task.id, target), { allow: true }, target);
  }
});

// ── bash 8 类漏（02-design §2.4 的表，逐条红测）──────────────────────────

const GUARDED = () => ensureGuardCases();

async function ensureGuardCases() {
  const home = await gitHome();
  const task = await taskWithWorktrees(home, "bash 漏");
  // 另建一个"别的 Task"，它**不在**当前 Task 的工作区里 → 写它就是越界
  const other = await taskWithWorktrees(home, "别的任务");
  return { home, task, other };
}

test("B1 cd 后写别人的 Task（主区）→ 拒", async () => {
  const { home, task, other } = await GUARDED();
  const verdict = await bash(home, task.id, `cd "${other.path}" && echo x >> log.md`);
  assert.equal(verdict.allow, false, JSON.stringify(verdict));
});

test("B2 变量拼接 → 拒（字面赋值能被解析出来）", async () => {
  const { home, task, other } = await GUARDED();
  const verdict = await bash(home, task.id, `P="${other.path}"; echo x >> $P/log.md`);
  assert.equal(verdict.allow, false, JSON.stringify(verdict));
});

test("B3 脚本里写 → 拒（脚本内容会被读进来递归分析）", async () => {
  const { home, task, other } = await GUARDED();
  const script = join(home, "state", "probe.sh");
  await mkdir(join(home, "state"), { recursive: true });
  await writeFile(script, `#!/bin/sh\necho x >> "${other.path}/log.md"\n`, "utf8");
  const verdict = await bash(home, task.id, `bash "${script}"`);
  assert.equal(verdict.allow, false, JSON.stringify(verdict));
});

test("B4 git 子命令分读写：status/log/diff 放行，apply/checkout/reset 在主区拒", async () => {
  const { home, task } = await GUARDED();
  for (const command of [
    `git -C "${home}" status`,
    `git -C "${home}" log --oneline -1`,
    `git -C "${home}" diff`,
    `git -C "${home}" ls-files`,
  ]) {
    const verdict = await bash(home, task.id, command);
    assert.equal(verdict.allow, true, `只读 git 必须放行：${command} → ${JSON.stringify(verdict)}`);
  }
  for (const command of [
    `git -C "${home}" apply x.patch`,
    `git -C "${home}" checkout -- .`,
    `git -C "${home}" reset --hard`,
    `git -C "${home}" merge other`,
  ]) {
    const verdict = await bash(home, task.id, command);
    assert.equal(verdict.allow, false, `写类 git 在主区必须拒：${command}`);
  }
  // 在**工作区**里写类 git 是允许的（Agent 要在自己分支上提交）
  const inWorktree = await bash(home, task.id, `git -C "${task.path}/${HOME_DIR}" add -A`);
  assert.equal(inWorktree.allow, true, `工作区里的 git 写必须放行：${JSON.stringify(inWorktree)}`);
});

test("B5 重定向进中间程序（tee / sed -i / perl -i）→ 拒", async () => {
  const { home, task, other } = await GUARDED();
  for (const command of [
    `echo x | tee "${other.path}/log.md"`,
    `sed -i '' 's/a/b/' "${other.path}/task.md"`,
    `perl -i -pe 's/a/b/' "${other.path}/task.md"`,
    `cat x | tail -1 > "${other.path}/log.md"`,
  ]) {
    const verdict = await bash(home, task.id, command);
    assert.equal(verdict.allow, false, `必须拒：${command}`);
  }
});

test("B6 heredoc 与多命令 → 拒", async () => {
  const { home, task, other } = await GUARDED();
  for (const command of [
    `cat > "${other.path}/log.md" <<EOF\nhello\nEOF`,
    `true && echo x >> "${other.path}/log.md"`,
    `true; echo x >> "${other.path}/log.md"`,
  ]) {
    const verdict = await bash(home, task.id, command);
    assert.equal(verdict.allow, false, `必须拒：${command}`);
  }
});

test("B7 mv / cp 进别人的 Task → 拒", async () => {
  const { home, task, other } = await GUARDED();
  const source = join(home, "state", "payload.txt");
  await mkdir(join(home, "state"), { recursive: true });
  await writeFile(source, "x\n", "utf8");
  for (const command of [
    `cp "${source}" "${other.path}/"`,
    `mv "${source}" "${other.path}/payload.txt"`,
    `ln -s "${source}" "${other.path}/link"`,
  ]) {
    const verdict = await bash(home, task.id, command);
    assert.equal(verdict.allow, false, `必须拒：${command}`);
  }
});

test("B8 解释器一行流（python3 -c / node -e）→ 拒", async () => {
  const { home, task, other } = await GUARDED();
  for (const command of [
    `python3 -c "open('${other.path}/log.md','a').write('x')"`,
    `node -e "require('fs').writeFileSync('${other.path}/log.md','x')"`,
  ]) {
    const verdict = await bash(home, task.id, command);
    assert.equal(verdict.allow, false, `必须拒：${command}`);
  }
});

test("B9 对照：bash 写自己的工作区 → 放行（守卫不能一刀切）", async () => {
  const { home, task } = await GUARDED();
  for (const command of [
    `echo x >> "${task.docPath}/log.md"`,
    `cd "${task.docPath}" && echo y > note.md`,
    `git -C "${task.path}/${HOME_DIR}" status`,
  ]) {
    const verdict = await bash(home, task.id, command);
    assert.equal(verdict.allow, true, `工作区里必须放行：${command} → ${JSON.stringify(verdict)}`);
  }
});

// ── 扩展挂载（tool_call 钩子）─────────────────────────────────────────────

test("E1 扩展挂到 tool_call：write 越界被 block，工作区内不 block", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  let handler;
  const extension = createLifeOsWriteGuardExtension({
    agentId: ctx.agentId, projectId: ctx.projectId, getTaskId: () => task.id,
  });
  extension.factory({ on: (name, fn) => { if (name === "tool_call") handler = fn; } });
  assert.equal(typeof handler, "function", "必须注册 tool_call");

  const blocked = await handler(
    { toolName: "write", input: { path: join(task.path, "task.md"), content: "x" } },
    { cwd: home },
  );
  assert.equal(blocked?.block, true, "主区 Task 文档必须被 block");
  assert.ok(blocked.reason.includes(task.docPath), "理由里要给 docPath");

  const allowed = await handler(
    { toolName: "write", input: { path: join(task.docPath, "01-background.md"), content: "x" } },
    { cwd: home },
  );
  assert.equal(allowed, undefined, "工作区内不该 block");

  const editBlocked = await handler(
    { toolName: "edit", input: { path: join(task.path, "task.md"), edits: [] } },
    { cwd: home },
  );
  assert.equal(editBlocked?.block, true, "edit 也要拦");
});

test("E2 扩展：bash 越界被 block；只读命令不 block", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  let handler;
  const extension = createLifeOsWriteGuardExtension({
    agentId: ctx.agentId, projectId: ctx.projectId, getTaskId: () => task.id,
  });
  extension.factory({ on: (name, fn) => { if (name === "tool_call") handler = fn; } });

  const blocked = await handler({ toolName: "bash", input: { command: `echo x >> "${task.path}/log.md"` } }, { cwd: home });
  assert.equal(blocked?.block, true, "越界 bash 必须 block");
  const allowed = await handler({ toolName: "bash", input: { command: "git status" } }, { cwd: home });
  assert.equal(allowed, undefined, "只读命令不该 block");
});

test("E3 扩展：没有 Task 指针时不误伤只读操作，但主区文档仍拒", async () => {
  const home = await gitHome();
  let handler;
  const extension = createLifeOsWriteGuardExtension({
    agentId: ctx.agentId, projectId: ctx.projectId, getTaskId: () => undefined,
  });
  extension.factory({ on: (name, fn) => { if (name === "tool_call") handler = fn; } });
  const blocked = await handler({ toolName: "write", input: { path: join(home, "agents", "lifeosagent", "agent.json"), content: "x" } }, { cwd: home });
  assert.equal(blocked?.block, true, "主区文档（tracked）必须拒");
  assert.match(blocked.reason, /没有 Task 指针/);
  const ok = await handler({ toolName: "write", input: { path: join(home, "reference", "clone", "a.ts"), content: "x" } }, { cwd: home });
  assert.equal(ok, undefined, "git 看不见的路径不该拦");
});

// ── 活性：把判据改坏，对应断言必须红 ──────────────────────────────────────

test("L1 活性：判据顺序颠倒（先判主区）会把工作区一起拒掉", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  // 模拟"先判主区"：工作区路径 `~/.lifeos/.../home/agents/...` 落在主区之下
  const inWorktree = join(task.docPath, "01-background.md");
  assert.ok(inWorktree.startsWith(home), "前提：工作区确实在家目录之下（所以顺序错了会一起拒）");
  assert.deepEqual(await decide(home, task.id, inWorktree), { allow: true }, "正确顺序下必须放行");
});

// ── 判据 4 的两个**副作用**（必须显式锁住，不能靠巧合）────────────────────

test("G8 判据 4 的副作用：写**别的 Task 的工作区**也放行（因为 home/ repo/ 在 .gitignore 里）", async () => {
  const home = await gitHome();
  const current = await taskWithWorktrees(home, "当前任务");
  const other = await taskWithWorktrees(home, "别的任务");

  // 为什么这是"对"的（用户 2026-11-19 口径）：
  // 「这样 agent 可以写任意的 task 下面的 worktree，但改动都是在 task 下面，这样合并都是以 task 为粒度的」
  // 所以放行符合口径；但它**不是判据 1 给的**，是判据 4（git 看不见）顺带给的——
  // 因为 `.lifeos/.gitignore:30-31` 忽略了 `**/tasks/*/home/` 与 `**/tasks/*/repo/`。
  // 锁住它：将来若改成"只许写当前 Task 的工作区"，这条会红，逼人回来重新裁决。
  assert.deepEqual(await decide(home, current.id, join(other.docPath, "x.md")), { allow: true });
  // 同一条工作区里的另一个位置（`workspace` 项目没有 repo/，所以用 home 工作区内的共享层）
  assert.deepEqual(
    await decide(home, current.id, join(other.path, HOME_DIR, "projects", "workspace", "runbook", "x.md")),
    { allow: true },
  );

  // 但主区里那个 Task 的**文档**（它不是 git 看不见的）必须拒
  assert.equal((await decide(home, current.id, join(other.path, "log.md"))).allow, false);
});

test("G9 判据 3 必须先于判据 4：config/ 在 .gitignore 里，靠顺序才拦得住", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  // 前提：config/ 确实被 git 忽略（所以判据 4 本来会放行它）
  const ignored = await run("git", ["-C", home, "check-ignore", "-q", join(home, "config", "models.json")], { timeout: 30_000 })
    .then(() => true, () => false);
  assert.equal(ignored, true, "前提：config/ 在 .gitignore 里（因此判据 4 会放行它，必须靠判据 3 拦）");
  assert.equal((await decide(home, task.id, join(home, "config", "models.json"))).allow, false);
});

test("G10 内存 tracked Set 是**性能层**：命中它时不 spawn git check-ignore（否则每次多 10.9ms）", async () => {
  const home = await gitHome();
  await mkdir(join(home, "reference"), { recursive: true });
  await writeFile(join(home, "reference", "AGENTS.md"), "# reference\n", "utf8");
  await git(home, ["add", "-f", "reference/AGENTS.md"]);
  await git(home, ["commit", "-q", "-m", "add -f"]);
  resetWriteGuardCaches();
  const task = await taskWithWorktrees(home);
  await trackedFilesOf(home);            // 预热（加载 Set 本身会 spawn 一次 ls-files，不计入本计数器）

  const before = writeGuardStats.checkIgnoreCalls;
  const verdict = await decide(home, task.id, join(home, "reference", "AGENTS.md"));
  assert.equal(verdict.allow, false, "tracked 文件必须拒");
  assert.equal(
    writeGuardStats.checkIgnoreCalls, before,
    "命中内存 Set 时**不该**再 spawn git check-ignore（这层是性能优化；去掉行为不变但每次多 10.9ms）",
  );

  // 未 tracked 且被忽略的路径才需要问 git
  const second = writeGuardStats.checkIgnoreCalls;
  await decide(home, task.id, join(home, "reference", "clone", "a.ts"));
  assert.equal(writeGuardStats.checkIgnoreCalls, second + 1, "未命中的路径必须问 git");
});

// ── reviewer 核出的两处漏（2026-11-19 第四轮补）────────────────────────────
//
// 阻塞级：判据 ④「git 看不见」会因为 `.lifeos/.gitignore:16` 忽略 `**/tasks/*/home/`
// 而放行"伪造一个工作区"——Pi 的 write 会 mkdir -p 父目录，于是主区真出现
// `<B>/home/agents/.../task.md`，随后 `taskDocRootOf`（只看文件存在，`task-doc-path.ts:27-31`）
// 就把 B 的装配读根静默切过去；那份假树没有分支、没有检视源。
//
// 误放：`.gitignore:10` 忽略 `**/projects/*/sessions/`、`:11-14` 忽略 `**/memory/**/{data,daemon,skills,logs}/`
// → 判据 ④ 允许，于是 Agent 能造假的会话 JSONL、能写记忆库二进制。

/** 造一个"已合并、工作区已摘除"的 Task（只留主区目录 + 它的骨架）。 */
async function mergedTask(home, title) {
  const created = await createTask(ctx, { title, type: "general", category: "G" });
  assert.ok(!("code" in created), JSON.stringify(created));
  const task = created.task;
  // 摘除两个工作区（等价于用户合并后 `git worktree remove`）
  const { removeWorktree } = await import("../src/task-worktree.ts");
  await removeWorktree(home, join(task.path, HOME_DIR));
  const repoPath = join(task.path, REPO_DIR);
  await removeWorktree(home, repoPath).catch(() => undefined);
  resetWriteGuardCaches();
  return task;
}

test("N1 写已合并 Task 的 <B>/home/.../task.md → 拒（不许伪造工作区）", async () => {
  const home = await gitHome();
  const current = await taskWithWorktrees(home, "当前任务");
  const merged = await mergedTask(home, "已合并任务");

  const fake = join(merged.path, HOME_DIR, "agents", ctx.agentId, "projects", ctx.projectId, "tasks", merged.dirName, "task.md");
  const verdict = await decide(home, current.id, fake);
  assert.equal(verdict.allow, false, `不许在主区伪造工作区：${JSON.stringify(verdict)}`);
  assert.match(verdict.reason, /注册过的工作区|缺 \.git|marker/);
});

test("N2 写当前 Task 自己的 <taskDir>/home/...（工作区已摘除）→ 拒", async () => {
  const home = await gitHome();
  const task = await mergedTask(home, "自己也已合并");

  const fake = join(task.path, HOME_DIR, "agents", ctx.agentId, "projects", ctx.projectId, "tasks", task.dirName, "01-background.md");
  const verdict = await decide(home, task.id, fake);
  assert.equal(verdict.allow, false, `自己的假树也要拒：${JSON.stringify(verdict)}`);
});

test("N3 写 agents/*/projects/*/sessions/xxx.jsonl → 拒（会污染会话原始记录）", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  for (const target of [
    join(home, "agents", ctx.agentId, "projects", ctx.projectId, "sessions", "2026-11-20T00-00-00_x.jsonl"),
    join(home, "agents", ctx.agentId, "projects", ctx.projectId, "sessions", "sub", "a.jsonl"),
  ]) {
    const verdict = await decide(home, task.id, target);
    assert.equal(verdict.allow, false, `会话记录不许写：${target}`);
  }
});

test("N4 写记忆库（memory/**/data/memos.db）→ 拒", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  for (const target of [
    join(home, "agents", ctx.agentId, "memory", "data", "memos.db"),
    join(home, "agents", ctx.agentId, "projects", ctx.projectId, "memory", "data", "memos.db"),
    join(home, "projects", "workspace", "memory", "data", "memos.db"),
    join(home, "agents", ctx.agentId, "memory", "daemon", "x.log"),
    join(home, "agents", ctx.agentId, "memory", "skills", "s.md"),
  ]) {
    const verdict = await decide(home, task.id, target);
    assert.equal(verdict.allow, false, `记忆库不许写：${target}`);
  }
});

test("N5 真 worktree 的 other.docPath / other.repo → 仍放行（G8 不回归）", async () => {
  const home = await gitHome();
  const current = await taskWithWorktrees(home, "当前任务");
  const other = await taskWithWorktrees(home, "别的真工作区");
  assert.deepEqual(await decide(home, current.id, join(other.docPath, "x.md")), { allow: true });
  assert.deepEqual(
    await decide(home, current.id, join(other.path, HOME_DIR, "projects", "workspace", "runbook", "x.md")),
    { allow: true },
    "真 worktree 里的共享层子路径也要放行",
  );
});

test("M1 合并后缓存必须失效（否则 30 秒内把刚被跟踪的文件仍当 invisible 放行）", async () => {
  const home = await gitHome();
  const task = await taskWithWorktrees(home);

  // ① 一个**未 tracked 且 ignored** 的路径：判据 ④ 放行
  const candidate = join(home, "reference", "clone", "a.ts");
  assert.deepEqual(await decide(home, task.id, candidate), { allow: true });

  // ② 模拟"它被合并进主区、被跟踪了"
  await mkdir(join(home, "reference", "clone"), { recursive: true });
  await writeFile(candidate, "export {}\n", "utf8");
  await git(home, ["add", "-f", "reference/clone/a.ts"]);
  await git(home, ["commit", "-q", "-m", "track it"]);

  // ③ **不清缓存**时它还在 30 秒 TTL 里 → 仍按旧集合放行（这就是那个陈旧窗口）
  assert.deepEqual(await decide(home, task.id, candidate), { allow: true },
    "前提：TTL 内确实还在用旧的 tracked 集合（所以必须有外部触发来清）");

  // ④ 清缓存后立刻按新集合判 → 拒
  resetWriteGuardCaches();
  assert.equal((await decide(home, task.id, candidate)).allow, false, "清缓存后必须立刻按新 tracked 集合判");
});

test("M2 mergeTask 结束时清缓存（否则合并完 30 秒内守卫用旧集合）", async () => {
  const home = await gitHome();
  await taskWithWorktrees(home, "待合并");

  const { mergeTask } = await import("../src/task-merge.ts");
  const before = writeGuardStats.cacheResets;
  // 任意一个 Task 目录都能跑 mergeTask（没有工作区的会全部 skipped，但收尾动作一样）
  const tasksRoot = join(home, "agents", ctx.agentId, "projects", ctx.projectId, "tasks");
  const first = (await (await import("node:fs/promises")).readdir(tasksRoot)).sort()[0];
  await mergeTask(join(tasksRoot, first));

  assert.ok(writeGuardStats.cacheResets > before,
    `mergeTask 收尾必须 resetWriteGuardCaches()（写语义改变了 tracked 集合）；实际 cacheResets: ${before} → ${writeGuardStats.cacheResets}`);
});

test("N6 写根级 .lifeos-worktree.json（工作区注册标记）→ 拒", async () => {
  // 依据：`.lifeos/.gitignore:43` 是根级 `.lifeos-worktree.json`，它是工作区的**注册标记**。
  // 不加固"无害"（root marker 不构成 mount），但语义上就是程序专属：只有建工作区的动作能写它。
  // 加固它的额外价值：守住"先伪造 marker 再写假树"这条路的第一步（守卫在工具执行前跑，
  // 所以伪造 marker 的那一次调用本身就被拒 → 鸡生不出蛋）。
  const home = await gitHome();
  const task = await taskWithWorktrees(home);
  const target = join(home, ".lifeos-worktree.json");
  const verdict = await decide(home, task.id, target);
  assert.equal(verdict.allow, false, `根级 marker 不许写：${JSON.stringify(verdict)}`);
  assert.match(verdict.reason, /注册标记|只由建工作区/);
});

// ── P5 存量共存（Task 0004 · P5）────────────────────────────────────────
//
// 协议 §11「历史不改写」：存量工作区不迁移、不重设 sparse，所以两种形态长期共存，
// 守卫与扫描都得同时处理。这里验的是**守卫不把旧形态判死**。
//
// 实测依据（2026-11-19，49 个存量挂载点）：
//   marker + .git 都有  45 个
//   只有 .git（无 marker）4 个 —— agent-3909/chengdu-outdoors/0002 的 home+repo、
//                                 reviewer/lifeos/0003 的 worktree、coder/lifeos/0010 的 evidence/worktree
//   两个都没有           0 个
// 所以 `isRegisteredWorktree`（marker **或** .git）对存量全覆盖——这是它认 `.git` 的理由。

/**
 * 造一个**旧形态**的 home 工作区：有 `.git`、**没有 marker**（与那 4 个存量一致）。
 *
 * 注意 `createTask` 已经建过收窄态工作区（带 marker），所以这里要先摘掉它——
 * 否则测的是"新形态"，与 P5 要验的东西不是一件事（第一版就是这么假红的）。
 */
async function legacyHomeWorktree(home, task) {
  const wt = join(task.path, HOME_DIR);
  const { rm } = await import("node:fs/promises");
  const { removeWorktree } = await import("../src/task-worktree.ts");
  await removeWorktree(home, wt).catch(() => undefined);
  await rm(wt, { force: true, recursive: true }).catch(() => undefined);
  await mkdir(wt, { recursive: true });
  await git(wt, ["init", "-q", "-b", "main"]);
  const doc = join(wt, "agents", ctx.agentId, "projects", ctx.projectId, "tasks", task.dirName);
  await mkdir(doc, { recursive: true });
  // 旧形态的文档就在工作区里（收窄前整个 agents/<自己>/ 都检出）
  for (const file of ["task.md", "AGENTS.md", "concept-space.md", "flywheel.md", "01-background.md"]) {
    await writeFile(join(doc, file), `# ${file}\n`, "utf8");
  }
  // 主区里那份是"上次合并的版本"或不存在
  await import("node:fs/promises").then(({ rm }) => rm(join(task.path, "01-background.md"), { force: true }));
  resetWriteGuardCaches();
  return doc;
}

test("P5-1 旧形态（有 .git、无 marker）：写工作区文档 → 放行", async () => {
  const home = await gitHome();
  const created = await createTask(ctx, { title: "旧形态", type: "general", category: "G" });
  assert.ok(!("code" in created), JSON.stringify(created));
  const task = created.task;
  const doc = await legacyHomeWorktree(home, task);

  // 前提：这个工作区确实**没有** marker（否则测的不是"旧形态"）
  const hasMarker = await (await import("node:fs/promises")).stat(join(task.path, HOME_DIR, ".lifeos-worktree.json")).then(() => true, () => false);
  assert.equal(hasMarker, false, "前提：旧形态没有 marker");

  assert.deepEqual(await decide(home, task.id, join(doc, "01-background.md")), { allow: true },
    "旧形态（只有 .git）必须能写——存量 4 个就是这种");
});

test("P5-2 旧形态：taskDocRootOf 返回工作区（不是主区）", async () => {
  const home = await gitHome();
  const created = await createTask(ctx, { title: "旧形态定位", type: "general", category: "G" });
  const task = created.task;
  const doc = await legacyHomeWorktree(home, task);

  const { taskDocRootOf } = await import("../src/task-doc-path.ts");
  const root = await taskDocRootOf(task.path, ctx, task.dirName);
  assert.equal(root, doc, `必须命中工作区那份：${root}`);
  assert.notEqual(root, task.path, "不等于主区");
});

test("P5-3 已合并（工作区摘除）：taskDocRootOf 返回主区", async () => {
  const home = await gitHome();
  const task = await mergedTask(home, "已合并");
  const { taskDocRootOf } = await import("../src/task-doc-path.ts");
  const root = await taskDocRootOf(task.path, ctx, task.dirName);
  assert.equal(root, task.path, "工作区摘除后必须回落主区");
  // 不断言主区有 task.md：这个夹具只做了 `worktree remove`，**没有真合并**（纪律 4），
  // 所以主区此刻确实可能没有文档——那是"已合并但未检出"的中间态，不是产品缺陷。
  // 真要断言"合并后有文档"，必须真跑 mergeTask，那会违反"不真合并任何 Task"。
});

test("P5-V3 旧形态的合并前置判据仍生效：主区脏 → status=dirty（不真合并）", async () => {
  // 纪律 4：**不真合并任何 Task**。这里只验合并的**前置判据**——主区不干净时
  // `mergeWorktree` 必须返回 `dirty` 并且**不动工作区**（不提交、不删除）。
  const home = await gitHome();
  const created = await createTask(ctx, { title: "合并前置", type: "general", category: "G" });
  assert.ok(!("code" in created), JSON.stringify(created));
  const task = created.task;
  const wt = join(task.path, HOME_DIR);

  // 前提：工作区是活的 git 检出
  assert.equal(await (await import("node:fs/promises")).stat(join(wt, ".git")).then(() => true, () => false), true);

  // 把主区弄脏（这就是"主区必须干净才合并"要拦的状态）。
  // 注意 `users/` 在安装骨架里不一定存在——先建目录，否则是 ENOENT 而不是"主区脏"。
  await (await import("node:fs/promises")).mkdir(join(home, "users"), { recursive: true });
  await writeFile(join(home, "users", "dirty-probe.md"), "# 未提交\n", "utf8");

  const { mergeWorktree } = await import("../src/task-merge.ts");
  const step = await mergeWorktree("home", wt);
  assert.equal(step.status, "dirty", `主区脏时必须返回 dirty，实际：${step.status} / ${step.message}`);

  // 关键：**工作区没被删除**（dirty 是"什么都不做"，不是"合到一半"）
  assert.equal(await (await import("node:fs/promises")).stat(wt).then((s) => s.isDirectory(), () => false), true,
    "dirty 时不该删除工作区");
  // 主区仍然是脏的（没被"顺手提交"）。
  // `-uall` 不能省：`users/` 整目录未跟踪时默认只显示 `?? users/`，
  // 断言文件名会恒假（同一族坑：这是第四次，前三次是空集断言 / quotePath / 弱子串断言）。
  const status = await git(home, ["status", "--porcelain", "-uall"]);
  assert.match(status, /dirty-probe\.md/, `主区必须保持原样（不该被自动提交）：\n${status}`);
});
