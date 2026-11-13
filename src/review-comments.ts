// 检视评论的持久化（S4-b）：评论**独立于对话**，绑"检视对象（taskId）"，落家目录 state。
//
// 为什么绑 taskId 而不是 commit sha / 分支（用户 2026-11-05 的核心问题："worktree 有新开发呢？"）：
//  - **Gerrit** 官方文档（`user-changeid.html`）：评论挂 change（`Change-Id`），一个 change 有多个
//    patch set —— "attach those 2 commits to the same change… **even across cherry-picks and rebases**"。
//    绑逻辑单元，代码重写/变基后评论不丢。
//  - **difit** 反例（`StorageService.ts:60-140`）：键 = `base..target` 的 commitish；它自己在
//    `:118-133` 写了警告 `Cannot normalize symbolic ref '@^' - may cause key collision`，且只存
//    localStorage（不跨设备、Agent 读不到）。
//  - 绑分支同样不行：分支会重命名/删除（`dev/x` → `dev/y` 评论就丢）。
//
// 存哪：`~/.lifeos/state/review-comments/<slug>.json`，与本仓 `src/session-views.ts:355-380` 完全同模式
// （`writeTextAtomic` + 目录 `AGENTS.md` 用 `wx` 不覆盖）。不进 git（D6 零 git 写）、不写进 Task 目录
// （否则程序会往用户文档目录写运行数据，还会被自己的 diff 检出）。
//
// 并发：**同一 Task 的写操作串行**（进程内 promise 链）。单机单进程，暂不处理跨进程。
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeTextAtomic } from "./atomic-file.ts";
import { resolveHome } from "./home.ts";

/** 每 Task 的评论上限（超出丢最旧）。与 `review-drafts.ts` 的 `MAX_DRAFTS_PER_TASK` 同值同理由。 */
export const MAX_COMMENTS_PER_TASK = 200;
/**
 * 结构版本：形状变了就 +1。
 *
 * **v2（S4-h）加 `replies`**：评论变成线程（根 + 若干回复）。
 * v1 文件**不丢弃**，读时补 `replies: []` 后按 v2 重写——用户已有的评论不能因为升级而消失
 * （这是与 `review-drafts.ts` 的差别：那边是浏览器草稿，丢了可重写；这里是用户与 Agent 的正式记录）。
 */
export const SCHEMA_VERSION = 2;

export const COMMENTS_DIR = join("state", "review-comments");

const COMMENTS_NOTE = `# review-comments · 检视评论

- 背景：检视模式（Task worktree diff 检视）的**评论数据**。评论绑"检视对象"（taskId），不绑对话、不绑对话/会话/浏览器。
- 内容：<slug>.json，每行一个 Task。slug = 可读前缀 + taskDir 全路径的 sha1 前 8 位（防同名撞车）。结构 \`{ version, taskId, taskDir, comments: [] }\`。
- 何时读：排查"评论为什么不显示/为什么串到别的 Task"时；或想直接看某个 Task 有哪些评论。
- 怎么用：不要手改（写入是原子替换，手改会被覆盖）；删除某个文件等于清空该 Task 的评论。不入库。
`;

export type CommentAuthor = { kind: "user" | "agent"; id: string };

/**
 * 线程里的一条回复（S4-h · A4-余）：**“Agent 说明他怎么闭环的”就写在这里**。
 *
 * 为什么回复不带 `marks` / `awaiting` / `canClose`（与根评论不同形状）：
 *  - 语气标记是“我这条意见的性质”，属于**线程根**；每条回复各挂一套会让复制格式膨胀三倍；
 *  - `awaiting` 是线程级的“现在等谁”，回复的动作会**翻转**它（交棒），不是每条各自的属性；
 *  - 关闭权限也是线程级的（只有提出者或用户能关整条线程），不是“关掉某一条回复”。
 *
 * 依据：VS Code `languages.ts:2266-2294`（线程级 state/canReply）与 `:2363-2376`（条目级 body/author）
 * 就是**分两层**的；difit 的 `DiffCommentMessage`（`types/diff.ts:104-110`）也只有 body/author/时间。
 */
export type CommentReply = {
  id: string;
  author: CommentAuthor;
  body: string;
  createdAt: string;
  /** 最后一次编辑时间（编辑过才有；与 `createdAt` 同则视为从未编辑） */
  updatedAt?: string;
};

