// 评论状态与关闭权限的**纯判定**（S4-e · A18/A19）——前端用这一份。
//
// ⚠️ 为什么前端不直接 import `src/review-comments.ts`（踩过的坑，案例 C191）：
//   那个模块里有 `node:fs/promises`（落盘）。Vite 会把它 externalize，浏览器运行到
//   `mkdir` 就抛 `Module "node:fs/promises" has been externalized`，**整页白屏**；
//   而 `pnpm typecheck` 是绿的（类型解析不看运行时依赖）。
//
// 那为什么会有两份：
//   - **权威判定在服务端**（`src/review-comments.ts` 的 `canCloseComment` / `setCommentState`）——
//     它决定请求是否被接受（403）；
//   - 前端这份只用于**显示/隐藏按钮**（避免用户点了才被拒）。
//   两份必须一致：由 `test/review-comment-state-parity.test.mjs` 逐用例对照（同一张表跑两边），
//   改了一边而另一边没改 → 测试红。
//
// 纪律：本文件**只能有纯函数**，不 import 任何 node:* 模块（否则又会白屏）。

export type CommentAuthorLike = { kind: "user" | "agent"; id: string };

export type CommentStateFields = {
  state: "draft" | "open" | "resolved";
  awaiting?: "user" | "agent" | null;
  canClose?: "author" | "author-or-user";
};

/** 是否已关闭（`state === "resolved"`）。 */
export function isClosedComment(state: Pick<CommentStateFields, "state">): boolean {
  return state.state === "resolved";
}

/**
 * 现在等谁处理。已关闭 → null（关掉就不该再显示"等谁"）。
 * 与 `src/review-comments.ts` 的 `awaitingOf` 同规则。
 */
export function awaitingOfComment(comment: CommentStateFields): "user" | "agent" | null {
  if (isClosedComment(comment)) return null;
  return comment.awaiting ?? null;
}

/**
 * 谁能关闭这条评论。
 * 与 `src/review-comments.ts` 的 `canCloseComment` 同规则（parity 测试锁住）：
 *  - `canClose === "author"` → 只有提出者；
 *  - `author-or-user`（默认）→ 提出者，或任何 `kind === "user"`（单用户家目录 = 所有者）。
 */
export function canCloseCommentBy(
  comment: { author: CommentAuthorLike; canClose?: CommentStateFields["canClose"] },
  by: CommentAuthorLike,
): boolean {
  const isAuthor = comment.author.kind === by.kind && comment.author.id === by.id;
  if (isAuthor) return true;
  if (comment.author.kind === "user" && by.kind === "user") return true;
  return (comment.canClose ?? "author-or-user") === "author-or-user" && by.kind === "user";
}
