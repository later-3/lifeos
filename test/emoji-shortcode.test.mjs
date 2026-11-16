// 短码切分与替换的纯函数契约（Task 0016 · P1）。
//
// 为什么要有这一层测试：短码替换发生在**正文渲染前**，一旦出错就是"用户写的代码被改成图"
// 或者"表情永远不显示"——两者都不会报错，只会静默错。纯函数穷举是最便宜的护栏。

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyShortcodes, splitCodeSegments } from "../frontend/src/emoji-shortcode.ts";

const KNOWN = new Set(["blush", "tada", "white_check_mark"]);

test("已知短码换成 markdown 图片；未知短码原样保留", () => {
  assert.equal(applyShortcodes("好的 :blush:", KNOWN), "好的 ![blush](/api/media/blush)");
  assert.equal(applyShortcodes("未知 :nope:", KNOWN), "未知 :nope:");
  // 已知与未知混在一句里：只替换已知的
  assert.equal(applyShortcodes(":blush: :nope: :tada:", KNOWN),
    "![blush](/api/media/blush) :nope: ![tada](/api/media/tada)");
});

test("短码 id 的字符集：只认 [a-z0-9-_]，其它形态不碰", () => {
  assert.equal(applyShortcodes(":Blush:", KNOWN), ":Blush:");            // 大写不认
  assert.equal(applyShortcodes("a:b:", KNOWN), "a:b:");                  // 缺结束冒号
  assert.equal(applyShortcodes(":` x `:", KNOWN), ":` x `:");
  assert.equal(applyShortcodes("::::", KNOWN), "::::");
});

test("围栏代码块里的短码原样保留（三反引号与波浪线都算）", () => {
  const fenced = "说明\n```\n发 :blush: 这样\n```\n完";
  assert.equal(applyShortcodes(fenced, KNOWN), fenced);
  const tilde = "~~~\n:blush:\n~~~";
  assert.equal(applyShortcodes(tilde, KNOWN), tilde);
  // 未闭合围栏：整段当代码（渲染器语义一致）
  const unclosed = "```\n:blush:\n还在写";
  assert.equal(applyShortcodes(unclosed, KNOWN), unclosed);
});

test("行内代码里的短码原样保留", () => {
  assert.equal(applyShortcodes("用 `:blush:` 表示", KNOWN), "用 `:blush:` 表示");
  // 落单的反引号不算代码：后面的短码照常替换
  assert.equal(applyShortcodes("落单 ` 然后 :blush:", KNOWN), "落单 ` 然后 ![blush](/api/media/blush)");
});

test("代码段与非代码段交错：只替换非代码部分", () => {
  const text = ":blush: `:tada:` :blush:";
  assert.equal(applyShortcodes(text, KNOWN), "![blush](/api/media/blush) `:tada:` ![blush](/api/media/blush)");
});

test("空集合 / 空文本：短路，返回原值", () => {
  assert.equal(applyShortcodes(":blush:", new Set()), ":blush:");
  assert.equal(applyShortcodes("", KNOWN), "");
});

test("切分结果拼回去必须等于原文（不丢字符是不变量）", () => {
  const samples = [
    "普通文本",
    "```\ncode\n```\ntext :blush:",
    "a `b` c",
    "```js\nconst a = 1;\n```",
    "未闭合 ```\n:blush:",
    "多个 `a` 与 `b`",
  ];
  for (const sample of samples) {
    const joined = splitCodeSegments(sample).map((segment) => segment.text).join("");
    assert.equal(joined, sample, `切分丢失字符：${JSON.stringify(sample)}`);
  }
});
