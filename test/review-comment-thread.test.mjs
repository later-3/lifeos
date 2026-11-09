// S4-h-1 评论线程（回复）：单元测试（先红后绿）。
//
// 为什么要有线程（用户 2026-11-05）：
//   "Agent 去闭环了，他肯定要回复一下他是怎么闭环的，然后我们再去查看，再把这个评论给关掉。"
//   —— 没有回复，"闭环说明"无处可写，整条链路断在中间。
//
// 参考事实（file:line）：
//  - **difit** `src/types/diff.ts:104-124`：`DiffCommentThread { position, codeSnapshot, messages[] }`，
//    `messages[0]` = 根；`useDiffComments.ts:234-258` 的 `replyToThread` 只在 messages 尾部追加。
//  - **VS Code** `languages.ts:2266-2294` 线程级（state/canReply/collapsibleState）与
//    `:2363-2376` 条目级（body/author/state）**分两层**；`commentThreadBody.ts:105` 按 comments[] 逐条渲染。
//  - **Gitea** `routers/api/v1/repo/pull_review.go:207-278`：回复是独立 Comment 行，共享 `ReviewID`；
//    已经解决的会话默认 `tw-hidden`（`conversation.tmpl:26-44`），要回复必须先解除解决。
//
// 我们与 difit 的关键差异（为什么根与回复不同形状）：
//   根评论带 `state/marks/awaiting/canClose/anchor`——这些是**线程级**属性，回复没有语气标记、
//   没有独立锚点、不能单独关闭。VS Code 同样分成两层，不硬凑成同一形状。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "review-thread-home-"));
process.env.LIFEOS_HOME = HOME;

const {
  SCHEMA_VERSION, addReply, readComments, removeReply, setCommentAwaiting, setCommentState,
  upsertComment, commentsFileOf, canReplyToComment, upsertReply, awaitingOf,
} = await import("../src/review-comments.ts");

const TASK_BASE = "/home/u/.lifeos/agents/a/projects/p/tasks";
let seq = 0;
/** 每个用例一个独立 taskDir（C186/C187：夹具共用状态会让后一个用例继承前一个的副作用）。 */
const freshTask = () => {
  seq += 1;
  return `${TASK_BASE}/${String(seq).padStart(4, "0")}-thread-用例`;
};
const USER = { kind: "user", id: "xu-later" };
const AGENT = { kind: "agent", id: "coder" };

const rootInput = (over = {}) => ({
  taskId: "0010",
  author: USER,
  anchor: { source: "worktree", path: "src/demo.ts", side: "new", start: 5, end: 7, snapshot: "l5\nl6\nl7" },
  body: "这里要同步 protocol.md 吗",
  marks: ["query"],
  ...over,
});

/** 建一条根评论，返回它（节省每个用例 3 行样板）。 */
const makeRoot = async (taskDir, over = {}) => upsertComment(taskDir, rootInput(over));

// ── 数据形状 ────────────────────────────────────────────────────────────────

test("S4h·1 新评论默认带空 replies（形状统一，消费方不用判空）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  assert.deepEqual(root.replies, []);
});

test("S4h·2 加一条回复：追加到尾部，带 id/author/body/createdAt", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  const replied = await addReply(dir, root.id, { author: AGENT, body: "同步了，见 protocol.md §3.7" });
  assert.equal(replied.replies.length, 1);
  const reply = replied.replies[0];
  assert.equal(reply.author.kind, "agent");
  assert.equal(reply.author.id, "coder");
  assert.equal(reply.body, "同步了，见 protocol.md §3.7");
  assert.match(reply.id, /^rr_/);
  assert.ok(!Number.isNaN(Date.parse(reply.createdAt)));

  // 落盘后读回一致（不是只在内存里对）
  const reread = (await readComments(dir)).find((c) => c.id === root.id);
  assert.equal(reread.replies.length, 1);
  assert.equal(reread.replies[0].body, "同步了，见 protocol.md §3.7");
});

test("S4h·3 多条回复按追加顺序保留（不排序、不去重）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  await addReply(dir, root.id, { author: AGENT, body: "第一条" });
  await addReply(dir, root.id, { author: USER, body: "第二条" });
  const done = await addReply(dir, root.id, { author: AGENT, body: "第三条" });
  assert.deepEqual(done.replies.map((r) => r.body), ["第一条", "第二条", "第三条"]);
});

