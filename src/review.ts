// 检视模式（Task 0010）：把一个 Task 的改动统一成可检视的 diff 形状。
//
// 业务只在这一处（backend 规范 2.6）；HTTP（server.ts）与 Pi 工具都是外壳。
//
// 两种检视源（01-background D15b）：
//  - worktree：Task 目录下的项目 worktree（约定 evidence/worktree，兜底扫一层）。
//    对比范围 = merge-base(main, HEAD) → 工作区（含未提交改动），即 opencode 的 "branch" 模式
//    （evidence/REFERENCE-SOURCE.md §4.1）。三点 diff 不会把 main 的前进算成"待检视"
//    （实测：已合并的 0005 worktree，main...HEAD 为空而 HEAD..main 有 48 提交）。
//  - lifeos：Task 自身文档目录（~/.lifeos/agents/.../tasks/NNNN/）。家目录仓本身是 git 仓；
//    基线 = 含该 Task 路径的最近一次提交的树，没有则整目录视为新增。用临时 index + write-tree
//    拿"含未跟踪文件"的树（实测 0.14s / 334 文件；不动真实 index，写对象可 git prune）。
//
// 上限（02-design §1.2）：Discourse 的预算思路（onpdiff.rb: budget = min(200×(m+n), 2M)）
// + 本仓 fs.ts 的 MAX_CONTENT_BYTES 先例。值按真实样本推导：reviewer 0003 = 29 文件 /
// 2464 diff 行 / 148KB，故 200 文件 / 20k 行 / 1MB 单文件给足余量。超出截断并标记——
// 失败可见，不静默（Discourse diff_error 同思路）。
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { resolveHome } from "./home.ts";
import { parseUnifiedPatchToHunks, type DiffHunk } from "./review-patch.ts";
import { HOME_DIR, REPO_DIR } from "./task-worktree.ts";

const run = promisify(execFile);

/** 单文件 diff 的字节上限（超过即截断该文件并标记）。 */
export const MAX_FILE_DIFF_BYTES = 1024 * 1024;
/** 一次检视的文件数上限。 */
export const MAX_REVIEW_FILES = 200;
/** 一次检视的 diff 行总数上限。 */
export const MAX_REVIEW_DIFF_LINES = 20_000;

export type ReviewSourceKind = "worktree" | "lifeos";

export type ReviewSource = {
  kind: ReviewSourceKind;
  /** 源目录的绝对路径（worktree 根 / Task 文档目录）。 */
  path: string;
  /** 目录是否存在。worktree 不存在是正常状态（引导用户去建），不是错误。 */
  exists: boolean;
  /** worktree 当前分支 / 文档源的家目录仓 HEAD。取不到为 undefined。 */
  head?: string;
  /** worktree 才有：分支名（detached 为 undefined）。 */
  branch?: string;
  /** 定位方式（诊断用）：约定路径 / 目录扫描。 */
  via?: "convention" | "scan" | "direct";
};

export type ReviewFileKind = "code" | "doc" | "other";

export type ReviewDiffLine = {
  type: "context" | "added" | "removed";
  oldNo: number | null;
  newNo: number | null;
  text: string;
};

export type ReviewFileDiff = {
  path: string;
  /** D8 显示分类：代码 / 文档(.md) / 其他。 */
  kind: ReviewFileKind;
  status: "added" | "modified" | "deleted" | "renamed";
  oldPath?: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  /** 该文件 diff 被截断（超单文件上限或全局限额用尽）。 */
  truncated?: boolean;
};

export type ReviewSourceDiff = {
  source: ReviewSource;
  files: ReviewFileDiff[];
  /** 全局限额用尽导致后续文件未纳入。 */
  truncated: boolean;
  /** 文档源才有：基线提交（短 SHA + 时间）。基线可见化——旧基线不假装是"本轮改动"（02-design §6 风险 1）。 */
  base?: { commit: string; at?: string };
  /** 文档源退化：家目录不是 git 仓 → 只列文件清单，无 diff。 */
  degraded?: "no_vcs";
};

