// 检视候选（D31 / A3+B2+C2）：先红后绿，全部用真实 git 夹具。
//
// 三条判据都来自实测（见 `src/review-candidates.ts` 头注）：
//  1. "有改动" = 工作区脏 ∪ 相对 main 有提交（只查 status 会漏掉已提交的分支）；
//  2. 文档侧一次全仓 status（不是每 Task 一次）；
//  3. daily 噪音单独标出，不混进"实质改动"。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = mkdtempSync(join(tmpdir(), "lifeos-candidates-"));
process.env.LIFEOS_HOME = HOME;

const { docChangesByTask, listCandidates, CANDIDATE_CONCURRENCY } = await import(`${HERE}/../src/review-candidates.ts`);

const git = (cwd, args) =>
  execFileSync("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const AGENT = "a1";
const PROJECT = "p1";
const TASKS = join(HOME, "agents", AGENT, "projects", PROJECT, "tasks");

/** 建一个 Task 目录 + task.md（满足 listTasks 的解析要求）。 */
function makeTask(id, title, opts = {}) {
  const dir = join(TASKS, `${id}-${title}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "task.md"), `# ${title}\n\nID: ${id}\n类型：development\n类别：A\n状态：进行中\n目标：测试\n`);
  if (opts.worktree === true) {
    // 真 worktree：从 projectRepo 建
    mkdirSync(join(dir, "evidence"), { recursive: true });
    git(process.env.CANDIDATES_REPO, ["worktree", "add", "-q", "-b", `dev/${id}`, join(dir, "evidence", "worktree")]);
  }
  return dir;
}

/** 家目录仓：git init，用于文档改动检测。 */
function initHomeRepo() {
  git(HOME, ["init", "-b", "main", "."]);
  git(HOME, ["config", "user.email", "t@t"]);
  git(HOME, ["config", "user.name", "t"]);
  git(HOME, ["add", "-A"]);
  git(HOME, ["commit", "-qm", "init", "--allow-empty"]);
}

/** 代码仓：有 main 分支的普通仓（worktree 从这里建）。 */
function initProjectRepo() {
  const repo = mkdtempSync(join(tmpdir(), "candidates-repo-"));
  git(repo, ["init", "-b", "main", "."]);
  git(repo, ["config", "user.email", "t@t"]);
  git(repo, ["config", "user.name", "t"]);
  writeFileSync(join(repo, "base.ts"), "export const a = 1\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "init"]);
  process.env.CANDIDATES_REPO = repo;
  return repo;
}

const repo = initProjectRepo();

// ── 1. 判据：有改动 = 脏 ∪ ahead ──────────────────────────────────────────

test("D31·1 worktree 干净且与 main 同步 → 没改动", async () => {
  makeTask("0001", "clean");
  makeTask("0002", "dirty", { worktree: true });
  // 0002 的 worktree 加一个未提交文件
  writeFileSync(join(TASKS, "0002-dirty", "evidence", "worktree", "new.ts"), "export const b = 2\n");
  initHomeRepo();
  const { items } = await listCandidates(AGENT, PROJECT);
  const byId = Object.fromEntries(items.map((item) => [item.taskId, item]));
  assert.equal(byId["0001"].hasWorktree, false, "没建 worktree");
  assert.equal(byId["0001"].worktreeChanged, false);
  assert.equal(byId["0002"].worktreeChanged, true, "未提交文件应算有改动");
});

test("D31·2 worktree **干净但相对 main 有提交** → 也算有改动（只查 status 会漏）", async () => {
  const dir = makeTask("0003", "committed", { worktree: true });
  const wt = join(dir, "evidence", "worktree");
  writeFileSync(join(wt, "feat.ts"), "export const f = 1\n");
  git(wt, ["add", "-A"]);
  git(wt, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "feat"]);
  assert.equal(git(wt, ["status", "--porcelain"]).trim(), "", "工作区应干净");
  const { items } = await listCandidates(AGENT, PROJECT);
  const target = items.find((item) => item.taskId === "0003");
  assert.equal(target.worktreeChanged, true, "ahead of main 必须算有改动");
});

// ── 2. 文档侧：一次全仓扫描 + daily 分层 ──────────────────────────────────

test("D31·3 docChangesByTask：按 task 分组计数，且识别'只有 daily'", async () => {
  const daily = join(TASKS, "0002-dirty", "daily");
  mkdirSync(daily, { recursive: true });
  writeFileSync(join(daily, "2026-11-08.md"), "- 日常一条\n");
  const map = await docChangesByTask();
  const key = `${AGENT}/${PROJECT}/0002`;
  const info = map.get(key);
  assert.ok(info !== undefined, `应能识别 ${key} 的文档改动`);
  assert.ok(info.count >= 1);
});

test("D31·4 daily 只有未跟踪分片时 → docOnlyDaily=true（C2 分层依据）", async () => {
  const dir = makeTask("0004", "onlydaily");
  /**
   * 夹具必须先把 `task.md` 提交掉：否则整个 task 目录都是未跟踪的，
   * 改动里既有 `task.md` 又有 `daily/…`，`onlyDaily` 当然算 false
   * （**实现是对的，夹具错**——第一次就踩到这个，记在这里）。
   */
  git(HOME, ["add", "--", dir]);
  git(HOME, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "add 0004", "--allow-empty"]);
  mkdirSync(join(dir, "daily"), { recursive: true });
  writeFileSync(join(dir, "daily", "2026-11-08.md"), "- 一条\n");
  const map = await docChangesByTask();
  const info = map.get(`${AGENT}/${PROJECT}/0004`);
  assert.equal(info?.onlyDaily, true, "只有 daily/ 应为 true");
});

test("D31·5 非 daily 的文档改动 → docOnlyDaily=false（算实质改动）", async () => {
  const dir = makeTask("0005", "docs");
  git(HOME, ["add", "--", dir]);
  git(HOME, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "add 0005", "--allow-empty"]);
  writeFileSync(join(dir, "log.md"), "- 过程记录\n");
  const map = await docChangesByTask();
  const info = map.get(`${AGENT}/${PROJECT}/0005`);
  assert.equal(info?.onlyDaily, false);
});

