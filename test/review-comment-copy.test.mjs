// S4-f（A20/A21）：评论 → 可粘贴文本（复制 / 放进输入框）——先红后绿。
//
// 参考（phases/S4ef-comment-state-copy-plan.md §4）：
//  - **difit** `utils/commentFormatting.ts`：`formatCommentThreadPrompt`（:132-148）= `path:L3-L5` + 正文，
//    回复用 `Reply N (author)`；`formatAllCommentThreadsPrompt`（:150+）= 多条拼接 + diff 表头。
//  - **opencode** `composer.attach`（`gui-plugins/src/review/model.ts:808-821`）= **放进输入框**，不自动发。
//  - **GitHub / GitLab / VS Code 都没有复制按钮**。
//
// 我们**不新造第二套格式**：复用 `annotation-message.ts`（Task 0003 用户 2026-11-03 定稿）的
// `1、你说的：「…」` + `-> note （语气）`，只加**位置头** `【README.md:L3-L5】`（取自 difit）。
import test from "node:test";
import assert from "node:assert/strict";
import { commentToLine, commentsToText, commentLocation } from "../frontend/src/review-comment-copy.ts";

const comment = (over = {}) => ({
  id: "c1",
  taskId: "0010",
  author: { kind: "user", id: "xu-later" },
  anchor: { source: "worktree", path: "README.md", side: "new", start: 3, end: 5, snapshot: "a\nb\nc" },
  body: "这段要同步 protocol.md 吗",
  marks: ["query"],
  state: "open",
  awaiting: "agent",
  canClose: "author-or-user",
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
  replies: [],
  ...over,
});

test("S4f·1 位置头：单行 L3 / 范围 L3-L5（difit commentFormatting.ts:14-23 同格式）", () => {
  assert.equal(commentLocation(comment()), "README.md:L3-L5");
  assert.equal(commentLocation(comment({ anchor: { source: "worktree", path: "a.ts", side: "new", start: 7, end: 7 } })), "a.ts:L7");
});

test("S4f·2 一条评论 → 复用既有格式 + 位置头（`1、【path:Lx-Ly】你说的：「原文」`）", () => {
  const line = commentToLine(comment(), 1);
  assert.ok(line.includes("1、"), `缺序号：${line}`);
  assert.ok(line.includes("【README.md:L3-L5】"), `缺位置头：${line}`);
  assert.ok(line.includes("你说的：「"), `缺引用头：${line}`);
  assert.ok(line.includes("这段要同步 protocol.md 吗"), `缺正文：${line}`);
  assert.ok(line.includes("疑问"), `缺语气：${line}`);
});

test("S4f·3 没写正文 → 不出现箭头（沿用 message 批注的既定规则）", () => {
  const line = commentToLine(comment({ body: "", marks: ["critic"] }), 1);
  assert.equal(line.includes("->"), false, `不该有箭头：${line}`);
  assert.ok(line.includes("批评"), line);
});

test("S4f·4 无语气标记 → 仍能复制（与 message 批注不同：检视评论不一定带语气）", () => {
  const line = commentToLine(comment({ marks: [] }), 1);
  assert.ok(line !== null, "检视评论即使没语气也要能复制（位置本身就是信息）");
  assert.ok(line.includes("【README.md:L3-L5】"), line);
});

test("S4f·5 多行正文保留换行（不压成一行）", () => {
  const line = commentToLine(comment({ body: "第一行\n第二行" }), 1);
  assert.ok(line.includes("第一行"), line);
  assert.ok(line.includes("第二行"), line);
});

test("S4f·6 多条 → 序号连续、按位置排序（文件内行号升序）", () => {
  const text = commentsToText([
    comment({ id: "c2", anchor: { source: "worktree", path: "b.ts", side: "new", start: 1, end: 1 } }),
    comment({ id: "c1", anchor: { source: "worktree", path: "a.ts", side: "new", start: 9, end: 9 } }),
  ]);
  const lines = text.split("\n").filter((l) => /^\d+、/.test(l));
  assert.equal(lines.length, 2, text);
  assert.ok(lines[0].startsWith("1、"), lines[0]);
  assert.ok(lines[1].startsWith("2、"), lines[1]);
  assert.ok(lines[0].includes("a.ts"), `按文件排序：${lines[0]}`);
});

