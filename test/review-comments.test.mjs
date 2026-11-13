// S4-b 评论持久化：单元测试（先红后绿）。
//
// 参考实现（file:line 见 phases/S4bcd-delivery-plan.md §4）：
//  - **Gerrit** 官方文档（user-changeid.html）：评论绑 change（逻辑单元），"even across cherry-picks
//    and rebases" → 我们绑 taskId，不绑 commit sha。
//  - **本仓** `src/session-views.ts:355-380`：state 目录 + `writeTextAtomic` + 目录 AGENTS.md（`wx` 不覆盖）。
//  - **difit** `useLocalComments.test.ts` 的 16 条用例清单（空/载入/增/删/改/清空/坏数据/默认键/顺序）。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "review-comments-home-"));
process.env.LIFEOS_HOME = HOME;

const {
  commentKeyOf, commentsFileOf, readComments, removeComment, taskSlugOf, toCommentInput, toReviewComment, upsertComment,
  writeComments, MAX_COMMENTS_PER_TASK, COMMENTS_DIR,
} = await import("../src/review-comments.ts");

const TASK_DIR = "/home/u/.lifeos/agents/a/projects/p/tasks/0010-检视模式：Task-worktree-改动的代码与文档-diff-检视";
const TASK_ID = "0010";
/**
 * 每个用例一个独立 taskDir（C186/C187 的教训：夹具共用状态会让后一个用例继承前一个的副作用）。
 * 早先 S4b·5 期望 state=draft，但因为 S4b·4 写了同键的 state=open 记录而红——是实现对的、夹具错的。
 */
let caseSeq = 0;
const freshTask = (label) => {
  caseSeq += 1;
  return `${TASK_DIR.replace("0010-", `00${caseSeq}-${label}-`)}`;
};

const input = (over = {}) => ({
  taskId: TASK_ID,
  author: { kind: "user", id: "xu-later" },
  anchor: { source: "worktree", path: "README.md", side: "new", start: 5, end: 7, quote: "abc", snapshot: "l5\nl6\nl7" },
  body: "这里要同步 protocol.md 吗",
  marks: ["query"],
  ...over,
});

test("S4b·1 空文件 / 不存在 → 空数组（不抛）", async () => {
  assert.deepEqual(await readComments(TASK_DIR), []);
});

test("S4b·2 坏 JSON → 空数组（不抛）", async () => {
  const file = commentsFileOf(TASK_DIR);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, "{ not json");
  assert.deepEqual(await readComments(TASK_DIR), []);
});

test("S4b·3 版本不符 → 空数组（不猜兼容）", async () => {
  const file = commentsFileOf(TASK_DIR);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: 99, taskId: TASK_ID, comments: [input()] }));
  assert.deepEqual(await readComments(TASK_DIR), []);
});

test("S4b·4 坏条目逐条跳过，其余照读（不拖垮整批）", async () => {
  const good = { id: "c1", createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z", state: "open", ...input() };
  const file = commentsFileOf(TASK_DIR);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: 1, taskId: TASK_ID, taskDir: TASK_DIR, comments: [good, { id: "" }, null, 42] }));
  const got = await readComments(TASK_DIR);
  assert.equal(got.length, 1, `只保留 1 条合法，实际 ${got.length}`);
  assert.equal(got[0].id, "c1");
});

test("S4b·5 add 一条 → 读回一致（含 author/anchor/marks）", async () => {
  const t = freshTask("add");
  const saved = await upsertComment(t, input());
  const got = await readComments(t);
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].author, { kind: "user", id: "xu-later" });
  assert.equal(got[0].anchor.path, "README.md");
  assert.deepEqual(got[0].marks, ["query"]);
  assert.equal(got[0].state, "open", "S4-e：新评论默认是 open（不是 draft）");
  assert.equal(got[0].id, saved.id);
});

test("S4b·6 同键（task+source+path+side+range+author）再写 → 覆盖，id 与 createdAt 不变", async () => {
  const t = freshTask("upsert");
  const a = await upsertComment(t, input({ body: "第一次" }));
  const b = await upsertComment(t, input({ body: "改了" }));
  const got = await readComments(t);
  assert.equal(got.length, 1, `同键应只有 1 条，实际 ${got.length}`);
  assert.equal(got[0].id, a.id);
  assert.equal(got[0].createdAt, a.createdAt);
  assert.equal(got[0].body, "改了");
  assert.equal(b.id, a.id);
});

