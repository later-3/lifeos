// P4 · 检视状态总览（`src/review-overview.ts`）：先写用例，再补实现。
//
// 为什么要有总览（用户 2026-11-07 原话）：
//   "我们做检视模式的工具，把工具给到 agent，然后 agent 能知道怎么查询有哪些检视意见，怎么回复。"
// 已有的四个工具分别管"读某条 / 写一条 / 回复 / 关闭"，但**没有一个是总览**：
// Agent 想知道"检视对象在哪、有多少改动、几条等我"，得先猜路径再一条条试。
//
// 本文件的用例分两层：
//  ① 纯格式化（`formatReviewOverview`）：给一份构造好的总览，断言文本里**每一段都能促成下一步动作**；
//  ② 真路径（`reviewOverviewOf`）：在临时家目录里造 Task + worktree + 评论，断言聚合结果
//     （数量、分组、等待方统计、warnings 不静默）。
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const { formatReviewOverview, reviewOverviewOf } = await import("../src/review-overview.ts");
const { upsertComment, setCommentState, addReply, setCommentAwaiting } = await import("../src/review-comments.ts");

const BASE_OVERVIEW = {
  taskId: "0010",
  taskDir: "/home/u/.lifeos/agents/a/projects/p/tasks/0010-review",
  sources: [
    { kind: "worktree", path: "/home/u/.lifeos/agents/a/projects/p/tasks/0010-review/evidence/worktree", exists: true, branch: "dev/0010-review", head: "abc1234" },
    { kind: "lifeos", path: "/home/u/.lifeos/agents/a/projects/p/tasks/0010-review", exists: true, head: "def5678" },
  ],
  files: { total: 3, code: 2, doc: 1, other: 0, additions: 41, deletions: 7, truncated: false, sample: ["src/a.ts (+20 -3)", "src/b.ts (+15 -4)", "README.md (+6 -0)"] },
  comments: {
    total: 3,
    byState: { draft: 0, open: 2, resolved: 1 },
    awaiting: { none: 1, user: 1, agent: 1 },
    pendingForAgent: 2,
    pendingForUser: 0,
    threadsWithReplies: 1,
    latest: [
      { id: "rc_1", where: "src/a.ts:L10-L12 (new)", author: "user:xu-later", state: "open", awaiting: "agent", replies: 1, preview: "这三行为什么不合并？" },
      { id: "rc_2", where: "README.md:L3 (new)", author: "agent:coder", state: "open", awaiting: null, replies: 0, preview: "这里缺一句说明。" },
      { id: "rc_3", where: "src/b.ts:L2 (old)", author: "user:xu-later", state: "resolved", awaiting: null, replies: 0, preview: "已处理。" },
    ],
  },
  warnings: [],
};

// ── ① 纯格式化 ──────────────────────────────────────────────────────────────

test("P4·1 总览文本说清三件事：检视对象在哪 / 改了多少 / 有几条等我", () => {
  const text = formatReviewOverview(BASE_OVERVIEW);
  assert.match(text, /Review state for task 0010/);
  assert.match(text, /project code \(repo\/\): .*evidence\/worktree \(exists, branch dev\/0010-review @ abc1234\)/, text);
  assert.match(text, /home documents \(~\/\.lifeos\): .*0010-review \(exists, @ def5678\)/);
  assert.match(text, /Changes: 3 file\(s\) \(\+41 -7\) — code 2, doc 1, other 0/);
  assert.match(text, /Comments: 3 thread\(s\) — draft 0, open 2, resolved 1/);
  assert.match(text, /Waiting \(open threads only\): for you 2, for the user 0, unassigned 1/);
});

test("P4·2 每个下一步都给出**具体工具名与参数形状**（不是「用工具查一下」）", () => {
  const text = formatReviewOverview(BASE_OVERVIEW);
  for (const fragment of [
    "lifeos_review_comments({ taskId, pendingForMe: true })",
    "lifeos_review_comments({ taskId })",
    "lifeos_review_comment_reply({ taskId, id, body })",
    "lifeos_review_comment_resolve({ taskId, id })",
  ]) {
    assert.ok(text.includes(fragment), `缺下一步指引：${fragment}\n---\n${text}`);
  }
  // 关闭权限的边界必须写出来，否则 Agent 会去关用户的评论然后撞 403
  assert.match(text, /threads the user raised can only be closed by the user/);
});

test("P4·3 线程列表带 id 与位置（Agent 拿它去回复/关闭，不用再猜 id）", () => {
  const text = formatReviewOverview(BASE_OVERVIEW);
  assert.match(text, /- rc_1 src\/a\.ts:L10-L12 \(new\) by user:xu-later · open waiting:agent · 1 reply — 这三行为什么不合并？/);
  assert.match(text, /- rc_2 README\.md:L3 \(new\) by agent:coder · open · 0 replies — 这里缺一句说明。/);
});