test("S4f·7 空数组 → 空串（复制全部时没有内容，UI 据此禁用按钮）", () => {
  assert.equal(commentsToText([]), "");
});

test("S4f·8 已关闭的评论默认不复制（只复制未解决的）", () => {
  const text = commentsToText([comment({ id: "open1" }), comment({ id: "done1", state: "resolved" })]);
  assert.ok(text.includes("README.md"), text);
  assert.equal(text.includes("done1"), false);
  assert.equal(text.split("\n").filter((l) => /^\d+、/.test(l)).length, 1, "只有 1 条");
});

test("S4f·9 可以显式要求包含已关闭的（参数 includeResolved）", () => {
  const text = commentsToText([comment({ id: "open1" }), comment({ id: "done1", state: "resolved" })], { includeResolved: true });
  assert.equal(text.split("\n").filter((l) => /^\d+、/.test(l)).length, 2, text);
});

test("S4f·10 没有原文快照 → 不输出空引号（`你说的：「」` 读起来像坏数据）", () => {
  const line = commentToLine(comment({ anchor: { source: "worktree", path: "a.ts", side: "new", start: 1, end: 1 } }), 1);
  assert.equal(line.includes("「」"), false, line);
  assert.ok(line.includes("你说的"), line);
});


// ── S4-h：线程回复也要进复制文本（否则 Agent 会重复回答已闭环的问题）─────────

test("S4h·C1 回复按顺序附在正文下面，Agent 用 ↳ 一行一条", () => {
  const line = commentToLine(comment({
    replies: [
      { id: "r1", author: { kind: "agent", id: "coder" }, body: "已同步 protocol.md §3.7", createdAt: "2026-11-05T01:00:00Z" },
      { id: "r2", author: { kind: "user", id: "xu-later" }, body: "好的", createdAt: "2026-11-05T02:00:00Z" },
    ],
  }), 1);
  assert.ok(line.includes("↳ coder：已同步 protocol.md §3.7"), line);
  assert.ok(line.includes("↳ 你：好的"), "用户自己的回复用「你」，读起来才顺：" + line);
  // 顺序：先正文后回复
  assert.ok(line.indexOf("这段要同步") < line.indexOf("↳ coder"), line);
});

test("S4h·C2 没有回复时不出现 ↳（不产生空行噪声）", () => {
  const line = commentToLine(comment(), 1);
  assert.equal(line.includes("↳"), false, line);
});

test("S4h·C3 commentsToText：多条线程各自的回复跟着各自的根走（不串到别的文件）", () => {
  const text = commentsToText([
    comment({ id: "a", anchor: { source: "worktree", path: "a.ts", side: "new", start: 1, end: 1 }, replies: [{ id: "r", author: { kind: "agent", id: "coder" }, body: "A 的回复", createdAt: "x" }] }),
    comment({ id: "b", anchor: { source: "worktree", path: "b.ts", side: "new", start: 2, end: 2 }, body: "B 的意见" }),
  ]);
  const lines = text.split("\n");
  const idxA = lines.findIndex((l) => l.includes("a.ts:L1"));
  const idxReply = lines.findIndex((l) => l.includes("A 的回复"));
  const idxB = lines.findIndex((l) => l.includes("b.ts:L2"));
  assert.ok(idxA >= 0 && idxReply === idxA + 2, `回复应紧跟 a.ts 的正文：${text}`);
  assert.ok(idxB > idxReply, text);
});

test("S4h·C4 已关闭的线程默认不复制（含它的回复）", () => {
  const text = commentsToText([comment({
    state: "resolved",
    replies: [{ id: "r", author: { kind: "agent", id: "coder" }, body: "已处理", createdAt: "x" }],
  })]);
  assert.equal(text, "");
});