test("S4b·7 同一范围不同作者 → 两条独立（用户 + Agent 不互相覆盖）", async () => {
  const t = freshTask("authors");
  await upsertComment(t, input());
  await upsertComment(t, input({ author: { kind: "agent", id: "coder" }, body: "建议统一术语" }));
  const got = await readComments(t);
  const authors = got.map((c) => `${c.author.kind}:${c.author.id}`).sort();
  assert.deepEqual(authors, ["agent:coder", "user:xu-later"]);
});

test("S4b·8 不同 Task 隔离（同文件路径、不同 taskDir）", async () => {
  const mine0 = freshTask("iso-mine");
  const other = freshTask("iso-other");
  await upsertComment(mine0, input());
  await upsertComment(mine0, input({ anchor: { source: "worktree", path: "b.md", side: "new", start: 1, end: 1 } }));
  await upsertComment(other, input({ body: "另一个 Task 的" }));
  assert.equal((await readComments(mine0)).length, 2, "本 Task 2 条");
  assert.equal((await readComments(other)).length, 1, "另一个 Task 1 条");
  assert.notEqual(commentsFileOf(mine0), commentsFileOf(other), "两个 Task 不能共用一个文件");
});

test("S4b·9 remove 按 id，其余保留", async () => {
  const t = freshTask("remove");
  await upsertComment(t, input());
  await upsertComment(t, input({ anchor: { source: "worktree", path: "b.md", side: "new", start: 1, end: 1 } }));
  const before = await readComments(t);
  const target = before[0];
  await removeComment(t, target.id);
  const after = await readComments(t);
  assert.equal(after.length, before.length - 1);
  assert.equal(after.some((c) => c.id === target.id), false);
  // 幂等
  await removeComment(t, "不存在的 id");
  assert.equal((await readComments(t)).length, after.length);
});

test("S4b·10 写入是原子的（tmp + rename）：文件内容永远是完整 JSON", async () => {
  const t = freshTask("atomic");
  await upsertComment(t, input({ anchor: { source: "worktree", path: "big.md", side: "new", start: 1, end: 1 } }));
  const text = readFileSync(commentsFileOf(t), "utf8");
  assert.doesNotThrow(() => JSON.parse(text), "落盘内容必须是合法 JSON");
  assert.equal(/\.tmp$/.test(commentsFileOf(t)), false);
});

test("S4b·11 文件权限 0600、目录 0700（新建时；已存在的目录不改权限）", async () => {
  const fresh = freshTask("perm");
  await upsertComment(fresh, input());
  const file = commentsFileOf(fresh);
  const mode = statSync(file).mode & 0o777;
  assert.equal(mode, 0o600, `文件权限 ${mode.toString(8)}`);
  // 目录：`mkdir(recursive)` 不会修改**已存在**的父目录权限（POSIX 语义）。
  // 新建时是 0700；若 state/ 早已由别的模块建过（如 session-views），沿用它的权限。
  // 断言"不比 0755 更宽"，避免本模块把目录放松成 0777。
  const dirMode = statSync(join(file, "..")).mode & 0o777;
  assert.ok((dirMode & 0o022) === 0, `目录不能有组/其他用户的写权限：${dirMode.toString(8)}`);
});

test("S4b·12 目录里有 AGENTS.md（协议 §5.2：运行目录也要说明文件，wx 不覆盖）", async () => {
  const t12 = freshTask("note");
  await upsertComment(t12, input());
  const file = commentsFileOf(t12);
  const note = readFileSync(join(file, "..", "AGENTS.md"), "utf8");
  assert.ok(note.includes("review-comments"), "说明文件要提到这是评论目录");
  // 已存在时不覆盖
  writeFileSync(join(file, "..", "AGENTS.md"), "# 用户改过的");
  await upsertComment(t12, input({ anchor: { source: "worktree", path: "x.md", side: "new", start: 1, end: 1 } }));
  assert.equal(readFileSync(join(file, "..", "AGENTS.md"), "utf8"), "# 用户改过的", "wx 语义：不覆盖已有");
});

