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
  // `core.quotePath=false`：否则中文路径在输出里是 `"\346\234\254..."`，
  // 任何基于路径内容（含中文）的断言都会永远为假——本文件 P2 段就有这种断言。
  return (await run("git", ["-C", cwd, "-c", "core.quotePath=false", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { timeout: 60_000 })).stdout;
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

// ── P2（Task 0004）：真 git 上验证收窄 ──────────────────────────────────────────
// 纯函数层面（`worktree-profile-narrow.test.mjs`）只能断言"模式序列与顺序"；
// git 的实际匹配语义必须真跑一次（architect 01-background §7 U1/U3 要求贴命令与输出）。

test("P2-U1 收窄态真 worktree：只有本 Task + 身份 + 共享层；read-tree 不报错；status 干净", async () => {
  const { home } = await installedGitHome();
  process.env.LIFEOS_HOME = home;
  const ctx = { agentId: "lifeosagent", projectId: "workspace" };

  // **活性前置（不能省）**："别的 Task 不在"这类断言，如果那个 Task 根本不在 HEAD 里，
  // 它在未收窄形态下也不会被检出 —— 断言就恒真了。所以先把两个"别的"夹具 commit 进 main：
  //   ① 同 Agent 同 pid 的另一个 Task（未收窄时会被整目录拖进来）
  //   ② 另一个 Agent（未收窄时若写到 /agents/* 也会被拖进来）
  const otherDir = join(home, "agents", "lifeosagent", "projects", "workspace", "tasks", "0000-别的任务");
  await mkdir(otherDir, { recursive: true });
  await writeFile(join(otherDir, "task.md"), "# 别的任务\n", "utf8");
  const otherAgent = join(home, "agents", "reviewer", "projects", "lifeos");
  await mkdir(otherAgent, { recursive: true });
  await writeFile(join(home, "agents", "reviewer", "agent.json"), '{"id":"reviewer"}\n', "utf8");
  await writeFile(join(otherAgent, "AGENTS.md"), "# reviewer\n", "utf8");
  await git(home, ["add", "-A"]);
  await git(home, ["commit", "-q", "-m", "夹具：别的 Task 与别的 Agent"]);

  // 夹具确实在 HEAD 里（再确认一次活性，不然后面的"不在"仍是空集断言）
  const headFiles = (await git(home, ["ls-tree", "-r", "--name-only", "HEAD"])).split("\n");
  assert.ok(headFiles.some((path) => path.includes("0000-别的任务")), "夹具①必须在 HEAD 里");
  assert.ok(headFiles.some((path) => path.includes("agents/reviewer/")), "夹具②必须在 HEAD 里");

  const created = await createTask(ctx, { title: "本任务：中文＋全角冒号＋加号+测", category: "G", type: "general" });
  assert.ok(!("code" in created), `createTask 失败：${JSON.stringify(created)}`);
  const task = created.task;
  const wt = join(task.path, "home");

  // U1：工作区形态存在，且没有因为收窄而缺件（缺件时 read-tree 会报错，createTask 会抛）
  assert.equal(await exists(join(wt, "agents", "lifeosagent", "agent.json")), true, "自己的身份文件应在");
  assert.equal(await exists(join(wt, "agents", "lifeosagent", "projects", "workspace", "specs", "index.json")), true,
    "Agent×project 层（specs/）应在——reviewer 补的那一行");
  assert.equal(await exists(join(wt, "projects", "workspace", "project.json")), true, "共享 workspace 应在");
  assert.equal(await exists(join(wt, "interaction-harness", "protocol.md")), true, "协议目录应在");

  // 本 Task 在（含中文/全角冒号/加号的目录名 —— U3）
  assert.equal(await exists(join(wt, "agents", "lifeosagent", "projects", "workspace", "tasks", task.dirName, "task.md")), true,
    `本 Task 必须被检出（目录名含中文与符号）：${task.dirName}`);

  // 别的 Task 不在（HEAD 里确实有它，见上方夹具前置）
  assert.equal(await exists(join(wt, "agents", "lifeosagent", "projects", "workspace", "tasks", "0000-别的任务")), false,
    "别的 Task 不该被检出（它在 HEAD 里，所以这条不是空集断言）");

  // 别的 Agent 不在（同上）
  assert.equal(await exists(join(wt, "agents", "reviewer")), false, "别的 Agent 不该在（它在 HEAD 里）");

  // U1 的正面证据：read-tree 能再跑一次而不报错（稀疏态已收敛）
  const readTree = await run("git", ["-C", wt, "read-tree", "-mu", "HEAD"], { timeout: 60_000 }).catch((error) => error);
  assert.equal(readTree.stderr ?? "", "", `read-tree 不该有 stderr：${readTree.stderr}`);

  // 完成标准 3 的真实意图（architect 01-background §5 括号里写明的）：
  // **收窄没有把已跟踪文件变成"删除"**。新建 Task 的文档此刻还是未跟踪的（还没提交），
  // 所以断言不能写成"status 必须完全为空"——那会逼实现去把 `??` 也算失败。
  const status = (await git(wt, ["status", "--porcelain"])).trim();
  const trackedChanges = status.split("\n").filter((line) => line !== "" && !line.startsWith("??"));
  assert.deepEqual(trackedChanges, [], `已跟踪文件不该被收窄变成删除/修改：\n${trackedChanges.join("\n")}`);
});

// ── P2-U2（Task 0035 · 复核 P2-2）：用户层的"先排后放"必须在**真 git** 上成立 ──────────
// 纯函数那份（`worktree-profile-narrow.test.mjs`）只能锁模式序列；gitignore 的实际匹配语义
// （后写覆盖先写、目录模式与叶子模式的交互）必须真跑一次。`users/` 这套手法是从 `agents/`
// 抄过来的，但从未在真 git 上验过 —— 这一条补上（architect 2026-11-24 复核点名）。
test("P2-U2 用户层真 worktree：本 pid + workspace 在；别的 pid 与别的 uid 不在（先排后放生效）", async () => {
  const { home } = await installedGitHome();
  process.env.LIFEOS_HOME = home;

  // 活性前置：把用户层夹具 commit 进 main（否则"不在"是空集断言，恒真）
  const userId = "xu";
  const userRoot = join(home, "users", userId);
  await mkdir(join(userRoot, "projects", "workspace", "knowledge"), { recursive: true });
  await mkdir(join(userRoot, "projects", "ziji", "knowledge"), { recursive: true });
  await writeFile(join(userRoot, "user.json"), '{"schemaVersion":1,"id":"xu","name":"xu"}\n', "utf8");
  await writeFile(join(userRoot, "AGENTS.md"), "# 用户层\n", "utf8");
  await writeFile(join(userRoot, "projects", "workspace", "knowledge", "note.md"), "# 本 Task 的 project\n", "utf8");
  await writeFile(join(userRoot, "projects", "ziji", "knowledge", "other.md"), "# 别的 project\n", "utf8");
  // 另一个 uid（"别的 uid"那半条）
  await mkdir(join(home, "users", "zz-other"), { recursive: true });
  await writeFile(join(home, "users", "zz-other", "user.json"), '{"schemaVersion":1,"id":"zz-other","name":"zz-other"}\n', "utf8");
  await git(home, ["add", "-A"]);
  await git(home, ["commit", "-q", "-m", "夹具：用户层三个 pid 与两个 uid"]);

  const headFiles = (await git(home, ["ls-tree", "-r", "--name-only", "HEAD"])).split("\n");
  for (const expected of [
    `users/${userId}/projects/workspace/knowledge/note.md`,
    `users/${userId}/projects/ziji/knowledge/other.md`,
    "users/zz-other/user.json",
  ]) {
    assert.ok(headFiles.includes(expected), `夹具必须在 HEAD 里（否则断言恒真）：${expected}`);
  }

  const ctx = { agentId: "lifeosagent", projectId: "workspace" };
  const created = await createTask(ctx, { title: "用户层收窄", category: "G", type: "general" });
  assert.ok(!("code" in created), `createTask 失败：${JSON.stringify(created)}`);
  const wt = join(created.task.path, "home");

  // 该在的
  assert.equal(await exists(join(wt, "users", userId, "AGENTS.md")), true, "用户实体本身（AGENTS.md）应在");
  assert.equal(await exists(join(wt, "users", userId, "user.json")), true, "用户实体本身（user.json）应在");
  assert.equal(await exists(join(wt, "users", userId, "projects", "workspace", "knowledge", "note.md")), true,
    "本 Task 所在 project 的用户空间应在");

  // 不该在的（它们在 HEAD 里 —— 见上面的活性前置）
  assert.equal(await exists(join(wt, "users", userId, "projects", "ziji", "knowledge", "other.md")), false,
    "别的 pid 的用户空间不该被检出（先排后放生效）");
  assert.equal(await exists(join(wt, "users", "zz-other")), false,
    "别的 uid 不该被检出");
});

test("P2-fallback taskDocRootOf 必须命中工作区（不是静默回落主区）", async () => {
  const { home } = await installedGitHome();
  process.env.LIFEOS_HOME = home;
  const ctx = { agentId: "lifeosagent", projectId: "workspace" };
  const created = await createTask(ctx, { title: "定位校验", category: "G", type: "general" });
  assert.ok(!("code" in created), JSON.stringify(created));
  const task = created.task;

  // 关键断言（architect P2 收口要求）：读根必须指到工作区里那份，而不是主区。
  // 收窄若把本 Task 排掉，这个函数会**静默**返回主区路径 —— 装配器不报错，
  // 所有文档改动悄悄落回主区，恰好是"归拢"要消灭的行为。
  const { taskDocRootOf } = await import("../src/task-doc-path.ts");
  const docRoot = await taskDocRootOf(task.path, ctx, task.dirName);
  assert.ok(docRoot.startsWith(join(task.path, "home")), `taskDocRootOf 必须命中工作区，实际：${docRoot}`);
  assert.notEqual(docRoot, task.path, "绝不能等于主区 Task 目录（那就是静默回落）");
  assert.equal(await exists(join(docRoot, "task.md")), true, "工作区里那份 task.md 必须真的存在（否则它其实回落了）");
  // 用结果反证：主区那份确实不存在（不是"两处都有"）
  assert.equal(await exists(join(task.path, "task.md")), false, "主区不该有 task.md：有它就意味着回落路径也可能为真");
});

/*
 * 存档步骤（`archiveIfDirty`）不能成为「建 Task」的单点故障（2026-11-25 · C333）。
 *
 * 现场：内容仓 `content/` 是独立 git 仓（S2 · Task 0038）。它 `git init` 之后**还没 commit**
 * 时，家目录仓的 `git add -A` **整体 fatal**（`'content/' does not have a commit checked out`），
 * 一条都不入暂存区。而存档是建 Task 链路上的**唯一存档步骤**，往上一路无 catch
 * ⇒ 用户点「新建 Task」失败，收到一句与建 Task 毫无关系的 git 报错。
 *
 * 这条用例锁两件事：
 *   ① 子检出 0 commit 时，**建 Task 仍然成功**（降级继续，不是整条断）；
 *   ② 该存档的文档真的进了基线，且 `content/` **没有**被记成 gitlink（`160000`）。
 * 活性：把 `archiveIfDirty` 里的 pathspec 排除去掉 → ① 立刻红（T5 报 createTask 失败）。
 */
test("T5 子检出（content/）未 commit 时建 Task 不失败，且不把子仓记成 gitlink", async () => {
  const { home } = await installedGitHome();
  process.env.LIFEOS_HOME = home;

  // 造一个"有 .git 但 0 commit"的内容仓（S2 首次发内容之前的真实形态）
  const content = join(home, "content");
  await mkdir(content, { recursive: true });
  await git(content, ["init", "-q", "-b", "main"]);
  await writeFile(join(content, "a.md"), "子仓内容\n");

  /*
   * 主区脏，而且要脏在**收窄工作区会检出的路径里**（`agents/` 下）：
   * 根目录的文件不会进 sparse 检出，拿它断言会得到"没存档"的假红（本用例第一版就踩了这个）。
   */
  const dirtyPath = join(home, "agents", "lifeosagent", "projects", "workspace", "cases", "存档标记.md");
  await mkdir(join(home, "agents", "lifeosagent", "projects", "workspace", "cases"), { recursive: true });
  await writeFile(dirtyPath, "应该进基线\n");

  const ctx = { agentId: "lifeosagent", projectId: "workspace" };
  const created = await createTask(ctx, { title: "存档守卫", category: "G", type: "general" });
  assert.ok(!("code" in created), `建 Task 不该失败：${JSON.stringify(created)}`);

  // ② 该存档的**真的在基线 commit 里**（用 git 事实断言，不看工作区检出范围）
  const baseHead = (await git(home, ["log", "-1", "--format=%H"])).trim();
  const inHistory = (await git(home, ["ls-tree", "-r", "--name-only", baseHead]))
    .split("\n").filter((f) => f.endsWith("存档标记.md"));
  assert.equal(inHistory.length, 1, `该存档的必须进基线，实际：${JSON.stringify(inHistory)}`);

  /*
   * ② 索引里**一条畸形条目都不能有**（reviewer P2-2：这条断言必须独立，不能靠 pathspec 顺手兜住）。
   *
   * 判据是 `ls-files -s` 的 mode 列，**不看路径名** —— 第一版用 `line.includes("content")` 是名字判据，
   * 而真实家目录里有 `agents/.../knowledge/content-platform-search-tools.md` 这种正常文件，
   * 名字判据会把它误判成违规（也会漏掉改了名字的子检出）。
   * 任何 `160000`（gitlink）或 `120000`（软链）都算失败。
   */
  const malformed = (await git(home, ["ls-files", "-s"]))
    .split("\n")
    .filter((line) => line.startsWith("160000") || line.startsWith("120000"));
  assert.deepEqual(malformed, [], `家目录仓索引里不该有 gitlink(160000)/软链(120000)，实际：${JSON.stringify(malformed)}`);
});

/*
 * T5b：子检出**已有 commit** 的形态（链条 B）。
 *
 * 与 T5 分开的原因：T5 的"0 commit"形态靠 `git add` 直接 fatal 也能被兜住（reproducible 但证明力弱），
 * 而"有 commit"的形态 `git add` 是**成功**的 —— 只有后置守卫（查 `ls-files -s` 的 160000）拦得住。
 * 两条分开，守卫失效时才能看出是哪一支漏了。
 *
 * 现场（reviewer 2026-11-25 实测）：家目录 main 里**已经有一条** `160000`，
 * 来自 `040dc4d`（自动存档）——`agents/<a>/projects/<p>/tasks/<NNNN>/repo-baseline` 作为 gitlink 写了进去。
 */
test("T5b 深层子检出已有 commit 时也不记成 gitlink（后置守卫，pathspec 挡不住的那一支）", async () => {
  const { home } = await installedGitHome();
  process.env.LIFEOS_HOME = home;

  /*
   * **必须放在深层**：`subCheckoutsOf` 只看顶层，`content/` 在顶层会被 pathspec 排除，
   * 于是用例测的是"pathspec 有效"而不是"后置守卫有效"（第一版就踩了这个，把守卫删掉它照样绿）。
   * 真实现场也是深层：`agents/<a>/projects/<p>/tasks/<NNNN>/repo-baseline`（reviewer 实测 040dc4d）。
   */
  const content = join(home, "agents", "lifeosagent", "projects", "workspace", "repo-baseline");
  await mkdir(content, { recursive: true });
  await git(content, ["init", "-q", "-b", "main"]);
  await writeFile(join(content, "a.md"), "子仓内容\n");
  await git(content, ["add", "-A"]);
  await git(content, ["commit", "-q", "-m", "sub init"]);

  // 主区脏（脏在收窄工作区会检出的路径里）
  const dirtyPath = join(home, "agents", "lifeosagent", "projects", "workspace", "cases", "存档标记b.md");
  await mkdir(join(home, "agents", "lifeosagent", "projects", "workspace", "cases"), { recursive: true });
  await writeFile(dirtyPath, "应该进基线\n");

  const ctx = { agentId: "lifeosagent", projectId: "workspace" };
  const created = await createTask(ctx, { title: "存档守卫b", category: "G", type: "general" });
  assert.ok(!("code" in created), `建 Task 不该失败：${JSON.stringify(created)}`);

  const malformed = (await git(home, ["ls-files", "-s"]))
    .split("\n")
    .filter((line) => line.startsWith("160000") || line.startsWith("120000"));
  assert.deepEqual(malformed, [], `家目录仓索引里不该有 gitlink(160000)，实际：${JSON.stringify(malformed)}`);
});

/*
 * T5c：「历史里已经有一条 gitlink」不该阻断未来的存档（reviewer 第 3 轮 P1 回归）。
 *
 * 第一版守卫读**全量索引**（`ls-files -s | grep 160000`），于是只要 HEAD 里有一条历史遗留的 gitlink，
 * 守卫就每次都命中；而 `git reset` 对**已提交**的条目是 no-op ⇒ 存档**永久失效**。
 * 真实家目录就是这个状态（`040dc4d` 带入 1 条），当时有 10 条脏改动全部进不了基线。
 *
 * 夹具：先让仓里**真的带着一条 gitlink**（造子仓 + add 它），再写脏文件建 Task。
 * 断言两件：① 建 Task 成功；② 该存档的**确实进了基线**（历史里那条 gitlink 不阻断它）。
 * 活性：把守卫改回读全量索引 → ② 立刻红（存档被跳过）。
 */
test("T5c 历史遗留的 gitlink 不阻断新的存档（守卫只看本次暂存的路径）", async () => {
  const { home } = await installedGitHome();
  process.env.LIFEOS_HOME = home;

  // 在基线里造一条历史遗留的 gitlink（等价于真实家目录 040dc4d 那条）
  const legacy = join(home, "agents", "lifeosagent", "projects", "workspace", "legacy-checkout");
  await mkdir(legacy, { recursive: true });
  await git(legacy, ["init", "-q", "-b", "main"]);
  await writeFile(join(legacy, "a.md"), "子仓\n");
  await git(legacy, ["add", "-A"]);
  await git(legacy, ["commit", "-q", "-m", "sub"]);
  // 强行 add 成 gitlink（`git add` 通常拒绝对内嵌仓这么做，所以用 update-index）
  await git(home, ["update-index", "--add", "--cacheinfo", `160000,${(await git(legacy, ["rev-parse", "HEAD"])).trim()},agents/lifeosagent/projects/workspace/legacy-checkout`]);
  await git(home, ["commit", "-q", "-m", "带一条历史 gitlink"]);
  const before = (await git(home, ["ls-files", "-s"])).split("\n").filter((l) => l.startsWith("160000"));
  assert.equal(before.length, 1, `夹具自检：HEAD 里应先有 1 条 160000，实际 ${before.length}`);

  // 主区脏（脏在收窄工作区会检出的路径里）
  const dirtyPath = join(home, "agents", "lifeosagent", "projects", "workspace", "cases", "存档标记c.md");
  await mkdir(join(home, "agents", "lifeosagent", "projects", "workspace", "cases"), { recursive: true });
  await writeFile(dirtyPath, "应该进基线\n");

  const ctx = { agentId: "lifeosagent", projectId: "workspace" };
  const created = await createTask(ctx, { title: "存档守卫c", category: "G", type: "general" });
  assert.ok(!("code" in created), `建 Task 不该失败：${JSON.stringify(created)}`);

  const head = (await git(home, ["rev-parse", "HEAD"])).trim();
  const inHistory = (await git(home, ["ls-tree", "-r", "--name-only", head]))
    .split("\n").filter((f) => f.endsWith("存档标记c.md"));
  assert.equal(inHistory.length, 1, `历史里有 gitlink 不该阻断存档，实际基线里没有它（HEAD=${head.slice(0, 7)}）`);
});
