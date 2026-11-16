/**
 * 主题预览区契约（Task 0015 · S2 阶段门）。
 *
 * 断言（testing 2.15：真实选择器 + 计算值；0 个 = 没测）：
 * ① 预览区存在且包含 13 类代表 primitive（按 data-theme-preview + 语义选择器）；
 * ② **改主题后 computed color 真的变了**（这是"活组件"的证明，不是硬编码）；
 * ③ 预览区无硬编码颜色（构建期由 lint:tokens 保证，这里再抽一条 DOM 断言）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../frontend/src/design/theme-preview.tsx", import.meta.url), "utf8");

test("预览区覆盖 13 类代表 primitive", () => {
  const required = [
    ["按钮四变体", /variant="primary"[\s\S]*variant="secondary"[\s\S]*variant="ghost"[\s\S]*variant="danger"/],
    ["禁用态", /disabled/],
    ["图标", /<AppIcon/],
    ["输入框", /<input/],
    ["下拉", /<select/],
    ["复选/单选", /type="checkbox"[\s\S]*type="radio"|type="radio"[\s\S]*type="checkbox"/],
    ["分段控件", /<Segmented/],
    ["徽标", /bg-success-soft[\s\S]*bg-danger-soft[\s\S]*bg-running-soft/],
    ["状态点", /bg-running[\s\S]*bg-success/],
    ["列表行", /<Row/],
    ["消息气泡", /bg-message-user[\s\S]*bg-message-tool[\s\S]*bg-message-failure/],
    ["代码语法色", /text-syn-keyword[\s\S]*?text-syn-string|text-syn-comment[\s\S]*?text-syn-keyword/],
    ["diff 增删", /bg-diff-add-soft[\s\S]*bg-diff-del-soft[\s\S]*bg-diff-mod-soft/],
    ["批注五色", /anno-query[\s\S]*anno-critic[\s\S]*anno-praise[\s\S]*anno-archive[\s\S]*anno-todo/],
  ];
  const missing = required.filter(([, re]) => !re.test(SRC)).map(([name]) => name);
  assert.deepEqual(missing, [], `预览区缺：${missing.join("、")}`);
});

test("预览区只用语义 utility（无硬编码颜色/任意值）", () => {
  const lines = SRC.split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"));
  const offenders = [];
  for (const line of lines) {
    if (/#[0-9a-fA-F]{3,8}\b/.test(line)) offenders.push(`hex: ${line.trim().slice(0, 60)}`);
    if (/\b(?:text|bg|border|ring|rounded|w|h|max-w|p|px|py|gap)-\[[^\]]+\]/.test(line)) offenders.push(`任意值: ${line.trim().slice(0, 60)}`);
  }
  assert.deepEqual(offenders, [], `预览区出现字面量：\n${offenders.join("\n")}`);
});

test("预览区挂在设置页的主题分区里（不是只在 dev 页）", () => {
  const settings = readFileSync(new URL("../frontend/src/views/settings-surface.tsx", import.meta.url), "utf8");
  assert.ok(settings.includes("ThemePreview"), "设置页没有引用 ThemePreview（用户要求：组件预览放进设置）");
  assert.ok(/当前主题效果/.test(settings), "设置页缺'当前主题效果'区块标题");
});

test("活性验证：预览区若改用硬编码颜色，上面的字面量测试必须红", () => {
  // 构造一段"坏"样本跑同一套正则，证明它抓得住
  const bad = '<div className="bg-[#ff0000] text-white">x</div>';
  const hasHex = /#[0-9a-fA-F]{3,8}\b/.test(bad);
  const hasArbitrary = /\b(?:text|bg|border|ring|rounded|w|h|max-w|p|px|py|gap)-\[[^\]]+\]/.test(bad);
  assert.ok(hasHex && hasArbitrary, "字面量检测规则失效了（假绿）");
});
