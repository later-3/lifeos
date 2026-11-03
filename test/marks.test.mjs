/**
 * 标记表单测（Task 0003 · P2）。
 *
 * 这张表是"加一个标记 = 加一行数据"的载体，所以它自己的**约束**必须被机器守住：
 * id 走白名单（拼进 ::highlight 选择器）、tone 只拼变量名（不存色值）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MARKS, MARK_ID_PATTERN, markById, toneColorVar, toneSoftVar, labelsOf } from "../frontend/src/marks.ts";

test("标记表有 5 个，顺序固定：疑问/批评/鼓励/存档/待办", () => {
  assert.deepEqual(MARKS.map((m) => m.label), ["疑问", "批评", "鼓励", "存档", "待办"]);
});

test("每个 id 都符合白名单（否则拼进 ::highlight 选择器就是注入口）", () => {
  for (const mark of MARKS) {
    assert.match(mark.id, MARK_ID_PATTERN, `id 不合规：${mark.id}`);
  }
});

test("id 唯一", () => {
  const ids = MARKS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("tone 只拼 CSS 变量名，不含色值", () => {
  for (const mark of MARKS) {
    assert.equal(toneColorVar(mark.tone), `--color-anno-${mark.tone}`);
    assert.equal(toneSoftVar(mark.tone), `--color-anno-${mark.tone}-soft`);
    // 不能出现 #rrggbb / rgb( 这类色值（色值只能在 tokens.css）
    assert.doesNotMatch(mark.tone, /#|rgb|hsl/, `tone 里不该有颜色值：${mark.tone}`);
  }
});

test("markById 未知 id 返回 undefined（调用方自己兜底）", () => {
  assert.equal(markById("query")?.label, "疑问");
  assert.equal(markById("nope"), undefined);
  assert.equal(markById(""), undefined);
});

test("labelsOf 按传入顺序用「、」连接，未知 id 原样输出", () => {
  assert.equal(labelsOf(["critic", "query"]), "批评、疑问");
  assert.equal(labelsOf(["query"]), "疑问");
  assert.equal(labelsOf([]), "");
  assert.equal(labelsOf(["critic", "unknown"]), "批评、unknown");
});

test("白名单正则的实际边界", () => {
  assert.equal(MARK_ID_PATTERN.test("query"), true);
  assert.equal(MARK_ID_PATTERN.test("a"), true);
  assert.equal(MARK_ID_PATTERN.test("a1"), true);
  assert.equal(MARK_ID_PATTERN.test("a-b"), true);
  assert.equal(MARK_ID_PATTERN.test("A"), false, "大写开头不允许");
  assert.equal(MARK_ID_PATTERN.test("1a"), false, "数字开头不允许");
  assert.equal(MARK_ID_PATTERN.test("a b"), false, "空格不允许");
  assert.equal(MARK_ID_PATTERN.test("a)b"), false, "括号不允许（会闭合选择器）");
  assert.equal(MARK_ID_PATTERN.test("a{b}"), false, "花括号不允许");
  assert.equal(MARK_ID_PATTERN.test(""), false);
  assert.equal(MARK_ID_PATTERN.test("a".repeat(17)), false, "超长不允许");
});
