// 检视批注的**草稿**持久化（S2·A5）——纯函数 + 一层 localStorage 适配。
//
// 问题：用户在 diff 上圈了三行、写了一句话，然后刷新/切文件/切 Task —— 草稿全丢。
// 依据（difit 的完整解，MIT）：
//  - `src/client/hooks/useLocalComments.ts`（383 行测试）+ `services/StorageService.ts`（398 行测试）：
//    草稿按 **commit 维度**存 localStorage，刷新后按同一 commit 取回；
//  - VS Code 侧：`PendingCommentThread{ range, isReply, comment{ body, cursor } }`
//    （`editor/common/languages.ts:2376-2387`）——草稿是**一等数据**，含 range 与光标。
//
// 我们的键：`taskDir | source | filePath | side | start-end`。
// 为什么带 taskDir：一个用户可能同时开多个 Task 的检视，草稿不能串（跨 Task 串草稿 = 灾难）。
// 为什么带 start-end 而不是只带文件：同一文件可以有多处草稿。
// 为什么不带 diff 的 hash：hash 会在"改了一个字"时全部作废，而草稿正需要活过这种改动；
//   "内容变了"由 `review-outdated.ts` 判，草稿本身保留、标注过期即可（用户可重新锚定）。
//
// 纪律：不读全局、不碰 React（storage 可注入，便于单测）。

import type { AnchorSide } from "./review-outdated.ts";

export const DRAFT_STORAGE_KEY = "lifeos.reviewDrafts";
/** 存储结构版本：形状变了就 +1，旧数据整批丢弃（不猜兼容）。 */
export const DRAFT_SCHEMA_VERSION = 1;
/** 单个 Task 最多保留多少条草稿（超出丢最旧的）。值取自"人在一个 Task 里最多同时挂几个念头"——不是性能限制。 */
export const MAX_DRAFTS_PER_TASK = 200;

/**
 * 草稿/批注的作者。
 *
 * **存 id，不存名字**（用户 2026-11-05 要求）：名字和头像会变，id 不会；
 * 展示时用 id 反查（用户 → `/api/profile`，Agent → `/api/agents`）。
 * 与 `annotations.ts` 的 `AnnotationAuthor` 同形状（kind + id），两处能互认。
 */
export type DraftAuthor = {
  kind: "user" | "agent";
  /** 用户 id（`users/<id>`）或 Agent id（`agents/<id>`）。 */
  id: string;
};

export type ReviewDraft = {
  /** 稳定 id（删除/更新用）。 */
  id: string;
  /** 谁写的。缺失 = 老数据，展示时按当前用户处理（不能因为"没记录"就不显示作者）。 */
  author?: DraftAuthor;
  taskDir: string;
  source: "worktree" | "lifeos";
  filePath: string;
  side: AnchorSide;
  /** 1 起；单行 start === end。 */
  start: number;
  end: number;
  /** 锚定当时这些行的原文（过期判定用，见 review-outdated.ts）。 */
  snapshot?: string;
  /** 用户写的话（可以为空串——"先圈上，等下再写"是正常动作）。 */
  note: string;
  /**
   * 语气/分类标记 id 数组（复用 `marks.ts` 的既有体系）。
   *
   * 为什么**不新增 severity 字段**（`knowledge/reference-comment-display.md` §3.5）：
   * 四家参考（VS Code / GitHub / difit / opencode）都没有 severity；我们已有语气体系，
   * 再加一套"严重/建议"会让一条评论挂两套标签，用户要选两次。
   * 现在的映射：批评≈严重问题、疑问≈待确认、鼓励≈做得好、同意≈认可。
   */
  marks?: string[];
  /** 创建时间（ISO）。 */
  createdAt: string;
  /**
   * 状态（S4-e · A18）：`draft` 草稿 / `open` 打开 / `resolved` 已关闭。
   * 由服务端的 `ReviewComment.state` 带过来；**浏览器本地草稿**没有这个字段（默认当作 draft）。
   */
  state?: "draft" | "open" | "resolved";
  /** 等谁处理（A18）：不是状态，是责任方。 */
  awaiting?: "user" | "agent" | null;
  /** 谁能关闭（A19）：`author` | `author-or-user`（默认后者）。 */
  canClose?: "author" | "author-or-user";
  /**
   * 线程里的回复（S4-h）。**只从服务端来**——本地草稿没有线程语义（离线时不能回复）。
   * 渲染层用它画出缩进的回复列表；`commentToDraft` 是唯一的填充点。
   */
  replies?: ReviewReply[];
};

/** 一条回复（与后端 `CommentReply` 同形状）。 */
export type ReviewReply = {
  id: string;
  author: DraftAuthor;
  body: string;
  createdAt: string;
  updatedAt?: string;
};

export type DraftKey = {
  taskDir: string;
  source: string;
  filePath: string;
  side: AnchorSide;
  start: number;
  end: number;
  /**
   * 作者 id（缺省 = 当前用户）。
   *
   * **必须进键**（用户 2026-11-05："同一行多个 agent 和用户评论呢？"）：
   * 同一段代码上，用户和两个 Agent 可以各写一条；若键不含作者，后写的会覆盖先写的。
   * 同一个人对同一段只保留一条（再写就是编辑），这是正确的。
   */
  authorId?: string;
};

