// 「引用」格式化（Task 0018 · D15）的穷举测试。
// 格式：按选中来源分前缀（assistant → Agent 说 / user → 我说 / 其他 → 无前缀），
// 引号内保持原样（含多行），统一后接换行 + 箭头（用户接话位置）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteDraftOf, quotePreviewOf } from "../src/selection-quote.ts";

test("assistant 块的选区 → Agent 说 + 箭头", () => {
  assert.equal(quoteDraftOf("这一段回复", "assistant"), "Agent 说：“这一段回复”\n→ ");
});

test("用户气泡的选区 → 我说 + 箭头", () => {
  assert.equal(quoteDraftOf("用户发的文字", "user"), "我说：“用户发的文字”\n→ ");
});

test("思考块/工具块（无说话人）→ 无前缀 + 箭头", () => {
  assert.equal(quoteDraftOf("thinking 里的话", undefined), "“thinking 里的话”\n→ ");
});

test("多行选区：引号内保持原样，箭头在最后一行之后", () => {
  assert.equal(quoteDraftOf("第一行\n第二行", "assistant"), "Agent 说：“第一行\n第二行”\n→ ");
});

test("首尾空白 trim；全空白选区 → 空串（不预填垃圾）", () => {
  assert.equal(quoteDraftOf("  两边空格  ", "assistant"), "Agent 说：“两边空格”\n→ ");
  assert.equal(quoteDraftOf("   \n\t  ", "user"), "");
});

test("按钮预览：不含箭头与换行", () => {
  assert.equal(quotePreviewOf("一段话", "assistant"), "Agent 说：“一段话”");
  assert.equal(quotePreviewOf("第一行\n第二行", "user"), "我说：“第一行\n第二行”");
  assert.equal(quotePreviewOf("   ", undefined), "");
});
