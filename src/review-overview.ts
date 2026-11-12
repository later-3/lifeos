// 检视状态总览（P4）：给 Agent 一个"现在检视对象是什么、有哪些改动、我欠几条回复"的入口。
//
// 为什么需要它（用户 2026-11-07）：
//   "我们做检视模式的工具，把工具给到 agent，然后 agent 能知道怎么查询有哪些检视意见，怎么回复。"
// 已有的四个工具分别解决"读某条/写一条/回复/关闭"，但**没有一个是总览**：
// Agent 想知道"这个 Task 的检视对象在哪、有多少改动、几条等我"，得先瞎猜路径再一条条试。
//
// 与既有模块的分工（不重复实现）：
//  - `src/review.ts`：检视对象定位（`locateSources`）与 diff 计算（`computeReviewDiff`）；
//  - `src/review-comments.ts`：评论读写与状态机（含 `pendingFor`）；
//  - 本文件只做**聚合与格式化**：一次调用把三者合成一份可读摘要，零新业务规则。
//
// 纪律：不写文件、不写 git、不改评论（只读快照）。工具层（`src/agent-tools.ts`）只做外壳。
import { computeReviewDiff, type ReviewSource } from "./review.ts";
import { pendingFor, readComments, type ReviewComment } from "./review-comments.ts";

/** 摘要里最多列多少个文件（完整清单用面板看；Agent 要的是"有没有、大概哪些"）。 */
export const OVERVIEW_FILE_SAMPLE = 20;
/** 摘要里最多带多少条线程（正文只给首行预览——全文用 `lifeos_review_comments`）。 */
export const OVERVIEW_COMMENT_SAMPLE = 10;
/** 预览正文的截断长度（够判断是哪条，不搬全文）。 */
const PREVIEW_CHARS = 120;

export type ReviewOverview = {
  taskId: string;
  taskDir: string;
  sources: Array<{
    kind: ReviewSource["kind"];
    path: string;
    exists: boolean;
    branch?: string;
    head?: string;
    /** 该源退化（例如目录不是 git 仓库） */
    degraded?: string;
  }>;
  files: {
    total: number;
    code: number;
    doc: number;
    other: number;
    additions: number;
    deletions: number;
    /** 该源的文件清单被上限截断 */
    truncated: boolean;
    /** 前 N 个文件（`path (+add -del)`），让 Agent 知道改了什么 */
    sample: string[];
  };
  comments: {
    total: number;
    byState: { draft: number; open: number; resolved: number };
    awaiting: { none: number; user: number; agent: number };
    /** 未闭环且等我（或没人认领）= 我的检视 TODO */
    pendingForAgent: number;
    /** 未闭环且等用户 */
    pendingForUser: number;
    threadsWithReplies: number;
    /** 最近 N 条（按 updatedAt 降序），正文只给首行预览 */
    latest: Array<{
      id: string;
      where: string;
      author: string;
      state: ReviewComment["state"];
      awaiting: ReviewComment["awaiting"];
      replies: number;
      preview: string;
    }>;
  };
  /** 聚合过程中的非致命问题（例如 diff 计算失败）——**必须**如实带出来，不许静默 */
  warnings: string[];
};

const preview = (body: string): string => {
  const first = body.trim().split("\n")[0] ?? "";
  return first.length <= PREVIEW_CHARS ? first : `${first.slice(0, PREVIEW_CHARS)}…`;
};

const whereOf = (c: ReviewComment): string => {
  const { path, side, start, end } = c.anchor;
  return `${path}:${start === end ? `L${start}` : `L${start}-L${end}`} (${side})`;
};

/**
 * 生成某个 Task 的检视总览。
 *
 * @param taskDir Task 目录（已由调用方解析；本函数不再做 taskId → 目录 的解析）
 * @param taskId 展示用的 Task 编号（`0010`）
 */
