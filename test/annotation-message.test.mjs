/**
 * 批注 → 消息文本（Task 0003 · P4）。
 *
 * 这个格式是**用户定的**（「原文」 -> 用户的话 （语气）），
 * 所以每条边界都要锁住：不润色、不编号、不出现内部标识。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { annotationLine, annotationsMessage } from "../frontend/src/annotation-message.ts";

const TONES = { query: "疑问", critic: "批评", praise: "鼓励", todo: "待办" };
const labels = (ids) => ids.map((id) => TONES[id] ?? id).join("、");

const anno = (over) => ({
  id: "a1", messageId: "m1", blockIndex: 0, start: 0, end: 3,
  quote: "原文", marks: ["critic"], note: "", ui: { mode: "open", pinned: false, dx: 0, dy: 0 },
  ...over,
});

test("T4-1 单条、有话、单语气", () => {
  assert.equal(
    annotationLine(anno({ note: "这里有问题" }), labels),
    "「原文」 -> 这里有问题 （批评）",
  );
});

test("T4-2 单条、没话（箭头后直接括号）", () => {
  assert.equal(annotationLine(anno({ note: "" }), labels), "「原文」 -> （批评）");
  assert.equal(annotationLine(anno({ note: "   " }), labels), "「原文」 -> （批评）", "纯空白也算没写话");
});

test("T4-3 单条、多语气用「、」连接", () => {
  assert.equal(
    annotationLine(anno({ marks: ["critic", "query"], note: "两个语气" }), labels),
    "「原文」 -> 两个语气 （批评、疑问）",
  );
});

test("T4-4 多条按消息顺序 + 段内偏移排序", () => {
  const list = [
    anno({ id: "c", messageId: "m2", start: 10, quote: "第三条" }),
    anno({ id: "a", messageId: "m1", start: 50, quote: "第一条" }),
    anno({ id: "b", messageId: "m1", start: 5, quote: "第二条" }),
  ];
  const text = annotationsMessage(list, { labels, order: ["m1", "m2"] });
  assert.deepEqual(text.split("\n"), [
    "「第二条」 -> （批评）",
    "「第一条」 -> （批评）",
    "「第三条」 -> （批评）",
  ]);
});

test("T4-4b 不传 order 时保持传入顺序（只有段内排序）", () => {
  const list = [
    anno({ id: "x", messageId: "m1", start: 9, quote: "后" }),
    anno({ id: "y", messageId: "m1", start: 2, quote: "前" }),
  ];
  const text = annotationsMessage(list, { labels });
  assert.deepEqual(text.split("\n"), ["「前」 -> （批评）", "「后」 -> （批评）"]);
});

test("T4-5 输出绝不含内部标识（markId / 颜色 / CSS 变量）", () => {
  const list = [
    anno({ id: "a1", marks: ["critic", "query"], note: "测试" }),
    anno({ id: "a2", marks: ["todo"], note: "" }),
  ];
  const text = annotationsMessage(list, { labels });
  for (const banned of ["critic", "query", "todo", "praise", "#", "rgb", "var(", "--color"]) {
    assert.equal(text.includes(banned), false, `不得出现 ${banned}`);
  }
});

test("T4-6 空数组 → 空串", () => {
  assert.equal(annotationsMessage([], { labels }), "");
});

test("T4-7 不编号：多行里没有行首序号", () => {
  const list = [anno({ id: "a", start: 1 }), anno({ id: "b", start: 2 })];
  const text = annotationsMessage(list, { labels });
  assert.doesNotMatch(text, /^\s*\d+[.、]\s/m, "它是一条消息内的多行，不是多条消息，不该有编号");
});

test("T4-8 默认 labels 用 marks.ts 的中文名（不传 labels 也能用）", () => {
  // 不传 labels → 走 marks.ts 的 labelsOf
  assert.equal(annotationLine(anno({ marks: ["critic"] }), undefined), "「原文」 -> （批评）");
});
