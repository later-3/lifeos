// G5/G6：大 diff 保护与懒挂载的纯判定——穷举。
//
// 参考：opencode `session-review-machine.ts:150-169`（四态纯函数）+ `:1`（500 行上限）
//      + `session-review.tsx:660`（160px 占位）；difit `useLazyDiffRendering.ts:6-7`（首屏 8 个 / 1200px 预取）。
// 我们的差异（有意）：超限**仍然渲染**只给前 200 行 + 提示，不把内容挡住。
import test from "node:test";
import assert from "node:assert/strict";
import {
  fileBodyOf, initialMountedFiles, LAZY_PLACEHOLDER_HEIGHT_PX, LAZY_ROOT_MARGIN, LARGE_FILE_PREVIEW_LINES,
  MAX_CHANGED_LINES_BEFORE_COLLAPSE, mountFile, needsLargeFileNotice, INITIAL_RENDERED_FILES,
} from "../frontend/src/review-lazy.ts";

const base = { expanded: true, forced: false, changedLines: 10, totalLines: 40, mounted: true };

test("G5·1 常量与参考项目同值（500 行 / 8 文件 / 1200px / 160px）", () => {
  assert.equal(MAX_CHANGED_LINES_BEFORE_COLLAPSE, 500, "opencode session-review-machine.ts:1");
  assert.equal(INITIAL_RENDERED_FILES, 8, "difit useLazyDiffRendering.ts:6");
  assert.equal(LAZY_ROOT_MARGIN, "1200px 0px", "difit useLazyDiffRendering.ts:7");
  assert.equal(LAZY_PLACEHOLDER_HEIGHT_PX, 160, "opencode session-review.tsx:660");
});

test("G5·2 折叠态 → collapsed（不渲染内容，但文件头还在）", () => {
  assert.equal(fileBodyOf({ ...base, expanded: false }), "collapsed");
});

test("G5·3 展开 + 未挂载 → placeholder（先占位，滚到再挂）", () => {
  assert.equal(fileBodyOf({ ...base, mounted: false }), "placeholder");
});

test("G5·4 展开 + 已挂载 + 小文件 → mounted", () => {
  assert.equal(fileBodyOf({ ...base, changedLines: 500 }), "mounted", "正好 500 行不算超限（> 才是超限）");
});

test("G5·5 展开 + 已挂载 + 大文件 → large（**渲染但给提示**，不是挡住）", () => {
  assert.equal(fileBodyOf({ ...base, changedLines: 501 }), "large");
  assert.equal(needsLargeFileNotice({ expanded: true, changedLines: 501, forced: false }), true);
});

test("G5·6 用户点过「全部显示」→ forced 优先，直接 mounted（不再提示）", () => {
  assert.equal(fileBodyOf({ ...base, changedLines: 99_999, forced: true }), "mounted");
  assert.equal(needsLargeFileNotice({ expanded: true, changedLines: 99_999, forced: true }), false);
});

test("G5·7 折叠态不提示大文件（没展开就没必要打扰）", () => {
  assert.equal(needsLargeFileNotice({ expanded: false, changedLines: 9000, forced: false }), false);
});

test("G5·8 大文件默认只展开前 N 行（不是全部）", () => {
  assert.equal(LARGE_FILE_PREVIEW_LINES, 200);
  assert.ok(LARGE_FILE_PREVIEW_LINES < MAX_CHANGED_LINES_BEFORE_COLLAPSE, "预览行数必须小于门槛，否则提示没意义");
});

test("G6·9 首屏只挂前 8 个文件，其余先占位（difit 同值）", () => {
  const files = Array.from({ length: 20 }, (_, i) => ({ path: `f${i}.ts` }));
  const mounted = initialMountedFiles(files);
  assert.equal(mounted.size, 8);
  assert.equal(mounted.has("f7.ts"), true);
  assert.equal(mounted.has("f8.ts"), false, "第 9 个不该在首屏挂载");
});

test("G6·10 文件少于 8 个 → 全部挂载（不会因为懒挂载而空着）", () => {
  const files = [{ path: "a.ts" }, { path: "b.ts" }];
  const mounted = initialMountedFiles(files);
  assert.equal(mounted.size, 2);
  assert.equal(mounted.has("a.ts") && mounted.has("b.ts"), true);
});

test("G6·11 mountFile：追加一个且幂等（滚动反复触发不会越加越多）", () => {
  const first = mountFile(new Set(), "a.ts");
  assert.equal(first.size, 1);
  const again = mountFile(first, "a.ts");
  assert.equal(again.size, 1);
  assert.equal(again, first, "已挂载时返回同一个 Set 引用（避免无意义重渲染）");
  const second = mountFile(first, "b.ts");
  assert.equal(second.size, 2);
  assert.equal(first.size, 1, "不能修改传入的 Set（纯函数）");
});

test("G6·12 空文件列表：不挂载任何东西（不崩）", () => {
  assert.equal(initialMountedFiles([]).size, 0);
  assert.equal(fileBodyOf({ ...base, expanded: false }), "collapsed");
});