test("P4·4 文件多时给样本 + 「还有 N 个」，不把上百行文件清单塞给模型", () => {
  const many = {
    ...BASE_OVERVIEW,
    files: { ...BASE_OVERVIEW.files, total: 30, sample: BASE_OVERVIEW.files.sample },
  };
  const text = formatReviewOverview(many);
  assert.match(text, /…and 27 more/);
});

test("P4·5 没有 worktree 时给出可行动的说明（不是只说「没有」）", () => {
  const text = formatReviewOverview({
    ...BASE_OVERVIEW,
    sources: [{ kind: "worktree", path: "/x/evidence/worktree", exists: false }, { kind: "lifeos", path: "/x", exists: true }],
  });
  assert.match(text, /project code \(repo\/\): .*\(missing\)/);
  assert.match(text, /no code worktree for this task yet.*repo\//);
});

test("P4·6 warnings 必须出现在文本里（聚合失败不许静默）", () => {
  const text = formatReviewOverview({ ...BASE_OVERVIEW, warnings: ["no_vcs：这个目录不是 git 仓库"] });
  assert.match(text, /Warnings:/);
  assert.match(text, /no_vcs：这个目录不是 git 仓库/);
});

// ── ② 真路径（临时家目录 + 真 git）─────────────────────────────────────────

/** 建一个装好家目录结构的临时环境，返回 Task 目录。 */
async function freshTask(label) {
  const home = await mkdtemp(join(tmpdir(), `review-overview-${label}-`));
  process.env.LIFEOS_HOME = home;
  const taskDir = join(home, "agents", "a", "projects", "p", "tasks", "0010-review");
  await mkdir(join(taskDir, "evidence"), { recursive: true });
  await writeFile(join(taskDir, "task.md"), "# 0010 检视模式\n\n状态：进行中\n");
  return { home, taskDir };
}

test("P4·7 真路径：worktree 有改动 → 文件数与增删行数正确，源码可读", async () => {
  const { taskDir } = await freshTask("real");
  const worktree = join(taskDir, "evidence", "worktree");
  await mkdir(worktree, { recursive: true });
  await run("git", ["-C", worktree, "init", "-q"], { env: { ...process.env } });
  await run("git", ["-C", worktree, "config", "user.email", "t@x"], { env: { ...process.env } });
  await run("git", ["-C", worktree, "config", "user.name", "t"], { env: { ...process.env } });
  await writeFile(join(worktree, "a.ts"), "const a = 1;\n");
  await run("git", ["-C", worktree, "add", "."], { env: { ...process.env } });
  await run("git", ["-C", worktree, "commit", "-qm", "init"], { env: { ...process.env } });
  // 未提交的改动（baseline = 首个提交 → 工作区差异）
  await writeFile(join(worktree, "a.ts"), "const a = 1;\nconst b = 2;\n");

  const overview = await reviewOverviewOf(taskDir, "0010");
  const worktreeSource = overview.sources.find((source) => source.kind === "worktree");
  assert.equal(worktreeSource?.exists, true);
  assert.equal(overview.files.total >= 1, true, JSON.stringify(overview.files));
  assert.equal(overview.files.additions >= 1, true, JSON.stringify(overview.files));
  assert.equal(overview.files.code >= 1, true, JSON.stringify(overview.files));
  assert.ok(overview.files.sample.some((line) => line.includes("a.ts")), JSON.stringify(overview.files.sample));
  assert.deepEqual(overview.warnings, [], JSON.stringify(overview.warnings));
});

test("P4·8 真路径：评论按状态/等待方聚合；等待方统计与「已关闭不再等谁」同口径", async () => {
  const { taskDir } = await freshTask("comments");
  const input = (body, start) => ({
    taskId: "0010",
    author: { kind: "user", id: "xu-later" },
    anchor: { source: "worktree", path: "a.ts", side: "new", start, end: start },
    body,
    marks: [],
  });
  const waitingAgent = await upsertComment(taskDir, input("等 Agent 处理", 1));
  await setCommentAwaiting(taskDir, waitingAgent.id, "agent", { kind: "user", id: "xu-later" });
  const waitingUser = await upsertComment(taskDir, input("等用户看", 2));
  await setCommentAwaiting(taskDir, waitingUser.id, "user", { kind: "user", id: "xu-later" });
  const unassigned = await upsertComment(taskDir, input("没人认领", 3));
  assert.ok(unassigned.id);
  const closedWithAgent = await upsertComment(taskDir, input("已关闭但还留着 awaiting", 4));
  await setCommentAwaiting(taskDir, closedWithAgent.id, "agent", { kind: "user", id: "xu-later" });
  await setCommentState(taskDir, closedWithAgent.id, "resolved", { kind: "user", id: "xu-later" });

  /**
   * Agent 回复会**交棒**：awaiting 从 agent 翻成 user（S4-h 的核心规则）。
   * 所以这里追加一条"还等着 Agent 且没人回过"的线程，才能分别验证"等 Agent"与"已关闭不再算等谁"。
   */
  const stillWaitingAgent = await upsertComment(taskDir, input("还等着 Agent", 5));
  await setCommentAwaiting(taskDir, stillWaitingAgent.id, "agent", { kind: "user", id: "xu-later" });
  await addReply(taskDir, waitingAgent.id, { author: { kind: "agent", id: "coder" }, body: "改了，见 a.ts:1" });

  const overview = await reviewOverviewOf(taskDir, "0010");
  assert.equal(overview.comments.total, 5);
  assert.deepEqual(overview.comments.byState, { draft: 0, open: 4, resolved: 1 });
  // 已关闭那条**不再计入「等 Agent」**（否则界面与统计会互相矛盾）
  assert.equal(overview.comments.awaiting.agent, 1, "只有「还等着 Agent」那条算；已关闭的那条不算");
  assert.equal(overview.comments.awaiting.user, 2, "Agent 回复后交棒的那条 + 原本等用户的");
  assert.equal(overview.comments.awaiting.none, 1, "只数未关闭里没人认领的 1 条；已关闭的不参与等待");
  assert.equal(overview.comments.threadsWithReplies, 1);
  /**
   * `pendingFor` 的口径（`src/review-comments.ts`）：未闭环 且（等我 **或** 没人认领）。
   * 所以「没人认领」那条**同时算两边的待办**——这是有意的：没人认领就等于谁都该看。
   * 已关闭的那条两边都不算。
   */
  assert.equal(overview.comments.pendingForAgent, 2, "等 Agent 1 条 + 没人认领 1 条");
  assert.equal(overview.comments.pendingForUser, 3, "等用户 2 条 + 没人认领 1 条（没人认领两边都算）");
});

test("P4·9 真路径：最新线程按 updatedAt 降序，正文只给首行预览（不搬全文）", async () => {
  const { taskDir, } = await freshTask("latest");
  const first = await upsertComment(taskDir, {
    taskId: "0010", author: { kind: "user", id: "xu-later" },
    anchor: { source: "worktree", path: "a.ts", side: "new", start: 1, end: 1 },
    body: "第一行\n第二行\n第三行", marks: [],
  }, "2026-11-01T00:00:00.000Z");
  await upsertComment(taskDir, {
    taskId: "0010", author: { kind: "user", id: "xu-later" },
    anchor: { source: "worktree", path: "a.ts", side: "new", start: 2, end: 2 },
    body: "后来的", marks: [],
  }, "2026-11-05T00:00:00.000Z");

  const overview = await reviewOverviewOf(taskDir, "0010");
  assert.equal(overview.comments.latest[0].preview, "后来的", "最新的排第一（按 updatedAt）");
  const multiLine = overview.comments.latest.find((item) => item.id === first.id);
  assert.equal(multiLine?.preview, "第一行", "预览只取首行，不把多行正文整段塞进来");
});

test("P4·10 真路径：worktree 不存在时给 exists=false 且 warnings 不含硬错误（缺 worktree 是正常状态）", async () => {
  const { taskDir } = await freshTask("nowt");
  const overview = await reviewOverviewOf(taskDir, "0010");
  const worktreeSource = overview.sources.find((source) => source.kind === "worktree");
  assert.equal(worktreeSource?.exists, false);
  assert.deepEqual(overview.warnings, []);
  const text = formatReviewOverview(overview);
  assert.match(text, /\(missing\)/);
});

test("P4·11 已关闭的线程不显示「等谁」，也不进任何一个等待桶（否则总数会超过线程数）", () => {
  const text = formatReviewOverview(BASE_OVERVIEW);
  // BASE_OVERVIEW 里第三条是 resolved 且 awaiting=null：三个桶 1+1+1 = 3 = 未关闭条数（2 open + 1 draft? 无 draft）
  const resolvedLine = text.split("\n").find((line) => line.includes("rc_3")) ?? "";
  assert.ok(resolvedLine !== "", "样本里应有已关闭那条");
  assert.equal(resolvedLine.includes("waiting:"), false, `已关闭的线程不该显示等谁：${resolvedLine}`);
});
