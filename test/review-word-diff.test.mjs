// 词级 diff：纯判定 + 拆分不变量（不依赖库）+ 执行层（真库）。
//
// 参考：difit `src/client/utils/wordLevelDiff.ts`（`diffWordsWithSpace` + 相似度 ≥0.2 门槛）。
// 我们的差异：门槛用**已算出的改动占比**（不跑第二遍 diff）；超长行不做（LCS 是 O(n·m)）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_WORD_DIFF_CHANGED_RATIO, MAX_WORD_DIFF_LINE_LENGTH, changedLengthOf, shouldComputeWordDiff,
  splitChanges, totalLengthOf, worthHighlighting,
} from "../frontend/src/review-word-diff.ts";
import { ensureWordDiffLib, wordDiffOf, wordDiffReady } from "../frontend/src/review-word-diff-lib.ts";

const OLD = "const total = valid.reduce((sum, r) => sum + r.count, 0);";
const NEW = "const total = valid.reduce((acc, r) => acc + r.count, 0);";

// ── 纯判定 ────────────────────────────────────────────────────────────────

test("G12·1 两行相同 → 不做词级（没有变化可标）", () => {
  assert.equal(shouldComputeWordDiff(OLD, OLD), false);
});

test("G12·2 任一侧为空/纯空白 → 不做（整行标色更清楚）", () => {
  assert.equal(shouldComputeWordDiff("", NEW), false);
  assert.equal(shouldComputeWordDiff(OLD, "   "), false);
  assert.equal(shouldComputeWordDiff("  ", "  x"), false);
});

test("G12·3 超长行 → 不做（LCS 是 O(n·m)，低端机会卡；difit 没有这道闸）", () => {
  const long = "x".repeat(MAX_WORD_DIFF_LINE_LENGTH + 1);
  assert.equal(shouldComputeWordDiff(long, `${long}y`), false);
  // 正好上限：**两侧都**不超过才算"正好"（早先写成 `${ok}y` 让新行变成 2001，是把测试写错了）
  const ok = "x".repeat(MAX_WORD_DIFF_LINE_LENGTH - 1);
  assert.equal(shouldComputeWordDiff(ok, `${ok}y`), true, "两侧都正好到上限仍要做");
});

test("G12·4 普通两行 → 要做", () => {
  assert.equal(shouldComputeWordDiff(OLD, NEW), true);
});

// ── 拆分不变量（最重要的两条）──────────────────────────────────────────────

test("G12·5 splitChanges：oldSegments 拼回去**逐字等于旧行**，newSegments 逐字等于新行", () => {
  const changes = [
    { value: "const total = valid.reduce((" },
    { value: "sum", removed: true },
    { value: "acc", added: true },
    { value: ", r) => " },
    { value: "sum", removed: true },
    { value: "acc", added: true },
    { value: " + r.count, 0);" },
  ];
  const diff = splitChanges(changes);
  assert.equal(diff.oldSegments.map((s) => s.value).join(""), "const total = valid.reduce((sum, r) => sum + r.count, 0);");
  assert.equal(diff.newSegments.map((s) => s.value).join(""), "const total = valid.reduce((acc, r) => acc + r.count, 0);");
});

test("G12·6 splitChanges：unchanged 两侧都有；added 只在 new；removed 只在 old", () => {
  const diff = splitChanges([{ value: "a " }, { value: "b", removed: true }, { value: "x", added: true }, { value: " c" }]);
  assert.deepEqual(diff.oldSegments, [
    { value: "a ", type: "unchanged" },
    { value: "b", type: "removed" },
    { value: " c", type: "unchanged" },
  ]);
  assert.deepEqual(diff.newSegments, [
    { value: "a ", type: "unchanged" },
    { value: "x", type: "added" },
    { value: " c", type: "unchanged" },
  ]);
});

test("G12·7 计数辅助：changedLengthOf / totalLengthOf 与段内容一致", () => {
  const segments = splitChanges([{ value: "ab" }, { value: "XYZ", removed: true }]).oldSegments;
  assert.equal(totalLengthOf(segments), 5);
  assert.equal(changedLengthOf(segments), 3);
});

// ── 高亮阈值 ──────────────────────────────────────────────────────────────

test("G12·8 worthHighlighting：改动占比小 → 显示词级；几乎全改 → 放弃（整行标色更清楚）", () => {
  const small = splitChanges([{ value: "const total = valid.reduce((sum, r) => sum + r.count, 0);" }, { value: "" }]);
  assert.equal(worthHighlighting(small), true, "没有改动也应 true（不阻碍）");
  const tiny = splitChanges([{ value: "aaaaaaaaaa" }, { value: "b", removed: true }, { value: "c", added: true }]);
  assert.equal(worthHighlighting(tiny), true);
  const huge = splitChanges([{ value: "x", removed: true }, { value: "y".repeat(100), added: true }]);
  assert.equal(worthHighlighting(huge), false, "一侧几乎全改 → 放弃词级");
});

test("G12·9 阈值常量：0.8（difit 相似度 0.2 的等价量级，但直接用结果判断）", () => {
  assert.equal(MAX_WORD_DIFF_CHANGED_RATIO, 0.8);
});

// ── 执行层（真库）────────────────────────────────────────────────────────

test("G12·10 动态加载：加载前不 ready、加载后 ready（可重复调用）", async () => {
  assert.equal(wordDiffReady(), false, "测试开始时库还没加载");
  const lib = await ensureWordDiffLib();
  assert.ok(lib !== undefined, "能加载到 diff 库");
  assert.equal(wordDiffReady(), true);
  assert.equal(await ensureWordDiffLib(), lib, "重复调用返回同一实例");
});

test("G12·11 真库端到端：改两个变量名 → 两侧各只有 2 段扩展，且拼回原文", () => {
  const diff = wordDiffOf(OLD, NEW);
  assert.ok(diff !== null);
  assert.equal(diff.oldSegments.map((s) => s.value).join(""), OLD);
  assert.equal(diff.newSegments.map((s) => s.value).join(""), NEW);
  const removed = diff.oldSegments.filter((s) => s.type === "removed").map((s) => s.value);
  const added = diff.newSegments.filter((s) => s.type === "added").map((s) => s.value);
  assert.deepEqual(removed, ["sum", "sum"], JSON.stringify(removed));
  assert.deepEqual(added, ["acc", "acc"], JSON.stringify(added));
});

test("G12·12 真库：不值得的两行返回 null（不是空 diff）", () => {
  assert.equal(wordDiffOf("same line", "same line"), null, "相同 → null");
  assert.equal(wordDiffOf("", "x"), null, "一侧为空 → null");
});