export type CommentAnchor = {
  /** 哪个源 */
  source: "worktree" | "lifeos";
  /** 相对路径（不是绝对路径，跨机器仍有效） */
  path: string;
  side: "old" | "new";
  /** 1 起；单行时 start === end */
  start: number;
  end: number;
  /** 原文摘录（兜底重锚用） */
  quote?: string;
  /** 锚定当时这些行的原文（过期判定用，见 frontend/src/review-outdated.ts） */
  snapshot?: string;
  /**
   * 锚定时的对比基线 sha（**只作显示与过期判定增强，不是主键**）。
   * 有了它，日志/界面能说清"这条是针对 abc1234 时的代码提的"。
   */
  baseCommit?: string;
};

export type ReviewComment = {
  id: string;
  taskId: string;
  author: CommentAuthor;
  anchor: CommentAnchor;
  body: string;
  /** 语气标记（复用 `marks.ts` 体系；D20 不新增 severity） */
  marks: string[];
  state: "draft" | "open" | "resolved";
  /**
   * 现在等谁处理（**不是状态**，是责任方）。
   *
   * 依据（phases/S4ef-comment-state-copy-plan.md §3）：四家参考的状态都是二态（unresolved/resolved），
   * "需要回复 / 需要 Agent 解决"本质是"等谁"，所以单独一个字段，而不是把状态扩成四态
   * （3 状态 × 2 责任方 = 6 种组合，测不完）。
   */
  awaiting: "user" | "agent" | null;
  /**
   * 谁能关闭。**数据字段**（VS Code `canReply: boolean | CommentAuthorInformation` 的同一思路，
   * `languages.ts:2283`）：不靠 UI 猜，服务端按它校验。
   *
   * - `author-or-user`（默认）：提出者 **或** 用户本人（= 用户 2026-11-05 的规则）
   * - `author`：只有提出者
   */
  canClose: "author" | "author-or-user";
  /**
   * 线程里的回复（S4-h）：`body` 是根的“第一条发言”，这里只放**后来追加的**。
   * 顺序 = 追加顺序（不排序、不去重）；渲染时第一条缩进一层（difit `CommentThreadCard.tsx:335-350`
   * 的 `ml-4 border-l pl-3` 同构）。
   */
  replies: CommentReply[];
  createdAt: string;
  updatedAt: string;
  /** 关闭时间/关闭人（`state === "resolved"` 时才有） */
  resolvedAt?: string;
  resolvedBy?: CommentAuthor;
  /** 发起人（对话轮次）——可选，仅供追溯；评论本身不依赖它。 */
  origin?: { kind: "review-panel" | "agent-tool"; sessionId?: string };
};

type StoredFile = { version: number; taskId: string; taskDir: string; comments: unknown[] };

const isString = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Task 目录 → 文件 slug。
 *
 * **可读前缀 + 全路径 sha1 前 8 位**：
 * - 可读前缀方便人肉 locate（`0010-检视模式`）；
 * - 但两个不同父目录下可能有同名 Task（测试夹具/多项目），所以必须带全路径哈希；
 * - 长度截到 64 以内（文件名安全）。
 */
export function taskSlugOf(taskDir: string): string {
  const base = taskDir.replace(/\/+$/, "").split("/").pop() ?? "task";
  const readable = base.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const hash = createHash("sha1").update(taskDir).digest("hex").slice(0, 8);
  const head = readable === "" ? "task" : readable;
  return `${head}-${hash}`.slice(0, 64);
}

/** 某个 Task 的评论文件绝对路径（不保证存在）。 */
export function commentsFileOf(taskDir: string): string {
  return join(resolveHome(), COMMENTS_DIR, `${taskSlugOf(taskDir)}.json`);
}

/** 某个 Task 的评论文件目录（判存在/写说明文件用）。 */
export function commentsDirOf(taskDir: string): string {
  return join(resolveHome(), COMMENTS_DIR);
}

/**
 * 评论的业务键：task + 源 + 文件 + 侧 + 行范围 + 作者。
 *
 * **必须含作者 id**（用户 2026-11-05："同一行多个 agent 和用户评论呢？"）：
 * 同一段代码上，用户和 N 个 Agent 可以各写一条；不含作者则后写覆盖先写。
 * 同一个人对同一段再写 = 编辑（覆盖），这是正确语义。
 * 字段分隔用 `\u0000`、作者分隔用 `\u0001`（与 `review-drafts.ts` 同约定）。
 */
