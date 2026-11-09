// S4-e（A18/A19）：评论状态机 + 关闭权限（先红后绿）。
//
// 对标依据（phases/S4ef-comment-state-copy-plan.md §3）：
//  - **GitHub / GitLab**：二态 `unresolved` / `resolved`；关闭权限原文 "You can resolve a conversation
//    … if you **opened the pull request** or if you have **write access**"。
//  - **VS Code**：`CommentThreadState { Unresolved=0, Resolved=1 }`（languages.ts:2227-2230）+
//    `canReply: boolean | CommentAuthorInformation`（:2283）——**用数据字段表达"谁能动"**。
//  - **difit**：完全没有状态（只有 Outdated）。
// 我们的模型（用户 2026-11-05 拍板）：三态 `draft/open/resolved` + `awaiting`（等谁，不是状态）
//   + `canClose`（`author` | `author-or-user`，默认后者）。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "review-state-home-"));
process.env.LIFEOS_HOME = HOME;

const {
  canCloseComment, isClosed, awaitingOf, setCommentState, settleComment,
  readComments, upsertComment, toReviewComment,
} = await import("../src/review-comments.ts");

let seq = 0;
const freshTask = () => `/tmp/state/00${++seq}-t`;

const input = (over = {}) => ({
  taskId: "0010",
  author: { kind: "user", id: "xu-later" },
  anchor: { source: "worktree", path: "README.md", side: "new", start: 3, end: 5 },
  body: "这段要同步吗",
  marks: ["query"],
  ...over,
});

test("S4e·1 默认状态 open；awaiting 默认 null；canClose 默认 author-or-user", async () => {
  const t = freshTask();
  const saved = await upsertComment(t, input());
  assert.equal(saved.state, "open");
  assert.equal(saved.awaiting, null);
  assert.equal(saved.canClose, "author-or-user");
});

test("S4e·2 awaiting 可设 user / agent / null（这是「等谁」而不是状态）", async () => {
  const t = freshTask();
  const a = await upsertComment(t, input({ awaiting: "agent" }));
  assert.equal(a.awaiting, "agent");
  assert.equal(a.state, "open", "改 awaiting 不改状态");
  const b = await upsertComment(t, input({ awaiting: "user" }));
  assert.equal(b.awaiting, "user");
  assert.equal(b.id, a.id, "同键覆盖（是编辑，不是新增）");
});

test("S4e·3 draft → open → resolved 的合法流转", async () => {
  const t = freshTask();
  const c = await upsertComment(t, input({ state: "draft" }));
  assert.equal(c.state, "draft");
  const opened = await setCommentState(t, c.id, "open", { kind: "user", id: "xu-later" });
  assert.equal(opened?.state, "open");
  const closed = await settleComment(t, c.id, { kind: "user", id: "xu-later" });
  assert.equal(closed?.state, "resolved");
  assert.ok(closed.resolvedAt, "关闭要记时间");
  assert.deepEqual(closed.resolvedBy, { kind: "user", id: "xu-later" }, "关闭要记谁关的");
});

test("S4e·4 用户（项目所有者）能关闭任何人的评论", async () => {
  const t = freshTask();
  const byAgent = await upsertComment(t, input({ author: { kind: "agent", id: "coder" }, state: "open" }));
  assert.equal(canCloseComment(byAgent, { kind: "user", id: "xu-later" }), true);
  const closed = await settleComment(t, byAgent.id, { kind: "user", id: "xu-later" });
  assert.equal(closed?.state, "resolved");
});

test("S4e·5 提出者（Agent）能关闭自己的评论", async () => {
  const t = freshTask();
  const byAgent = await upsertComment(t, input({ author: { kind: "agent", id: "coder" }, state: "open" }));
  assert.equal(canCloseComment(byAgent, { kind: "agent", id: "coder" }), true);
  const closed = await settleComment(t, byAgent.id, { kind: "agent", id: "coder" });
  assert.equal(closed?.resolvedBy?.id, "coder");
});

test("S4e·6 **别的 Agent 不能关闭**（用户原话：只能用户自己或提出评论的 agent）", async () => {
  const t = freshTask();
  const byCoder = await upsertComment(t, input({ author: { kind: "agent", id: "coder" }, state: "open" }));
  assert.equal(canCloseComment(byCoder, { kind: "agent", id: "reviewer" }), false);
  await assert.rejects(
    () => settleComment(t, byCoder.id, { kind: "agent", id: "reviewer" }),
    /不能关闭|not allowed|forbidden/i,
  );
  // 状态没被改
  assert.equal((await readComments(t))[0].state, "open");
});

test("S4e·7 canClose='author' 的评论：连用户也不能关（数据字段说话，不靠 UI 猜）", async () => {
  const t = freshTask();
  const own = await upsertComment(t, input({ author: { kind: "agent", id: "coder" }, canClose: "author", state: "open" }));
  assert.equal(canCloseComment(own, { kind: "user", id: "xu-later" }), false);
  assert.equal(canCloseComment(own, { kind: "agent", id: "coder" }), true);
});

test("S4e·8 关闭后可重开（resolved → open），并清掉 resolvedAt/resolvedBy", async () => {
  const t = freshTask();
  const c = await upsertComment(t, input({ state: "open" }));
  await settleComment(t, c.id, { kind: "user", id: "xu-later" });
  const reopened = await setCommentState(t, c.id, "open", { kind: "user", id: "xu-later" });
  assert.equal(reopened?.state, "open");
  assert.equal(reopened.resolvedAt, undefined);
  assert.equal(reopened.resolvedBy, undefined);
});

test("S4e·9 isClosed / awaitingOf 判断（UI 用它们决定显示什么，不自己拼）", async () => {
  const t = freshTask();
  const open = await upsertComment(t, input({ awaiting: "agent" }));
  assert.equal(isClosed(open), false);
  assert.equal(awaitingOf(open), "agent");
  const closed = await settleComment(t, open.id, { kind: "user", id: "xu-later" });
  assert.equal(isClosed(closed), true);
  assert.equal(awaitingOf(closed), null, "已关闭就不该再「等谁」");
});

test("S4e·10 不存在的 id → settle/setState 返回 undefined（不抛，幂等）", async () => {
  const t = freshTask();
  assert.equal(await settleComment(t, "nope", { kind: "user", id: "xu-later" }), undefined);
  assert.equal(await setCommentState(t, "nope", "open", { kind: "user", id: "xu-later" }), undefined);
});

test("S4e·11 落盘保留 awaiting/canClose/resolved*（读回一致）", async () => {
  const t = freshTask();
  const c = await upsertComment(t, input({ awaiting: "agent", canClose: "author" }));
  await settleComment(t, c.id, { kind: "user", id: "xu-later" });
  const got = (await readComments(t))[0];
  assert.equal(got.awaiting, "agent");
  assert.equal(got.canClose, "author");
  assert.equal(got.state, "resolved");
  assert.equal(got.resolvedBy?.id, "xu-later");
});

test("S4e·12 坏值的 awaiting/canClose 被丢弃（不污染 state）", () => {
  const base = { id: "x", createdAt: "t", updatedAt: "t", ...input() };
  assert.equal(toReviewComment({ ...base, awaiting: "robot" })?.awaiting, null);
  assert.equal(toReviewComment({ ...base, canClose: "anyone" })?.canClose, "author-or-user", "非法值落回默认");
});

test.after(() => { rmSync(HOME, { recursive: true, force: true }); });
