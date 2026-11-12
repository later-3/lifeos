// Task 的合并（协议 §3.7：合并只由用户触发）。
//
// 一个 Task 最多两个工作区，各自属于**不同的仓**，所以合并要跑两遍：
//
//   <taskDir>/home/  → 家目录仓 `~/.lifeos` 的 main
//   <taskDir>/repo/  → 被开发项目仓的 main
//
// 四条纪律（都在实测里踩过）：
// 1. **主区必须干净**才合并：main 有未提交改动时 git 会拒绝，硬合会把没提交的东西卷进去。
// 2. **冲突就回滚并报出来**，不替用户解：`git merge --abort` 把仓恢复原样，再把冲突文件列出来。
//    留下一个冲突中的仓，用户下一次操作全是坑。
// 3. **先合、后删工作区**：合完再 `worktree remove --force` + `prune`；反过来会把还没合的东西删掉。
// 4. 一个源失败**不影响另一个源**：两个仓互不相干，把各自结果原样报出来，不隐瞒。
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { HOME_DIR, REPO_DIR, removeWorktree } from "./task-worktree.ts";

const run = promisify(execFile);

export type MergeStep = {
  kind: "project" | "home";
  /** 工作区目录；没有这个工作区时为 undefined。 */
  worktree?: string;
  /** 分支名。 */
  branch?: string;
  /** merged = 已合入并删除工作区；skipped = 本来就没有；conflict = 冲突已回滚；dirty = 主区不干净；failed = 其他错误。 */
  status: "merged" | "skipped" | "conflict" | "dirty" | "failed";
  /** 给人看的一句话。 */
  message: string;
  /** conflict 时的冲突文件（相对路径）。 */
  conflicts?: string[];
};

export type MergeResult = { ok: boolean; steps: MergeStep[] };

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

async function isDir(path: string): Promise<boolean> {
  const info = await fs.stat(path).catch(() => undefined);
  return info?.isDirectory() === true;
}

/** 工作区所属的仓：`git rev-parse --git-common-dir` 的上一级就是主工作树。 */
async function repoOf(worktree: string): Promise<string | undefined> {
  try {
    const common = (await git(worktree, ["rev-parse", "--git-common-dir"])).trim();
    const abs = common.startsWith("/") ? common : join(worktree, common);
    return join(abs, "..");
  } catch {
    return undefined;
  }
}

/** 合并一个工作区：主区干净 → merge --no-ff → 删工作区。冲突则回滚并报冲突文件。 */
export async function mergeWorktree(kind: "project" | "home", worktree: string): Promise<MergeStep> {
  const repo = await repoOf(worktree);
  if (repo === undefined) return { kind, worktree, status: "failed", message: "读不到这个工作区所属的仓" };
  const branch = (await git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim();
  if (branch === "" || branch === "HEAD") return { kind, worktree, status: "failed", message: "工作区没有分支（detached HEAD），不知道该合什么" };

  // 先把工作区里未提交的改动存档：`git merge` 只认**提交**，而 Agent 平时不一定提交。
  // 不存档的后果有两个，且都很糟：合并“合了个空”，而 `worktree remove --force` 会把那些
  // 未提交的改动一起删掉——用户检视过、点过确认的内容就没了。
  const worktreeDirty = (await git(worktree, ["status", "--porcelain"]).catch(() => "")).trim();
  if (worktreeDirty !== "") {
    await git(worktree, ["add", "-A"]);
    await git(worktree, [
      "-c", "user.name=Life OS", "-c", "user.email=lifeos@localhost",
      "commit", "-q", "-m", "chore: 合入前存档（自动）",
    ]);
  }

  const dirty = (await git(repo, ["status", "--porcelain"]).catch(() => "")).trim();
  if (dirty !== "") {
    return { kind, worktree, branch, status: "dirty", message: "主区有未提交的改动，先处理再合并（git 会拒绝，硬合会把它们卷进去）" };
  }

  try {
    await git(repo, ["merge", "--no-ff", "--no-edit", branch]);
  } catch (error) {
    const conflicts = (await git(repo, ["diff", "--name-only", "--diff-filter=U"]).catch(() => ""))
      .split("\n").map((line) => line.trim()).filter((line) => line !== "");
    await git(repo, ["merge", "--abort"]).catch(() => undefined);
    const detail = error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error);
    return {
      kind, worktree, branch,
      status: conflicts.length > 0 ? "conflict" : "failed",
      message: conflicts.length > 0
        ? `合并不成功：${conflicts.length} 个文件冲突，已回滚（仓恢复原样）；请人工解冲突后再合并`
        : `合并不成功：${detail.slice(0, 200)}`,
      ...(conflicts.length > 0 ? { conflicts } : {}),
    };
  }

  await removeWorktree(repo, worktree);
  return { kind, worktree, branch, status: "merged", message: "已合入 main 并删除工作区" };
}

/**
 * 合并一个 Task 的所有工作区（用户触发，协议 §3.7）。
 * 一个源失败不影响另一个：两个仓互不相干。
 */
export async function mergeTask(taskDir: string): Promise<MergeResult> {
  const steps: MergeStep[] = [];
  const home = join(taskDir, HOME_DIR);
  const project = join(taskDir, REPO_DIR);

  if (await isDir(project)) steps.push(await mergeWorktree("project", project));
  else steps.push({ kind: "project", status: "skipped", message: "这个 Task 没有项目工作区（repo/）" });

  if (await isDir(home)) steps.push(await mergeWorktree("home", home));
  else steps.push({ kind: "home", status: "skipped", message: "这个 Task 没有家目录工作区（home/）" });

  const ok = steps.every((step) => step.status === "merged" || step.status === "skipped");
  return { ok, steps };
}
