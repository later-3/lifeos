/**
 * 字体主题化契约（Task 0015 · S3 阶段门）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../frontend/src/index.css", import.meta.url), "utf8");
const TOKENS = readFileSync(new URL("../frontend/src/design/tokens.css", import.meta.url), "utf8");
const PKG = readFileSync(new URL("../frontend/src/design/theme-package.ts", import.meta.url), "utf8");
const SETTINGS = readFileSync(new URL("../frontend/src/views/settings-surface.tsx", import.meta.url), "utf8");

test("字体族走变量（不是写死在选择器里）", () => {
  assert.ok(/--font-sans:/.test(CSS), "index.css 没有 --font-sans 变量");
  assert.ok(/--font-mono:/.test(CSS), "index.css 没有 --font-mono 变量");
  assert.ok(/font-family: var\(--font-sans\)/.test(CSS), "body 字体没走变量");
  assert.ok(/pre, code, \.font-mono \{\s*font-family: var\(--font-mono\)/.test(CSS), "代码块字体没走变量");
});

test("主题包 schema 有字体槽，应用时写入", () => {
  assert.ok(/fonts\?: \{ sans\?: string; mono\?: string \}/.test(PKG), "ThemePack 没有 fonts 槽");
  assert.ok(/setProperty\("--font-sans", pack\.fonts\.sans\)/.test(PKG), "applyThemePack 没写 --font-sans");
});

test("设置页有字体选择器（≥3 个候选）", () => {
  assert.ok(/FONT_CHOICES/.test(SETTINGS), "设置页没有字体候选");
  const count = (SETTINGS.match(/id: "(system|serif-cjk|hei-cjk|mono-ui)", label:/g) ?? []).length;
  assert.ok(count >= 3, `字体候选只有 ${count} 个（要求 ≥3）`);
});

test("切换字体后刷新能保持（持久化）", () => {
  assert.ok(/localStorage\.setItem\("lifeos\.fontId"/.test(SETTINGS), "字体选择没有持久化");
  assert.ok(/localStorage\.getItem\("lifeos\.fontId"\)/.test(SETTINGS), "字体选择没有读回");
});

test("默认字体与改造前一致（不选字体时不改变观感）", () => {
  assert.ok(/--font-sans: Inter, -apple-system/.test(CSS), "默认字体栈被改动了（应与改造前一致）");
});

test("活性验证：如果 body 字体改回硬编码，检测必须红", () => {
  const bad = "html, body { font-family: Inter, sans-serif; }";
  assert.ok(!/font-family: var\(--font-sans\)/.test(bad), "探测规则失效");
});
