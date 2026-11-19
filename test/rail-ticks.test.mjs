/**
 * 导航竖条的刻度投影（Task 0020 · P1）。
 *
 * 断言集围绕三件事，每一件都对应一个真实会错的地方：
 *  1. **一条消息一条刻度**，且只取"用户消息 + 轮末回复"（工具段/思考段不出刻度）；
 *  2. **长度度量是字符数**（T6 收口：不再有 token 与字数两套口径）；
 *  3. 边界：空会话、孤儿 assistant、流式中、缺 id、代理对截断。
 *
 * 数字依据（2026-11-19 实测，136 个会话 / 37,529 条 assistant 消息）：
 * 轮里有多条带文字 assistant 消息的占 48%，最后一条占整轮字符中位 83%、占 output tokens 中位 22%
 * —— 两者差 4 倍，所以取"字符数"这一套口径。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { RAIL_PREVIEW_CHARS, railTicksOf, truncateByCodePoint } from "../src/rail-ticks.ts";

const user = (id, text) => ({ role: "user", text, id });
const assistant = (id, text, extra = {}) => ({ role: "assistant", text, id, ...extra });

test("一问一答 = 两条刻度（一轮 = 2）", () => {
  const ticks = railTicksOf([user("m1", "问题"), assistant("m2", "回答")]);
  assert.deepEqual(ticks.map((tick) => [tick.id, tick.role]), [["m1", "user"], ["m2", "assistant"]]);
});

test("一轮里的工具段与思考段不出刻度，只留最后一条带文字的回复", () => {
  // 真实形态：user → assistant(thinking+toolCall, text="") → toolResult（已挂回，不在顶层）
  // → assistant(text="再看看…") → assistant(text="最终答案")
  const ticks = railTicksOf([
    user("u1", "查一下"),
    assistant("a1", ""),
    assistant("a2", "再看看"),
    assistant("a3", "最终答案"),
  ]);
  assert.deepEqual(ticks.map((tick) => tick.id), ["u1", "a3"], "同轮只留最后一条带文字的回复");
  assert.equal(ticks[1].chars, "最终答案".length);
});

test("真实极端回合：198 段助手消息里只有最后一段带文字 → 仍只出 1 条助手刻度", () => {
  const messages = [user("u1", "跑一遍")];
  for (let i = 0; i < 197; i += 1) messages.push(assistant(`a${i}`, ""));
  messages.push(assistant("last", "完成"));
  const ticks = railTicksOf(messages);
  assert.equal(ticks.length, 2);
  assert.equal(ticks[1].id, "last");
});

test("纯工具轮（没有任何文字回复）→ 只有用户刻度", () => {
  const ticks = railTicksOf([user("u1", "看目录"), assistant("a1", ""), assistant("a2", "   ")]);
  assert.deepEqual(ticks.map((tick) => tick.id), ["u1"]);
});

test("长度取字符数，不是 token（T6 收口）", () => {
  const ticks = railTicksOf([user("u1", "四个汉字"), assistant("a1", "十个字十个字十个")]);
  assert.equal(ticks[0].chars, 4);
  assert.equal(ticks[1].chars, 8);
  assert.equal(Object.hasOwn(ticks[0], "tokens"), false, "刻度上不出现 token 字段");
});

test("流式中的那条不是最终回复，不出刻度", () => {
  const ticks = railTicksOf([
    user("u1", "第一问"),
    assistant("a1", "第一答"),
    user("u2", "第二问"),
    assistant("a2", "还在写", { streaming: true }),
  ]);
  assert.deepEqual(ticks.map((tick) => tick.id), ["u1", "a1", "u2"], "流式中那条要等这一轮结束");
});

test("第一条用户消息之前的孤儿 assistant 不出刻度（压缩后可能残留）", () => {
  const ticks = railTicksOf([assistant("orphan", "上一段的尾巴"), user("u1", "问"), assistant("a1", "答")]);
  assert.deepEqual(ticks.map((tick) => tick.id), ["u1", "a1"], "没有对应的『问』，画出来点不出所以然");
});

test("缺 id 的消息不出刻度（跳转锚点必须有 id）", () => {
  const ticks = railTicksOf([
    { role: "user", text: "没有 id" },
    user("u1", "有 id"),
    { role: "assistant", text: "没有 id 的回复" },
    assistant("a1", "有 id 的回复"),
  ]);
  assert.deepEqual(ticks.map((tick) => tick.id), ["u1", "a1"]);
});

test("空会话与只有空白 → []", () => {
  assert.deepEqual(railTicksOf([]), []);
  assert.deepEqual(railTicksOf([assistant("a1", "  \n  ")]), []);
});

test("preview 截断到 100 个码点，且不切断代理对", () => {
  const long = "😀".repeat(150);            // 每个 emoji 是 2 个 UTF-16 单元
  const ticks = railTicksOf([user("u1", long)]);
  assert.equal(Array.from(ticks[0].preview).length, RAIL_PREVIEW_CHARS);
  assert.equal(ticks[0].preview, "😀".repeat(RAIL_PREVIEW_CHARS), "截断处不能留下半个 emoji");
  assert.equal(ticks[0].chars, long.length, "chars 仍是原文字符长度，不受预览截断影响");
});

test("preview 去掉首尾空白，chars 保留原文长度", () => {
  const ticks = railTicksOf([user("u1", "  中间有空格  ")]);
  assert.equal(ticks[0].preview, "中间有空格");
  assert.equal(ticks[0].chars, 9, "char 是原文长度（含两侧空格），只有 preview 去空白");
});

test("truncateByCodePoint：边界与非法入参", () => {
  assert.equal(truncateByCodePoint("abc", 0), "");
  assert.equal(truncateByCodePoint("abc", -1), "");
  assert.equal(truncateByCodePoint("abc", 3), "abc");
  assert.equal(truncateByCodePoint("abcd", 3), "abc");
  assert.equal(truncateByCodePoint("👨‍👩‍👧", 1), "👨", "ZWJ 家族按码点切，至少不出孤代理");
});

test("真实会话形态：多轮、每轮多条回复、中间夹空文字段", () => {
  const ticks = railTicksOf([
    user("u1", "第一问" + "补".repeat(70)),
    assistant("a1", ""),
    assistant("a2", "第一答"),
    user("u2", "第二问"),
    assistant("a3", "中间过程"),
    assistant("a4", ""),
    assistant("a5", "第二答" + "正".repeat(200)),
  ]);
  assert.deepEqual(ticks.map((tick) => [tick.id, tick.role]), [
    ["u1", "user"], ["a2", "assistant"],
    ["u2", "user"], ["a5", "assistant"],
  ]);
  assert.equal(ticks[0].chars, 73);
  assert.equal(ticks[3].chars, 203);
  assert.ok(ticks[3].preview.length <= RAIL_PREVIEW_CHARS * 2, "预览截断后长度受控（UTF-16 单元上界）");
});