// ── 3. 排序与汇总 ────────────────────────────────────────────────────────

test("D31·6 排序：有实质改动 → 只有 daily → 其余；同组按编号倒序", async () => {
  initHomeRepo();
  const { items } = await listCandidates(AGENT, PROJECT);
  const ranks = items.map((item) => (item.substantive ? 0 : item.docChangedFiles > 0 ? 1 : 2));
  for (let i = 1; i < ranks.length; i += 1) {
    assert.ok(ranks[i - 1] <= ranks[i], `排序应单调：${ranks.join(",")}`);
  }
  for (let i = 1; i < items.length; i += 1) {
    if (ranks[i - 1] !== ranks[i]) continue;
    assert.ok(Number(items[i - 1].taskId) >= Number(items[i].taskId), "同组内编号倒序");
  }
});

test("D31·7 substantive 汇总：worktree 变了 或 有非 daily 文档改动", async () => {
  const { items } = await listCandidates(AGENT, PROJECT);
  for (const item of items) {
    const expected = item.worktreeChanged || (item.docChangedFiles > 0 && !item.docOnlyDaily);
    assert.equal(item.substantive, expected, `${item.taskId}`);
  }
});

test("D31·8 elapsedMs 有值（性能断言的落点）", async () => {
  const result = await listCandidates(AGENT, PROJECT);
  assert.equal(typeof result.elapsedMs, "number");
  assert.ok(result.elapsedMs >= 0);
  assert.equal(result.truncated, false);
});

test("D31·9 空 project（没有 task）→ 空列表，不抛", async () => {
  const result = await listCandidates("nobody", "noproject");
  assert.deepEqual(result.items, []);
});

test("D31·10 并发常量 = 16（实测依据：16 个 worktree 0.32s vs 串行 1.81s）", () => {
  assert.equal(CANDIDATE_CONCURRENCY, 16);
});

test.after(() => {
  rmSync(HOME, { recursive: true, force: true });
  try { rmSync(repo, { recursive: true, force: true }); } catch { /* worktree 还挂着 */ }
});

// ── D29 用户侧可见化：候选里带"有多少条评论等我"──────────────────────────

test("D29·1 没有评论的 Task → 三个计数都是 0", async () => {
  const { items } = await listCandidates(AGENT, PROJECT);
  const clean = items.find((item) => item.taskId === "0001");
  assert.equal(clean.commentsTotal, 0);
  assert.equal(clean.pendingForUser, 0);
});

test("D29·2 有评论：pendingForUser 复用 pendingFor 口径（未关闭 且 等用户或没人认领）", async () => {
  const { upsertComment, setCommentState, setCommentAwaiting } = await import("../src/review-comments.ts");
  const dir = join(TASKS, "0006-comments");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "task.md"), "# 0006\n\nID: 0006\n类型：development\n类别：A\n状态：进行中\n目标：t\n");
  /**
   * **必须先把 task.md 提交掉**（C207 的同款坑）：否则整个 task 目录未跟踪，
   * `task.md` 本身就是一条非 daily 的文档改动 → `substantive` 会是 true，
   * 于是"评论不影响 substantive"这条断言会因为**与评论无关的原因**而红。
   * 把不参与分类的部分先 fixed 住，断言才测的是它自己那件事。
   */
  git(HOME, ["add", "--", dir]);
  git(HOME, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "add 0006", "--allow-empty"]);
  const input = (start) => ({
    taskId: "0006", author: { kind: "user", id: "u" },
    anchor: { source: "worktree", path: "a.ts", side: "new", start, end: start },
    body: "x", marks: [],
  });
  const waitingUser = await upsertComment(dir, input(1));
  await setCommentAwaiting(dir, waitingUser.id, "user", { kind: "user", id: "u" });
  const waitingAgent = await upsertComment(dir, input(2));
  await setCommentAwaiting(dir, waitingAgent.id, "agent", { kind: "user", id: "u" });
  const nobody = await upsertComment(dir, input(3));
  assert.ok(nobody.id);
  const closed = await upsertComment(dir, input(4));
  await setCommentState(dir, closed.id, "resolved", { kind: "user", id: "u" });

  const { items } = await listCandidates(AGENT, PROJECT);
  const target = items.find((item) => item.taskId === "0006");
  assert.equal(target.commentsTotal, 4);
  assert.equal(target.openComments, 3, "已关闭的不算打开");
  // pendingFor(user) = 未关闭 且（等 user 或 没人认领）= waitingUser + nobody = 2
  assert.equal(target.pendingForUser, 2, `实际 ${target.pendingForUser}`);
});

test("D29·3 评论不影响 substantive（评论不是「改动」，不该点亮改动徽标）", async () => {
  const { items } = await listCandidates(AGENT, PROJECT);
  const target = items.find((item) => item.taskId === "0006");
  assert.equal(target.pendingForUser, 2);
  assert.equal(target.substantive, false, "只有评论、没有代码/文档改动 → 不算 substantive");
});