export function commentKeyOf(c: {
  taskId: string;
  author: CommentAuthor;
  anchor: CommentAnchor;
}): string {
  const start = Math.min(c.anchor.start, c.anchor.end);
  const end = Math.max(c.anchor.start, c.anchor.end);
  return [
    c.taskId, c.anchor.source, c.anchor.path, c.anchor.side, `${start}-${end}`,
  ].join("\u0000") + `\u0001${c.author.kind}:${c.author.id}`;
}

const toAuthor = (raw: unknown): CommentAuthor | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "user" && r.kind !== "agent") return undefined;
  if (!isString(r.id) || r.id === "") return undefined;
  return { kind: r.kind, id: r.id };
};

const toAnchor = (raw: unknown): CommentAnchor | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.source !== "worktree" && r.source !== "lifeos") return undefined;
  if (!isString(r.path) || r.path === "") return undefined;
  if (r.side !== "old" && r.side !== "new") return undefined;
  const start = r.start;
  const end = r.end;
  if (!isNum(start) || !isNum(end) || start < 1 || end < 1) return undefined;
  return {
    source: r.source,
    path: r.path,
    side: r.side,
    // 归一：倒序输入不产生 start > end 的锚点（前端 rangeOf 已归一，这里是存储层的兜底）
    start: Math.min(start, end),
    end: Math.max(start, end),
    ...(isString(r.quote) ? { quote: r.quote } : {}),
    ...(isString(r.snapshot) ? { snapshot: r.snapshot } : {}),
    ...(isString(r.baseCommit) && r.baseCommit !== "" ? { baseCommit: r.baseCommit } : {}),
  };
};

const toReply = (raw: unknown): CommentReply | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (!isString(r.id) || r.id === "") return undefined;
  const author = toAuthor(r.author);
  if (author === undefined) return undefined;
  if (!isString(r.body)) return undefined;
  const createdAt = isString(r.createdAt) && r.createdAt !== "" ? r.createdAt : new Date().toISOString();
  const updatedAt = isString(r.updatedAt) && r.updatedAt !== "" && r.updatedAt !== createdAt ? r.updatedAt : undefined;
  return { id: r.id, author, body: r.body, createdAt, ...(updatedAt !== undefined ? { updatedAt } : {}) };
};

/** 校验并归一化一条评论；不合法返回 undefined（调用方跳过——坏条目不能拖垮整批）。 */
export function toReviewComment(raw: unknown): ReviewComment | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  const taskId = r.taskId;
  if (!isString(id) || id === "") return undefined;
  if (!isString(taskId) || taskId === "") return undefined;
  const author = toAuthor(r.author);
  if (author === undefined) return undefined;
  const anchor = toAnchor(r.anchor);
  if (anchor === undefined) return undefined;
  if (!isString(r.body)) return undefined;
  const state = r.state === "open" || r.state === "resolved" || r.state === "draft" ? r.state : "draft";
  // awaiting：三值（user/agent/null）；非法值落回 null（不污染 state）
  // 注意：**关闭时不抹掉存储值**（它是“最后在等谁”的事实）；读出来的“已关闭不再等谁”
  // 由 `awaitingOf` 统一派生（一处实现），不靠在存储层提前归一。
  const awaiting = r.awaiting === "user" || r.awaiting === "agent" ? r.awaiting : null;
  // canClose：二值；非法值落回默认（用户规则：提出者或用户本人）
  const canClose = r.canClose === "author" ? "author" : "author-or-user";
  const resolvedAt = isString(r.resolvedAt) && r.resolvedAt !== "" ? r.resolvedAt : undefined;
  const resolvedBy = toAuthor(r.resolvedBy);
  const createdAt = isString(r.createdAt) && r.createdAt !== "" ? r.createdAt : new Date().toISOString();
  const updatedAt = isString(r.updatedAt) && r.updatedAt !== "" ? r.updatedAt : createdAt;
  const marks = Array.isArray(r.marks)
    ? r.marks.filter((m): m is string => isString(m) && m !== "")
    : [];
  const originRaw = r.origin;
  let origin: ReviewComment["origin"];
  if (typeof originRaw === "object" && originRaw !== null) {
    const o = originRaw as Record<string, unknown>;
    if (o.kind === "review-panel" || o.kind === "agent-tool") {
      origin = { kind: o.kind, ...(isString(o.sessionId) ? { sessionId: o.sessionId } : {}) };
    }
  }
  // replies：坏条目逐条跳过（一条坏数据不能把整个线程拖没）
  const replies = Array.isArray(r.replies)
    ? r.replies.map(toReply).filter((reply): reply is CommentReply => reply !== undefined)
    : [];
  return {
    id, taskId, author, anchor, body: r.body, marks, state, awaiting, canClose, replies, createdAt, updatedAt,
    ...(origin !== undefined ? { origin } : {}),
    ...(resolvedAt !== undefined ? { resolvedAt } : {}),
    ...(resolvedBy !== undefined ? { resolvedBy } : {}),
  };
}

