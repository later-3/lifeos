/**
 * 标记表单测（Task 0003 · P2）。
 *
 * 这张表是"加一个标记 = 加一行数据"的载体，所以它自己的**约束**必须被机器守住：
 * id 走白名单（拼进 ::highlight 选择器）、tone 只拼变量名（不存色值）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MARKS, MARK_ID_PATTERN, markById, toneColorVar, toneSoftVar, labelsOf, toneIdsOf, sayOf } from "../frontend/src/marks.ts";

test("标记表顺序固定：4 个语气 + 2 个功能", () => {
  assert.deepEqual(MARKS.map((m) => m.label), ["疑问", "批评", "鼓励", "同意", "存档", "待办"]);
});

test("分类：语气发给 Agent，功能不发（用户 2026-11-03）", () => {
  assert.deepEqual(MARKS.filter((m) => m.kind === "tone").map((m) => m.id), ["query", "critic", "praise", "agree"]);
  assert.deepEqual(MARKS.filter((m) => m.kind === "feature").map((m) => m.id), ["archive", "todo"]);
});

test("语气类都必须有措辞；功能类不需要", () => {
  for (const mark of MARKS) {
    if (mark.kind === "tone") assert.ok((mark.say ?? "").length > 0, `语气 ${mark.id} 缺 say`);
    else assert.equal(mark.say, undefined, `功能 ${mark.id} 不该有 say（不发给 Agent）`);
  }
});

test("措辞不套死模板：「同意」是「我同意！」不是「我是同意的语气」", () => {
  assert.equal(markById("critic")?.say, "我是批评的语气！");
  assert.equal(markById("agree")?.say, "我同意！");
});

test("sayOf 只取语气、用「、」连接；只有功能时返回空串", () => {
  assert.equal(sayOf(["critic"]), "我是批评的语气！");
  assert.equal(sayOf(["critic", "agree"]), "我是批评的语气！、我同意！");
  assert.equal(sayOf(["critic", "todo"]), "我是批评的语气！", "功能类不进括号");
  assert.equal(sayOf(["todo"]), "", "只有功能 → 空串");
  assert.equal(sayOf([]), "");
});

test("toneIdsOf 只留语气", () => {
  assert.deepEqual(toneIdsOf(["critic", "todo", "agree"]), ["critic", "agree"]);
  assert.deepEqual(toneIdsOf(["archive", "todo"]), []);
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
