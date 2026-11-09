// S2·A6 批注过期判定的穷举单测。
//
// 用例逐条对齐 difit `src/client/utils/outdatedComments.test.ts`（13 条，MIT）：
// 它把这件小事的边界全测了，我们照它的清单过一遍，再补两条我们自己的。
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFileLineIndex, isAnchorOutdated, outdatedIds, snapshotOf,
} from "../frontend/src/review-outdated.ts";

const line = (type, oldNo, newNo, text) => ({ type, oldNo, newNo, text });

const hunks = [{ lines: [
  line("context", 10, 10, "keep me"),
  line("removed", 11, null, "old line"),
  line("added", null, 11, "new line"),
  line("context", 12, 12, "tail"),
] }];
const index = buildFileLineIndex(hunks);

test("A6·1 内容一致 → 不过期", () => {
  assert.equal(isAnchorOutdated({ side: "new", start: 11, end: 11, snapshot: "new line" }, index), false);
});

test("A6·2 内容变了 → 过期", () => {
  assert.equal(isAnchorOutdated({ side: "new", start: 11, end: 11, snapshot: "something else" }, index), true);
});

test("A6·3 目标行不在索引里 → 不判过期（删掉 ≠ 内容变了）", () => {
  assert.equal(isAnchorOutdated({ side: "new", start: 99, end: 99, snapshot: "gone" }, index), false);
});

test("A6·4 文件整体消失（index undefined）→ 过期", () => {
  assert.equal(isAnchorOutdated({ side: "new", start: 11, end: 11, snapshot: "new line" }, undefined), true);
});

test("A6·5 没有快照（老数据）→ 不过期", () => {
  assert.equal(isAnchorOutdated({ side: "new", start: 11, end: 11 }, index), false);
});

test("A6·6 只差尾随空格 → 不过期", () => {
  assert.equal(isAnchorOutdated({ side: "new", start: 10, end: 10, snapshot: "keep me   " }, index), false);
});

test("A6·7 多行范围，部分行不存在但存在的那些一致 → 不过期", () => {
  assert.equal(isAnchorOutdated({ side: "new", start: 10, end: 12, snapshot: "keep me\nnew line\ntail" }, index), false);
});

test("A6·8 多行范围，部分存在且有不同 → 过期", () => {
  assert.equal(isAnchorOutdated({ side: "new", start: 10, end: 12, snapshot: "keep me\nDIFFERENT\ntail" }, index), true);
});

test("A6·9 锚在删除侧（old）→ 拿 old 索引比对", () => {
  assert.equal(isAnchorOutdated({ side: "old", start: 11, end: 11, snapshot: "old line" }, index), false);
  assert.equal(isAnchorOutdated({ side: "old", start: 11, end: 11, snapshot: "new line" }, index), true);
});

test("A6·10 内容以 + / - 开头不影响（普通文本比较）", () => {
  const idx = buildFileLineIndex([{ lines: [line("context", 1, 1, "+ plus"), line("context", 2, 2, "- minus")] }]);
  assert.equal(isAnchorOutdated({ side: "new", start: 1, end: 2, snapshot: "+ plus\n- minus" }, idx), false);
});

test("A6·11 空串快照 = 空行批注，当前行也是空 → 不过期", () => {
  const idx = buildFileLineIndex([{ lines: [line("context", 5, 5, "")] }]);
  assert.equal(isAnchorOutdated({ side: "new", start: 5, end: 5, snapshot: "" }, idx), false);
});

test("A6·12 空串快照，但当前行有内容 → 过期", () => {
  const idx = buildFileLineIndex([{ lines: [line("context", 5, 5, "now has text")] }]);
  assert.equal(isAnchorOutdated({ side: "new", start: 5, end: 5, snapshot: "" }, idx), true);
});

test("A6·13 快照末尾空行 vs 当前行有内容 → 过期（difit `trailing blank line` 用例）", () => {
  // difit 原用例：快照 "const a = 1;\nconst b = 2;\n"（末尾空行 = 第 3 行为空），锚 10..12，
  // 实际第 12 行是 "const c = 3;" → 第 3 行期望 '' ≠ 实际 → 过期。
  const idx = buildFileLineIndex([{ lines: [
    line("context", 10, 10, "const a = 1;"),
    line("context", 11, 11, "const b = 2;"),
    line("context", 12, 12, "const c = 3;"),
  ] }]);
  assert.equal(isAnchorOutdated({ side: "new", start: 10, end: 12, snapshot: "const a = 1;\nconst b = 2;\n" }, idx), true);
  // 反向：实际第 12 行也是空 → 不过期
  const idx2 = buildFileLineIndex([{ lines: [
    line("context", 10, 10, "const a = 1;"),
    line("context", 11, 11, "const b = 2;"),
    line("context", 12, 12, ""),
  ] }]);
  assert.equal(isAnchorOutdated({ side: "new", start: 10, end: 12, snapshot: "const a = 1;\nconst b = 2;\n" }, idx2), false);
});

// ── 我们自己的两条 ─────────────────────────────────────────────────────────────

test("A6·14 行号反着传（end < start）按 min..max 处理，不崩", () => {
  assert.equal(isAnchorOutdated({ side: "new", start: 12, end: 10, snapshot: "keep me\nnew line\ntail" }, index), false);
});

test("A6·15 左侧删除行不会污染 new 索引（同一行号 11 两侧内容不同）", () => {
  // new 侧第 11 行是 "new line"，old 侧第 11 行是 "old line"
  assert.equal(index.new.get(11), "new line");
  assert.equal(index.old.get(11), "old line");
});

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

test("A6·16 snapshotOf：按 side 取原文，行不在该侧 → undefined", () => {
  const lines = [hunks[0].lines[0], hunks[0].lines[1], hunks[0].lines[2]];
  assert.equal(snapshotOf([lines[1]], "old"), "old line");
  assert.equal(snapshotOf([lines[2]], "new"), "new line");
  assert.equal(snapshotOf([lines[2]], "old"), undefined, "added 行没有 old 侧行号");
  assert.equal(snapshotOf([], "new"), undefined);
});

test("A6·17 snapshotOf：多行按传入顺序拼（调用方负责升序）", () => {
  const lines = [hunks[0].lines[0], hunks[0].lines[2], hunks[0].lines[3]];
  assert.equal(snapshotOf(lines, "new"), "keep me\nnew line\ntail");
});

test("A6·18 outdatedIds：批量判定，文件不在 diff 里的也算过期", () => {
  const anchors = [
    { id: "a", anchor: { side: "new", start: 11, end: 11, snapshot: "new line" } },
    { id: "b", anchor: { side: "new", start: 11, end: 11, snapshot: "changed" } },
    { id: "c", anchor: { side: "new", start: 1, end: 1, snapshot: "x" } },
  ];
  const got = outdatedIds(anchors, (path) => (path === "gone.ts" ? undefined : index), (id) => (id === "c" ? "gone.ts" : "a.ts"));
  assert.deepEqual([...got].sort(), ["b", "c"]);
});

test("A6·19 CRLF 快照与 LF 索引等价（跨平台）", () => {
  assert.equal(isAnchorOutdated({ side: "new", start: 10, end: 10, snapshot: "keep me\r\n" }, index), false);
});
