// Task 的工作区（协议 §3.7）：在 Task 目录下建/删两个 git worktree。
//
// | 工作区 | 位置 | 分支 | 内容 |
// |---|---|---|---|
// | 项目仓 | `<taskDir>/repo/` | `dev/<NNNN>-<slug>` | 被开发项目的完整检出（不裁剪） |
// | 家目录仓 | `<taskDir>/home/` | `task/<NNNN>-<slug>` | `~/.lifeos` 的检出，按 Agent 可见范围裁剪 |
//
// 三条硬约束（都在实测里踩过或验过）：
// 1. `git worktree add` 只从 **commit** 检出——基线脏不影响，但未提交的东西进不去。
// 2. 家目录 worktree 必须建在**被 .gitignore 忽略的目录**里（`home/`、`repo/` 都在 `.gitignore` 里），
//    否则主区的 `git status` 会被这份检出刷满；同时 `home/` 的检出里不会出现 `home/` 自己（没有递归）。
// 3. 裁剪是 **per-worktree** 的（`.git/worktrees/<name>/info/sparse-checkout`），两个 Task 各自一份，
//    互不影响（实测）。
//
// 失败必须可回滚：先建 home 再建 repo，任何一步失败就把已建的摘掉，不留半个 Task。
import { execFile } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveHome } from "./home.ts";
import { applyWorktreeIdentity } from "./worktree-identity.ts";
import { worktreeProfileOf } from "./worktree-profile.ts";
import { existingUserId } from "./profile.ts";

const run = promisify(execFile);

/**
 * 取当前用户 id，**取不到就返回 undefined**（不报错）。
 *
 * 为什么允许拿不到：用户实体是运行时建立的（`writeProfile` 派生 id）。新装家目录在用户
 * 第一次改档案前根本没有 `users/<uid>/user.json` —— 那时“用户层还不存在”是正常情形，
 * 不该让建工作区失败。拿不到就不放行用户层（工作区里没有那一层，与现状一致）。
 */
async function safeCurrentUserId(home: string): Promise<string | undefined> {
  return existingUserId(home).catch(() => undefined);
}

/** 两个工作区的目录名（协议 §3.7）。 */
export const HOME_DIR = "home";
export const REPO_DIR = "repo";
/** 工作区里放的机器可读标记：目录名只给人看，真值是它。 */
export const MARKER_FILE = ".lifeos-worktree.json";

export type WorktreeKind = "home" | "project";

export type WorktreeMarker = {
  kind: WorktreeKind;
  taskId: string;
  /** project 工作区才有：被开发项目的全局 id。 */
  projectId?: string;
  agentId: string;
  baseBranch: string;
  branch: string;
  createdAt: string;
};

export type WorktreeResult = {
  /** 建成的工作区目录；没有（例如项目不是 git 仓）就是 undefined。 */
  path?: string;
  /** 没建成的原因，交给人看；不静默跳过。 */
  skipped?: string;
  /** 建之前主区是不是脏的（脏就会自动存档一次）。 */
  archived?: boolean;
  /**
   * 存档没成功的原因（降级继续：工作区照建，基线可能旧）。
   * 有值 = 主区里那些改动**没有**进基线，交付时要说明。
   */
  archiveSkipped?: string;
  /**
   * 提交身份没写进去的原因（协议 §3.7「提交与署名」）。
   * 有值 = 这个工作区里的提交会落成用户的全局身份，Agent 必须显式传 `-c`。
   */
  identitySkipped?: string;
};

