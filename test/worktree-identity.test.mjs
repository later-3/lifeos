// 工作区的提交身份（协议 §3.7「提交与署名」）。
//
// 要证明的**行为**（不是实现）：谁在哪个目录提交，git 记下来的作者是谁。
// 四件事各自一条断言：
//   T1 建 Task 后，工作区里提交的作者 = agentId（不是用户的全局身份）
//   T2 主区里提交的作者仍是全局身份（工作区身份不许污染主区）
//   T3 两个 Agent 的工作区各记各的身份，不串
//   T4 `judgeIdentity` 的四态穷举（ok / missing / wrong / no-extension）
//
// 隔离：临时家目录 + 临时 git 仓；全局身份用 GIT_CONFIG_GLOBAL 指到临时文件，
// 绝不读也不写这台机器真实的 `~/.gitconfig`（`specs/code/testing/testing.md` 2.1）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { installHome } from "../src/home.ts";
import { createTask } from "../src/tasks.ts";
import { applyWorktreeIdentity, identityOf, judgeIdentity, readWorktreeIdentity } from "../src/worktree-identity.ts";

const run = promisify(execFile);

/** 一份临时的“用户全局身份”，隔离掉本机真实的 ~/.gitconfig。 */
async function tempGlobal(base) {
  const path = join(base, "gitconfig-global");
  await writeFile(path, "[user]\n\tname = real-user\n\temail = real@example.com\n");
  return path;
}

async function git(cwd, args, globalPath) {
  return (await run("git", ["-C", cwd, ...args], {
    timeout: 60_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: globalPath, GIT_CONFIG_NOSYSTEM: "1" },
  })).stdout;
}

async function installedGitHome() {
  const base = await mkdtemp(join(tmpdir(), "lifeos-identity-"));
  const home = join(base, "home");
  await installHome(process.cwd(), home);
  const globalPath = await tempGlobal(base);
  await git(home, ["init", "-q", "-b", "main"], globalPath);
  await writeFile(join(home, ".gitignore"), await readFile(join(process.cwd(), ".lifeos", ".gitignore"), "utf8"));
  await git(home, ["add", "-A"], globalPath);
  await git(home, ["commit", "-q", "-m", "init"], globalPath);
  return { base, home, globalPath };
}

const exists = async (path) => (await stat(path).catch(() => undefined)) !== undefined;

test("T1：工作区里提交的作者是 agentId，不是用户的全局身份", async () => {
  const { home, globalPath } = await installedGitHome();
  process.env.LIFEOS_HOME = home;
  const created = await createTask({ agentId: "lifeosagent", projectId: "workspace" }, { title: "署名", type: "general", category: "G" });
  assert.ok(!("code" in created), JSON.stringify(created));
  const worktree = join(created.task.path, "home");
  assert.equal(await exists(worktree), true, "家目录工作区应存在");

  // 工作区里改了东西再提交（Agent 的真实动作）
  await writeFile(join(worktree, "projects", "workspace", "flywheel.md"), "# 改过\n");
  await git(worktree, ["add", "-A"], globalPath);
  await git(worktree, ["commit", "-q", "-m", "agent 的提交"], globalPath);

  const author = (await git(worktree, ["log", "-1", "--pretty=%an|%ae"], globalPath)).trim();
  assert.equal(author, "lifeosagent|lifeosagent@lifeos.local", `工作区提交的作者应为 agentId，实际 ${author}`);
});

test("T2：主区提交的作者仍是用户的全局身份（工作区身份不污染主区）", async () => {
  const { home, globalPath } = await installedGitHome();
  process.env.LIFEOS_HOME = home;
  const created = await createTask({ agentId: "lifeosagent", projectId: "workspace" }, { title: "不污染", type: "general", category: "G" });
  assert.ok(!("code" in created), JSON.stringify(created));

  await writeFile(join(home, "keep.txt"), "x\n");
  await git(home, ["add", "-A"], globalPath);
  await git(home, ["commit", "-q", "-m", "主区提交"], globalPath);
  const author = (await git(home, ["log", "-1", "--pretty=%an|%ae"], globalPath)).trim();
  assert.equal(author, "real-user|real@example.com", `主区提交应仍是全局身份，实际 ${author}`);

  // 主区的仓配置里不得被写入 user.*（那是工作区独占的）
  const localName = await git(home, ["config", "--local", "--get", "user.name"], globalPath).then((v) => v.trim()).catch(() => "");
  assert.equal(localName, "", "主区仓配置不得写入 user.name");
});

