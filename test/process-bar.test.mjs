// 过程条统计（2026-11-02）：只做统计，不做摘要。
// 这条断言集锁住用户拍板的两个边界：① 0 工具 0 思考不折叠；② 文案极短、缺项省略。
import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDuration, formatTokens, hasProcess, processDetail, processSummary, statsOf,
} from "../frontend/src/process-stats.ts";

const tool = (name = "bash") => ({ type: "toolCall", name, arguments: {} });
const think = (text = "想") => ({ type: "thinking", text, live: false });
const text = (s = "答") => ({ type: "text", text: s });

test("0 工具 0 思考 = 纯聊天，不折叠（用户 2026-11-02 拍板）", () => {
  assert.equal(hasProcess(statsOf([text("一段回答")])), false);
  assert.equal(hasProcess(statsOf([])), false);
});

test("有工具或有思考就折叠（两个条件任一成立）", () => {
  assert.equal(hasProcess(statsOf([tool()])), true);
  assert.equal(hasProcess(statsOf([think()])), true);
  assert.equal(hasProcess(statsOf([think(), tool(), text()])), true);
});

test("统计口径：只数工具与思考，正文块不计", () => {
  const stats = statsOf([think(), tool("bash"), text(), tool("read"), text(), think()]);
  assert.equal(stats.tools, 2);
  assert.equal(stats.thinking, 2);
});

test("时长与 token 由调用方合入，不在块里", () => {
  const stats = statsOf([tool()], { durationMs: 151_000, tokens: 38_200 });
  assert.equal(stats.durationMs, 151_000);
  assert.equal(stats.tokens, 38_200);
  const bare = statsOf([tool()]);
  assert.equal(bare.durationMs, undefined);
  assert.equal(bare.tokens, undefined);
});

test("时长文案：秒/分/小时三档，不足 1 秒不显示", () => {
  assert.equal(formatDuration(500), undefined, "不足 1 秒不写 0 秒");
  assert.equal(formatDuration(8_000), "8 秒");
  assert.equal(formatDuration(151_000), "2 分 31 秒");
  assert.equal(formatDuration(120_000), "2 分", "整分不带 0 秒");
  assert.equal(formatDuration(3_900_000), "1 小时 5 分");
  assert.equal(formatDuration(3_600_000), "1 小时");
  assert.equal(formatDuration(Number.NaN), undefined);
});

test("token 文案：k / M 紧凑，0 与非法值不显示", () => {
  assert.equal(formatTokens(912), "912");
  assert.equal(formatTokens(38_200), "38.2k");
  assert.equal(formatTokens(1_400_000), "1.4M");
  assert.equal(formatTokens(0), undefined);
  assert.equal(formatTokens(Number.NaN), undefined);
});

test("过程条文字极短：工具 + 时长 + token，缺项直接省略", () => {
  assert.equal(
    processSummary({ tools: 14, thinking: 3, durationMs: 151_000, tokens: 38_200 }),
    "14 次工具 · 2 分 31 秒 · 38.2k tokens",
  );
  // 只有工具，没有时长/token（老会话）
  assert.equal(processSummary({ tools: 5, thinking: 0 }), "5 次工具");
  // 只有思考（例如被中断的轮次）
  assert.equal(processSummary({ tools: 0, thinking: 2 }), "2 段思考");
  // 不允许出现"0 次工具"这类噪音
  assert.equal(processSummary({ tools: 0, thinking: 0 }), "");
});

test("过程条不写摘要式措辞（避免被当成'模型总结过这段过程'）", () => {
  const summary = processSummary({ tools: 3, thinking: 1, durationMs: 5_000, tokens: 1000 });
  for (const forbidden of ["总结", "摘要", "概要", "大意"]) {
    assert.equal(summary.includes(forbidden), false, `过程条不得出现「${forbidden}」`);
  }
});

test("tooltip 补全正文省掉的项（思考段数 / 精确秒数）", () => {
  assert.equal(
    processDetail({ tools: 2, thinking: 1, durationMs: 12_340, tokens: 900 }),
    "2 次工具调用 · 1 段思考 · 耗时 12.3 秒 · 900 tokens",
  );
});