export type ReviewError = { code: string; message: string; status: 400 | 403 | 404 | 502 };

/** 空树（git 内建常量）：Task 目录在基线里还不存在时用它当 oldRoot，全部视为新增。 */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const isMd = (path: string): boolean => /\.(md|markdown|mdx)$/i.test(path);
const fileKindOf = (path: string): ReviewFileKind => (isMd(path) ? "doc" : /\.(ts|tsx|js|mjs|cjs|jsx|css|json|ya?ml|html|rs|py|go|sh|toml)$/i.test(path) ? "code" : "other");

async function git(cwd: string, args: string[], maxBuffer = 64 * 1024 * 1024): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
    timeout: 15_000,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

function gitShortError(error: unknown): ReviewError {
  const message = error instanceof Error ? error.message : String(error);
  if (/not a git repository/i.test(message)) return { code: "no_vcs", message: "这个目录不是 git 仓库", status: 400 };
  if (/bad object|unknown revision|ambiguous argument/i.test(message)) return { code: "bad_ref", message: "git 引用不存在或已损坏", status: 502 };
  return { code: "git_broken", message: `git 命令失败：${message.slice(0, 200)}`, status: 502 };
}

async function dirExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

/** worktree 的 `.git` 是**文件**（gitdir 指针），普通仓是目录——两种都算（实测 reviewer 0003 漏检的教训）。 */
async function gitMarkerExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory() || info.isFile();
  } catch { return false; }
}

/**
 * 定位一个 Task 的检视源。
 *
 * 项目 worktree 的约定路径（协议 §3.7，按优先级）：
 *   1. `<Task 目录>/repo/`（新形态，与 `home/` 对称）
 *   2. `<Task 目录>/evidence/worktree/`（2026-11 之前的历史位置）
 *   3. 扫 Task 目录下一层含 `.git` 的子目录（历史散落形态，如 reviewer 0003 的 `worktree/`）
 *   都找不到才算“还没有工作区”（`exists:false`，引导用户去建）。
 *
 * 文档源（kind `lifeos`）：
 *   - 有 `<Task 目录>/home/` → 它就是源（家目录仓的 worktree，整份家目录按 Agent 裁剪）；
 *   - 没有 → 退回 Task 目录本身（历史形态，diff 走 `computeLifeosDiff`）。
 */
