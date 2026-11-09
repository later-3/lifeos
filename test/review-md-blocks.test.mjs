// G15 md 渲染态 diff：块聚合与围栏切分（纯函数穷举）。
//
// 参考：difit `src/client/viewers/MarkdownDiffViewer.tsx` `buildPreviewBlocks`（:90-121）
//      + `buildRenderBlocks` + `getBlockStyle`（:335-346）。
// 我们**不实现** frontmatter 表格 diff（实测本项目 167 个 md 里 0 个有 frontmatter）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  blockChanged, buildPreviewBlocks, buildRenderBlocks, isPlainBlock, parseFenceStart,
} from "../frontend/src/review-md-blocks.ts";

const ctx = (n, text) => ({ type: "context", oldNo: n, newNo: n, text });
const del = (n, text) => ({ type: "removed", oldNo: n, newNo: null, text });
const add = (n, text) => ({ type: "added", oldNo: null, newNo: n, text });

// ── 块聚合 ────────────────────────────────────────────────────────────────

test("G15·1 连续 context → 一块 context（不是每行一块）", () => {
  const blocks = buildPreviewBlocks([ctx(1, "a"), ctx(2, "b"), ctx(3, "c")]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "context");
  assert.deepEqual(blocks[0].lines, ["a", "b", "c"]);
});

test("G15·2 只有删除（后面没新增）→ delete 块", () => {
  const blocks = buildPreviewBlocks([ctx(1, "keep"), del(2, "gone"), ctx(3, "after")]);
  assert.deepEqual(blocks.map((b) => b.type), ["context", "delete", "context"]);
  assert.deepEqual(blocks[1].lines, ["gone"]);
});

test("G15·3 删 + 紧接新增 → 删除成块、新增记 change（同一处改动）", () => {
  const blocks = buildPreviewBlocks([del(2, "old"), add(2, "new")]);
  assert.deepEqual(blocks.map((b) => b.type), ["delete", "change"]);
});

test("G15·4 只有新增（前面不是删除）→ add 块（不是 change）", () => {
  const blocks = buildPreviewBlocks([ctx(1, "a"), add(2, "b")]);
  assert.deepEqual(blocks.map((b) => b.type), ["context", "add"]);
});

test("G15·5 多处改动：change 之后的 context 会重置，不会把后面的新增都算 change", () => {
  const blocks = buildPreviewBlocks([
    del(1, "d1"), add(1, "a1"), ctx(2, "c2"), add(3, "a3"),
  ]);
  assert.deepEqual(blocks.map((b) => b.type), ["delete", "change", "context", "add"]);
});

test("G15·6 末尾的删除行也会成块（不丢）", () => {
  const blocks = buildPreviewBlocks([ctx(1, "a"), del(2, "b")]);
  assert.deepEqual(blocks.map((b) => b.type), ["context", "delete"]);
});

test("G15·7 空输入 → 空块列表（不崩）", () => {
  assert.deepEqual(buildPreviewBlocks([]), []);
});

test("G15·8 blockChanged：context 不算改动，其余三种都算", () => {
  assert.equal(blockChanged("context"), false);
  assert.equal(blockChanged("add"), true);
  assert.equal(blockChanged("delete"), true);
  assert.equal(blockChanged("change"), true);
});

// ── 围栏切分 ──────────────────────────────────────────────────────────────

test("G15·9 parseFenceStart：``` 与 ~~~ 都认；四空格缩进不认（是代码块内容不是围栏）", () => {
  // 返回值含 `raw`（原样保留这一行，退回 markdown 时才不丢语言标识）
  assert.deepEqual(parseFenceStart("```ts"), { marker: "`", length: 3, raw: "```ts" });
  assert.deepEqual(parseFenceStart("~~~"), { marker: "~", length: 3, raw: "~~~" });
  assert.deepEqual(parseFenceStart("````"), { marker: "`", length: 4, raw: "````" });
  assert.equal(parseFenceStart("    ```"), null, "缩进 4 空格的不是围栏（是缩进代码块）");
  assert.equal(parseFenceStart("普通文字"), null);
});

test("G15·10 有改动的围栏 → fenced-code 块，段内逐行带类型", () => {
  const blocks = buildPreviewBlocks([
    ctx(1, "```js"),
    del(2, "const a = 1;"),
    add(2, "const a = 2;"),
    ctx(3, "```"),
  ]);
  const rendered = buildRenderBlocks(blocks);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].kind, "fenced-code");
  if (rendered[0].kind === "fenced-code") {
    assert.deepEqual(rendered[0].lines.map((l) => [l.type, l.content]), [
      ["delete", "const a = 1;"],
      ["change", "const a = 2;"],
    ]);
  }
});

test("G15·11 全 context 的围栏 → 退回 markdown 块（保留语法高亮与选中）", () => {
  const blocks = buildPreviewBlocks([
    ctx(1, "```js"),
    ctx(2, "const a = 1;"),
    ctx(3, "```"),
  ]);
  const rendered = buildRenderBlocks(blocks);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].kind, "markdown");
  if (rendered[0].kind === "markdown") {
    assert.deepEqual(rendered[0].lines, ["```js", "const a = 1;", "```"]);
  }
});

test("G15·12 围栏内出现疑似 markdown 的行（# 标题 / --- 分割线）不改语义", () => {
  const blocks = buildPreviewBlocks([
    ctx(1, "```md"),
    add(2, "# 这不是标题，是代码"),
    add(3, "---"),
    ctx(4, "```"),
  ]);
  const rendered = buildRenderBlocks(blocks);
  assert.equal(rendered[0].kind, "fenced-code");
  if (rendered[0].kind === "fenced-code") {
    assert.deepEqual(rendered[0].lines.map((l) => l.content), ["# 这不是标题，是代码", "---"]);
  }
});

test("G15·13 变更块 + 未改块混合：类型切换时切开（色边不连成一片）", () => {
  const blocks = buildPreviewBlocks([
    ctx(1, "## 标题"),
    ctx(2, ""),
    del(3, "旧段"),
    add(3, "新段"),
    ctx(4, ""),
    ctx(5, "尾段"),
  ]);
  const rendered = buildRenderBlocks(blocks);
  assert.deepEqual(rendered.map((b) => (b.kind === "markdown" ? b.type : "code")), ["context", "delete", "change", "context"]);
});

test("G15·14 isPlainBlock：空行/引用定义/脚注/HTML 注释 → 当纯文本画", () => {
  assert.equal(isPlainBlock(["", "   "]), true);
  assert.equal(isPlainBlock(["[ref]: https://x"]), true);
  assert.equal(isPlainBlock(["[^1]: 脚注"]), true);
  assert.equal(isPlainBlock(["<!-- 注释 -->"]), true);
  assert.equal(isPlainBlock(["# 标题"]), false);
  assert.equal(isPlainBlock(["普通段落"]), false);
});

test("G15·15 未闭合的围栏不丢内容（到结尾 flush，仍是 fenced-code）", () => {
  const blocks = buildPreviewBlocks([ctx(1, "```js"), add(2, "const a = 1;")]);
  const rendered = buildRenderBlocks(blocks);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].kind, "fenced-code");
});
