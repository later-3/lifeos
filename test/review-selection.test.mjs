// S3·A2b/A7 范围选区与位置头的穷举单测。
//
// 用例对齐（基于源码事实）：
//  - GitHub 官方文档：范围选择 = **拖到末行** 或 **Shift+点**（两种都要）
//  - difit `DiffChunk.tsx:123-131` `getCommentLineFromAnchor`：`Math.min/max` 归一；
//    `selectionAnchor.side !== selection.side` → 退化为单行（不跨侧）
//  - difit `utils/commentFormatting.ts`：位置头 `src/x.tsx:L42` / `:L42-L48`
//  - opencode `composer/comment-note.ts:96-108` `formatCommentNote`：
//    `line 42` / `lines 3 through 5`（自然语言式，我们作为对照记录，不采用）
import test from "node:test";
import assert from "node:assert/strict";
import {
  anchorLineOf, blockEdgesOf, inRange, locationHeader, parseAnchorKey, rangeFromSelection, rangeLabel, rangeLength, rangeOf, shiftRangeOf,
} from "../frontend/src/review-selection.ts";

test("A2b·1 首次点击（无锚）→ 单行", () => {
  assert.deepEqual(rangeOf(undefined, { side: "new", line: 7 }), { side: "new", start: 7, end: 7 });
});

test("A2b·2 同侧向下拖 → 起点..终点", () => {
  assert.deepEqual(rangeOf({ side: "new", line: 3 }, { side: "new", line: 5 }), { side: "new", start: 3, end: 5 });
});

test("A2b·3 同侧向上拖（反向）→ min..max 归一（difit 同判）", () => {
  assert.deepEqual(rangeOf({ side: "new", line: 5 }, { side: "new", line: 3 }), { side: "new", start: 3, end: 5 });
});

test("A2b·4 同一点 → 单行", () => {
  assert.deepEqual(rangeOf({ side: "new", line: 4 }, { side: "new", line: 4 }), { side: "new", start: 4, end: 4 });
});

test("A2b·5 跨侧拖（old 起 → new 止）→ 退化为**当前点**单行（difit getCommentLineFromAnchor 同判）", () => {
  assert.deepEqual(rangeOf({ side: "old", line: 3 }, { side: "new", line: 8 }), { side: "new", start: 8, end: 8 });
});

test("A2b·6 Shift+点跨侧 → 退化为锚点单行（保留原侧，符合「从我上次点的地方算起」的心智）", () => {
  assert.deepEqual(shiftRangeOf({ side: "old", line: 3 }, { side: "new", line: 8 }), { side: "old", start: 3, end: 3 });
});

test("A2b·7 Shift+点同侧 → 归一成段", () => {
  assert.deepEqual(shiftRangeOf({ side: "new", line: 10 }, { side: "new", line: 4 }), { side: "new", start: 4, end: 10 });
});

test("A2b·8 Shift+点无锚 → 单行（等价于普通点击）", () => {
  assert.deepEqual(shiftRangeOf(undefined, { side: "new", line: 9 }), { side: "new", start: 9, end: 9 });
});

test("A2b·9 inRange：侧不同不算在内", () => {
  const r = { side: "new", start: 3, end: 5 };
  assert.equal(inRange(r, "new", 4), true);
  assert.equal(inRange(r, "new", 2), false);
  assert.equal(inRange(r, "new", 6), false);
  assert.equal(inRange(r, "old", 4), false, "侧不同不在范围内");
  assert.equal(inRange(undefined, "new", 4), false);
});

test("A2b·10 rangeLength：单行=1，5..3 不可能（rangeOf 已归一）", () => {
  assert.equal(rangeLength({ side: "new", start: 7, end: 7 }), 1);
  assert.equal(rangeLength({ side: "new", start: 3, end: 5 }), 3);
});

test("A3·1 锚点落在哪一侧：added→new / removed→old / context→默认 new", () => {
  assert.deepEqual(anchorLineOf({ type: "added", oldNo: null, newNo: 12 }, "new"), { side: "new", line: 12 });
  assert.deepEqual(anchorLineOf({ type: "removed", oldNo: 9, newNo: null }, "new"), { side: "old", line: 9 });
  assert.deepEqual(anchorLineOf({ type: "context", oldNo: 4, newNo: 5 }, "new"), { side: "new", line: 5 });
  assert.deepEqual(anchorLineOf({ type: "context", oldNo: 4, newNo: 5 }, "old"), { side: "old", line: 4 });
});

test("A3·2 一侧没有行号时退化到另一侧；两侧都没有（不该出现）→ undefined", () => {
  // 纯新增文件里的 added 行没有 old 行号 → 优先 new
  assert.deepEqual(anchorLineOf({ type: "added", oldNo: null, newNo: 3 }, "old"), { side: "new", line: 3 });
  assert.equal(anchorLineOf({ type: "context", oldNo: null, newNo: null }, "new"), undefined);
});

test("A7·1 位置头：单行 → path:L42（difit `utils/commentFormatting.ts` 的 L 前缀）", () => {
  assert.equal(locationHeader("src/lib/a.ts", { side: "new", start: 42, end: 42 }), "src/lib/a.ts:L42");
});

test("A7·2 位置头：范围 → path:L42-L48", () => {
  assert.equal(locationHeader("docs/x.md", { side: "new", start: 42, end: 48 }), "docs/x.md:L42-L48");
});