async function git(cwd: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
    timeout: 120_000,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

/**
 * 这个目录是不是一个**注册过的工作区**（`<taskDir>/home` / `repo` / 历史 `worktree`）。
 *
 * 判据与 `home-check.ts` 的「从别处来的检出」**同一件事**，所以实现只在这里一份：
 * 有机器可读 marker（`.lifeos-worktree.json`）**或**有 `.git`（worktree 的 `.git` 是文件）。
 *
 * 为什么写入守卫需要它（Task 0004 · P4 修补）：`.lifeos/.gitignore:16-17` 忽略了
 * `** /tasks/<NNNN>/home/` 与 `** /tasks/<NNNN>/repo/`，所以"git 看不见"会把**伪造的工作区**也放行——
 * 而 Pi 的 `write` 会 `mkdir -p` 父目录（`tools/write.ts:63-66`），主区里真会长出一份假树；
 * 随后 `taskDocRootOf`（只看 `task.md` 在不在，`task-doc-path.ts:27-31`）就把装配读根切过去，
 * 而那份假树没有分支、没有检视源。
 */
export async function isRegisteredWorktree(dir: string): Promise<boolean> {
  const marker = await stat(join(dir, MARKER_FILE)).then((info) => info.isFile(), () => false);
  if (marker) return true;
  return exists(join(dir, ".git"));
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

/** 一个目录是不是 git 仓（`.git` 目录或文件都算——worktree 的 `.git` 是文件）。 */
export async function isGitRepo(path: string): Promise<boolean> {
  try {
    await git(path, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/** 取基线分支：有 `main` 用它，否则用当前 HEAD（与检视的基线口径一致）。 */
async function baseRefOf(repo: string): Promise<string> {
  try {
    await git(repo, ["rev-parse", "--verify", "--quiet", "main"]);
    return "main";
  } catch {
    return (await git(repo, ["rev-parse", "--short", "HEAD"])).trim();
  }
}

/**
 * 直接子目录里带着 `.git` 的，是**独立检出**（内容仓 `content/`、`reference/` 里的外部克隆…），
 * 一律不作为家目录仓的内容参与 `git add -A`。
 *
 * 为什么按结构事实、不写死名字（architecture 2.21 同一条道理）：
 * - 写死 `content` → 下一个子检出（`reference/` 里 `git init` 而不 commit 的克隆）再炸一次；
 * - 结构判据换名字照样拦得住，且不需要有人记得来改名单。
 *
 * 为什么要排除而不是只兜底（2026-11-24 实测，reviewer `phases/S2ab-archive-fix.md`）：
 * - 子仓 **0 commit** 时 `git add -A` 是**整体 fatal**（`'content/' does not have a commit checked out`），
 *   **一条都不入暂存区** —— 此时「catch 住继续 commit」= 存档静默丢失，不是"跳过一个子仓"；
 * - 子仓**有 commit** 时 `git add -A` 成功，但会把内容记成 `160000` gitlink 写进协议仓历史，
 *   且事后 `status` 只留 `? content`，看不出发生过什么。`--ignore-errors` 单独用堵不住这一支。
 */
async function subCheckoutsOf(repo: string): Promise<string[]> {
  const entries = await readdir(repo, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (await stat(join(repo, entry.name, ".git")).then(() => true, () => false)) found.push(entry.name);
  }
  return found;
}

/**
 * 建工作区前把主区存档（脏就本地提交一次）。
 *
 * 为什么必须：`git worktree add` **只从 commit 检出**——主区里还没提交的文档，
 * 在工作区里就是不存在。不存档就会让 Agent 拿到一份“少了几份文件”的家目录，而且不报错。
 * 提交是本地存档（不推送、不合并），与“合并只由用户触发”不冲突。
 *
 * **失败不阻断建工作区**（2026-11-24，C333）：这一条是「新建 Task」链路上的**唯一存档步骤**，
 * 而它的调用方 `createTaskWorktrees` 一路没有 catch。子检出导致 `git add -A` fatal 时，
 * 用户点「新建 Task」会失败并收到 `'content/' does not have a commit checked out` ——
 * 与建 Task 毫无语义关联，用户不可能猜到要删 `~/.lifeos/content/.git`。
 * 所以：**尽力存档；存不下就把原因带回去**（降级继续，基线旧是协议允许的，整条断不可接受）。
 */
async function archiveIfDirty(repo: string): Promise<{ archived: boolean; archiveSkipped?: string }> {
  const status = (await git(repo, ["status", "--porcelain"])).trim();
  if (status === "") return { archived: false };
  const excludes = (await subCheckoutsOf(repo)).map((name) => `:!${name}`);

  /*
   * **不靠 `git add` 的退出码决定要不要提交**（reviewer 2026-11-25 实测）：
   * `--ignore-errors` 让 add「把能加的加进暂存区，但退出码仍非零」——
   * 靠 catch 判断就等于「add 部分成功、然后放弃提交」，还留下**暂存区脏但没提交**的新状态，
   * 下次进来再失败一遍。所以：add 的错误吞掉不看，**看暂存区有没有东西**再决定 commit。
   */
  await git(repo, ["add", "-A", "--ignore-errors", "--", ".", ...excludes]).catch(() => "");

  /*
   * **后置守卫：查「本次进暂存区的路径」的 mode，不看名字、不看深度、不看全量索引**（reviewer 4.1 + 第 3 轮 P1）。
   *
   * 为什么需要这一道：`subCheckoutsOf` 只看**顶层**，而真实家目录里子检出能到 8 层
   * —— 某个 Task 下的 `repo-baseline` 就不在 .gitignore 的
   * `tasks/<N>/repo` / `home` / `worktree` 这套名单里，于是它作为 gitlink（160000）
   * 被写进了家目录仓历史（`040dc4d`，2026-11-25 实测）。靠名字/深度枚举必然继续漂（architecture 2.21）；
   * `ls-files -s` 的 mode 是索引事实，换名字、换深度都拦得住，且同时堵住 todo #50 的软链形态（120000）。
   *
   * 为什么**不能**读全量索引（第一版这么写，是个现在就在生效的回归）：
   * 历史里已有的 gitlink 会让守卫每次都命中，而 `git reset` 对**已提交**的条目是 no-op
   * ⇒ 存档**永久失效**：真实家目录里 10 条脏改动全不进基线，报的原因还指向错误的地方。
   * 职责边界：**别再把新的带进去**是守卫的事；**历史里已有的**由 `git rm --cached` 清（用户动作）。
   */
  const staged0 = (await git(repo, ["diff", "--cached", "--name-only"])).trim();
  if (staged0 === "") return { archived: false };

  const malformed = await malformedAmong(repo, staged0.split("\n"));
  if (malformed.length > 0) {
    // 只撤出畸形的那几条，**剩下的照常提交**（不是整批放弃）。
    await git(repo, ["reset", "-q", "--", ...malformed]).catch(() => "");
  }
  const staged = (await git(repo, ["diff", "--cached", "--name-only"])).trim();
  if (staged === "") {
    return {
      archived: false,
      archiveSkipped: `本次改动全是畸形条目（子检出/软链），已撤出、未提交：${malformed.slice(0, 3).join(", ")}${malformed.length > 3 ? " …" : ""}`,
    };
  }

  try {
    await git(repo, [
      "-c", "user.name=Life OS", "-c", "user.email=lifeos@localhost",
      "commit", "-q", "-m", "chore: 建 Task 工作区前存档（自动）",
    ]);
    return { archived: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error);
    return {
      archived: false,
      archiveSkipped: `主区存档未完成（工作区照建，基线可能旧）：${detail.slice(0, 200)}`,
    };
  }
}

/**
 * 给定的这批路径里，哪些在索引里是 **gitlink（160000）或软链（120000）**。
 *
 * 判据用 `ls-files -s` 的 mode 列 —— 索引事实，与路径名和目录深度无关；
 * 同时堵住 todo #50 的软链形态。只查**传进来的路径**，不扫全量索引（见调用点的职责边界）。
 *
 * `core.quotePath=false` 是必须的：否则中文路径在输出里是八进制转义（`"\346\234..."`），
 * 与 `diff --cached` 给的原始路径永远对不上，等于守卫静默失效。
 */
async function malformedAmong(repo: string, paths: string[]): Promise<string[]> {
  const want = new Set(paths.filter((p) => p !== ""));
  if (want.size === 0) return [];
  const raw = await git(repo, ["ls-files", "-s"]).catch(() => "");
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    if (line === "") continue;
    const [meta, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (path === "" || meta === undefined || !want.has(path)) continue;
    const [mode] = meta.split(" ");
    if (mode === "160000" || mode === "120000") out.push(path);
  }
  return out;
}

async function writeMarker(worktreePath: string, marker: WorktreeMarker): Promise<void> {
  await writeFile(join(worktreePath, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

/**
 * 给刚建好的工作区写提交身份（协议 §3.7「提交与署名」）。
 *
 * 返回一个只含 `identitySkipped`（或为空对象）的补丁——失败不影响工作区本身可用，
 * 只是提交会落成用户身份，所以**报出来**而不是静默跳过。
 */
async function identitySkipOf(worktree: string, agentId: string): Promise<{ identitySkipped?: string }> {
  const applied = await applyWorktreeIdentity({ worktree, agentId });
  return applied.ok ? {} : { identitySkipped: applied.reason };
}

/** 家目录工作区：建在家目录仓上，按 Agent 可见范围裁剪。 */
export async function createHomeWorktree(input: {
  taskDir: string; taskId: string; agentId: string; projectId: string; boundProjects: string[];
  /** 本 Task 的目录名（`NNNN-标题`）：传了就是**收窄态**，只检出这一个 Task（Task 0004 · P2）。 */
  taskDirName?: string;
}): Promise<WorktreeResult> {
  const home = resolveHome();
  if (!await isGitRepo(home)) return { skipped: "家目录不是 git 仓（没有 init 过），跳过家目录工作区" };
  const path = join(input.taskDir, HOME_DIR);
  // 分支名带 agent × project：Task ID 只在 Agent × Project 内唯一（协议 §3.7），
  // 裸 `task/0004` 会让两个 Agent 的 0004 撞在同一个分支上。
  const branch = `task/${input.agentId}/${input.projectId}/${input.taskId}`;
  const base = await baseRefOf(home);
  const archiving = await archiveIfDirty(home);
  await git(home, ["worktree", "add", "--no-checkout", path, "-b", branch, base]);
  try {
    // 收窄：只检出本 Task（Task 0004 · P2）。不传 taskDirName 时保持旧形态（存量工作区）。
    // `userId` 从 `profile.ts` 的 `existingUserId(home)` 取（**唯一来源**，Task 0035）；
    // 取不到（用户实体还没建）就不传 —— 那是“用户层还不存在”的正常情形，不是错误。
    const userId = await safeCurrentUserId(home);
    const profile = worktreeProfileOf({
      agentId: input.agentId,
      boundProjects: input.boundProjects,
      ...(userId !== undefined ? { userId } : {}),
      ...(input.taskDirName !== undefined
        ? { taskDirName: input.taskDirName, projectId: input.projectId }
        : {}),
    });
    await git(path, ["sparse-checkout", "set", "--no-cone", ...profile]);
    await git(path, ["read-tree", "-mu", "HEAD"]);
    await writeMarker(path, {
      kind: "home", taskId: input.taskId, agentId: input.agentId,
      baseBranch: base, branch, createdAt: new Date().toISOString(),
    });
    return {
      path,
      archived: archiving.archived,
      ...(archiving.archiveSkipped !== undefined ? { archiveSkipped: archiving.archiveSkipped } : {}),
      ...await identitySkipOf(path, input.agentId),
    };
  } catch (error) {
    await removeWorktree(home, path).catch(() => undefined);
    throw error;
  }
}

/** 项目仓工作区：建在被开发项目仓上，不裁剪。 */
export async function createProjectWorktree(input: {
  taskDir: string; taskId: string; agentId: string; projectId: string; projectPath: string;
}): Promise<WorktreeResult> {
  if (!await isGitRepo(input.projectPath)) return { skipped: "项目目录不是 git 仓，跳过项目工作区" };
  const path = join(input.taskDir, REPO_DIR);
  const branch = `dev/${input.agentId}/${input.projectId}/${input.taskId}`;
  const base = await baseRefOf(input.projectPath);
  await git(input.projectPath, ["worktree", "add", path, "-b", branch, base]);
  try {
    await writeMarker(path, {
      kind: "project", taskId: input.taskId, projectId: input.projectId, agentId: input.agentId,
      baseBranch: base, branch, createdAt: new Date().toISOString(),
    });
    return { path, ...await identitySkipOf(path, input.agentId) };
  } catch (error) {
    await removeWorktree(input.projectPath, path).catch(() => undefined);
    throw error;
  }
}

/**
 * 摘掉一个工作区并 `prune`。
 *
 * `--force` 是必须的：工作区里通常有 `node_modules` 这类未跟踪文件，不带 force 会拒绝删除。
 * 目录已不在（磁盘被手删）时也走 force prune 把那一条登记清掉。
 */
export async function removeWorktree(repo: string, path: string): Promise<void> {
  await run("git", ["-C", repo, "worktree", "remove", "--force", path], { timeout: 120_000 }).catch(() => undefined);
  await run("git", ["-C", repo, "worktree", "prune"], { timeout: 60_000 }).catch(() => undefined);
}

/** 读该 Agent 绑定的 project id（`agents/<id>/projects/` 下的目录名，协议 §5.2 结构即事实）。 */
export async function boundProjectsOf(agentId: string): Promise<string[]> {
  const root = join(resolveHome(), "agents", agentId, "projects");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

/**
 * 建 Task 的两个工作区（`createTask` 与 `ensureDefaultTask` 共用，不要各写一份）。
 *
 * 返回的 `docRoot` 是**文档应该写到哪里**：有家目录工作区就写到工作区里那份 Task 目录，
 * 否则退回主区的 Task 目录（家目录不是 git 仓时的兼容路径）。
 */
export async function createTaskWorktrees(input: {
  taskDir: string; taskId: string; agentId: string; projectId: string; projectPath?: string;
}): Promise<{ docRoot: string; created: { home?: string; project?: string }; skipped: string[] }> {
  const skipped: string[] = [];
  const created: { home?: string; project?: string } = {};
  const boundProjects = await boundProjectsOf(input.agentId);

  const taskDirName = input.taskDir.split("/").pop() ?? "";
  const home = await createHomeWorktree({
    taskDir: input.taskDir, taskId: input.taskId, agentId: input.agentId, projectId: input.projectId, boundProjects,
    ...(taskDirName !== "" ? { taskDirName } : {}),
  });
  if (home.path !== undefined) created.home = home.path;
  if (home.skipped !== undefined) skipped.push(home.skipped);
  // 存档没完成也要报出来（工作区已照建，但基线里少了主区那些改动）——不静默降级。
  if (home.archiveSkipped !== undefined) skipped.push(home.archiveSkipped);
  if (home.identitySkipped !== undefined) skipped.push(home.identitySkipped);

  if (input.projectPath !== undefined && input.projectPath !== "") {
    const project = await createProjectWorktree({
      taskDir: input.taskDir, taskId: input.taskId, agentId: input.agentId,
      projectId: input.projectId, projectPath: input.projectPath,
    });
    if (project.path !== undefined) created.project = project.path;
    if (project.skipped !== undefined) skipped.push(project.skipped);
    if (project.identitySkipped !== undefined) skipped.push(project.identitySkipped);
  } else {
    skipped.push(`项目 ${input.projectId} 没有 path（不是代码仓），只有家目录工作区`);
  }

  const docRoot = created.home === undefined
    ? input.taskDir
    : join(created.home, "agents", input.agentId, "projects", input.projectId, "tasks", input.taskDir.split("/").pop() ?? "");
  if (created.home !== undefined) await mkdir(docRoot, { recursive: true, mode: 0o700 });
  return { docRoot, created, skipped };
}
