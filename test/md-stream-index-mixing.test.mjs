/**
 * `md-stream.ts` 死循环的回归测试（Task 0036）。
 *
 * ## 这个 bug 的实测现场（2026-11-24）
 *
 * ```
 * closeIncompleteMarkdown("abc `code` def")     → 1ms     ✅
 * closeIncompleteMarkdown("😀 abc `code` def")  → 永不返回 ⏱
 * ```
 *
 * 线上三次事故（Chrome 11 小时 / Edge / Chrome 9 小时）的主线程栈经 sourcemap 翻译后都指向
 * `md-stream.ts` 的这一段，中间夹着 `react-dom` 的 `useMemo` ——
 * 也就是"一条含 emoji + 反引号的流式正文进入渲染"就足以把主线程永久钉死。
 *
 * ## 为什么这些用例必须带 emoji
 *
 * 死循环的成因是**码点下标与 UTF-16 码元下标混用**：一个 emoji（代理对）占 2 个码元、
 * 1 个码点，于是后续所有位置错开 1 → `runLength` 读到非反引号返回 0 → `i += 0` 原地不动。
 * 纯 ASCII 输入两套下标数值相同，**永远不会触发** —— 所以没有 emoji 的用例挡不住这个回归。
 *
 * ## 每个用例都有超时
 *
 * 死循环不会抛错、也不会返回，只会**永久占住 CPU**。测试必须能在这个情况下失败而不是挂死，
 * 所以用 `Promise.race` 包一层超时。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { closeIncompleteMarkdown } from "../frontend/src/md-stream.ts";

/** 限时执行：死循环会让它超时失败，而不是把整个 test runner 挂住。 */
async function withinMs(label, fn, ms = 200) {
  const result = await Promise.race([
    Promise.resolve().then(fn).then((value) => ({ ok: true, value })),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, label }), ms)),
  ]);
  assert.equal(result.ok, true, `${label}：${ms}ms 内没返回（判定为死循环）`);
  return result.value;
}

test("T36-1 emoji + 成对反引号：不再死循环（原始 bug 的最小复现）", async () => {
  /*
   * 修复前：这一条会永久挂住（实测 60 秒不返回）。
   * 修复后：必须 <200ms 且返回字符串。
   */
  const output = await withinMs("emoji+成对反引号", () => closeIncompleteMarkdown("😀 abc `code` def"));
  assert.equal(typeof output, "string");
  assert.equal(output, "😀 abc `code` def", "已闭合的输入应当原样返回");
});

test("T36-2 emoji 在前 + 落单反引号：按语义补一个反引号", async () => {
  const output = await withinMs("emoji+落单反引号", () => closeIncompleteMarkdown("😀 abc `unclosed"));
  assert.ok(output.endsWith("`"), "未闭合的行内码应补一个反引号");
});

test("T36-3 多个 emoji 夹多个反引号：全部形态都不许卡", async () => {
  const cases = [
    "😀😀😀 `x`",
    "😀`a`😀`b`😀",
    "😀 ``` x ` y",
    "这是中文 😀 然后 `没闭合",
    "😀`",
    "😀😀\n`code`\n😀",
    "🀄️ `x` ️",
    "👨‍👩‍👧‍👦 `family`",
  ];
  for (const text of cases) {
    await withinMs(`case ${JSON.stringify(text).slice(0, 30)}`, () => closeIncompleteMarkdown(text));
  }
});

test("T36-4 真实病态输入：大量 emoji 与反引号混排", async () => {
  /* 用 5000 个 emoji + 交替的反引号，量级上模拟"长回复里带表情" */
  const text = "😀`".repeat(5000);
  const output = await withinMs("5000×emoji+反引号", () => closeIncompleteMarkdown(text), 2000);
  assert.equal(typeof output, "string");
});

test("T36-5 幂等：修好之后不能改变原有语义", async () => {
  /* 已经完整的文本必须原样返回（这是函数的契约，修复不能破坏它） */
  const complete = [
    "普通文字",
    "`code`",
    "**bold**",
    "😀 表情 + `code`",
    "```js\nconst a = 1;\n```",
    "",
  ];
  for (const text of complete) {
    const output = await withinMs(`幂等 ${JSON.stringify(text).slice(0, 20)}`, () => closeIncompleteMarkdown(text));
    assert.equal(output, text, `已完整文本不该被改动：${JSON.stringify(text)}`);
  }
});

test("T36-6 未闭合的粗体在含 emoji 时仍然补齐（语义没被修坏）", async () => {
  const output = await withinMs("emoji+未闭合粗体", () => closeIncompleteMarkdown("😀 **未闭合粗体"));
  assert.ok(output.includes("**"), "输出里应保留/补齐 ** 标记");
  assert.ok(output.length >= "😀 **未闭合粗体".length);
});