test("S4h·4 编辑根评论（upsertComment 同键）**不清空回复**", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  await addReply(dir, root.id, { author: AGENT, body: "已回答" });
  // 同键覆盖 = 编辑正文（这是现有语义：不需要单独的 update 接口）
  const edited = await upsertComment(dir, rootInput({ body: "改过的正文" }));
  assert.equal(edited.body, "改过的正文");
  assert.equal(edited.replies.length, 1, "编辑根评论把回复弄丢了");
  assert.equal(edited.replies[0].body, "已回答");
  assert.equal(edited.id, root.id, "编辑后 id 变了——它还是同一条评论");
});

test("S4h·5 改状态（关闭）**不清空回复**（关闭后仍能看到怎么闭环的）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  await addReply(dir, root.id, { author: AGENT, body: "闭环说明" });
  const closed = await setCommentState(dir, root.id, "resolved", USER);
  assert.equal(closed.state, "resolved");
  assert.equal(closed.replies.length, 1, "关闭后回复丢了——用户就看不到 Agent 怎么闭环的了");
});

// ── 回复的编辑与删除 ────────────────────────────────────────────────────────

test("S4h·6 编辑一条回复：只改那条，其余不动（difit `updateMessage` 同语义）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  await addReply(dir, root.id, { author: AGENT, body: "错的" });
  const withTwo = await addReply(dir, root.id, { author: USER, body: "用户的话" });
  const target = withTwo.replies[0];
  const edited = await upsertReply(dir, root.id, { id: target.id, author: AGENT, body: "改对的" });
  assert.deepEqual(edited.replies.map((r) => r.body), ["改对的", "用户的话"]);
  assert.equal(edited.replies[0].id, target.id, "编辑不该换 id");
  assert.equal(edited.replies[0].createdAt, target.createdAt, "编辑不该改创建时间");
});

test("S4h·7 删一条回复：只有作者或用户能删（别人删 → 抛错）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  const withReply = await addReply(dir, root.id, { author: AGENT, body: "Agent 的话" });
  const replyId = withReply.replies[0].id;

  // 另一个 Agent 删不了
  await assert.rejects(
    () => removeReply(dir, root.id, replyId, { kind: "agent", id: "reviewer" }),
    /只有|不能/,
  );
  // 作者自己能删
  const gone = await removeReply(dir, root.id, replyId, AGENT);
  assert.deepEqual(gone.replies, []);
});

test("S4h·8 删不存在的回复 → 返回原样（幂等，不抛）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  const same = await removeReply(dir, root.id, "rr_nope", USER);
  assert.equal(same.id, root.id);
  assert.deepEqual(same.replies, []);
});

// ── 已关闭的线程不能回复 ────────────────────────────────────────────────────

test("S4h·9 已关闭的线程不能回复（Gitea 已解决会话默认隐藏、要回复须先解除）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  await setCommentState(dir, root.id, "resolved", USER);
  assert.equal(canReplyToComment({ state: "resolved" }), false);
  await assert.rejects(() => addReply(dir, root.id, { author: AGENT, body: "还想说" }), /关闭|重开/);
});

test("S4h·10 重开之后可以继续回复（关闭不是终点）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  await setCommentState(dir, root.id, "resolved", USER);
  await setCommentState(dir, root.id, "open", USER);
  const replied = await addReply(dir, root.id, { author: AGENT, body: "重开后能说了" });
  assert.equal(replied.replies.length, 1);
});

// ── awaiting 交棒 ──────────────────────────────────────────────────────────

test("S4h·11 Agent 回复 → awaiting 变成 user（交棒给用户去看/去关）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);            // 用户提的，默认 awaiting=null
  const replied = await addReply(dir, root.id, { author: AGENT, body: "已闭环" });
  assert.equal(replied.awaiting, "user");
});

test("S4h·12 用户回复 → awaiting 变成 agent（用户在追问/交回给 Agent）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  const replied = await addReply(dir, root.id, { author: USER, body: "那这里呢？" });
  assert.equal(replied.awaiting, "agent");
});

test("S4h·13 手动改 awaiting（G1 界面入口的落点）：合法值通过，非法值被拒", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  const toAgent = await setCommentAwaiting(dir, root.id, "agent", USER);
  assert.equal(toAgent.awaiting, "agent");
  const cleared = await setCommentAwaiting(dir, root.id, null, USER);
  assert.equal(cleared.awaiting, null);
  await assert.rejects(() => setCommentAwaiting(dir, root.id, "nobody", USER), /awaiting/);
});

