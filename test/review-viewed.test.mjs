// G10 Viewed + G9 文件树：纯函数穷举。
//
// 参考：difit `useViewedFiles.ts`（记录含 `diffContentHash`，判定"看过之后又变了"）、
//      `utils/diffUtils.ts:37-50`（哈希输入 = path+status+行 type:content，不含行号）、
//      `utils/autoViewedPatterns.ts`（模式自动标已看）。
// 我们的差异：记录存服务端（换设备仍保留）、哈希用同步 FNV-1a（可在渲染期与单测里直接算）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFileTree, diffContentHash, filesUnder, viewedStatesOf, viewedStatusOf, viewedSummaryOf,
} from "../frontend/src/review-viewed.ts";

const file = (over = {}) => ({
  path: "src/a.ts",
  status: "modified",
  hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [
    { type: "context", text: "const a = 1;" },
    { type: "removed", text: "const b = 2;" },
    { type: "added", text: "const b = 22;" },
  ] }],
  ...over,
});

test("G10·1 哈希：同内容同哈希（确定性）", () => {
  assert.equal(diffContentHash(file()), diffContentHash(file()));
});

test("G10·2 哈希：内容变、路径变、状态变都会变", () => {
  const base = diffContentHash(file());
  assert.notEqual(diffContentHash(file({ hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [{ type: "added", text: "改了" }] }] })), base, "内容变了哈希要变");
  assert.notEqual(diffContentHash(file({ path: "src/b.ts" })), base, "路径变了哈希要变");
  assert.notEqual(diffContentHash(file({ status: "added" })), base, "状态变了哈希要变");
});

test("G10·3 哈希**不含行号**：上下文折展导致的行号漂移不该让「已看」失效（difit 同判）", () => {
  const a = diffContentHash(file({ hunks: [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 3, lines: [{ type: "added", text: "x" }] }] }));
  const b = diffContentHash(file({ hunks: [{ oldStart: 900, oldLines: 3, newStart: 900, newLines: 3, lines: [{ type: "added", text: "x" }] }] }));
  assert.equal(a, b, "只改 hunk 起始行号，哈希不该变");
});

test("G10·4 哈希：空格/换行差异要能区分（不能把不同内容撞成同一个）", () => {
  const a = diffContentHash(file({ hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [{ type: "added", text: "a b" }] }] }));
  const b = diffContentHash(file({ hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [{ type: "added", text: "a  b" }] }] }));
  assert.notEqual(a, b);
});

test("G10·5 三态：没记录 = unviewed；哈希相同 = viewed；哈希不同 = changed（看过后又改了）", () => {
  assert.equal(viewedStatusOf(undefined, "abc"), "unviewed");
  assert.equal(viewedStatusOf({ path: "a", viewedAt: "", hash: "abc" }, "abc"), "viewed");
  assert.equal(viewedStatusOf({ path: "a", viewedAt: "", hash: "abc" }, "def"), "changed", "内容变了必须变成 changed，不能还算看过");
});

test("G10·6 viewedStatesOf：按传入顺序给每个文件的状态（没记录的不省略）", () => {
  const files = [file({ path: "a.ts" }), file({ path: "b.ts" }), file({ path: "c.ts" })];
  const hashB = diffContentHash(files[1]);
  const states = viewedStatesOf(files, [{ path: "b.ts", viewedAt: "t", hash: hashB }, { path: "c.ts", viewedAt: "t", hash: "stale" }]);
  assert.deepEqual(states.map((state) => state.path), ["a.ts", "b.ts", "c.ts"]);
  assert.deepEqual(states.map((state) => state.status), ["unviewed", "viewed", "changed"]);
});

test("G10·7 进度：只有 viewed 计入（changed 不算，进度条不能骗人）", () => {
  const summary = viewedSummaryOf([
    { path: "a", hash: "h", status: "viewed" },
    { path: "b", hash: "h", status: "viewed" },
    { path: "c", hash: "h", status: "changed" },
    { path: "d", hash: "h", status: "unviewed" },
  ]);
  assert.deepEqual(summary, { viewed: 2, changed: 1, total: 4, percent: 50 });
});