test("T3：两个 Agent 的工作区各记各的身份，不串", async () => {
  const { home, globalPath } = await installedGitHome();
  process.env.LIFEOS_HOME = home;
  const a = await createTask({ agentId: "agent-a", projectId: "workspace" }, { title: "A 的活", type: "general", category: "G" });
  const b = await createTask({ agentId: "agent-b", projectId: "workspace" }, { title: "B 的活", type: "general", category: "G" });
  assert.ok(!("code" in a) && !("code" in b), "两个 Task 都应创建成功");
  const waiter = join(a.task.path, "home");
  const waitb = join(b.task.path, "home");

  assert.equal((await git(waiter, ["config", "--worktree", "--get", "user.name"], globalPath)).trim(), "agent-a");
  assert.equal((await git(waitb, ["config", "--worktree", "--get", "user.name"], globalPath)).trim(), "agent-b");

  for (const [dir, name] of [[waiter, "agent-a"], [waitb, "agent-b"]]) {
    await writeFile(join(dir, "note.txt"), name);
    await git(dir, ["add", "-A"], globalPath);
    await git(dir, ["commit", "-q", "-m", `by ${name}`], globalPath);
    assert.equal((await git(dir, ["log", "-1", "--pretty=%an"], globalPath)).trim(), name);
  }
});

test("T4：judgeIdentity 四态穷举（没有身份 / 身份不对 / 没开扩展 / 正确）", () => {
  const expected = identityOf("coder");

  const noExtension = judgeIdentity({ agentId: "coder", worktreeName: "coder", worktreeEmail: "coder@lifeos.local", extension: false });
  assert.equal(noExtension.state, "no-extension");

  const missing = judgeIdentity({ agentId: "coder", extension: true });
  assert.equal(missing.state, "missing");
  assert.match(missing.detail, /落成用户的全局身份/);

  const wrong = judgeIdentity({ agentId: "coder", worktreeName: "coder", worktreeEmail: "fd@lifeos.local", extension: true });
  assert.equal(wrong.state, "wrong");
  assert.match(wrong.detail, /coder@lifeos\.local/);

  const ok = judgeIdentity({ agentId: "coder", worktreeName: "coder", worktreeEmail: "coder@lifeos.local", extension: true });
  assert.equal(ok.state, "ok");

  // 邮箱域是契约的一部分：本地部分就是 agentId
  assert.deepEqual(expected, { name: "coder", email: "coder@lifeos.local" });
});

test("T5：applyWorktreeIdentity 幂等；readWorktreeIdentity 读到的就是写进去的", async () => {
  const { home, globalPath } = await installedGitHome();
  process.env.LIFEOS_HOME = home;
  const created = await createTask({ agentId: "lifeosagent", projectId: "workspace" }, { title: "幂等", type: "general", category: "G" });
  assert.ok(!("code" in created), JSON.stringify(created));
  const worktree = join(created.task.path, "home");

  const first = await applyWorktreeIdentity({ worktree, agentId: "lifeosagent" });
  const second = await applyWorktreeIdentity({ worktree, agentId: "lifeosagent" });
  assert.deepEqual(first, { ok: true });
  assert.deepEqual(second, { ok: true }, "重复设置必须幂等，不能报错");

  const read = await readWorktreeIdentity(worktree);
  assert.equal(read.extension, true);
  assert.equal(read.worktreeName, "lifeosagent");
  assert.equal(read.worktreeEmail, "lifeosagent@lifeos.local");
  // 读的是“这个工作区独占的那份”，不是全局值
  assert.notEqual(read.worktreeName, "real-user");
});

test("T6：非 git 目录上设置身份会失败并说明怎么做（不静默）", async () => {
  const base = await mkdtemp(join(tmpdir(), "lifeos-identity-fail-"));
  const result = await applyWorktreeIdentity({ worktree: base, agentId: "coder" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /-c user\.name=coder/);
  assert.match(result.reason, /-c user\.email=coder@lifeos\.local/);
});