export async function reviewOverviewOf(taskDir: string, taskId: string): Promise<ReviewOverview> {
  const warnings: string[] = [];

  /**
   * **只调一次** `computeReviewDiff`：它内部已经调过 `locateSources`，而且每个 item 都带回
   * 自己的 `source`（路径/分支/HEAD/exists）。再单独调一次 locateSources 等于重复跑 4–6 条 git 命令
   * ——这个工具会被 Agent 反复调用，白跑的成本要避免。
   */
  const diff = await computeReviewDiff(taskDir);
  if ("error" in diff && diff.error !== undefined) {
    // 目录不存在等硬错误：调用方（工具层）负责抛；这里只把警告带出去（不许静默）
    warnings.push(`${diff.error.code}：${diff.error.message}`);
  }
  const items = "items" in diff && diff.items !== undefined ? diff.items : [];

  const sources = items.map((item) => ({
    kind: item.source.kind,
    path: item.source.path,
    exists: item.source.exists,
    ...(item.source.branch !== undefined ? { branch: item.source.branch } : {}),
    ...(item.source.head !== undefined ? { head: item.source.head } : {}),
    ...(item.degraded !== undefined ? { degraded: item.degraded } : {}),
  }));

  const allFiles = items.flatMap((item) => item.files.map((file) => ({ file, kind: item.source.kind })));
  const files = {
    total: allFiles.length,
    code: allFiles.filter((entry) => entry.file.kind === "code").length,
    doc: allFiles.filter((entry) => entry.file.kind === "doc").length,
    other: allFiles.filter((entry) => entry.file.kind === "other").length,
    additions: allFiles.reduce((sum, entry) => sum + entry.file.additions, 0),
    deletions: allFiles.reduce((sum, entry) => sum + entry.file.deletions, 0),
    truncated: items.some((item) => item.truncated),
    sample: allFiles
      .slice(0, OVERVIEW_FILE_SAMPLE)
      .map((entry) => `${entry.kind === "lifeos" ? "[文档源] " : ""}${entry.file.path} (+${entry.file.additions} -${entry.file.deletions})`),
  };

  const comments = await readComments(taskDir);
  const byState = { draft: 0, open: 0, resolved: 0 };
  /**
   * 「等谁」的三个桶**只统计未关闭的线程**。
   *
   * 早先的写法把已关闭的算进 `none`（"没人认领"），实测输出变成
   * `Waiting: for you 1, for the user 1, unassigned 2` 而总共只有 2 条线程——
   * 已关闭的那条既不是"等用户"也不是"没人认领"，它**不参与等待**。
   * 与 `awaitingOf()` 同一条规则：关闭 = 这一轮讨论结束。
   */
  const awaiting = { none: 0, user: 0, agent: 0 };
  for (const comment of comments) {
    byState[comment.state] += 1;
    if (comment.state === "resolved") continue;
    if (comment.awaiting === null) awaiting.none += 1;
    else awaiting[comment.awaiting] += 1;
  }
  const pendingAgent = pendingFor(comments, "agent").length;
  const pendingUser = pendingFor(comments, "user").length;

  const latest = [...comments]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, OVERVIEW_COMMENT_SAMPLE)
    .map((comment) => ({
      id: comment.id,
      where: whereOf(comment),
      author: `${comment.author.kind}:${comment.author.id}`,
      state: comment.state,
      awaiting: comment.awaiting,
      replies: comment.replies.length,
      preview: preview(comment.body),
    }));

  return {
    taskId,
    taskDir,
    sources,
    files,
    comments: {
      total: comments.length,
      byState,
      awaiting,
      pendingForAgent: pendingAgent,
      pendingForUser: pendingUser,
      threadsWithReplies: comments.filter((comment) => comment.replies.length > 0).length,
      latest,
    },
    warnings,
  };
}

/**
 * 总览 → 给 Agent 读的文本。
 *
 * 写法要求（不是风格问题）：**每一段都要能直接促成下一步动作**——
 * 说清"检视对象在哪"、"有几条等我"、"用哪个工具继续"。
 * 空态也要给出下一步（没有 worktree 时告诉它去建，而不是只说"没有"）。
 */
export function formatReviewOverview(overview: ReviewOverview): string {
  const lines: string[] = [];
  const { taskId, files, comments } = overview;
  lines.push(`Review state for task ${taskId}`);

  lines.push("", "Sources:");
  for (const source of overview.sources) {
    const label = source.kind === "worktree" ? "project code (repo/)" : "home documents (~/.lifeos)";
    const meta = [source.branch !== undefined ? `branch ${source.branch}` : undefined, source.head !== undefined ? `@ ${source.head}` : undefined]
      .filter((part): part is string => part !== undefined)
      .join(" ");
    const state = source.exists ? (meta === "" ? "exists" : `exists, ${meta}`) : "missing";
    lines.push(`- ${label}: ${source.path} (${state})${source.degraded !== undefined ? ` [${source.degraded}]` : ""}`);
  }
  const missingWorktree = overview.sources.some((source) => source.kind === "worktree" && !source.exists);
  if (missingWorktree) {
    lines.push("  note: no code worktree for this task yet — it is expected at <taskDir>/repo/ (legacy tasks: evidence/worktree/).");
  }

  lines.push("", `Changes: ${files.total} file(s) (+${files.additions} -${files.deletions}) — code ${files.code}, doc ${files.doc}, other ${files.other}${files.truncated ? " [truncated]" : ""}`);
  for (const line of files.sample) lines.push(`- ${line}`);
  if (files.total > files.sample.length) lines.push(`- …and ${files.total - files.sample.length} more`);

  lines.push("", `Comments: ${comments.total} thread(s) — draft ${comments.byState.draft}, open ${comments.byState.open}, resolved ${comments.byState.resolved}`);
  lines.push(`Waiting (open threads only): for you ${comments.pendingForAgent}, for the user ${comments.pendingForUser}, unassigned ${comments.awaiting.none} (${comments.threadsWithReplies} thread(s) have replies)`);
  for (const item of comments.latest) {
    // 已关闭的线程不显示「等谁」（它不再等任何人）；与统计口径一致
    const who = item.state === "resolved" || item.awaiting === null ? "" : ` waiting:${item.awaiting}`;
    lines.push(`- ${item.id} ${item.where} by ${item.author} · ${item.state}${who} · ${item.replies} repl${item.replies === 1 ? "y" : "ies"} — ${item.preview}`);
  }
  if (comments.total > comments.latest.length) lines.push(`- …and ${comments.total - comments.latest.length} more`);

  lines.push("", "Next:",
    "- `lifeos_review_comments({ taskId, pendingForMe: true })` — the threads that still wait for you (your review TODO).",
    "- `lifeos_review_comments({ taskId })` — every thread with full text and replies.",
    "- `lifeos_review_comment_reply({ taskId, id, body })` — say what you changed and where (this hands the thread back to the user).",
    "- `lifeos_review_comment_resolve({ taskId, id })` — close a thread **you** raised; threads the user raised can only be closed by the user.",
  );

  if (overview.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of overview.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n");
}