test("G10·8 进度：0 个文件 → 0%（不是 NaN）", () => {
  assert.deepEqual(viewedSummaryOf([]), { viewed: 0, changed: 0, total: 0, percent: 0 });
});

test("G9·9 建树：目录在前、同类按名字排序；文件在目录之后", () => {
  const states = [
    { path: "src/lib/b.ts", hash: "h", status: "unviewed" },
    { path: "README.md", hash: "h", status: "unviewed" },
    { path: "src/a.ts", hash: "h", status: "unviewed" },
  ];
  const tree = buildFileTree(states);
  assert.deepEqual(tree.map((node) => node.name), ["src", "README.md"], "目录在前");
  const src = tree[0];
  assert.equal(src.kind, "dir");
  if (src.kind === "dir") {
    assert.deepEqual(src.children.map((node) => node.name), ["lib", "a.ts"], "目录在前、文件在后");
  }
});

test("G9·10 目录三态：全看过 = all；一个没看 = none；部分 = some", () => {
  const allViewed = buildFileTree([
    { path: "d/a.ts", hash: "h", status: "viewed" },
    { path: "d/b.ts", hash: "h", status: "viewed" },
  ]);
  const dirAll = allViewed[0];
  assert.equal(dirAll.kind === "dir" ? dirAll.state : null, "all");
  assert.equal(dirAll.kind === "dir" ? dirAll.total : 0, 2);

  const mixed = buildFileTree([
    { path: "d/a.ts", hash: "h", status: "viewed" },
    { path: "d/b.ts", hash: "h", status: "unviewed" },
  ]);
  const dirMixed = mixed[0];
  assert.equal(dirMixed.kind === "dir" ? dirMixed.state : null, "some");
  assert.equal(dirMixed.kind === "dir" ? dirMixed.viewed : -1, 1);

  const none = buildFileTree([{ path: "d/a.ts", hash: "h", status: "unviewed" }]);
  const dirNone = none[0];
  assert.equal(dirNone.kind === "dir" ? dirNone.state : null, "none");
});

test("G9·11 目录三态：`changed` 不计入已看（内容变了要重看）", () => {
  const tree = buildFileTree([
    { path: "d/a.ts", hash: "h", status: "changed" },
    { path: "d/b.ts", hash: "h", status: "viewed" },
  ]);
  const dir = tree[0];
  assert.equal(dir.kind === "dir" ? dir.state : null, "some", "1 个 viewed + 1 个 changed → some，不是 all");
  assert.equal(dir.kind === "dir" ? dir.viewed : -1, 1);
});

test("G9·12 嵌套目录：父目录的计数包含孙子（不是只看直接子项）", () => {
  const tree = buildFileTree([
    { path: "a/b/c/d.ts", hash: "h", status: "viewed" },
    { path: "a/b/e.ts", hash: "h", status: "unviewed" },
  ]);
  const top = tree[0];
  assert.equal(top.kind === "dir" ? top.total : 0, 2, "a 下有 2 个文件（跨 c 一层）");
  assert.equal(top.kind === "dir" ? top.state : null, "some");
});

test("G9·13 filesUnder：勾选目录拿到该目录下全部文件路径（用于批量标记）", () => {
  const tree = buildFileTree([
    { path: "src/a.ts", hash: "h", status: "unviewed" },
    { path: "src/lib/b.ts", hash: "h", status: "unviewed" },
    { path: "docs/c.md", hash: "h", status: "unviewed" },
  ]);
  assert.deepEqual(filesUnder(tree, "src").sort(), ["src/a.ts", "src/lib/b.ts"]);
  assert.deepEqual(filesUnder(tree, "src/lib"), ["src/lib/b.ts"]);
  assert.deepEqual(filesUnder(tree, "nope"), []);
});

test("G9·14 空列表：建树不崩，返回空数组", () => {
  assert.deepEqual(buildFileTree([]), []);
});
