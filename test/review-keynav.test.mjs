// G13 键盘导航：纯函数穷举（键位表 / 行 / 块 / 文件 / 输入框守卫）。
//
// 键位来源：difit `src/client/hooks/useKeyboardNavigation.ts`（2026-11-08 核对，21 个键）。
// 我们这一版只实现"真的能用"的那部分——帮助浮层直接读 `KEY_BINDINGS`，不另写文案
// （否则"帮助里说了、按下去没反应"这种偏差无法被自动发现）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  actionOfKey, firstFileRow, KEY_BINDINGS, lastFileRow, normalizeNavKey, shouldIgnoreNav, stepChunk, stepFile, stepLine,
} from "../frontend/src/review-keynav.ts";

/** 两个文件 × 两个 chunk：A(0-2) B(3-4)，C(5-6) D(7) */
const ROWS = [
  { file: "a.ts", chunk: "a0" },
  { file: "a.ts", chunk: "a0" },
  { file: "a.ts", chunk: "a0" },
  { file: "a.ts", chunk: "a1" },
  { file: "a.ts", chunk: "a1" },
  { file: "b.ts", chunk: "b0" },
  { file: "b.ts", chunk: "b0" },
  { file: "b.ts", chunk: "b1" },
];

test("G13·1 键位表：帮助里列的每个键都真的映射得到动作（不会列出没实现的键）", () => {
  assert.ok(KEY_BINDINGS.length >= 8, `键位过少（${KEY_BINDINGS.length}）`);
  for (const binding of KEY_BINDINGS) {
    for (const key of binding.keys) {
      const action = actionOfKey(key);
      assert.ok(action !== undefined, `键 ${key} 在表里但 actionOfKey 找不到`);
      assert.equal(action.label, binding.label);
      assert.notEqual(action.description, "", "帮助文案不能为空");
    }
  }
});

test("G13·2 键名规范化：方向键与大小写都归一到小写表", () => {
  assert.equal(normalizeNavKey("ArrowDown"), "arrowdown");
  assert.equal(normalizeNavKey("J"), "j");
  assert.equal(actionOfKey("ArrowDown")?.label, "j / ↓");
  assert.equal(actionOfKey("ArrowUp")?.label, "k / ↑");
  assert.equal(actionOfKey("Escape")?.label, "Esc");
  assert.equal(actionOfKey("x"), undefined, "未登记的键不归面板管");
});

test("G13·3 行步进：到头就停（不环绕），空列表返回 -1", () => {
  assert.equal(stepLine(ROWS, 0, 1), 1);
  assert.equal(stepLine(ROWS, 1, -1), 0);
  assert.equal(stepLine(ROWS, ROWS.length - 1, 1), ROWS.length - 1, "最后一行再往下应停住");
  assert.equal(stepLine(ROWS, 0, -1), 0, "第一行再往上应停住");
  assert.equal(stepLine([], 0, 1), -1);
});

test("G13·4 块步进（前进）：跳到下一个改动块的**首行**（不是只跳一格）", () => {
  assert.equal(stepChunk(ROWS, 0, 1), 3, "块中间按 n 要跳到下一块首行");
  assert.equal(stepChunk(ROWS, 3, 1), 5, "跨文件也算下一块");
  assert.equal(stepChunk(ROWS, 5, 1), 7);
  assert.equal(stepChunk(ROWS, 7, 1), 7, "最后一个块再按 n 停住");
});

test("G13·5 块步进（后退）：块中间先回块首，块首再往前一个块首", () => {
  assert.equal(stepChunk(ROWS, 2, -1), 0, "块中间往回 → 本块首行");
  assert.equal(stepChunk(ROWS, 0, -1), 0, "第一个块首再往回 → 停住");
  assert.equal(stepChunk(ROWS, 5, -1), 3, "第二个文件首块往回 → 上一文件末块首行");
});

test("G13·6 文件步进：跳到相邻文件首行，且**环绕**（difit 同判）", () => {
  assert.equal(stepFile(ROWS, 0, 1), 5, "a → b 的首行");
  assert.equal(stepFile(ROWS, 5, -1), 0, "b → a 的首行");
  assert.equal(stepFile(ROWS, 6, 1), 0, "最后一个文件再 ] → 回到第一个（环绕）");
  assert.equal(stepFile(ROWS, 0, -1), 5, "第一个文件 [ → 最后一个（环绕）");
});

test("G13·7 首/尾文件：{ 与 } 落到第一个/最后一个文件的首行", () => {
  assert.equal(firstFileRow(ROWS), 0);
  assert.equal(lastFileRow(ROWS), 5, "最后一个文件是 b.ts，首行是下标 5");
  assert.equal(firstFileRow([]), -1);
  assert.equal(lastFileRow([]), -1);
});

test("G13·8 输入框守卫：在 textarea/input/contenteditable 里不抢键（用户在写评论）", () => {
  assert.equal(shouldIgnoreNav({ tagName: "TEXTAREA" }), true);
  assert.equal(shouldIgnoreNav({ tagName: "input" }), true);
  assert.equal(shouldIgnoreNav({ tagName: "SELECT" }), true);
  assert.equal(shouldIgnoreNav({ isContentEditable: true }), true);
  assert.equal(shouldIgnoreNav({ tagName: "BUTTON" }), false, "按钮上按 j 仍然导航（按钮不吃字符）");
  assert.equal(shouldIgnoreNav({ tagName: "DIV" }), false);
  assert.equal(shouldIgnoreNav(null), false);
});

test("G13·9 单文件时文件步进原地不动（不跳走）", () => {
  const single = [{ file: "only.ts", chunk: "a" }, { file: "only.ts", chunk: "b" }];
  assert.equal(stepFile(single, 0, 1), 0);
  assert.equal(stepFile(single, 0, -1), 0);
});

test("G13·10 帮助文案覆盖「关键动作」：行/块/文件/评论/帮助/关闭各至少一条", () => {
  const text = KEY_BINDINGS.map((binding) => binding.description).join(" ");
  for (const word of ["行", "改动块", "文件", "写评论", "快捷键", "关闭"]) {
    assert.ok(text.includes(word), `帮助里缺「${word}」`);
  }
});