test("S4h·14 已关闭的线程：存储值保留但「现在等谁」派生为 null（一条规则，不在两处各自实现）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  await setCommentAwaiting(dir, root.id, "agent", USER);
  const closed = await setCommentState(dir, root.id, "resolved", USER);
  // 存储层不抹掉事实（S4e·11 锁定了：落盘保留 awaiting）；
  // “已关闭就不再等谁”由 `awaitingOf` 一处派生——UI 读它，不自己拼。
  assert.equal(closed.awaiting, "agent", "存储值被抹了（S4e·11 会红）");
  assert.equal(awaitingOf(closed), null, "已关闭还显示「等 Agent」——界面会谎报");
});

// ── 迁移（v1 → v2）────────────────────────────────────────────────────────

test("S4h·15 v1 旧数据能读（老评论的 replies 补成空数组，不整批丢弃）", async () => {
  const dir = freshTask();
  const file = commentsFileOf(dir);
  mkdirSync(join(file, ".."), { recursive: true });
  // 手工造一份 v1 文件（没有 replies 字段）
  writeFileSync(file, JSON.stringify({
    version: 1,
    taskId: "0010",
    taskDir: dir,
    comments: [{
      id: "rc_old", taskId: "0010", author: USER,
      anchor: { source: "worktree", path: "a.ts", side: "new", start: 1, end: 1 },
      body: "旧评论", marks: [], state: "open", awaiting: null, canClose: "author-or-user",
      createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
    }],
  }));
  const items = await readComments(dir);
  assert.equal(items.length, 1, "v1 数据被整批丢弃了——用户已有的评论会消失");
  assert.equal(items[0].body, "旧评论");
  assert.deepEqual(items[0].replies, []);
});

test("S4h·16 写入用 SCHEMA_VERSION=2（下次读到的不再是 v1）", async () => {
  assert.equal(SCHEMA_VERSION, 2);
  const dir = freshTask();
  await makeRoot(dir);
  const raw = JSON.parse(readFileSync(commentsFileOf(dir), "utf8"));
  assert.equal(raw.version, 2);
});

test("S4h·17 坏回复条目逐条跳过（一条坏数据不拖垮整个线程）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  const file = commentsFileOf(dir);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  raw.comments[0].replies = [null, 3, { id: "rr_ok", author: AGENT, body: "好的", createdAt: "2026-11-05T00:00:00.000Z" }];
  writeFileSync(file, JSON.stringify(raw));
  const items = await readComments(dir);
  assert.equal(items.length, 1);
  assert.equal(items[0].replies.length, 1);
  assert.equal(items[0].replies[0].body, "好的");
  assert.equal(items[0].id, root.id);
});

test("S4h·18 reply 的 author 非法（kind 不对）→ 该条被丢弃，不写入", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  await assert.rejects(
    () => addReply(dir, root.id, { author: { kind: "robot", id: "x" }, body: "?" }),
    /author|author 不合法|不合法/,
  );
  const reread = (await readComments(dir)).find((c) => c.id === root.id);
  assert.deepEqual(reread.replies, []);
});

test("S4h·19 回复 id 全局唯一（同一线程 20 条互不相同）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  let current = root;
  for (let i = 0; i < 20; i += 1) current = await addReply(dir, root.id, { author: AGENT, body: `回复 ${i}` });
  const ids = new Set(current.replies.map((r) => r.id));
  assert.equal(ids.size, 20);
});

test("S4h·20 空 body 的回复被拒（空回复没有信息量，difit 的 CommentForm 也不允许空提交）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  await assert.rejects(() => addReply(dir, root.id, { author: AGENT, body: "   " }), /body|内容/);
});

// ── 自检抓到的缺陷：编辑会静默改写状态 ─────────────────────────────────────

test("S4i·1 编辑正文不改状态（open 不能被降回 draft）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  // 升到 open（模拟已在讨论中的线程）
  const opened = await setCommentState(dir, root.id, "open", USER);
  assert.equal(opened.state, "open");
  // 同键覆盖（= 编辑正文）时**不传 state**：必须保留原状态
  const edited = await upsertComment(dir, rootInput({ body: "改过的正文" }));
  assert.equal(edited.state, "open", "编辑把 open 降回 draft 了——状态被编辑动作污染");
  assert.equal(edited.body, "改过的正文");
});

test("S4i·2 改语气也不改状态（marks 与 state 是两件事）", async () => {
  const dir = freshTask();
  const root = await makeRoot(dir);
  await setCommentState(dir, root.id, "open", USER);
  const edited = await upsertComment(dir, rootInput({ marks: ["critic"] }));
  assert.equal(edited.state, "open", "改语气把状态改了");
  assert.deepEqual(edited.marks, ["critic"]);
});
