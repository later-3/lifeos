// 检视候选：回答用户"哪些 Task 有东西可检视"（D31 / A3+B2+C2）。
//
// 为什么需要它（用户 2026-11-08）：
//   "用户怎么来手动使用呢？……总得让 agent 知道该检视啥东西才行。"
//   现状：工具栏按钮只检**当前会话的 activeTaskId**，想看别的 Task 只能切会话/切项目。
//
// 参考形态（读源码，2026-11-08）：
//  - **difit** 检视对象在**进 UI 之前**就定了（CLI 位置参数，`src/cli/index.ts`），UI 里没有选对象的地方；
//  - **opencode** 绑定**当前会话**（`review.toggle` 是会话级命令），会话列表里也没有"哪些会话有未看改动"；
//  - **VS Code SCM** 多个仓库在**同一个视图里分组列出**（`scmRepositoriesViewPane.ts:107` 的 `ArtifactGroup`）——
//    不是"先弹窗选"，而是"一次列出、按组标注"。**我们取这一形态**（Task 有多份，与多仓库同构）。
//
// 三个判据都是实测出来的（不是挑值）：
//  1. **"有改动" = 工作区脏 ∪ 相对 main 有提交**。只查 `git status` 会漏：实测 16 个 worktree 里
//     `0005-列表行对象` 与 `0009-主题系统` 是 `dirty=0` 但 `ahead=1` / `ahead=16`。
//  2. **文档侧一次全仓 `git status`**（0.094s / 357 条），**不要每 Task 各跑一次**（83 个 Task 串行 5.46s）。
//  3. **daily 噪音分层**：实测 59 个 Task 有文档改动，其中 **11 个只有 `daily/`**——
//     全算会让徽标失去意义（59/83 全亮），不算又偏离 D15b。所以**算，但单独标出来**（C2）。
//
// 性能目标（实测预算）：当前 project 15 个 Task 并行 16 检查 **0.93s**；全库 83 个 **1.24s**；
// 文档侧一次扫描 0.094s。所以接口按"一次列一个 agent×project"设计（不一次列全库），单次 ≈1s。
import { readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { listTasks, type TaskSummary } from "./tasks.ts";
import { isCountable, pendingFor, readComments } from "./review-comments.ts";
import { computeReviewDiff } from "./review.ts";
import { resolveHome } from "./home.ts";
import { stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** 并行度：实测 16 时 16 个 worktree 0.32s（串行 1.81s）；更高没有明显收益。 */
export const CANDIDATE_CONCURRENCY = 16;

export type TaskCandidate = {
  taskId: string;
  dirName: string;
  title: string;
  type: string;
  status: string;
  /** 这个 Task 目录的绝对路径（调用方用它打开检视） */
  taskDir: string;
  /** 有没有 worktree（约定位置或扫描到） */
  hasWorktree: boolean;
  /** worktree 有东西可看（工作区脏 或 相对 main 有提交） */
  worktreeChanged: boolean;
  /** Task 文档有改动（家目录仓里这个目录下的改动条数） */
  docChangedFiles: number;
  /**
   * 文档改动**只有** `daily/` 下的（日常分片）。
   * 用于 C2 的分层：不把它算进"有实质改动"的徽标，但界面上仍可展开看到。
   */
  docOnlyDaily: boolean;
  /** 汇总：有实质改动（worktree 变了，或文档有非 daily 改动） */
  substantive: boolean;
  /**
   * 这个 Task 的评论（D29 的用户侧可见化）：用户一眼看出"哪个 Task 有评论等我"。
   *
   * `pendingForUser` **复用 `pendingFor(comments, "user")`**——与 Agent 侧（`lifeos_review_comments`
   * 的 `pendingForMe`）**同一个函数**，不写第二套口径（api 规范 2.10：同一个事实只有一套规则）。
   */
  commentsTotal: number;
  openComments: number;
  pendingForUser: number;
};

export type CandidateList = {
  items: TaskCandidate[];
  /** 这次扫描的耗时（毫秒）——放进响应便于诊断"为什么慢"，也是性能断言的落点 */
  elapsedMs: number;
  /** worktree 检查是否被并发上限截断（理论上不会；截断时如实标注） */
  truncated: boolean;
};

const git = async (cwd: string, args: string[]): Promise<string> => {
  try {
    const { stdout } = await run("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    });
    return stdout;
  } catch {
    return "";
  }
};

const isDir = async (path: string): Promise<boolean> => {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
};

/** `.git` 可能是目录（普通仓）或文件（worktree 的 gitdir 指针）——两种都算（实测教训）。 */
const hasGitMarker = async (path: string): Promise<boolean> => {
  try {
    const info = await stat(path);
    return info.isDirectory() || info.isFile();
  } catch { return false; }
};

/**
 * 定位项目 worktree（与 `review.ts#locateSources` 同一约定，按优先级）：
 * `repo/`（新形态）→ `evidence/worktree/`（历史）→ 扫一层含 `.git` 的子目录。
 */
async function findWorktree(taskDir: string): Promise<string | undefined> {
  for (const convention of [join(taskDir, "repo"), join(taskDir, "evidence", "worktree")]) {
    if (await isDir(convention)) return convention;
  }
  const entries = await readdir(taskDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "home" || entry.name === "repo" || entry.name === "evidence") continue;
    const candidate = join(taskDir, entry.name);
    if (await hasGitMarker(join(candidate, ".git"))) return candidate;
  }
  return undefined;
}

/** 家目录工作区（协议 §3.7）：有它时文档改动在它里面，主区不会再脏。 */
const homeWorktreeOf = (taskDir: string): string => join(taskDir, "home");

/**
 * worktree 有没有东西可看：**工作区脏** 或 **相对 main/master 有提交**。
 *
 * 后者不能省（实测：`0005-列表行对象` worktree 干净但 `ahead=1`，`0009-主题系统` `ahead=16`）——
 * 那正是"提交了但还没合并"的常态，漏掉会把一半真正待检视的 Task 标成"没改动"。
 */
async function worktreeChanged(worktree: string): Promise<boolean> {
  const dirty = await git(worktree, ["status", "--porcelain", "-uall"]);
  if (dirty.trim() !== "") return true;
  for (const base of ["main", "master"]) {
    const mergeBase = (await git(worktree, ["merge-base", base, "HEAD"])).trim();
    if (mergeBase === "") continue;
    const ahead = (await git(worktree, ["rev-list", "-n", "1", `${mergeBase}..HEAD`])).trim();
    if (ahead !== "") return true;
  }
  return false;
}

/** 有界并发：手写而不是引依赖（只需要这一处）。 */
async function mapLimit<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(lanes);
  return out;
}

/**
 * 家目录仓里**一次性**拿到所有 Task 的文档改动条数（按 Task 目录分组）。
 *
 * 为什么不是每 Task 一次 `git status -- <taskDir>`：实测 83 个 Task 串行 **5.46s**；
 * 一次全仓 `status -z -uall` **0.094s**（357 条），再按 `agents/<a>/projects/<p>/tasks/<NNNN>` 分组。
 *
 * `-uall` 必须加：否则未跟踪目录（如整目录新增的 `daily/`）只会输出目录名一条，
 * 我们无法判断"是不是只有 daily"，C2 的分层就失去依据（实测会少算）。
 */
export async function docChangesByTask(): Promise<Map<string, { count: number; onlyDaily: boolean }>> {
  const home = resolveHome();
  const raw = await git(home, ["status", "--porcelain", "-z", "-uall"]);
  const out = new Map<string, { count: number; onlyDaily: boolean }>();
  // `-z` 的格式：`XY <path>\0`；重命名/复制（R/C）**多吃一条**（下一条是旧路径）。
  const parts = raw.split("\u0000");
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (entry === undefined || entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    if (xy.includes("R") || xy.includes("C")) i += 1;   // 跳过旧路径
    const match = /^agents\/([^/]+)\/projects\/([^/]+)\/tasks\/(\d{4})-(.+?)\//.exec(path);
    if (match === null) continue;
    const key = `${match[1]}/${match[2]}/${match[3]}`;
    const afterTask = path.slice(`agents/${match[1]}/projects/${match[2]}/tasks/${match[3]}-${match[4]}/`.length);
    const isDaily = afterTask.startsWith("daily/");
    const current = out.get(key);
    if (current === undefined) {
      out.set(key, { count: 1, onlyDaily: isDaily });
    } else {
      current.count += 1;
      current.onlyDaily = current.onlyDaily && isDaily;
    }
  }
  return out;
}

/** 列某个 agent × project 的检视候选（按"有实质改动优先、编号倒序"排序）。 */
export async function listCandidates(agentId: string, projectId: string): Promise<CandidateList> {
  const startedAt = Date.now();
  const tasks: TaskSummary[] = await listTasks({ agentId, projectId });
  const docs = await docChangesByTask();

  const items = await mapLimit(tasks, CANDIDATE_CONCURRENCY, async (task): Promise<TaskCandidate> => {
    const worktree = await findWorktree(task.path);
    const changed = worktree === undefined ? false : await worktreeChanged(worktree);
    // 文档改动：有家目录工作区就算它的脏条目（主区那份不再变），否则看历史形态的全仓 status。
    const homeWorktree = homeWorktreeOf(task.path);
    const homeDirty = await isDir(homeWorktree) ? (await git(homeWorktree, ["status", "--porcelain", "-uall"])).trim().split("\n").filter((line) => line !== "").length : 0;
    const docInfo = docs.get(`${agentId}/${projectId}/${task.id}`);
    const docChangedFiles = Math.max(docInfo?.count ?? 0, homeDirty);
    const docOnlyDaily = (docInfo?.onlyDaily === true) && homeDirty === 0;
    /**
     * 评论：直接按 taskDir 算文件路径读（不扫目录）——实测 2 个文件 2.6ms，
     * 15 个 Task 约 20ms；比"先扫一遍 state 目录再反查 slug"更直接，也不会读错别的 Task。
     */
    const comments = await readComments(task.path);
    /**
     * 计数口径（0018 用户实测两次）：**只数面板上能看到卡片的评论**——
     * ① 空正文的草稿（点"＋"没写就丢下）不算；
     * ② 锚 (source,path) 不在当前 diff 文件清单的 = 失锚孤儿（评论绑检视时刻的 diff，
     *    合并/改动后文件不在了，跳转也看不到卡）不算。
     * 只有"有评论的 Task"才付这次 diff 的成本（0018：15 个 Task 里少数）。
     */
    let available: Set<string> | undefined;
    if (comments.length > 0) {
      available = new Set();
      try {
        const diff = await computeReviewDiff(task.path);
        for (const group of diff.items ?? []) {
          const kind = group.source.kind;
          for (const file of group.files) available.add(`${kind}\u0000${file.path}`);
        }
      } catch { /* diff 算不出来：available 保持 undefined = 旧口径（评论全算），错误可见于日志 */ }
    }
    const countable = available !== undefined ? comments.filter((c) => isCountable(c, available as Set<string>)) : comments;
    return {
      taskId: task.id,
      dirName: task.dirName,
      title: task.title,
      type: task.type,
      status: task.status,
      taskDir: task.path,
      hasWorktree: worktree !== undefined,
      worktreeChanged: changed,
      docChangedFiles,
      docOnlyDaily,
      substantive: changed || (docChangedFiles > 0 && !docOnlyDaily),
      commentsTotal: countable.length,
      openComments: countable.filter((comment) => comment.state !== "resolved").length,
      pendingForUser: pendingFor(countable, "user", available).length,
    };
  });

  // 排序：有实质改动 → 有文档改动（含只有 daily）→ 其余；同组按编号倒序（最近的 Task 在上）
  const ranked = [...items].sort((a, b) => {
    const rank = (item: TaskCandidate): number => item.substantive ? 0 : item.docChangedFiles > 0 ? 1 : 2;
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return Number(b.taskId) - Number(a.taskId);
  });

  return { items: ranked, elapsedMs: Date.now() - startedAt, truncated: false };
}

/** 供工具/日志用的相对路径（诊断时能看出是哪个目录）。 */
export function relativeToHome(path: string): string {
  const rel = relative(resolveHome(), path);
  return rel.split(sep).join("/");
}

/** `dirname` 在这里只是为了让"路径规范化"有单点（避免各调用方各写一份）。 */
export const parentOf = (path: string): string => dirname(path);
