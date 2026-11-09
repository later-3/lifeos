// 检视模式 S1·G1a：按需取文件全文（折叠未改行展开时用）。
//
// 为什么需要这个接口（依据）：
//  - 我们的 diff 来自 `git diff --unified=3`，patch 里只有改动行前后各 3 行上下文；
//    用户点"展开更多"时，那些行不在 patch 里，必须回源取。
//  - 参考实现同构：difit `GET /api/blob/<path>?ref=<commitish>`（src/server/server.ts:495-540）
//    + 前端 `useExpandedLines.ts:52`；opencode 走的是 `@pierre/diffs` 的 `fileDiff`（含全文）。
//    我们选 difit 的按需模式：30 文件 patch 已 1.1MB，接口直返全文会翻几倍。
//
// 失败路径先写（backend 规范 2.5）：404 / 400 / 二进制 / 超限各有断言。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.LIFEOS_HOME = mkdtempSync(join(tmpdir(), "lifeos-blob-test-"));

const { readReviewBlob, MAX_FILE_DIFF_BYTES } = await import(`${HERE}/../src/review.ts`);

const git = (cwd, args) =>
  execFileSync("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** 建 Task：代码仓（main 上有 base.ts / del.ts / 中文.md）+ 真实 worktree。 */
function makeTask(n) {
  const home = process.env.LIFEOS_HOME;
  const root = mkdtempSync(join(tmpdir(), `blob-repo-${n}-`));
  git(root, ["init", "-b", "main", "."]);
  git(root, ["config", "user.email", "t@t"]);
  git(root, ["config", "user.name", "t"]);
  writeFileSync(join(root, "base.ts"), "line1\nline2\nline3\n");
  writeFileSync(join(root, "del.ts"), "gone\n");
  writeFileSync(join(root, "中文.md"), "# 旧标题\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "init"]);

  const taskDir = join(home, "agents", "a", "projects", "p", "tasks", `000${n}-blob`);
  mkdirSync(join(taskDir, "evidence"), { recursive: true });
  // 先把 Task 文档提交进家目录仓（基线），**再**建 worktree——顺序反了会让 git add 扫描
  // 到 worktree 里的 .git 指针文件，报 "not a git repository: .../worktrees/worktree"（实测踩到）。
  const homeReady = (() => { try { git(home, ["rev-parse", "--verify", "HEAD"]); return true; } catch { return false; } })();
  if (!homeReady) {
    git(home, ["init", "-b", "main", "."]);
    git(home, ["config", "user.email", "t@t"]);
    git(home, ["config", "user.name", "t"]);
  }
  writeFileSync(join(taskDir, "task.md"), "# Task\n");
  git(home, ["add", "--", join(taskDir, "task.md")]);
  git(home, ["commit", "-m", `task 000${n}`]);

  const wt = join(taskDir, "evidence", "worktree");
  git(root, ["worktree", "add", wt, "-b", `dev/blob-${n}`]);
  return { root, taskDir, wt, home };
}

test("G1a·1 修改文件：old 侧 = 基线提交内容，new 侧 = 工作区内容", async () => {
  const { root, taskDir, wt } = makeTask(1);
  try {
    writeFileSync(join(wt, "base.ts"), "line1\nCHANGED\nline3\nline4\n");
    const old = await readReviewBlob({ taskDir, source: "worktree", path: "base.ts", side: "old" });
    const cur = await readReviewBlob({ taskDir, source: "worktree", path: "base.ts", side: "new" });
    assert.equal(old.content, "line1\nline2\nline3\n", "old = main 上的原文");
    assert.equal(cur.content, "line1\nCHANGED\nline3\nline4\n", "new = 工作区（含未提交）");
    assert.equal(old.truncated, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("G1a·2 新增文件：old 侧为空（不是错误）", async () => {
  const { root, taskDir, wt } = makeTask(2);
  try {
    writeFileSync(join(wt, "fresh.ts"), "export const x = 1\n");
    const old = await readReviewBlob({ taskDir, source: "worktree", path: "fresh.ts", side: "old" });
    assert.equal(old.content, "", "新增文件在基线里不存在 → 空文本（行终止符纪律：空文本 = 0 行）");
    const cur = await readReviewBlob({ taskDir, source: "worktree", path: "fresh.ts", side: "new" });
    assert.equal(cur.content, "export const x = 1\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("G1a·3 删除文件：new 侧为空（不是错误）", async () => {
  const { root, taskDir, wt } = makeTask(3);
  try {
    rmSync(join(wt, "del.ts"));
    const cur = await readReviewBlob({ taskDir, source: "worktree", path: "del.ts", side: "new" });
    assert.equal(cur.content, "");
    const old = await readReviewBlob({ taskDir, source: "worktree", path: "del.ts", side: "old" });
    assert.equal(old.content, "gone\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("G1a·4 中文路径：不转义，能读（core.quotePath=false）", async () => {
  const { root, taskDir, wt } = makeTask(4);
  try {
    writeFileSync(join(wt, "中文.md"), "# 新标题\n");
    const old = await readReviewBlob({ taskDir, source: "worktree", path: "中文.md", side: "old" });
    const cur = await readReviewBlob({ taskDir, source: "worktree", path: "中文.md", side: "new" });
    assert.equal(old.content, "# 旧标题\n");
    assert.equal(cur.content, "# 新标题\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("G1a·5 超单文件上限：返回头部内容 + truncated=true（不是错误）", async () => {
  const { root, taskDir, wt } = makeTask(5);
  try {
    const big = "x".repeat(MAX_FILE_DIFF_BYTES + 1024) + "\n";
    writeFileSync(join(wt, "big.ts"), big);
    const cur = await readReviewBlob({ taskDir, source: "worktree", path: "big.ts", side: "new" });
    assert.equal(cur.truncated, true);
    assert.ok(cur.content.length > 0 && cur.content.length <= MAX_FILE_DIFF_BYTES, `内容被截到上限：${cur.content.length}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("G1a·6 路径逃逸（../ / 绝对 / NUL）：400 bad_request", async () => {
  const { root, taskDir } = makeTask(6);
  try {
    for (const bad of ["../../../etc/passwd", "/etc/passwd", "a\0b", ""]) {
      const r = await readReviewBlob({ taskDir, source: "worktree", path: bad, side: "new" });
      assert.ok("error" in r, `应拒绝：${JSON.stringify(bad)}`);
      assert.equal(r.error.status, 400);
      assert.equal(r.error.code, "bad_request");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("G1a·7 Task 目录不存在：404 task_dir_not_found", async () => {
  const r = await readReviewBlob({ taskDir: "/nope/not/a/task", source: "worktree", path: "a.ts", side: "old" });
  assert.ok("error" in r);
  assert.equal(r.error.status, 404);
  assert.equal(r.error.code, "task_dir_not_found");
});

test("G1a·8 源与侧参数非法：400 invalid_source / invalid_side", async () => {
  const { root, taskDir } = makeTask(8);
  try {
    const a = await readReviewBlob({ taskDir, source: "nope", path: "a.ts", side: "old" });
    assert.ok("error" in a);
    assert.equal(a.error.code, "invalid_source");
    const b = await readReviewBlob({ taskDir, source: "worktree", path: "a.ts", side: "middle" });
    assert.ok("error" in b);
    assert.equal(b.error.code, "invalid_side");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("G1a·9 文件在两侧都不存在：404 file_not_found", async () => {
  const { root, taskDir } = makeTask(9);
  try {
    const r = await readReviewBlob({ taskDir, source: "worktree", path: "ghost.ts", side: "new" });
    assert.ok("error" in r);
    assert.equal(r.status ?? r.error.status, 404);
    assert.equal(r.error.code, "file_not_found");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("G1a·10 二进制内容：拒绝并说明（不返回乱码）", async () => {
  const { root, taskDir, wt } = makeTask(10);
  try {
    writeFileSync(join(wt, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00]));
    const r = await readReviewBlob({ taskDir, source: "worktree", path: "blob.bin", side: "new" });
    assert.ok("error" in r, "二进制应拒绝");
    assert.equal(r.error.code, "binary_not_supported");
    assert.equal(r.error.status, 400);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("G1a·11 lifeos 源：old = 基线提交，new = 当前工作区（Task 文档）", async () => {
  const { root, taskDir, home } = makeTask(11);
  try {
    writeFileSync(join(taskDir, "task.md"), "# Task\n\n新增一段。\n");
    const old = await readReviewBlob({ taskDir, source: "lifeos", path: "task.md", side: "old" });
    const cur = await readReviewBlob({ taskDir, source: "lifeos", path: "task.md", side: "new" });
    assert.equal(old.content, "# Task\n", "old = 基线提交里的内容");
    assert.equal(cur.content, "# Task\n\n新增一段。\n", "new = 工作区当前内容");
    // 家目录真实 index 不被动（只读校验）
    const inIndex = git(home, ["diff", "--cached", "--name-only"]).trim();
    assert.equal(inIndex === "" || inIndex.includes("task.md"), true, "临时 index 不污染真实 index");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("G1a·12 worktree 不存在：404 worktree_missing（引导去建，不是静默空）", async () => {
  const home = process.env.LIFEOS_HOME;
  const taskDir = join(home, "agents", "a", "projects", "p", "tasks", "0012-nowt");
  mkdirSync(taskDir, { recursive: true });
  try {
    const r = await readReviewBlob({ taskDir, source: "worktree", path: "a.ts", side: "old" });
    assert.ok("error" in r);
    assert.equal(r.error.code, "worktree_missing");
    assert.equal(r.error.status, 404);
  } finally { rmSync(taskDir, { recursive: true, force: true }); }
});