export async function locateSources(taskDir: string): Promise<ReviewSource[]> {
  const sources: ReviewSource[] = [];

  // ① 项目 worktree：repo/ → evidence/worktree → 扫一层
  const convention = join(taskDir, REPO_DIR);
  const legacy = join(taskDir, "evidence", "worktree");
  let worktreePath: string | undefined;
  let via: ReviewSource["via"];
  if (await dirExists(convention)) {
    worktreePath = convention;
    via = "convention";
  } else if (await dirExists(legacy)) {
    worktreePath = legacy;
    via = "convention";
  } else {
    try {
      const entries = await readdir(taskDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = join(taskDir, entry.name);
        if (await gitMarkerExists(join(candidate, ".git"))) {
          worktreePath = candidate;
          via = "scan";
          break; // 一期取第一个；多项目 Task 的完整多源形态在后续迭代
        }
      }
    } catch { /* 目录读不了 = 没有 worktree */ }
  }
  if (worktreePath !== undefined) {
    const source: ReviewSource = { kind: "worktree", path: worktreePath, exists: true };
    if (via !== undefined) source.via = via;
    try {
      const branch = (await git(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      const head = (await git(worktreePath, ["rev-parse", "--short", "HEAD"])).trim();
      if (branch !== "") source.branch = branch;
      if (head !== "") source.head = head;
    } catch { /* 存在但 git 读不了：保留 exists，diff 阶段报 no_vcs */ }
    sources.push(source);
  } else {
    sources.push({ kind: "worktree", path: convention, exists: false });
  }

  // ② Task 自身文档（家目录仓）：有 home/ 工作区就用它，否则退回 Task 目录本身
  const homeWorktree = join(taskDir, HOME_DIR);
  if (await dirExists(homeWorktree)) {
    const source: ReviewSource = { kind: "lifeos", path: homeWorktree, exists: true, via: "direct" };
    try {
      const branch = (await git(homeWorktree, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      const head = (await git(homeWorktree, ["rev-parse", "--short", "HEAD"])).trim();
      if (branch !== "") source.branch = branch;
      if (head !== "") source.head = head;
    } catch { /* 存在但读不了：diff 阶段退化为空 */ }
    sources.push(source);
    return sources;
  }

  const lifeos: ReviewSource = { kind: "lifeos", path: taskDir, exists: true, via: "direct" };
  const homeRepo = resolveHome();
  try {
    const head = (await git(homeRepo, ["rev-parse", "--short", "HEAD"])).trim();
    if (head !== "") lifeos.head = head;
  } catch { /* 家目录仓没 init：diff 阶段退化 */ }
  sources.push(lifeos);

  return sources;
}

/** 文档源的基线：家目录仓里含该 Task 路径的最近一次提交。 */
async function lifeosBaseline(taskDir: string): Promise<{ commit: string; at?: string } | undefined> {
  const homeRepo = resolveHome();
  try {
    const log = await git(homeRepo, ["log", "--format=%H %cI", "-n", "1", "--", taskDir]);
    const [commit, at] = log.trim().split(" ");
    if (commit === undefined || commit === "") return undefined;
    return at !== undefined && at !== "" ? { commit, at } : { commit };
  } catch {
    return undefined;
  }
}

/**
 * 家目录仓的 Task 文档 diff：临时 index 建两棵树再对比。
 *
 * - 树 A：基线提交的树里**该 Task 目录的子树**（没有基线 = 空树，全部视为新增）；
 * - 树 B：当前工作区里该 Task 目录的内容（`git add` 进临时 index——**不动真实 index**，
 *   实测 index 前后条数不变；写入的对象库可用 `git prune` 清理）；
 * - 用 `GIT_INDEX_FILE` 指向临时文件是进程内独立的，并发无冲突。
 */
async function computeLifeosDiff(taskDir: string): Promise<ReviewSourceDiff> {
  const homeRepo = resolveHome();
  const base = await lifeosBaseline(taskDir);
  const rel = relativeTo(homeRepo, taskDir);

  const source: ReviewSource = { kind: "lifeos", path: taskDir, exists: true, via: "direct" };
  try {
    const head = (await git(homeRepo, ["rev-parse", "--short", "HEAD"])).trim();
    if (head !== "") source.head = head;
  } catch { /* no vcs */ }
  if (source.head === undefined) {
    return { source: { ...source, exists: await dirExists(taskDir) }, files: [], truncated: false, degraded: "no_vcs" };
  }

  const tmpDir = join(homeRepo, "tmp");
  const tmpIndex = join(tmpDir, `review-index-${process.pid}-${Date.now()}.idx`);
  try {
    await mkdir(tmpDir, { recursive: true });
    // 两侧都取**根树**再带全仓 pathspec 对比（子树对子树会让路径错位——实测 task.md 显示成"new file"）：
    //  - oldRoot：基线提交的根树；基线提交里还没有该 Task 目录（Task 是后来建的）→ 空树（全部视为新增）
    //  - newRoot：临时 index 建的"只含该 Task 目录"的根树（read-tree --empty + add -A -- <rel>，
    //    add 从仓根按全路径装，天然对齐；不动真实 index——实测前后条数不变）
    let oldRoot = EMPTY_TREE;
    if (base !== undefined) {
      // 基线提交的**根树**（ls-tree -- <path> 给的是子树，与根树 diff 会路径错位）
      oldRoot = (await git(homeRepo, ["rev-parse", `${base.commit}^{tree}`]).catch(() => ""))?.trim() || EMPTY_TREE;
    }
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
    // evidence/（worktree 所在）排除在家目录 diff 外：它是代码仓的检视对象（worktree 源），
    // 不属于 Task 文档；且 git 会把 worktree 当 gitlink 噪声（真实家目录靠 .gitignore 挡，这里防御性排除）。
    // add 不带 exclude（带 exclude 会让"被 .gitignore 忽略的显式路径"报错，实测）；
    // evidence/ 的排除放到 diff 的 pathspec（diff 不受 .gitignore 交互影响）。
    await run("git", ["-C", homeRepo, "read-tree", "--empty"], { env, timeout: 10_000, maxBuffer: 1024 * 1024 });
    await run("git", ["-C", homeRepo, "add", "-A", "--", rel], { env, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    const newRoot = (await run("git", ["-C", homeRepo, "write-tree"], { env, timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout.trim();

    const diffPaths = [rel, `:(exclude)${rel === "." ? "" : rel + "/"}evidence/**`];
    const patch = await git(homeRepo, ["diff", "--no-color", "--no-ext-diff", "--unified=3", oldRoot, newRoot, "--", ...diffPaths]);
    return { source, files: filesFromPatch(patch), truncated: false, ...(base !== undefined ? { base } : {}) };
  } catch (error) {
    // 树对比失败不拖垮整个检视：文档组退化为空（错误可见）
    const e = gitShortError(error);
    if (e.code !== "no_vcs") console.error(`[review] lifeos diff 失败 (${taskDir}):`, e.message);
    return { source, files: [], truncated: false, ...(base !== undefined ? { base } : {}), degraded: "no_vcs" };
  } finally {
    // 临时 index 清理（失败不管：残留一个 idx 文件无害，家目录 tmp/ 本来就是临时区）
    await import("node:fs/promises").then((fs) => fs.rm(tmpIndex, { force: true })).catch(() => {});
  }
}

// ── G1a 按需取文件全文（折叠未改行「展开更多」时用）───────────────────────────
//
// 依据：difit `GET /api/blob/<path>?ref=<commitish>`（src/server/server.ts:495-540）+
// 前端 useExpandedLines.ts:52；opencode 走 @pierre/diffs 的 fileDiff（含全文）。
// 我们只有 `--unified=3` 的 patch，展开到 patch 之外的行必须回源取。
// 按需而不是接口直返全文：30 文件 patch 已 1.1MB，直返会翻几倍（difit 同判）。

export type ReviewBlobSide = "old" | "new";

export type ReviewBlob = { content: string; truncated: boolean };

export type ReadBlobInput = {
  taskDir: string;
  source: ReviewSourceKind | string;
  path: string;
  side: ReviewBlobSide | string;
};

/**
 * 路径安全性判定（抽纯逻辑便于复用）：拒绝空、绝对路径、NUL、以及任何 `..` 段。
 * 返回规范化后的相对路径；非法返回 undefined。
 */
export function safeRelativePath(path: string): string | undefined {
  if (typeof path !== "string" || path === "") return undefined;
  if (path.includes("\0")) return undefined;
  if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) return undefined;
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) return undefined;
  return normalized;
}

/** 二进制判定：前 8KB 内出现 NUL 即视为二进制（git 自身的启发式同口径）。 */
function looksBinary(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 8192);
  for (const byte of head) if (byte === 0) return true;
  return false;
}

/** 按字节上限截断，尽量停在换行处（不把一行劈成两半）。 */
function truncateContent(buffer: Buffer): { content: string; truncated: boolean } {
  if (buffer.length <= MAX_FILE_DIFF_BYTES) return { content: buffer.toString("utf8"), truncated: false };
  const head = buffer.subarray(0, MAX_FILE_DIFF_BYTES);
  const lastNewline = head.lastIndexOf(0x0a);
  const cut = lastNewline > 0 ? head.subarray(0, lastNewline + 1) : head;
  return { content: cut.toString("utf8"), truncated: true };
}

async function readDiskFile(root: string, relative: string): Promise<Buffer | undefined> {
  const absolute = resolve(root, relative);
  const rootResolved = resolve(root);
  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + "/")) return undefined;
  try {
    const info = await stat(absolute);
    if (!info.isFile()) return undefined;
    return await readFile(absolute);
  } catch { return undefined; }
}

async function readGitBlob(repo: string, ref: string, relative: string): Promise<Buffer | undefined> {
  try {
    const { stdout } = await run("git", ["-C", repo, "-c", "core.quotePath=false", "show", `${ref}:${relative}`], {
      timeout: 15_000,
      maxBuffer: 256 * 1024 * 1024,
      encoding: "buffer",
      env: { ...process.env, LC_ALL: "C" },
    });
    return stdout as unknown as Buffer;
  } catch { return undefined; }
}

const blobError = (code: string, message: string, status: 400 | 404): { error: ReviewError } =>
  ({ error: { code, message, status } });

/** worktree 的对比基线（与 computeWorktreeDiff 同一口径：merge-base(main, HEAD)，无 main 退化 HEAD）。 */
async function worktreeBaseRef(repo: string): Promise<string> {
  const baseBranch = await baseBranchOf(repo);
  if (baseBranch !== undefined) {
    try {
      const mergeBase = (await git(repo, ["merge-base", baseBranch, "HEAD"])).trim();
      if (mergeBase !== "") return mergeBase;
    } catch { /* 分叉历史取不到 merge-base：退化 HEAD */ }
  }
  return "HEAD";
}

/**
 * 取某个文件在某一侧的全文（G1a）。
 *
 * - worktree：old = 基线提交里的内容（不存在 → 空文本，新增文件的正常形态）；
 *   new = 工作区内容（不存在 → 空文本，删除文件的正常形态）。
 * - lifeos：old = 基线提交；new = 工作区（与 computeLifeosDiff 的临时 index 同口径）。
 * - 两侧都不存在 → 404 file_not_found（真不存在，不假装空文件）。
 */
export async function readReviewBlob(input: ReadBlobInput): Promise<ReviewBlob | { error: ReviewError }> {
  const { taskDir } = input;
  if (input.source !== "worktree" && input.source !== "lifeos") {
    return blobError("invalid_source", "source 只能是 worktree 或 lifeos", 400);
  }
  if (input.side !== "old" && input.side !== "new") {
    return blobError("invalid_side", "side 只能是 old 或 new", 400);
  }
  const relative = safeRelativePath(input.path);
  if (relative === undefined) return blobError("bad_request", "文件路径不合法（不允许绝对路径或 .. 逃逸）", 400);
  if (!(await dirExists(taskDir))) {
    return blobError("task_dir_not_found", `Task 目录不存在：${basename(taskDir)}`, 404);
  }

  const ownBuffer = async (side: ReviewBlobSide): Promise<Buffer | undefined> => {
    if (input.source === "worktree") {
      const source = (await locateSources(taskDir)).find((item) => item.kind === "worktree");
      if (source === undefined || !source.exists) return undefined;
      if (side === "old") return readGitBlob(source.path, await worktreeBaseRef(source.path), relative);
      return readDiskFile(source.path, relative);
    }
    const homeRepo = resolveHome();
    if (side === "new") return readDiskFile(taskDir, relative);
    const base = await lifeosBaseline(taskDir);
    if (base === undefined) return undefined;
    return readGitBlob(homeRepo, base.commit, relativeTo(homeRepo, join(taskDir, relative)));
  };

  const wanted = await ownBuffer(input.side as ReviewBlobSide);
  if (wanted === undefined) {
    // 要的这一侧没有：另一侧若存在则是「新增 / 删除」的正常形态（空文本 = 0 行）；都没有才是真不存在
    const other = await ownBuffer(input.side === "old" ? "new" : "old");
    if (other !== undefined && !looksBinary(other)) return { content: "", truncated: false };
    if (other !== undefined) return blobError("binary_not_supported", "这是二进制文件，不提供文本内容", 400);
    if (input.source === "worktree") {
      const source = (await locateSources(taskDir)).find((item) => item.kind === "worktree");
      if (source === undefined || !source.exists) {
        return blobError("worktree_missing", "这个 Task 还没有 worktree（约定位置 evidence/worktree）", 404);
      }
    }
    return blobError("file_not_found", `两侧都找不到这个文件：${relative}`, 404);
  }
  if (looksBinary(wanted)) return blobError("binary_not_supported", "这是二进制文件，不提供文本内容", 400);
  return truncateContent(wanted);
}

function relativeTo(root: string, dir: string): string {
  const r = resolve(root);
  const d = resolve(dir);
  if (d === r) return ".";
  if (!d.startsWith(r + "/")) return ".";
  return d.slice(r.length + 1);
}

/**
 * 项目 worktree 的 diff：merge-base(main, HEAD) → 工作区（**含未跟踪文件**）。
 *
 * 两个关键点：
 * 1. 用 `git diff <merge-base>`（一个点）而不是三点：它天然比对“工作区 vs 分叉点”，未提交改动自动包含。
 * 2. **未跟踪文件必须纳入**：新建的 Task 文档、新建的源码文件都是未跟踪的，裸 `git diff` 会
 *    根本看不到它们（实测：新 Task 的文档侧全是未跟踪 → 检视一片空白）。
 *    做法：临时 `GIT_INDEX_FILE` 里 `read-tree <基线树>` + `add -A` + `write-tree`，
 *    再把两棵树 diff——不动真实 index（同 `computeLifeosDiff` 的手法）。
 *
 * merge-base 取 main；没有 main（独立仓/换名）时退化为 HEAD（只看未提交改动），避免误报巨大 diff。
 */
async function computeWorktreeDiff(source: ReviewSource): Promise<ReviewSourceDiff> {
  const baseBranch = await baseBranchOf(source.path);
  let baseRef: string | undefined;
  try {
    if (baseBranch !== undefined) {
      baseRef = (await git(source.path, ["merge-base", baseBranch, "HEAD"])).trim() || undefined;
    }
  } catch { /* 没有 main 或分叉历史：baseRef 保持 undefined */ }

  // baseRef 缺失（无 main/master）：退化为只看未提交改动（`git diff HEAD` 仍含已提交，
  // 但那是分支自己的提交——比“整段历史”保守）；source.branch 的存在让前端可标注
  // “基线：HEAD（找不到 main）”。02-design §6 风险 1 的同款“基线可见化”。
  const range = baseRef ?? "HEAD";
  let patch: string;
  try {
    patch = await diffIncludingUntracked(source.path, range);
  } catch (error) {
    throw gitShortError(error);
  }
  // base 随 diff 返回（0018 用户：评论卡"锚定的原文"要能标注来自哪个基线/分支——
  // lifeos 源一直带 base，worktree 源漏了）。baseRef 为 undefined（找不到 main）时不带。
  return { source, files: filesFromPatch(patch), truncated: false, ...(baseRef !== undefined ? { base: { commit: baseRef } } : {}) };
}

/** 基线引用 → 一棵树（基线是 commit 就取它的根树；是树就原样）。取不到就用空树。 */
async function treeOfRef(repo: string, ref: string): Promise<string> {
  // 失败不再静默（后端规 2.9）：静默回空树曾把"整个 diff 全部显示为新增"（0018 测试实测——
  // code.ts 在 HEAD 树里却被报成 new file）。至少要让排查者看得到是谁、为什么失败。
  const asTree = await git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{tree}`])
    .catch((error: unknown) => { console.error(`[review] treeOfRef(${repo}, ${ref}^{tree}) 失败：`, error instanceof Error ? error.message : String(error)); return ""; });
  if (asTree.trim() !== "") return asTree.trim();
  const peeled = await git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}^{tree}`])
    .catch((error: unknown) => { console.error(`[review] treeOfRef(${repo}, ${ref}^{commit}^{tree}) 失败：`, error instanceof Error ? error.message : String(error)); return ""; });
  return peeled.trim() !== "" ? peeled.trim() : EMPTY_TREE;
}

/**
 * 含未跟踪文件的 diff：临时 index 里把工作区快照成一棵树，再与基线树对比。
 * `-- .` 从仓根装（不跟 .gitignore 讨价——被忽略的本来就不该进检视）。
 */
async function diffIncludingUntracked(repo: string, range: string): Promise<string> {
  const baseTree = await treeOfRef(repo, range);
  const tmpIndex = join(tmpdir(), `lifeos-review-${process.pid}-${Date.now()}.idx`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  try {
    await run("git", ["-C", repo, "read-tree", baseTree], { env, timeout: 30_000, maxBuffer: 1024 * 1024 });
    // **skip-worktree 的路径不得进快照**（Task 0018 用户实测）：它们是本地特殊检出
    //（如开发 worktree 把 submodule 替换成软链），不代表代码事实；真实 index 上的
    // skip 标志不会跟到临时 index，add -A 会把 typechange 算进 diff。
    const skipWorktree = (await git(repo, ["ls-files", "-v"]))
      .split("\n").filter((line) => line.startsWith("S ")).map((line) => line.slice(2));
    const excludes = skipWorktree.map((path) => `:(exclude)${path}`);
    await run("git", ["-C", repo, "add", "-A", "--", ".", ...excludes], { env, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    const newTree = (await run("git", ["-C", repo, "write-tree"], { env, timeout: 60_000, maxBuffer: 1024 * 1024 })).stdout.trim();
    return await git(repo, ["diff", "--no-color", "--no-ext-diff", "--unified=3", baseTree, newTree]);
  } finally {
    await rm(tmpIndex, { force: true }).catch(() => undefined);
  }
}

/** 未跟踪文件清单（-z 输出；目录条目以 / 结尾，只留文件）。P2 的文件清单用。 */
export function parseUntracked(zOutput: string): string[] {
  const out: string[] = [];
  for (const entry of zOutput.split("\0")) {
    if (!entry.startsWith("?? ")) continue;
    const path = entry.slice(3);
    if (!path.endsWith("/")) out.push(path);
  }
  return out;
}

/** worktree 的对比基线分支：main → master → 首个本地分支。 */
async function baseBranchOf(repo: string): Promise<string | undefined> {
  for (const name of ["main", "master"]) {
    try {
      await git(repo, ["rev-parse", "--verify", name]);
      return name;
    } catch { /* 不存在，试下一个 */ }
  }
  return undefined;
}

/** 统一 patch 文本 → 文件级 diff（带全局限额；截断的文件保留在列表里并标记——用户要知道有个大文件）。 */
export function filesFromPatch(patch: string): ReviewFileDiff[] {
  const files: ReviewFileDiff[] = [];
  let totalLines = 0;
  let hitLimit = false;

  for (const section of splitPatchByFile(patch)) {
    if (files.length >= MAX_REVIEW_FILES) { hitLimit = true; break; }
    const meta = fileMetaOf(section.header);
    if (meta === undefined) continue;
    const hunks = parseUnifiedPatchToHunks(section.body);
    let additions = 0;
    let deletions = 0;
    let lines = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === "added") additions++;
        else if (line.type === "removed") deletions++;
        lines++;
      }
    }

    const remaining = MAX_REVIEW_DIFF_LINES - totalLines;
    if (lines <= remaining) {
      totalLines += lines;
      files.push({ ...meta, additions, deletions, hunks });
      continue;
    }
    // 行数超限：把 hunk 裁到放得下为止，文件保留 + truncated 标记
    const kept: typeof hunks = [];
    let keptLines = 0;
    let keptAdd = 0;
    let keptDel = 0;
    for (const hunk of hunks) {
      if (keptLines >= remaining) break;
      const budget = remaining - keptLines;
      if (hunk.lines.length <= budget) {
        kept.push(hunk);
        keptLines += hunk.lines.length;
        keptAdd += hunk.lines.filter((l) => l.type === "added").length;
        keptDel += hunk.lines.filter((l) => l.type === "removed").length;
        continue;
      }
      const clipped = { ...hunk, lines: hunk.lines.slice(0, budget) };
      kept.push(clipped);
      keptLines += budget;
      keptAdd += clipped.lines.filter((l) => l.type === "added").length;
      keptDel += clipped.lines.filter((l) => l.type === "removed").length;
      break;
    }
    totalLines += keptLines;
    files.push({ ...meta, additions: keptAdd, deletions: keptDel, hunks: kept, truncated: true });
    hitLimit = true;
    break;
  }
  // 文件数触顶（区别于行数触顶——那个已在循环内标）：给最后一个文件补标记
  const last = files[files.length - 1];
  if (hitLimit && last !== undefined && last.truncated !== true) last.truncated = true;
  return files;
}

type PatchSection = { header: string[]; body: string[] };

function splitPatchByFile(patch: string): PatchSection[] {
  const sections: PatchSection[] = [];
  let current: PatchSection | undefined;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = { header: [line], body: [] };
      sections.push(current);
      inHunk = false;
      continue;
    }
    if (current === undefined) continue;
    if (line.startsWith("@@")) inHunk = true;
    if (inHunk) current.body.push(line);
    else current.header.push(line);
  }
  return sections;
}