/** 键的字符串形式（Map/localStorage 用）。作者分隔符用 `\u0001`，与字段分隔的 `\u0000` 区分。 */
export function draftKeyOf(key: DraftKey): string {
  const start = Math.min(key.start, key.end);
  const end = Math.max(key.start, key.end);
  const author = key.authorId ?? "";
  return `${key.taskDir}\u0000${key.source}\u0000${key.filePath}\u0000${key.side}\u0000${start}-${end}\u0001${author}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type StoredShape = { version: number; drafts: ReviewDraft[] };

const isString = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 校验一条草稿；不合法返回 undefined（坏条目跳过，不拖垮整批——同 annotations 的策略）。 */
function toDraftAuthor(raw: unknown): DraftAuthor | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  const id = r.id;
  if (kind !== "user" && kind !== "agent") return undefined;
  if (!isString(id) || id === "") return undefined;
  return { kind, id };
}

export function toReviewDraft(raw: unknown): ReviewDraft | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  const taskDir = r.taskDir;
  const source = r.source;
  const filePath = r.filePath;
  const side = r.side;
  const start = r.start;
  const end = r.end;
  const note = r.note;
  const createdAt = r.createdAt;
  if (!isString(id) || id === "") return undefined;
  if (!isString(taskDir) || taskDir === "") return undefined;
  if (source !== "worktree" && source !== "lifeos") return undefined;
  if (!isString(filePath) || filePath === "") return undefined;
  if (side !== "old" && side !== "new") return undefined;
  if (!isNum(start) || !isNum(end) || start < 1 || end < 1) return undefined;
  if (!isString(note)) return undefined;
  if (!isString(createdAt) || createdAt === "") return undefined;
  const snapshot = r.snapshot;
  const author = toDraftAuthor(r.author);
  const marksRaw = r.marks;
  const marks = Array.isArray(marksRaw) ? marksRaw.filter((m): m is string => isString(m) && m !== "") : undefined;
  return {
    id, ...(author !== undefined ? { author } : {}), taskDir, source: source as ReviewDraft["source"], filePath, side: side as AnchorSide,
    start: Math.min(start, end), end: Math.max(start, end),
    ...(isString(snapshot) ? { snapshot } : {}),
    ...(marks !== undefined && marks.length > 0 ? { marks } : {}),
    note, createdAt,
  };
}

/** 从存储里读全部草稿。坏 JSON / 版本不符 / 坏条目一律安全降级（不抛）。 */
export function readDrafts(storage: StorageLike): ReviewDraft[] {
  const text = storage.getItem(DRAFT_STORAGE_KEY);
  if (text === null || text === "") return [];
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return []; }
  if (typeof parsed !== "object" || parsed === null) return [];
  const shape = parsed as Partial<StoredShape>;
  if (shape.version !== DRAFT_SCHEMA_VERSION || !Array.isArray(shape.drafts)) return [];
  const out: ReviewDraft[] = [];
  for (const item of shape.drafts) {
    const draft = toReviewDraft(item);
    if (draft !== undefined) out.push(draft);
  }
  return out;
}

function writeDrafts(storage: StorageLike, drafts: readonly ReviewDraft[]): void {
  const shape: StoredShape = { version: DRAFT_SCHEMA_VERSION, drafts: [...drafts] };
  storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(shape));
}

/**
 * 落一条草稿（同键覆盖，不同键新增），并**按 Task 裁剪**到上限。
 * 覆盖时保留原 id 与 createdAt（它还是同一条草稿，只是内容变了）。
 */
export function upsertDraft(
  storage: StorageLike,
  draft: Omit<ReviewDraft, "id" | "createdAt"> & { id?: string; createdAt?: string },
  now: string = new Date().toISOString(),
): ReviewDraft {
  const all = readDrafts(storage);
  const key = draftKeyOf({ ...draft, authorId: draft.author?.id });
  const existing = all.find((item) => draftKeyOf({ ...item, authorId: item.author?.id }) === key);
  const next: ReviewDraft = {
    ...draft,
    id: draft.id ?? existing?.id ?? `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    createdAt: draft.createdAt ?? existing?.createdAt ?? now,
  };
  const rest = all.filter((item) => draftKeyOf({ ...item, authorId: item.author?.id }) !== key);
  // 按 Task 上限裁剪：超出时丢该 Task 里最旧的
  const sameTask = rest.filter((item) => item.taskDir === draft.taskDir);
  let kept = rest;
  if (sameTask.length + 1 > MAX_DRAFTS_PER_TASK) {
    const oldest = [...sameTask].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, sameTask.length + 1 - MAX_DRAFTS_PER_TASK);
    const drop = new Set(oldest.map((item) => item.id));
    kept = rest.filter((item) => !drop.has(item.id));
  }
  writeDrafts(storage, [...kept, next]);
  return next;
}

/** 删一条（提交或用户取消时）。不存在的 id 静默忽略。 */
export function removeDraft(storage: StorageLike, id: string): void {
  const all = readDrafts(storage);
  const next = all.filter((item) => item.id !== id);
  if (next.length !== all.length) writeDrafts(storage, next);
}

/** 某个 Task 的全部草稿，按创建时间升序（渲染顺序稳定）。 */
export function draftsOfTask(storage: StorageLike, taskDir: string): ReviewDraft[] {
  return readDrafts(storage)
    .filter((item) => item.taskDir === taskDir)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 某个文件+侧的草稿（渲染高亮用）。 */
export function draftsOfFile(storage: StorageLike, taskDir: string, source: string, filePath: string): ReviewDraft[] {
  return draftsOfTask(storage, taskDir).filter((item) => item.source === source && item.filePath === filePath);
}

/** 按 id 取（更新正文时用）。 */
export function findDraft(storage: StorageLike, id: string): ReviewDraft | undefined {
  return readDrafts(storage).find((item) => item.id === id);
}