test("A7·3 位置头：中文/空格路径原样（不转义）", () => {
  assert.equal(locationHeader("docs/有 空格.md", { side: "new", start: 1, end: 2 }), "docs/有 空格.md:L1-L2");
});

test("A7·4 标签：单行「第 7 行」/ 范围「第 3–5 行」（en dash，不与负数混淆）", () => {
  assert.equal(rangeLabel({ side: "new", start: 7, end: 7 }), "第 7 行");
  assert.equal(rangeLabel({ side: "new", start: 3, end: 5 }), "第 3–5 行");
  assert.ok(rangeLabel({ side: "new", start: 3, end: 5 }).includes("–"), "用 en dash 而不是连字符");
});

// ── 文字拖选 → 行范围（opencode 路径）─────────────────────────────────────────
test("A2d·1 选区两端在同一行 → 单行（调用方据此决定不接管，让用户复制）", () => {
  const rows = [
    { key: "new:3", contains: (n) => n === "a" },
    { key: "new:4", contains: (n) => n === "b" },
  ];
  assert.deepEqual(rangeFromSelection(rows, "a", "a"), { side: "new", start: 3, end: 3 });
});

test("A2d·2 选区跨两行 → 范围", () => {
  const rows = [
    { key: "new:3", contains: (n) => n === "a" },
    { key: "new:4", contains: (n) => n === "b" },
    { key: "new:5", contains: (n) => n === "c" },
  ];
  assert.deepEqual(rangeFromSelection(rows, "a", "c"), { side: "new", start: 3, end: 5 });
});

test("A2d·3 反向拖（终点在上）→ 归一", () => {
  const rows = [
    { key: "new:3", contains: (n) => n === "a" },
    { key: "new:7", contains: (n) => n === "c" },
  ];
  assert.deepEqual(rangeFromSelection(rows, "c", "a"), { side: "new", start: 3, end: 7 });
});

test("A2d·4 一端不在任何行内 → 退化为另一端单行", () => {
  const rows = [{ key: "new:9", contains: (n) => n === "b" }];
  assert.deepEqual(rangeFromSelection(rows, "outside", "b"), { side: "new", start: 9, end: 9 });
  assert.deepEqual(rangeFromSelection(rows, "b", "outside"), { side: "new", start: 9, end: 9 });
});

test("A2d·5 两端都不在行内 → undefined（不制造假锚点）", () => {
  const rows = [{ key: "new:9", contains: () => false }];
  assert.equal(rangeFromSelection(rows, "x", "y"), undefined);
});

test("A2d·6 跨侧选区 → 退化为终点单行（与 drag 同一套规则）", () => {
  const rows = [
    { key: "old:4", contains: (n) => n === "a" },
    { key: "new:9", contains: (n) => n === "b" },
  ];
  assert.deepEqual(rangeFromSelection(rows, "a", "b"), { side: "new", start: 9, end: 9 });
});

test("A2d·7 parseAnchorKey：合法/非法都覆盖", () => {
  assert.deepEqual(parseAnchorKey("new:12"), { side: "new", line: 12 });
  assert.deepEqual(parseAnchorKey("old:5"), { side: "old", line: 5 });
  assert.equal(parseAnchorKey("middle:5"), undefined);
  assert.equal(parseAnchorKey("new:0"), undefined);
  assert.equal(parseAnchorKey("new:abc"), undefined);
  assert.equal(parseAnchorKey(null), undefined);
  assert.equal(parseAnchorKey(""), undefined);
});

// ── A22 整块高亮：首/末行的判定（用户报的"几条黄色线框"的修法）───────────────
//
// 依据 difit `src/client/styles/global.css:185-210`：整块高亮只在 `drag-selected-first` 画 border-top、
// 在 `drag-selected-last` 画 border-bottom，中间行不画横线——否则相邻行的边会贴成一串小方框。

test("A22·1 三行范围：首行只有 start、末行只有 end、中间都没有", () => {
  const range = { side: "new", start: 5, end: 7 };
  assert.deepEqual(blockEdgesOf(range, "new", 5), { start: true, end: false });
  assert.deepEqual(blockEdgesOf(range, "new", 6), { start: false, end: false });
  assert.deepEqual(blockEdgesOf(range, "new", 7), { start: false, end: true });
});

test("A22·2 单行范围：既是首也是末（上下边都画才是一个框）", () => {
  assert.deepEqual(blockEdgesOf({ side: "new", start: 9, end: 9 }, "new", 9), { start: true, end: true });
});

test("A22·3 范围外 / 另一侧 → 两边都不画（不误标）", () => {
  const range = { side: "new", start: 5, end: 7 };
  assert.deepEqual(blockEdgesOf(range, "new", 4), { start: false, end: false });
  assert.deepEqual(blockEdgesOf(range, "new", 8), { start: false, end: false });
  assert.deepEqual(blockEdgesOf(range, "old", 5), { start: false, end: false });
});

test("A22·4 倒序范围（拖反了）也按归一后的首末算", () => {
  assert.deepEqual(blockEdgesOf({ side: "new", start: 7, end: 5 }, "new", 5), { start: true, end: false });
  assert.deepEqual(blockEdgesOf({ side: "new", start: 7, end: 5 }, "new", 7), { start: false, end: true });
});

test("A22·5 没有范围 → 什么都不画（不崩）", () => {
  assert.deepEqual(blockEdgesOf(undefined, "new", 3), { start: false, end: false });
});
