// 检视模式 P1 测试（Task 0010）：真实 git 夹具，先红后绿。
// 覆盖（03-phase P1 清单）：
//   新增/修改/删除/重命名、未提交改动计入、已合并 worktree 为空、
//   中文路径、truncation 上限、家目录仓 Task 文档 diff、家目录无 .git 退化、
//   locateSources 约定/扫描、parseUnifiedPatchToHunks / quoteAtLines 穷举。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// 家目录换到临时目录：真实用户数据只读不写（testing 规范 2.1）
process.env.LIFEOS_HOME = mkdtempSync(join(tmpdir(), "lifeos-review-test-"));

const { locateSources, computeReviewDiff, filesFromPatch, MAX_REVIEW_FILES, MAX_REVIEW_DIFF_LINES } =
  await import(`${HERE}/../src/review.ts`);
const { parseUnifiedPatchToHunks, quoteAtLines } = await import(`${HERE}/../src/review-patch.ts`);

const git = (cwd, args) =>
  execFileSync("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/**
 * 建一个真实检视场景：代码仓（tmp，main 上有 init 提交）+ 家目录仓里的 Task 目录 +
 * 该 Task 的 evidence/worktree（真实 `git worktree add`，与实际形态一致）。
 * 返回 { root, taskDir, wt }；wt 的改动用 root 做 merge-base 基线。
 */
function makeTask(n) {
  const home = process.env.LIFEOS_HOME;
  const root = mkdtempSync(join(tmpdir(), `review-repo-${n}-`));
  git(root, ["init", "-b", "main", "."]);
  git(root, ["config", "user.email", "t@t"]);
  git(root, ["config", "user.name", "t"]);
  writeFileSync(join(root, "base.ts"), "export const a = 1\n");
  writeFileSync(join(root, "del.ts"), "export const gone = true\n");
  mkdirSync(join(root, "lib"));
  writeFileSync(join(root, "lib", "util.ts"), "export const u = () => 0\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "init"]);

  const taskDir = join(home, "agents", "t", "projects", "p", "tasks", `000${n}-x`);
  mkdirSync(join(taskDir, "evidence"), { recursive: true });
  const wt = join(taskDir, "evidence", "worktree");
  git(root, ["worktree", "add", wt, "-b", `dev/00${n}-test`]);
  return { root, taskDir, wt };
}

test("P1·1 worktree diff：新增/修改/删除/重命名/未提交全部计入（merge-base → 工作区）", async () => {
  const { root, taskDir, wt } = makeTask(1);
  try {
    writeFileSync(join(wt, "base.ts"), "export const a = 2\n");
    rmSync(join(wt, "del.ts"));
    git(wt, ["mv", join("lib", "util.ts"), join("lib", "renamed.ts")]);
    writeFileSync(join(wt, "feat.ts"), "export const f = 3\n");
    git(wt, ["add", "-A"]);
    git(wt, ["commit", "-m", "committed changes"]);
    // 未提交：改 feat.ts + 新增未跟踪 scratch.ts
    writeFileSync(join(wt, "feat.ts"), "export const f = 4\nexport const g = 5\n");
    writeFileSync(join(wt, "scratch.ts"), "// untracked\n");

    const { items } = await computeReviewDiff(taskDir);
    const worktree = items.find((i) => i.source.kind === "worktree");
    assert.ok(worktree, "有 worktree 源");
    const byPath = Object.fromEntries(worktree.files.map((f) => [f.path, f]));

    assert.equal(byPath["base.ts"].status, "modified");
    assert.equal(byPath["base.ts"].additions, 1);
    assert.equal(byPath["base.ts"].deletions, 1);
    assert.equal(byPath["del.ts"].status, "deleted");
    assert.equal(byPath["lib/renamed.ts"].status, "renamed");
    assert.equal(byPath["lib/renamed.ts"].oldPath, "lib/util.ts");
    assert.equal(byPath["feat.ts"].status, "added");
    assert.ok(byPath["feat.ts"].additions >= 2, "feat.ts 计入未提交修改（merge-base → 工作区）");
    // 未跟踪文件必须进 diff（Task 0004）：新建的 Task 文档、新建的源码都是未跟踪的，
    // 裸 `git diff` 会让“这个 Task 什么都没改”。走临时 index + add -A + write-tree。
    assert.ok(byPath["scratch.ts"], "untracked 必须进 diff");
    assert.equal(byPath["scratch.ts"].status, "added");
    assert.equal(byPath["scratch.ts"].additions, 1);
    assert.equal(worktree.truncated, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("P1·2 已合并的 worktree：diff 为空，不把 main 的前进算成待检视", async () => {
  const { root, taskDir, wt } = makeTask(2);
  try {
    writeFileSync(join(wt, "base.ts"), "export const a = 99\n");
    git(wt, ["add", "-A"]);
    git(wt, ["commit", "-m", "to merge"]);
    git(root, ["merge", "--no-ff", "-m", "merge it", "dev/002-test"]);
    writeFileSync(join(root, "main-only.ts"), "// main ahead\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "main ahead"]);

    const { items } = await computeReviewDiff(taskDir);
    const worktree = items.find((i) => i.source.kind === "worktree");
    assert.equal(worktree.files.length, 0,
      `已合并分支的 diff 应为空，实际 ${JSON.stringify(worktree.files.map((f) => f.path))}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("P1·3 中文路径：不转义、kind 归 doc", async () => {
  const { root, taskDir, wt } = makeTask(3);
  try {
    writeFileSync(join(wt, "设计文档.md"), "# 标题\n\n新增段落\n");
    git(wt, ["add", "-A"]);
    git(wt, ["commit", "-m", "add 中文文件"]);
    const { items } = await computeReviewDiff(taskDir);
    const md = items.find((i) => i.source.kind === "worktree").files.find((f) => f.path === "设计文档.md");
    assert.ok(md, `中文路径应在（实际：${items[0].files.map((f) => f.path).join(", ")}）`);
    assert.equal(md.kind, "doc");
    assert.ok(md.additions >= 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("P1·4 truncation：行数超限截断该文件；文件数超限钳到上限", () => {
  // 行数上限：单文件超 MAX_REVIEW_DIFF_LINES → 文件仍在但带 truncated，行被裁到上限内
  const n = MAX_REVIEW_DIFF_LINES + 10;
  const manyLines = Array.from({ length: n }, (_, i) => `+line ${i}`).join("\n");
  const patch = `diff --git a/big.ts b/big.ts\nnew file mode 100644\n--- /dev/null\n+++ b/big.ts\n@@ -0,0 +1,${n} @@\n${manyLines}\n`;
  const files = filesFromPatch(patch);
  assert.equal(files.length, 1, "超限文件仍在列表（用户要知道有个大文件）");
  assert.equal(files[0].truncated, true, "带截断标记");
  const total = files[0].hunks.reduce((acc, h) => acc + h.lines.length, 0);
  assert.ok(total <= MAX_REVIEW_DIFF_LINES, `裁后的行数 ${total} ≤ ${MAX_REVIEW_DIFF_LINES}`);

  // 文件数上限
  const head = [];
  for (let i = 0; i < MAX_REVIEW_FILES + 5; i++) {
    head.push(`diff --git a/f${i}.ts b/f${i}.ts`, "new file mode 100644", "--- /dev/null", `+++ b/f${i}.ts`, "@@ -0,0 +1 @@", `+c${i}`);
  }
  const many = filesFromPatch(head.join("\n"));
  assert.equal(many.length, MAX_REVIEW_FILES, "文件数钳到上限");
  assert.equal(many[MAX_REVIEW_FILES - 1].truncated, true, "最后一个文件带截断标记");
});

test("P1·5 家目录仓：Task 文档 diff（基线 → 当前，含未跟踪新文件，真实 index 不被动）", async () => {
  const home = process.env.LIFEOS_HOME;
  git(home, ["init", "-b", "main", "."]);
  git(home, ["config", "user.email", "t@t"]);
  git(home, ["config", "user.name", "t"]);
  const { taskDir } = makeTask(5);
  writeFileSync(join(taskDir, "task.md"), "# T\n\nv1\n");
  git(home, ["add", "-A"]);
  git(home, ["commit", "-m", "snapshot"]);

  writeFileSync(join(taskDir, "task.md"), "# T\n\nv2 with more\n");
  writeFileSync(join(taskDir, "log.md"), "# 日志\n\n新增行\n");

  const { items } = await computeReviewDiff(taskDir);
  const lifeos = items.find((i) => i.source.kind === "lifeos");
  assert.ok(lifeos, "有 lifeos 源");
  assert.ok(lifeos.base?.commit, "基线可见（base.commit）");
  const prefix = "agents/t/projects/p/tasks/0005-x/";
  const byPath = Object.fromEntries(lifeos.files.map((f) => [f.path.slice(prefix.length), f]));
  assert.equal(byPath["task.md"]?.status, "modified");
  assert.equal(byPath["log.md"]?.status, "added", "未跟踪新文件计入（temp-index 口径）");
  // 真实 index / 工作区未被提交或回滚
  const statusAfter = git(home, ["status", "--porcelain"]);
  assert.ok(statusAfter.includes("task.md"), "工作区改动仍在（没被偷偷提交）");
});

test("P1·6 家目录不是 git 仓 → 文档源退化为 no_vcs，不抛异常", async () => {
  const freshHome = mkdtempSync(join(tmpdir(), "lifeos-novcs-"));
  const oldHome = process.env.LIFEOS_HOME;
  process.env.LIFEOS_HOME = freshHome;
  try {
    const taskDir = join(freshHome, "agents", "t", "projects", "p", "tasks", "0001-x");
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, "task.md"), "# T\n");
    const { items } = await computeReviewDiff(taskDir);
    const lifeos = items.find((i) => i.source.kind === "lifeos");
    assert.ok(lifeos, "lifeos 源仍在");
    assert.equal(lifeos.degraded, "no_vcs", `退化标记（实际 ${JSON.stringify(lifeos)}）`);
    assert.equal(lifeos.files.length, 0);
  } finally {
    process.env.LIFEOS_HOME = oldHome;
    rmSync(freshHome, { recursive: true, force: true });
  }
});

test("P1·7 Task 目录不存在 → 404 形状的错误对象", async () => {
  const result = await computeReviewDiff(join(process.env.LIFEOS_HOME, "no", "such", "dir"));
  assert.ok(result.error, "返回 error 形状");
  assert.equal(result.error.code, "task_dir_not_found");
  assert.equal(result.error.status, 404);
});

test("P1·8 worktree 缺失 → exists:false 占位源（不是错误）", async () => {
  const taskDir = join(process.env.LIFEOS_HOME, "agents", "t", "projects", "p", "tasks", "0002-nowt");
  mkdirSync(taskDir, { recursive: true });
  const { items } = await computeReviewDiff(taskDir);
  const wt = items.find((i) => i.source.kind === "worktree");
  assert.ok(wt, "worktree 占位源在");
  assert.equal(wt.source.exists, false);
  assert.equal(wt.files.length, 0);
});

test("P1·9 locateSources：约定路径优先，扫描兜底（tasks/NNNN/worktree 形态）", async () => {
  try {
    // 形态 A：worktree 直接在 Task 目录下（reviewer 0003 实际形态）——用独立 git init 仓
    const taskDir = mkdtempSync(join(tmpdir(), "task-dir-"));
    const scanRepo = join(taskDir, "worktree");
    mkdirSync(scanRepo, { recursive: true });
    git(scanRepo, ["init", "-q"]);
    const sources = await locateSources(taskDir);
    const w = sources.find((s) => s.kind === "worktree");
    assert.ok(w, "扫描兜底找到 worktree");
    assert.equal(w.via, "scan");
    assert.equal(w.path, join(taskDir, "worktree"));
    assert.ok(sources.some((s) => s.kind === "lifeos"), "lifeos 源总在");

    // 形态 B：约定路径优先
    const taskDir2 = mkdtempSync(join(tmpdir(), "task-dir2-"));
    mkdirSync(join(taskDir2, "evidence", "worktree"), { recursive: true });
    git(join(taskDir2, "evidence", "worktree"), ["init", "-q"]);
    const sources2 = await locateSources(taskDir2);
    assert.equal(sources2.find((s) => s.kind === "worktree").via, "convention");
  } finally { /* tmp 自清理 */ }
});

// ---- parseUnifiedPatchToHunks 穷举 ----

test("P1·10 解析：hunk 计数、双行号、上下文/增/删", () => {
  const hunks = parseUnifiedPatchToHunks([
    "@@ -1,3 +1,4 @@",
    " ctx",
    "-old line",
    "+new line",
    "+another",
    " tail",
  ]);
  assert.equal(hunks.length, 1);
  const h = hunks[0];
  assert.deepEqual([h.oldStart, h.oldLines, h.newStart, h.newLines], [1, 3, 1, 4]);
  assert.deepEqual(h.lines, [
    { type: "context", oldNo: 1, newNo: 1, text: "ctx" },
    { type: "removed", oldNo: 2, newNo: null, text: "old line" },
    { type: "added", oldNo: null, newNo: 2, text: "new line" },
    { type: "added", oldNo: null, newNo: 3, text: "another" },
    { type: "context", oldNo: 3, newNo: 4, text: "tail" },
  ]);
});

test("P1·11 解析：hunk 头省略 count（,1）、多 hunk、No-newline", () => {
  const hunks = parseUnifiedPatchToHunks([
    "@@ -5 +5 @@",
    "-a",
    "+b",
    "@@ -20,2 +21,2 @@",
    " x",
    "\\ No newline at end of file",
    "+y",
  ]);
  assert.equal(hunks.length, 2);
  assert.deepEqual([hunks[0].oldStart, hunks[0].oldLines, hunks[0].newStart, hunks[0].newLines], [5, 1, 5, 1]);
  assert.deepEqual(
    hunks[1].lines.map((l) => [l.type, l.text, l.oldNo, l.newNo]),
    [["context", "x", 20, 21], ["added", "y", null, 22]],
  );
});

test("P1·12 解析：空体 / 无 hunk 头 → 空数组（不抛）", () => {
  assert.deepEqual(parseUnifiedPatchToHunks([]), []);
  assert.deepEqual(parseUnifiedPatchToHunks(["diff --git a/x b/x", "not a hunk"]), []);
});

test("P1·13 quoteAtLines：按侧取原文（context 属两侧），越界/倒序 undefined", () => {
  const hunks = parseUnifiedPatchToHunks([
    "@@ -1,3 +1,3 @@",
    " keep",
    "-gone",
    "+here",
    " end",
  ]);
  assert.equal(quoteAtLines(hunks, "old", 2, 2), "gone");
  assert.equal(quoteAtLines(hunks, "new", 2, 2), "here");
  assert.equal(quoteAtLines(hunks, "old", 1, 1), "keep");
  // context 行两侧都属：new 1-3 = keep/here/end
  assert.equal(quoteAtLines(hunks, "new", 1, 3), "keep\nhere\nend");
  assert.equal(quoteAtLines(hunks, "old", 1, 3), "keep\ngone\nend");
  // old 侧跳过纯 added 行（类型过滤）：old 2..3 只有 gone 与 end（end 是 context oldNo=3）
  assert.equal(quoteAtLines(hunks, "old", 2, 3), "gone\nend");
  // 越界与倒序
  assert.equal(quoteAtLines(hunks, "new", 99, 100), undefined);
  assert.equal(quoteAtLines(hunks, "new", 3, 1), undefined);
});
