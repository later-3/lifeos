// 检视评论 → 可粘贴文本（S4-f · A20 复制 / A21 放进输入框）。
//
// 为什么复用 `annotation-message.ts` 而不另造一套（用户 2026-11-05 拍板）：
//   项目里已有 message 批注的**定稿格式**（Task 0003，用户 2026-11-03 逐条裁决）：
//     `1、你说的：「quote」` + `\n  -> note （我是疑问的语气！）`
//   检视评论只是锚点从"消息文本"变成"diff 行"，所以**只加位置头**，其余沿用。
//
// 位置头的格式取自 **difit** `utils/commentFormatting.ts:14-23`（`formatCommentLocation`）：`path:L3-L5`；
// 外层用 `【】` 与既有中文标点一致（用户 2026-11-03 的格式纪律：序号后用中文顿号、引用用 `「」`）。
// 多条拼接参照 difit `formatAllCommentThreadsPrompt`（`:150+`），但**不加 diff 表头**——
// 我们的位置头已带路径，加表头会与"检视对象条"重复。
//
// 纪律：纯函数，不读 DOM / localStorage / fetch——可穷举单测。

import { markById, toneIdsOf } from "./marks.ts";
import type { ReviewComment } from "./review-comment-store.ts";

/** 位置头：`README.md:L3` / `README.md:L3-L5`（difit `commentFormatting.ts:14-23` 同格式）。 */
export function commentLocation(comment: Pick<ReviewComment, "anchor">): string {
  const { path, start, end } = comment.anchor;
  const range = start === end ? `L${start}` : `L${start}-L${end}`;
  return `${path}:${range}`;
}

/** 语气措辞（与 message 批注同源：`marks.ts` 的 `say`；功能类标记不进括号）。 */
function toneWords(ids: readonly string[]): string | null {
  const tones = toneIdsOf(ids);
  if (tones.length === 0) return null;
  const says = tones
    .map((id) => markById(id)?.say)
    .filter((say): say is string => typeof say === "string" && say !== "");
  if (says.length === 0) return null;
  // 与 `annotation-message.ts` 的 `sayOf` 语义一致：多个用「、」连接
  return says.join("、");
}

/**
 * 一条评论 → 一行文本。
 *
 * @param ordinal 序号（1 起）。调用方负责按"实际发出的行"重排（与 message 批注同一约定）。
 * @returns 文本；**不会返回 null**——检视评论即使没有语气，位置本身就是信息（与 message 批注不同）。
 */
export function commentToLine(comment: ReviewComment, ordinal: number): string {
  const quote = (comment.anchor.snapshot ?? "").trim();
  // 没有原文快照就不输出空引号（`你说的：「」` 读起来像坏数据）
  const head = quote === ""
    ? `${ordinal}、【${commentLocation(comment)}】你说的`
    : `${ordinal}、【${commentLocation(comment)}】你说的：「${quote}」`;
  const note = comment.body.trim();
  const words = toneWords(comment.marks ?? []);
  const tail = words === null ? "" : `（${words}）`;
  /**
   * 回复也要复制出去（S4-h）。
   *
   * 参考 difit `utils/commentFormatting.ts:132-148`：`formatCommentThreadPrompt` 逐条输出
   * `Reply N (author)` + 正文——Agent 拿到时必须知道"这条意见后面已经有人答过什么"，
   * 否则会重复回答已经闭环的问题。
   * 我们沿用同一形状但更省字：`↳ author：正文`（中文正文里 `Reply 1 (x)` 读起来是英文夹生）。
   */
  const replies = (comment.replies ?? []).map((reply) => `  ↳ ${reply.author.kind === "user" ? "你" : reply.author.id}：${reply.body.trim()}`);
  // 没写正文就不出箭头（沿用 message 批注的既定规则，用户 2026-11-03）
  const first = note === "" ? `${head}${tail}` : `${head}\n  -> ${note}${words === null ? "" : ` （${words}）`}`;
  return [first, ...replies].join("\n");
}

/**
 * 多条评论 → 可粘贴的完整文本。
 *
 * 排序：按 `source` → `path` → `start`（文件内行号升序）——
 * 复制出去粘贴给 Agent 时，"按文件、按行"读起来最自然（difit 用 threads 原顺序，我们更严格）。
 *
 * @param options.includeResolved 默认 **false**：已关闭的不复制（GitHub 的 resolved 会话默认折叠，
 *        同理——已经处理完的意见不该再塞给 Agent）。
 */
export function commentsToText(
  comments: readonly ReviewComment[],
  options: { includeResolved?: boolean } = {},
): string {
  const includeResolved = options.includeResolved === true;
  const usable = comments.filter((comment) => includeResolved || comment.state !== "resolved");
  if (usable.length === 0) return "";
  const sorted = [...usable].sort((a, b) => {
    if (a.anchor.source !== b.anchor.source) return a.anchor.source === "worktree" ? -1 : 1;
    if (a.anchor.path !== b.anchor.path) return a.anchor.path.localeCompare(b.anchor.path);
    if (a.anchor.start !== b.anchor.start) return a.anchor.start - b.anchor.start;
    return a.anchor.end - b.anchor.end;
  });
  return sorted.map((comment, index) => commentToLine(comment, index + 1)).join("\n");
}