/**
 * 读某个 Task 的评论。任何异常都降级成空数组（评论丢了可以重写，接口不能 500）。
 * 坏条目逐条跳过（同 `annotationsOf` / `readDrafts` 的策略）。
 */
export async function readComments(taskDir: string): Promise<ReviewComment[]> {
  const file = commentsFileOf(taskDir);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [];  // 不存在 = 空（正常状态）
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];  // 坏 JSON = 空（不让一个坏文件把整个面板拖死）
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const shape = parsed as Partial<StoredFile>;
  /**
   * 版本兼容：**v1 不丢**（S4-h）。
   * v1 = 还没有 `replies` 的旧评论；读时由 `toReviewComment` 补成 `replies: []`，
   * 下次写入自动变成 v2。这里只拦“不认识的新版本”（未来 v3 出现时，v2 的代码不该猜它的形状）。
   */
  if (shape.version !== 1 && shape.version !== SCHEMA_VERSION || !Array.isArray(shape.comments)) return [];
  const out: ReviewComment[] = [];
  for (const item of shape.comments) {
    const comment = toReviewComment(item);
    if (comment !== undefined) out.push(comment);
  }
  return out;
}

// —— 同一 Task 串行写（进程内；单机单进程足够，跨进程不在本期）——
const chains = new Map<string, Promise<void>>();
function serialize(taskDir: string, work: () => Promise<void>): Promise<void> {
  const key = commentsFileOf(taskDir);
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(work, work).catch(() => undefined);
  chains.set(key, next);
  return next;
}

/** 整份写入（迁移/批量用）。会校验 taskId 一致、裁剪上限、原子替换。 */
export async function writeComments(taskDir: string, taskId: string, comments: readonly ReviewComment[]): Promise<void> {
  const valid = comments
    .filter((c) => c.taskId === taskId)
    .map((c) => toReviewComment(c))
    .filter((c): c is ReviewComment => c !== undefined);
  // 上限裁剪：丢最旧（按 createdAt 升序取尾部）
  const trimmed = valid.length <= MAX_COMMENTS_PER_TASK
    ? valid
    : [...valid].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(valid.length - MAX_COMMENTS_PER_TASK);
  const file = commentsFileOf(taskDir);
  const dir = join(file, "..");
  const body: StoredFile = { version: SCHEMA_VERSION, taskId, taskDir, comments: trimmed };
  await serialize(taskDir, async () => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeTextAtomic(file, JSON.stringify(body, null, 2) + "\n");
    // 协议 §5.2：运行目录也要有说明文件；`wx` 不覆盖用户改过的
    await writeFile(join(dir, "AGENTS.md"), COMMENTS_NOTE, { flag: "wx", mode: 0o600 }).catch(() => undefined);
  });
}

export type UpsertInput = Omit<ReviewComment, "id" | "createdAt" | "updatedAt" | "state" | "marks" | "awaiting" | "canClose" | "replies"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  state?: ReviewComment["state"];
  marks?: string[];
  awaiting?: ReviewComment["awaiting"];
  canClose?: ReviewComment["canClose"];
  /** 显式传时覆盖（Agent/迁移可带）；不传则**保留原 replies**（编辑不能把回复清掉） */
  replies?: CommentReply[];
};

/**
 * 新增或更新一条（同键覆盖）。
 *
 * 覆盖时**保留原 id 与 createdAt**：它还是同一条评论，只是内容（body/marks/anchor 的 snapshot）变了。
 * 这也是"编辑"的语义——不需要单独的 update 接口。
 */
