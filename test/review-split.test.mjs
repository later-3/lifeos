// G11 并排视图的行配对：穷举（这是并排视图唯一会"整片错位"的地方）。
//
// 参考：difit `SideBySideDiffChunk.tsx:414-490` `convertToSideBySide`。
import test from "node:test";
import assert from "node:assert/strict";
import { pairForSplit, splitAnchorOf } from "../frontend/src/review-split.ts";

const ctx = (oldNo, newNo, text) => ({ type: "context", oldNo, newNo, text });
const del = (oldNo, text) => ({ type: "removed", oldNo, newNo: null, text });
const add = (newNo, text) => ({ type: "added", oldNo: null, newNo, text });

test("G11·1 纯 context → 每行左右各一格（同一个源行）", () => {
  const rows = pairForSplit([ctx(1, 1, "a"), ctx(2, 2, "b")]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].old?.text, "a");
  assert.equal(rows[0].new?.text, "a");
  assert.equal(rows[1].old?.oldNo, 2);
  assert.equal(rows[1].new?.newNo, 2);
});

test("G11·2 一删一增 → 配成同一横排（difit 同判）", () => {
  const rows = pairForSplit([del(2, "old"), add(2, "new")]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].old?.text, "old");
  assert.equal(rows[0].new?.text, "new");
});

test("G11·3 删 3 增 1 → 3 行：前 1 行成对，后 2 行只有左列", () => {
  const rows = pairForSplit([del(1, "d1"), del(2, "d2"), del(3, "d3"), add(1, "a1")]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].old?.text, "d1");
  assert.equal(rows[0].new?.text, "a1");
  assert.equal(rows[1].old?.text, "d2");
  assert.equal(rows[1].new, undefined, "右列留空");
  assert.equal(rows[2].old?.text, "d3");
  assert.equal(rows[2].new, undefined);
});

test("G11·4 删 1 增 3 → 3 行：前 1 行成对，后 2 行只有右列", () => {
  const rows = pairForSplit([del(1, "d1"), add(1, "a1"), add(2, "a2"), add(3, "a3")]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].old?.text, "d1");
  assert.equal(rows[0].new?.text, "a1");
  assert.equal(rows[1].old, undefined, "左列留空");
  assert.equal(rows[1].new?.text, "a2");
  assert.equal(rows[2].new?.text, "a3");
});

test("G11·5 只有新增（文件追加）→ 全部只占右列", () => {
  const rows = pairForSplit([add(1, "a1"), add(2, "a2")]);
  assert.equal(rows.length, 2);
  assert.equal(rows.every((row) => row.old === undefined), true);
});

test("G11·6 只有删除（文件清空）→ 全部只占左列", () => {
  const rows = pairForSplit([del(1, "d1"), del(2, "d2")]);
  assert.equal(rows.length, 2);
  assert.equal(rows.every((row) => row.new === undefined), true);
});

test("G11·7 多段改动 + context 混合：总行数 = 各段配对行数之和", () => {
  const lines = [
    ctx(1, 1, "c1"),
    del(2, "d2"), del(3, "d3"), add(2, "a2"),         // 2 行
    ctx(4, 3, "c4"),
    add(4, "a4"),                                     // 1 行（前面不是 removed）
    ctx(5, 5, "c5"),
  ];
  const rows = pairForSplit(lines);
  assert.equal(rows.length, 1 + 2 + 1 + 1 + 1);
  // 顺序与源一致：context 行的两侧文字必须相同
  assert.equal(rows[0].old?.text, "c1");
  assert.equal(rows[0].new?.text, "c1");
});

test("G11·8 相邻两段改动（删除→新增→再删除→再新增）不会被合并成一段", () => {
  const rows = pairForSplit([del(1, "d1"), add(1, "a1"), del(2, "d2"), add(2, "a2")]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.old?.text, row.new?.text]), [["d1", "a1"], ["d2", "a2"]]);
});

test("G11·9 空输入 → 空输出（不崩）", () => {
  assert.deepEqual(pairForSplit([]), []);
});

test("G11·10 splitAnchorOf：左列只锚 old、右列只锚 new；该侧无行号则不可锚", () => {
  const paired = { old: del(7, "old"), new: add(9, "new") };
  assert.deepEqual(splitAnchorOf(paired, "old"), { no: 7, text: "old" });
  assert.deepEqual(splitAnchorOf(paired, "new"), { no: 9, text: "new" });
  // 只有一侧的行：另一侧不可锚
  assert.equal(splitAnchorOf({ old: del(3, "x") }, "new"), null);
  assert.equal(splitAnchorOf({ new: add(4, "y") }, "old"), null);
  // context 行两侧都可锚（并排里"在左边点"= 原来这行）
  assert.deepEqual(splitAnchorOf({ old: ctx(5, 5, "c"), new: ctx(5, 5, "c") }, "old"), { no: 5, text: "c" });
  assert.deepEqual(splitAnchorOf({ old: ctx(5, 5, "c"), new: ctx(5, 5, "c") }, "new"), { no: 5, text: "c" });
});
