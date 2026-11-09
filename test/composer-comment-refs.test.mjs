// A8 + G3：输入框里的评论引用（chip）——**先写用例，再补实现**。
//
// 参考（源码级）：
//  - **opencode** `packages/app/src/composer/schema.ts:152-190`：`FileContextItem` 带
//    `path + selection + comment + commentID`；`contextItemKey()`（`:288-301`）按
//    `type:path:startLine:endLine:c=commentID` 生成稳定键 → 同一条评论只挂一个 chip；
//  - **opencode** `packages/app/src/composer/editor/editor.tsx:770-800`：chip 容器
//    `data-slot="composer-attachments"` + 每条右上角 `aria-label` 删除按钮；
//  - **我们的差异**：opencode 把 `comment`（正文）**塞进** context item；
//    我们保留完整 `ReviewComment`（发送时要合成文本、chip 上要画位置头与预览），
//    但**发送文本仍由 `commentsToText()` 生成**——不新造第二套格式（D25）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  addCommentRef, attachableComment, commentRefKey, commentRefLabel, commentRefPreview, removeCommentRef,
} from "../frontend/src/composer-comment-refs.ts";

const comment = (over = {}) => ({
  id: "rc_1",
  taskId: "0010",
  author: { kind: "user", id: "xu-later" },
  anchor: { source: "worktree", path: "src/demo.ts", side: "new", start: 3, end: 5, snapshot: "a\nb\nc" },
  body: "这三行能不能合并成一个函数？",
  marks: ["query"],
  state: "open",
  awaiting: null,
  canClose: "author-or-user",
  replies: [],
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
  ...over,
});

test("A8·1 位置头：单行 L3 / 范围 L3-L5（与复制文本同一形状，difit commentFormatting.ts:14-23 同款）", () => {
  assert.equal(commentRefLabel(comment()), "src/demo.ts:L3-L5");
  assert.equal(commentRefLabel(comment({ anchor: { source: "worktree", path: "a.ts", side: "new", start: 7, end: 7 } })), "a.ts:L7");
});

test("A8·2 chip 预览只取正文首行、超 40 字截断（chip 只有一行宽）", () => {
  assert.equal(commentRefPreview(comment({ body: "第一行\n第二行" })), "第一行");
  const long = "一".repeat(50);
  const preview = commentRefPreview(comment({ body: long }));
  assert.equal(preview.length, 41, preview);
  assert.ok(preview.endsWith("…"), preview);
  assert.equal(commentRefPreview(comment({ body: "   " })), "（无正文）");
});

test("A8·3 加引用：同一线程只挂一个 chip（重复点「发送」不叠）", () => {
  const one = addCommentRef([], comment());
  assert.equal(one.length, 1);
  const twice = addCommentRef(one, comment());
  assert.equal(twice.length, 1, "同一条线程被加了两次");
  assert.equal(twice[0].id, "rc_1");
});

test("A8·4 同一段代码的不同线程是不同 chip（你 + 两个 Agent 各一条）", () => {
  const list = addCommentRef(addCommentRef(addCommentRef([], comment()), comment({ id: "rc_2", author: { kind: "agent", id: "coder" } })), comment({ id: "rc_3", author: { kind: "agent", id: "reviewer" } }));
  assert.equal(list.length, 3, "按线程 id 去重，不按位置去重");
  assert.deepEqual(list.map((item) => item.id), ["rc_1", "rc_2", "rc_3"]);
});

test("A8·5 移除一条（幂等）：不存在的 id 不报错，其余顺序不变", () => {
  const list = addCommentRef(addCommentRef([], comment()), comment({ id: "rc_2" }));
  const removed = removeCommentRef(list, "rc_1");
  assert.deepEqual(removed.map((item) => item.id), ["rc_2"]);
  assert.deepEqual(removeCommentRef(removed, "rc_nope").map((item) => item.id), ["rc_2"]);
});

test("A8·6 已关闭的线程挂不上 chip（挂上就发不出去，用户会以为坏了）", () => {
  assert.equal(attachableComment(comment()), true);
  assert.equal(attachableComment(comment({ state: "resolved" })), false);
  assert.equal(attachableComment(comment({ state: "draft" })), true, "草稿也能发（它就是未提交的意见）");
});

test("A8·7 chip 键 = 线程 id（稳定，刷新后仍能对上）", () => {
  assert.equal(commentRefKey(comment()), "rc_1");
  assert.equal(commentRefKey(comment({ body: "改了正文" })), "rc_1", "键不随正文变");
});
