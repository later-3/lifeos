/**
 * 批注 → 消息文本（Task 0003 · P4，2026-11-03 二次改格式）。
 *
 * 格式是**用户逐条裁定的**，所以每条边界都要锁住：
 *    1、你说的：「147 条」
 *      -> 这个数怎么来的 （我是批评的语气！）
 *    2、你说的：「数据1」（我是待办的语气！）
 *
 * 四条细则：序号用「1、」/ 第二人称「你说的：」/ 没话不出箭头 / 引号保持「」。
 * 外加一条分类规则：**只有语气类标记进括号**，功能类（存档/待办）不发给 Agent。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { annotationLine, annotationsMessage, hasSendableAnnotation } from "../frontend/src/annotation-message.ts";

const anno = (over) => ({
  id: "a1", messageId: "m1", blockIndex: 0, start: 0, end: 3,
  quote: "原文", marks: ["critic"], note: "", ui: { mode: "open", pinned: false, dx: 0, dy: 0 },
  ...over,
});

test("T4-1 单条、有话：序号 + 你说的 + 换行缩进箭头", () => {
  assert.equal(
    annotationLine(anno({ note: "这里有问题" }), 1),
    "1、你说的：「原文」\n  -> 这里有问题 （我是批评的语气！）",
  );
});

test("T4-2 没写话：不出箭头，括号直接跟在引号后", () => {
  assert.equal(annotationLine(anno({ note: "" }), 1), "1、你说的：「原文」（我是批评的语气！）");
  assert.equal(annotationLine(anno({ note: "   " }), 1), "1、你说的：「原文」（我是批评的语气！）", "纯空白也算没写话");
});

test("T4-3 多语气用「、」连接", () => {
  assert.equal(
    annotationLine(anno({ marks: ["critic", "query"], note: "两个语气" }), 1),
    "1、你说的：「原文」\n  -> 两个语气 （我是批评的语气！、我是疑问的语气！）",
  );
});

test("T4-3b「同意」说「我同意！」，不套「XX 的语气」模板", () => {
  assert.equal(
    annotationLine(anno({ marks: ["agree"], note: "" }), 1),
    "1、你说的：「原文」（我同意！）",
  );
});

test("T4-3c 功能类标记（存档/待办）不进括号，也不进消息", () => {
  // 只标功能 → 整条不发
  assert.equal(annotationLine(anno({ marks: ["todo"], note: "记一下" }), 1), null);
  // 语气 + 功能混用 → 只取语气
  assert.equal(
    annotationLine(anno({ marks: ["critic", "todo"], note: "既要批评又要记" }), 1),
    "1、你说的：「原文」\n  -> 既要批评又要记 （我是批评的语气！）",
  );
});

test("T4-4 多条按消息顺序 + 段内偏移排序，序号连续", () => {
  const list = [
    anno({ id: "c", messageId: "m2", start: 10, quote: "第三条" }),
    anno({ id: "a", messageId: "m1", start: 50, quote: "第一条" }),
    anno({ id: "b", messageId: "m1", start: 5, quote: "第二条" }),
  ];
  const text = annotationsMessage(list, { order: ["m1", "m2"] });
  assert.deepEqual(text.split("\n"), [
    "1、你说的：「第二条」（我是批评的语气！）",
    "2、你说的：「第一条」（我是批评的语气！）",
    "3、你说的：「第三条」（我是批评的语气！）",
  ]);
});

test("T4-4c 中间夹一条只标功能的，序号不能断（重排成连续）", () => {
  const list = [
    anno({ id: "a", start: 0, quote: "一" }),
    anno({ id: "b", start: 5, quote: "二", marks: ["archive"] }),   // 只有功能 → 跳过
    anno({ id: "c", start: 9, quote: "三" }),
  ];
  const text = annotationsMessage(list);
  assert.deepEqual(text.split("\n"), [
    "1、你说的：「一」（我是批评的语气！）",
    "2、你说的：「三」（我是批评的语气！）",
  ]);
});

test("T4-4b 不传 order 时保持传入顺序（只有段内排序）", () => {
  const list = [
    anno({ id: "x", messageId: "m1", start: 9, quote: "后" }),
    anno({ id: "y", messageId: "m1", start: 2, quote: "前" }),
  ];
  const text = annotationsMessage(list);
  assert.deepEqual(text.split("\n"), ["1、你说的：「前」（我是批评的语气！）", "2、你说的：「后」（我是批评的语气！）"]);
});

test("T4-9 hasSendableAnnotation：只有功能标记时不算可发", () => {
  assert.equal(hasSendableAnnotation([anno({ marks: ["todo"] })]), false);
  assert.equal(hasSendableAnnotation([anno({ marks: ["archive", "todo"] })]), false);
  assert.equal(hasSendableAnnotation([anno({ marks: ["todo"] }), anno({ id: "b", marks: ["agree"] })]), true);
});

test("T4-5 输出绝不含内部标识（markId / 颜色 / CSS 变量）", () => {
  const list = [
    anno({ id: "a1", marks: ["critic", "query"], note: "测试" }),
    anno({ id: "a2", marks: ["todo"], note: "" }),
  ];
  const text = annotationsMessage(list);
  for (const banned of ["critic", "query", "todo", "praise", "#", "rgb", "var(", "--color"]) {
    assert.equal(text.includes(banned), false, `不得出现 ${banned}`);
  }
});

test("T4-6 空数组 → 空串", () => {
  assert.equal(annotationsMessage([]), "");
});

test("T4-7 每条带序号，用中文顿号（1、2、）", () => {
  const list = [anno({ id: "a", start: 1 }), anno({ id: "b", start: 2 })];
  const text = annotationsMessage(list);
  assert.match(text, /^1、你说的：/m);
  assert.match(text, /^2、你说的：/m);
  assert.doesNotMatch(text, /^\s*\d+[.]/m, "不用英文句点");
});

test("T4-8 不传 say 时用 marks.ts 的默认措辞", () => {
  assert.equal(annotationLine(anno({ marks: ["critic"] }), 1), "1、你说的：「原文」（我是批评的语气！）");
});
