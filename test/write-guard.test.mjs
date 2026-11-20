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
  const task = await taskWithWorktrees(home);
  const target = join(task.path, REPO_DIR, "src", "x.ts");
  assert.deepEqual(await decide(home, task.id, target), { allow: true });
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
  assert.deepEqual(await decide(home, current.id, join(other.path, REPO_DIR, "src", "a.ts")), { allow: true });

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
