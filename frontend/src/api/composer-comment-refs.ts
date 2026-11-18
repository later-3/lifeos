// 输入框里的"检视评论引用"（A8 + G3）：把评论作为**结构化条目**挂到输入框，而不是拼成一坨文字。
//
// 为什么不再拼纯文本（用户 2026-11-07/08 要求的"比他们做得好"）：
//   S4-h 的"发送"是把 `1、【path:Lx-Ly】你说的：「…」` 追加进输入框。多条时会糊在一起，
//   想去掉其中一条只能在文字里手动选（opencode 的 `composer.attach` 是 chip，可单独删——
//   `packages/app/src/composer/schema.ts:152-190` 的 `ContextItem` / `packages/app/src/composer/editor/editor.tsx:770-800`
//   的 `data-slot="composer-attachments"`）。
//
// 我们的做法：**引用归引用、正文归正文**。
//   - 输入框里显示 chip（位置头 + 首行预览 + ✕），可逐条移除；
//   - 真正发送时，由 `commentsToText()` 合成文本（**同一条实现**，不新造第二套格式）；
//   - chip 列表是 composer 级状态：发送成功清空，失败回填（与图片附件同一套补偿）。
//
// 纪律：本文件是**纯函数**（不读 DOM、不碰 React），可穷举单测。

import type { ReviewComment } from "./review-comment-store.ts";

/** 一条待发送的评论引用。保留完整评论对象：发送时要它合成文本，chip 上要它画位置与预览。 */
export type CommentRef = ReviewComment;

/** chip 上显示的位置头（`README.md:L3-L5`）——与复制/发送文本里的位置头同一形状。 */
export function commentRefLabel(ref: CommentRef): string {
  const { path, start, end } = ref.anchor;
  return `${path}:${start === end ? `L${start}` : `L${start}-L${end}`}`;
}

/** chip 上的预览：正文首行，超过 40 字截断（chip 只有一行宽）。 */
export function commentRefPreview(ref: CommentRef): string {
  const first = (ref.body.trim().split("\n")[0] ?? "").trim();
  if (first === "") return "（无正文）";
  return first.length <= 40 ? first : `${first.slice(0, 40)}…`;
}

/** chip 的稳定键：同一线程只挂一次（重复点「发送」不会叠两个）。 */
export function commentRefKey(ref: CommentRef): string {
  return ref.id;
}

/**
 * 加一条引用。
 *
 * 去重口径 = 线程 id：同一个线程反复点"发送"只保留一个 chip。
 * **不按位置去重**：同一段代码可能有多条线程（你 + 两个 Agent），它们是不同的意见。
 */
export function addCommentRef(list: readonly CommentRef[], ref: CommentRef): CommentRef[] {
  if (list.some((item) => commentRefKey(item) === commentRefKey(ref))) return [...list];
  return [...list, ref];
}

/** 移除一条（幂等）。 */
export function removeCommentRef(list: readonly CommentRef[], id: string): CommentRef[] {
  return list.filter((item) => commentRefKey(item) !== id);
}

/**
 * 已经关闭的线程不该再发给 Agent（与 `commentsToText` 的默认一致：已处理完的意见没意义）。
 * 挂 chip 时就过滤掉，用户不会看到一个"发不出去"的 chip。
 */
export function attachableComment(ref: CommentRef): boolean {
  return ref.state !== "resolved";
}