export async function upsertComment(taskDir: string, input: UpsertInput, now: string = new Date().toISOString()): Promise<ReviewComment> {
  const all = await readComments(taskDir);
  const key = commentKeyOf({ taskId: input.taskId, author: input.author, anchor: input.anchor });
  const existing = all.find((c) => commentKeyOf(c) === key);
  const candidate: ReviewComment = {
    ...input,
    id: input.id ?? existing?.id ?? newId(),
    marks: input.marks ?? existing?.marks ?? [],
    state: input.state ?? existing?.state ?? "open",
    awaiting: input.awaiting !== undefined ? input.awaiting : (existing?.awaiting ?? null),
    canClose: input.canClose ?? existing?.canClose ?? "author-or-user",
    // 回复不随“编辑正文”消失：不传就保留原值（S4h·4 的回归）
    replies: input.replies ?? existing?.replies ?? [],
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
    updatedAt: now,
  };
  const validated = toReviewComment(candidate);
  if (validated === undefined) throw new Error("评论字段不合法（需要 taskId/author/anchor/body）");
  const rest = all.filter((c) => commentKeyOf(c) !== key);
  await writeComments(taskDir, input.taskId, [...rest, validated]);
  return validated;
}

/** 删除一条（幂等）。 */
export async function removeComment(taskDir: string, id: string): Promise<boolean> {
  const all = await readComments(taskDir);
  const next = all.filter((c) => c.id !== id);
  if (next.length === all.length) return false;
  await writeComments(taskDir, all[0]?.taskId ?? "", next);
  return true;
}

/** 清空某个 Task 的评论（测试/排障用；也用于用户"清空这个 Task 的检视意见"）。 */
export async function clearComments(taskDir: string): Promise<void> {
  const file = commentsFileOf(taskDir);
  await rm(file, { force: true });
}

/**
 * 校验**写入入参**（`id` 可选：新增时由 `upsertComment` 生成；`state`/`marks` 也可省略）。
 *
 * 为什么不复用 `toReviewComment`：那个是给"已落盘记录"用的，`id` 必填。
 * 新增评论时前端还没有 id，用它校验会把合法请求判成 400（S4bAPI·3 踩过）。
 */
export function toCommentInput(
  raw: unknown,
  taskId: string,
): (UpsertInput & { taskId: string }) | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const author = toAuthor(r.author);
  if (author === undefined) return undefined;
  const anchorOk = toAnchor(r.anchor);
  if (anchorOk === undefined) return undefined;
  if (!isString(r.body)) return undefined;
  const marks = Array.isArray(r.marks)
    ? r.marks.filter((m): m is string => isString(m) && m !== "")
    : undefined;
  const state = r.state === "open" || r.state === "resolved" || r.state === "draft" ? r.state : undefined;
  // awaiting / canClose 也要透传：否则前端 POST 带了也不生效（实测 badge 一直是 null）
  const awaiting = r.awaiting === "user" || r.awaiting === "agent" ? r.awaiting : undefined;
  const canClose = r.canClose === "author" ? "author" as const : r.canClose === "author-or-user" ? "author-or-user" as const : undefined;
  return {
    ...(isString(r.id) && r.id !== "" ? { id: r.id } : {}),
    taskId,
    author,
    anchor: anchorOk,
    body: r.body,
    ...(marks !== undefined ? { marks } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(awaiting !== undefined ? { awaiting } : {}),
    ...(canClose !== undefined ? { canClose } : {}),
  };
}

/** 评论总数（日志/统计用，避免调用方自己 reduce）。 */
export function countByFile(comments: readonly ReviewComment[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of comments) out[c.anchor.path] = (out[c.anchor.path] ?? 0) + 1;
  return out;
}