test(`S4b·13 单 Task 超过 ${MAX_COMMENTS_PER_TASK} 条 → 丢最旧`, async () => {
  const many = TASK_DIR.replace("0010-", "0099-");
  for (let i = 0; i < MAX_COMMENTS_PER_TASK + 3; i++) {
    await upsertComment(many, input({ taskId: "0099", anchor: { source: "worktree", path: `f${i}.md`, side: "new", start: 1, end: 1 } }));
  }
  const got = await readComments(many);
  assert.equal(got.length, MAX_COMMENTS_PER_TASK);
  // 留下的是最新的：f0/f1/f2 应被丢
  assert.equal(got.some((c) => c.anchor.path === "f0.md"), false, "最旧的被丢");
  assert.equal(got.some((c) => c.anchor.path === `f${MAX_COMMENTS_PER_TASK + 2}.md`), true, "最新的保留");
});

test("S4b·14 taskSlug 安全且不撞：中文/斜杠/超长路径", () => {
  const a = taskSlugOf(TASK_DIR);
  const b = taskSlugOf(TASK_DIR.replace("0010-", "0011-"));
  assert.notEqual(a, b);
  assert.match(a, /^[\w.-]+$/, `slug 只能含安全字符：${a}`);
  assert.ok(a.length <= 64, `slug 不能太长：${a.length}`);
  assert.notEqual(taskSlugOf("/a/b/tasks/0010-x"), taskSlugOf("/a/c/tasks/0010-x"), "同名不同父目录不能撞");
});

test("S4b·15 toReviewComment：缺字段/非法 side/行号 0/倒序 都拒绝或归一并说明", () => {
  assert.equal(toReviewComment(null), undefined);
  assert.equal(toReviewComment({}), undefined);
  const base = { id: "x", createdAt: "t", updatedAt: "t", state: "open", ...input() };
  assert.equal(toReviewComment({ ...base, anchor: { ...base.anchor, side: "middle" } }), undefined);
  assert.equal(toReviewComment({ ...base, anchor: { ...base.anchor, start: 0 } }), undefined);
  const reversed = toReviewComment({ ...base, anchor: { ...base.anchor, start: 9, end: 3 } });
  assert.deepEqual([reversed.anchor.start, reversed.anchor.end], [3, 9], "倒序要归一");
});

test("S4b·16 baseCommit 可选：存得下也读得回；不传则无该字段", async () => {
  const t = TASK_DIR.replace("0010-", "0098-");
  await upsertComment(t, input({ taskId: "0098", anchor: { source: "worktree", path: "a.ts", side: "new", start: 1, end: 1, baseCommit: "abc1234" } }));
  await upsertComment(t, input({ taskId: "0098", anchor: { source: "worktree", path: "b.ts", side: "new", start: 1, end: 1 } }));
  const got = await readComments(t);
  assert.equal(got.find((c) => c.anchor.path === "a.ts")?.anchor.baseCommit, "abc1234");
  assert.equal(got.find((c) => c.anchor.path === "b.ts")?.anchor.baseCommit, undefined);
});

test("S4b·17 空 body + 空 marks 也能存（先圈上、稍后再写）", async () => {
  const t = TASK_DIR.replace("0010-", "0097-");
  await upsertComment(t, input({ taskId: "0097", body: "", marks: [] }));
  const got = await readComments(t);
  assert.equal(got.length, 1);
  assert.equal(got[0].body, "");
  assert.deepEqual(got[0].marks, []);
});

test("S4b·18 writeComments 直写整份（迁移/批量用），且校验 taskId 一致", async () => {
  const t = freshTask("bulk");
  const asComment = (over) => ({
    id: `c-${Math.random().toString(36).slice(2, 8)}`,
    taskId: "bulk",
    author: { kind: "user", id: "u" },
    anchor: { source: "worktree", path: "a.md", side: "new", start: 1, end: 1 },
    body: "x", marks: [], state: "open",
    createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z",
    ...over,
  });
  await writeComments(t, "bulk", [asComment(), asComment({ anchor: { source: "lifeos", path: "task.md", side: "new", start: 1, end: 1 } })]);
  assert.equal((await readComments(t)).length, 2, "两条都要落盘");
  // taskId 不一致的会被过滤掉
  await writeComments(t, "bulk", [asComment(), asComment({ taskId: "other" })]);
  assert.equal((await readComments(t)).length, 1, "taskId 不一致的条目要丢弃");
});