function fileMetaOf(headerLines: string[]): { path: string; kind: ReviewFileKind; status: ReviewFileDiff["status"]; oldPath?: string } | undefined {
  const diffLine = headerLines[0] ?? "";
  const m = /^diff --git a\/(.+) b\/(.+)$/.exec(diffLine);
  if (m === null) return undefined;
  const aPath = m[1];
  const bPath = m[2];
  const text = headerLines.join("\n");
  let status: ReviewFileDiff["status"] = "modified";
  let oldPath: string | undefined;
  if (/^new file mode/m.test(text)) status = "added";
  else if (/^deleted file mode/m.test(text)) status = "deleted";
  else if (/^copy from |^rename from /m.test(text)) {
    status = "renamed";
    const rm = /^rename from (.+)$/m.exec(text);
    if (rm !== null) oldPath = rm[1];
  }
  // 删除的文件展示其原路径；其余用 b 侧
  const path = status === "deleted" ? (aPath ?? "") : (bPath ?? aPath ?? "");
  return { path, kind: fileKindOf(path), status, ...(oldPath !== undefined ? { oldPath } : {}) };
}

/** 一次检视的完整 diff（两个源都算；单源失败不拖垮另一个，错误进 degraded——错误可见）。 */
export async function computeReviewDiff(taskDir: string): Promise<{ items: ReviewSourceDiff[]; error?: never } | { items?: never; error: ReviewError }> {
  if (!(await dirExists(taskDir))) {
    return { error: { code: "task_dir_not_found", message: `Task 目录不存在：${basename(taskDir)}`, status: 404 } };
  }
  const sources = await locateSources(taskDir);
  const items: ReviewSourceDiff[] = [];

  for (const source of sources) {
    if (source.kind === "worktree") {
      if (!source.exists) {
        items.push({ source, files: [], truncated: false });
        continue;
      }
      try {
        items.push(await computeWorktreeDiff(source));
      } catch (error) {
        const e = error as ReviewError;
        if (e.code === "no_vcs") {
          items.push({ source, files: [], truncated: false, degraded: "no_vcs" });
        } else {
          // 真正的 git 故障要可见：打日志（backend 2.9），items 里不带 degraded 字段
          console.error(`[review] worktree diff 失败 (${source.path}):`, e.message);
          items.push({ source, files: [], truncated: false });
        }
      }
    } else {
      // 文档源：有 home/ 工作区就走与代码同一套算法（含未跟踪文件），否则退回历史形态
      const homeWorktree = join(taskDir, HOME_DIR);
      if (await dirExists(homeWorktree)) {
        try {
          items.push(await computeWorktreeDiff({ ...source, path: homeWorktree }));
        } catch (error) {
          const e = error as ReviewError;
          console.error(`[review] home worktree diff 失败 (${homeWorktree}):`, e?.message ?? String(error));
          items.push({ source, files: [], truncated: false, degraded: "no_vcs" });
        }
      } else {
        items.push(await computeLifeosDiff(taskDir));
      }
    }
  }
  return { items };
}