/** 列出当前家目录下所有有评论的 Task slug（诊断用）。 */
export async function listCommentFiles(): Promise<string[]> {
  try {
    const entries = await readdir(join(resolveHome(), COMMENTS_DIR));
    return entries.filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

function newId(): string {
  return `rc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── 状态机与权限（S4-e · A18/A19）────────────────────────────────────────────
//
// 参考（phases/S4ef-comment-state-copy-plan.md §3）：
//  - GitHub/GitLab：二态 unresolved/resolved；关闭权限 "PR 作者或写权限"（官方文档原文）；
//  - VS Code：`CommentThreadState` 二态 + `canReply` **数据字段**表达"谁能动"；
//  - difit：无状态。
// 我们的规则（用户 2026-11-05）：三态 draft/open/resolved；`awaiting` 表达"等谁"（不是状态）；
//   **只有提出者或用户本人能关闭**（用户是项目所有者，等同 GitHub 的 "write access"）。

/**
 * 这条评论是否已关闭。
 * UI 用它决定显示（而不是自己拼 `state === "resolved"`）——判断只有一处实现。
 */
export function isClosed(comment: Pick<ReviewComment, "state">): boolean {
  return comment.state === "resolved";
}

/**
 * 现在等谁处理。已关闭的评论**不再等谁**（返回 null）。
 * 依据：关闭意味着"这一轮讨论结束"，保留 awaiting 只会让界面显示"等 Agent"而实际已关。
 */
export function awaitingOf(comment: Pick<ReviewComment, "state" | "awaiting">): ReviewComment["awaiting"] {
  if (isClosed(comment)) return null;
  return comment.awaiting ?? null;
}

/**
 * 谁能关闭这条评论。
 *
 * 规则（数据字段 + 一个纯函数，可穷举）：
 *  - `canClose === "author"` → 只有提出者；
 *  - `canClose === "author-or-user"`（默认）→ 提出者 **或** 任何 `kind === "user"` 的调用方。
 *    为什么 user 不用比对 id：本项目是"一个家目录一个使用者"（protocol §3.7 / 单用户），
 *    user 就是所有者；将来多用户时这里改成比对 id 即可（规则收在一个函数里）。
 *
 * 为什么 Agent 之间不能互相关闭：用户原话"只能由用户自己或者是提出评论的 agent 关闭"——
 * 别的 Agent 关掉别人的评论，会让提出者失去上下文。
 */
export function canCloseComment(
  comment: Pick<ReviewComment, "author" | "canClose">,
  by: CommentAuthor,
): boolean {
  const isAuthor = comment.author.kind === by.kind && comment.author.id === by.id;
  if (isAuthor) return true;
  if (comment.author.kind === "user" && by.kind === "user") return true;   // 用户本人（单用户家目录）
  return comment.canClose === "author-or-user" && by.kind === "user";
}

/**
 * 改状态（open ↔ resolved ↔ draft），**带权限校验**。
 *
 * @returns 更新后的评论；id 不存在返回 undefined（幂等，不抛）。
 * @throws 关闭他人评论且无权限时抛错（错误信息说清"谁不能关"）。
 */
export async function setCommentState(
  taskDir: string,
  id: string,
  state: ReviewComment["state"],
  by: CommentAuthor,
  now: string = new Date().toISOString(),
): Promise<ReviewComment | undefined> {
  const all = await readComments(taskDir);
  const current = all.find((c) => c.id === id);
  if (current === undefined) return undefined;

  // 关闭（→ resolved）要校验权限；重开（→ open/draft）允许作者或用户
  if (state === "resolved" && !canCloseComment(current, by)) {
    throw new Error(`不能关闭：只有提出者 ${current.author.kind}:${current.author.id} 或用户本人可以关闭这条评论`);
  }
  if (state !== "resolved") {
    const isAuthor = current.author.kind === by.kind && current.author.id === by.id;
    if (!isAuthor && by.kind !== "user") {
      throw new Error(`不能重开：只有提出者 ${current.author.kind}:${current.author.id} 或用户本人可以重开这条评论`);
    }
  }

  // exactOptionalPropertyTypes：可选字段用"条件展开"赋值/清除，不写 undefined
  const { resolvedAt: _dropAt, resolvedBy: _dropBy, ...rest } = current;
  const cleaned: ReviewComment = state === "resolved"
    ? { ...rest, state, updatedAt: now, resolvedAt: now, resolvedBy: by }
    : { ...rest, state, updatedAt: now };

  await writeComments(taskDir, current.taskId, all.map((c) => (c.id === id ? cleaned : c)));
  return cleaned;
}

/** `settleComment` = 关闭（语义化别名，UI 里读起来更清楚）。 */
export async function settleComment(
  taskDir: string,
  id: string,
  by: CommentAuthor,
  now?: string,
): Promise<ReviewComment | undefined> {
  return setCommentState(taskDir, id, "resolved", by, now);
}

// ── 线程：回复（S4-h · A4-余）──────────────────────────────────────────────
//
// 为什么回复是这条链路的必需环节（用户 2026-11-05 原话）：
//   “Agent 去闭环了，他肯定要回复一下他是怎么闭环的，然后我们再去查看，再把这个评论给关掉。”
// 所以三条规则不能少：① 已关闭的线程不能回复（先重开）；② 回复**翻转 awaiting**（交棒）；
// ③ 权限不变（作者或用户能关，别的 Agent 只能回复）。
//
// 参考：difit `useDiffComments.ts:234-258`（`replyToThread` 尾部追加）、
// Gitea `routers/api/v1/repo/pull_review.go:207-278`（回复是独立 Comment 行，共享 ReviewID）、
// VS Code `commentReply.ts:39-70`（回复框是线程内的一个编辑器）。

/** 已关闭的线程不能回复（Gitea 已解决会话默认隐藏，GitHub 要 Unresolve 才出回复框）。 */
export function canReplyToComment(comment: Pick<ReviewComment, "state">): boolean {
  return comment.state !== "resolved";
}

/** 回复会“交棒”：Agent 回 → 等用户；用户回 → 等 Agent。 */
export function awaitingAfterReply(
  author: Pick<CommentAuthor, "kind">,
): ReviewComment["awaiting"] {
  return author.kind === "agent" ? "user" : "agent";
}

function newReplyId(): string {
  return `rr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 给某条评论追加一条回复。
 *
 * @throws 线程不存在（`找不到评论`）/ 已关闭（`已关闭的评论不能回复`）/ body 为空 / author 不合法。
 */
export async function addReply(
  taskDir: string,
  commentId: string,
  reply: { author: CommentAuthor; body: string },
  now: string = new Date().toISOString(),
): Promise<ReviewComment> {
  const author = toAuthor(reply.author);
  if (author === undefined) throw new Error("回复的 author 不合法（需要 kind=user|agent 与非空 id）");
  if (typeof reply.body !== "string" || reply.body.trim() === "") throw new Error("回复内容不能为空（body）");

  const all = await readComments(taskDir);
  const current = all.find((c) => c.id === commentId);
  if (current === undefined) throw new Error(`找不到评论 ${commentId}`);
  if (!canReplyToComment(current)) throw new Error("已关闭的评论不能回复，请先重开");

  const next: ReviewComment = {
    ...current,
    replies: [...current.replies, { id: newReplyId(), author, body: reply.body, createdAt: now }],
    // 交棒：有了新回复，“现在等谁”就换人了
    awaiting: awaitingAfterReply(author),
    updatedAt: now,
  };
  await writeComments(taskDir, current.taskId, all.map((c) => (c.id === commentId ? next : c)));
  return next;
}

/**
 * 编辑一条回复：**只改那条的正文**，id 与 createdAt 不变（difit `updateMessage` 同语义）。
 *
 * 权限：只有作者本人或用户能改（不额外引入字段——与 `canClose` 同一套“作者或用户”口径）。
 * 已关闭的线程仍可编辑自己的话（关闭是为了结束讨论，不是为了把错误的话锁在石头上）。
 */
export async function upsertReply(
  taskDir: string,
  commentId: string,
  reply: { id: string; author: CommentAuthor; body: string },
  now: string = new Date().toISOString(),
): Promise<ReviewComment> {
  if (typeof reply.body !== "string" || reply.body.trim() === "") throw new Error("回复内容不能为空（body）");
  const all = await readComments(taskDir);
  const current = all.find((c) => c.id === commentId);
  if (current === undefined) throw new Error(`找不到评论 ${commentId}`);
  const target = current.replies.find((r) => r.id === reply.id);
  if (target === undefined) throw new Error(`找不到回复 ${reply.id}`);
  assertCanEditReply(target, reply.author);

  const next: ReviewComment = {
    ...current,
    replies: current.replies.map((r) =>
      r.id === reply.id ? { ...r, body: reply.body, updatedAt: now } : r),
    updatedAt: now,
  };
  await writeComments(taskDir, current.taskId, all.map((c) => (c.id === commentId ? next : c)));
  return next;
}

/**
 * 删一条回复（幂等）。
 *
 * 权限同编辑：作者本人或用户。别的 Agent 删不掉（用户原话“只能由用户自己或者是提出评论的 agent 关闭”）。
 * @throws 权限不足；id 不存在则不抛（返回原评论，方便重试）。
 */
export async function removeReply(
  taskDir: string,
  commentId: string,
  replyId: string,
  by: CommentAuthor,
): Promise<ReviewComment> {
  const all = await readComments(taskDir);
  const current = all.find((c) => c.id === commentId);
  if (current === undefined) throw new Error(`找不到评论 ${commentId}`);
  const target = current.replies.find((r) => r.id === replyId);
  if (target === undefined) return current;   // 幂等：已经不在 = 目标已达成
  assertCanEditReply(target, by);
  const next: ReviewComment = {
    ...current,
    replies: current.replies.filter((r) => r.id !== replyId),
    updatedAt: new Date().toISOString(),
  };
  await writeComments(taskDir, current.taskId, all.map((c) => (c.id === commentId ? next : c)));
  return next;
}

/** 回复的作者本人或用户可改/可删（与 `canCloseComment` 同口径：整个家目录只有一个使用者）。 */
function assertCanEditReply(reply: CommentReply, by: CommentAuthor): void {
  const isAuthor = reply.author.kind === by.kind && reply.author.id === by.id;
  if (isAuthor || by.kind === "user") return;
  throw new Error(`只有回复作者 ${reply.author.kind}:${reply.author.id} 或用户本人可以修改/删除这条回复`);
}

/**
 * 手动设置“现在等谁”（G1 的落点：用户/Agent 可以在界面上说“这条等你”或“这条等 Agent”）。
 *
 * @throws awaiting 不是 user/agent/null；id 不存在返回 undefined（幂等）。
 */
export async function setCommentAwaiting(
  taskDir: string,
  id: string,
  awaiting: ReviewComment["awaiting"],
  _by: CommentAuthor,
  now: string = new Date().toISOString(),
): Promise<ReviewComment | undefined> {
  if (awaiting !== "user" && awaiting !== "agent" && awaiting !== null) {
    throw new Error("awaiting 必须是 user / agent / null");
  }
  const all = await readComments(taskDir);
  const current = all.find((c) => c.id === id);
  if (current === undefined) return undefined;
  const next: ReviewComment = { ...current, awaiting, updatedAt: now };
  await writeComments(taskDir, current.taskId, all.map((c) => (c.id === id ? next : c)));
  return next;
}

/**
 * 未闭环的线程 = **某人的待办**（用户 2026-11-05：“他有很多还没有闭环的，那只是他的 TODO”）。
 *
 * 口径：`state !== "resolved"` 且（`awaiting === who` 或 `awaiting === null`）——
 * 没人认领的也算他的（他得看）。已关闭的不算。
 *
 * 为什么**不按作者再筛一道**（曾经想筛）：`awaiting` 只有 `user` / `agent` 两档，
 * 没有“指派给哪个 Agent”——用户提的评论说“等 Agent”时，任何 Agent 都可能接手去改。
 * 若按作者筛，用户提的单就会对所有人变隐形（而它恰恰是最主要的一类）。
 * 真要“指派给具体 Agent”，那是一个新字段（先有拍板再加，协议 §3.13 不自创约束）。
 */
export function pendingFor(
  comments: readonly ReviewComment[],
  who: "user" | "agent",
  /** 当前检视对象的 (source,path) 集（0018 用户）：口径修正——**失锚孤儿不算待办**
   *  （评论绑检视时刻的 diff，合并/改动后文件不在 diff 里，跳转也看不到卡片）；
   *  同理空正文的草稿（点了＋没写就丢下）不算。不传 = 旧口径（全部计入）。 */
  available?: ReadonlySet<string>,
): ReviewComment[] {
  return comments.filter((c) => c.state !== "resolved"
    && (c.awaiting === null || c.awaiting === who)
    && (available === undefined || isCountable(c, available)));
}

/** 空正文的草稿 = 点了"＋"没写就丢下，不算意见（0018 实测计入会误导）。 */
export function isEmptyDraft(comment: ReviewComment): boolean {
  return (comment.state ?? "draft") === "draft" && comment.body.trim() === "";
}

/** 这条评论**计不计数**（总条数/待办/跳转）：空草稿不算；锚不在当前 diff 的文件里 = 失锚孤儿不算。 */
export function isCountable(comment: ReviewComment, available: ReadonlySet<string>): boolean {
  if (isEmptyDraft(comment)) return false;
  const a = comment.anchor;
  return available.has(`${a.source}\u0000${a.path}`);
}