test("S4b·19 COMMENTS_DIR 在 state 下（与 session-views 同层）", () => {
  assert.ok(COMMENTS_DIR.startsWith("state/"), `相对路径应在 state 下：${COMMENTS_DIR}`);
  assert.ok(COMMENTS_DIR.endsWith("review-comments"), COMMENTS_DIR);
});

test("S4b·20 commentKeyOf：作者分隔符与字段分隔符不冲突；倒序归一", () => {
  const k1 = commentKeyOf({ ...input(), }) ;
  const k2 = commentKeyOf({ ...input(), author: { kind: "agent", id: "coder" } });
  assert.notEqual(k1, k2);
  const k3 = commentKeyOf({ ...input(), anchor: { ...input().anchor, start: 7, end: 5 } });
  assert.equal(k1, k3, "倒序与正序同键");
});

test.after(() => { rmSync(HOME, { recursive: true, force: true }); });


test("S4b·21 toCommentInput：无 id 也能过（新增），非法拒绝（这是 API 入参校验，与落盘校验分开）", () => {
  const ok = toCommentInput(input(), "0010");
  assert.ok(ok, "没有 id 的入参也要能通过（id 由 upsert 生成）");
  assert.equal(ok.taskId, "0010");
  assert.equal(ok.id, undefined);
  assert.equal(toCommentInput({ ...input(), author: { kind: "robot", id: "x" } }, "0010"), undefined);
  assert.equal(toCommentInput({ ...input(), body: undefined }, "0010"), undefined);
  assert.equal(toCommentInput({ ...input(), anchor: { source: "x", path: "a", side: "new", start: 1, end: 1 } }, "0010"), undefined);
  // state/marks 可省略
  const bare = toCommentInput({ author: { kind: "user", id: "u" }, anchor: { source: "worktree", path: "a", side: "new", start: 1, end: 2 }, body: "" }, "0010");
  assert.equal(bare.marks, undefined);
  assert.equal(bare.state, undefined);
});

test("S4b·22 toCommentInput 透传 awaiting / canClose（否则 POST 带了也不生效）", () => {
  const withAwaiting = toCommentInput({ ...input(), awaiting: "agent", canClose: "author" }, "0010");
  assert.equal(withAwaiting.awaiting, "agent");
  assert.equal(withAwaiting.canClose, "author");
  const bad = toCommentInput({ ...input(), awaiting: "robot", canClose: "anyone" }, "0010");
  assert.equal(bad.awaiting, undefined, "非法 awaiting 丢掉（不写脏值）");
  assert.equal(bad.canClose, undefined, "非法 canClose 丢掉（落盘时用默认）");
});


test("isCountable（0018 孤儿口径）：空草稿不算、失锚不算、正常算", async () => {
  const { isCountable } = await import("../src/review-comments.ts");
  const available = new Set(["worktree\u0000frontend/src/demo.ts"]);
  const mk = (over) => ({
    id: "t1", taskId: "t", author: { kind: "user", id: "xu" },
    anchor: { source: "worktree", path: "frontend/src/demo.ts", side: "new", start: 2, end: 2, snapshot: "s" },
    body: "意见正文", state: "open", ...over,
  });
  assert.equal(isCountable(mk({}), available), true, "正常 open 评论算");
  assert.equal(isCountable(mk({ state: "draft", body: "  " }), available), false, "空正文草稿不算");
  assert.equal(isCountable(mk({ state: "draft", body: "写了" }), available), true, "有正文的草稿算");
  const orphan = mk({});
  orphan.anchor.path = "src/gone.ts";
  assert.equal(isCountable(orphan, available), false, "锚不在 diff 的孤儿不算");
  assert.equal(isCountable(mk({}), new Set()), false, "空 diff（全合并后）= 全部孤儿");
});
