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
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveHome } from "./home.ts";
import { worktreeProfileOf } from "./worktree-profile.ts";

const run = promisify(execFile);

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
};

async function git(cwd: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
    timeout: 120_000,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

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
 * 建工作区前把主区存档（脏就本地提交一次）。
 *
 * 为什么必须：`git worktree add` **只从 commit 检出**——主区里还没提交的文档，
 * 在工作区里就是不存在。不存档就会让 Agent 拿到一份“少了几份文件”的家目录，而且不报错。
 * 提交是本地存档（不推送、不合并），与“合并只由用户触发”不冲突。
 */
async function archiveIfDirty(repo: string): Promise<boolean> {
  const status = (await git(repo, ["status", "--porcelain"])).trim();
  if (status === "") return false;
  await git(repo, ["add", "-A"]);
  await git(repo, [
    "-c", "user.name=Life OS", "-c", "user.email=lifeos@localhost",
    "commit", "-q", "-m", "chore: 建 Task 工作区前存档（自动）",
  ]);
  return true;
}

async function writeMarker(worktreePath: string, marker: WorktreeMarker): Promise<void> {
  await writeFile(join(worktreePath, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

/** 家目录工作区：建在家目录仓上，按 Agent 可见范围裁剪。 */
export async function createHomeWorktree(input: {
  taskDir: string; taskId: string; agentId: string; boundProjects: string[];
}): Promise<WorktreeResult> {
  const home = resolveHome();
  if (!await isGitRepo(home)) return { skipped: "家目录不是 git 仓（没有 init 过），跳过家目录工作区" };
  const path = join(input.taskDir, HOME_DIR);
  const branch = `task/${input.taskId}`;
  const base = await baseRefOf(home);
  const archived = await archiveIfDirty(home);
  await git(home, ["worktree", "add", "--no-checkout", path, "-b", branch, base]);
  try {
    await git(path, ["sparse-checkout", "set", "--no-cone", ...worktreeProfileOf({ agentId: input.agentId, boundProjects: input.boundProjects })]);
    await git(path, ["read-tree", "-mu", "HEAD"]);
    await writeMarker(path, {
      kind: "home", taskId: input.taskId, agentId: input.agentId,
      baseBranch: base, branch, createdAt: new Date().toISOString(),
    });
    return { path, archived };
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
  const branch = `dev/${input.taskId}`;
  const base = await baseRefOf(input.projectPath);
  await git(input.projectPath, ["worktree", "add", path, "-b", branch, base]);
  try {
    await writeMarker(path, {
      kind: "project", taskId: input.taskId, projectId: input.projectId, agentId: input.agentId,
      baseBranch: base, branch, createdAt: new Date().toISOString(),
    });
    return { path };
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

  const home = await createHomeWorktree({
    taskDir: input.taskDir, taskId: input.taskId, agentId: input.agentId, boundProjects,
  }).catch((error: unknown) => { throw error; });
  if (home.path !== undefined) created.home = home.path;
  if (home.skipped !== undefined) skipped.push(home.skipped);

  if (input.projectPath !== undefined && input.projectPath !== "") {
    const project = await createProjectWorktree({
      taskDir: input.taskDir, taskId: input.taskId, agentId: input.agentId,
      projectId: input.projectId, projectPath: input.projectPath,
    });
    if (project.path !== undefined) created.project = project.path;
    if (project.skipped !== undefined) skipped.push(project.skipped);
  } else {
    skipped.push(`项目 ${input.projectId} 没有 path（不是代码仓），只有家目录工作区`);
  }

  const docRoot = created.home === undefined
    ? input.taskDir
    : join(created.home, "agents", input.agentId, "projects", input.projectId, "tasks", input.taskDir.split("/").pop() ?? "");
  if (created.home !== undefined) await mkdir(docRoot, { recursive: true, mode: 0o700 });
  return { docRoot, created, skipped };
}
