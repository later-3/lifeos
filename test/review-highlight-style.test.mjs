// G8 语法高亮的样式映射：每个分组都要有字面量类名（Tailwind 只扫静态字符串）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tokenClassName, TOKEN_GROUPS } from "../frontend/src/review-highlight-style.ts";

const TOKENS = readFileSync(join(process.cwd(), "frontend/src/design/tokens.css"), "utf8");
const STYLE = readFileSync(join(process.cwd(), "frontend/src/review-highlight-style.ts"), "utf8");

test("G8·C1 每个分组都映射到一个 `text-syn-*` 类，且该类在 tokens.css 里有对应色值", () => {
  assert.ok(TOKEN_GROUPS.length >= 6, `分组过少（${TOKEN_GROUPS.length}）`);
  for (const group of TOKEN_GROUPS) {
    const className = tokenClassName([group]);
    assert.equal(typeof className, "string", `分组 ${group} 没映射到类名`);
    assert.match(className, /^text-syn-[a-z]+$/, className);
    const cssVar = className.replace("text-syn-", "--color-syn-");
    assert.ok(TOKENS.includes(cssVar), `tokens.css 里缺 ${cssVar}（类会存在但没有颜色）`);
  }
});

test("G8·C2 类名必须是**字面量**（模板拼接 Tailwind 扫不到 → 高亮静默失效）", () => {
  // 反向断言：源码里不许出现 `text-syn-${` 这种拼接
  assert.equal(/text-syn-\$\{/.test(STYLE), false, "类名不能用模板拼接（Tailwind 扫描不到）");
  // 正向：每个类名都以字面量出现在源码里
  for (const group of TOKEN_GROUPS) {
    const className = tokenClassName([group]);
    assert.ok(STYLE.includes(`"${className}"`), `${className} 没有以字面量出现`);
  }
});

test("G8·C3 Prism 的多层 types 取第一个能识别的（`[function, variable]` → function）", () => {
  assert.equal(tokenClassName(["function", "variable"]), "text-syn-function");
  assert.equal(tokenClassName(["unknown-a", "keyword"]), "text-syn-keyword", "前面认不出就继续往后找");
});

test("G8·C4 plain / 空 types / 全未识别 → undefined（用默认文字色，不是空字符串）", () => {
  assert.equal(tokenClassName(["plain"]), undefined);
  assert.equal(tokenClassName([]), undefined);
  assert.equal(tokenClassName(["totally-unknown"]), undefined);
});

test("G8·C5 常见语言的关键 token 都有颜色（ts 关键字/字符串/注释/数字/函数）", () => {
  const expectations = {
    keyword: "text-syn-keyword",
    string: "text-syn-string",
    comment: "text-syn-comment",
    number: "text-syn-number",
    function: "text-syn-function",
    "class-name": "text-syn-type",
    operator: "text-syn-punctuation",
  };
  for (const [type, expected] of Object.entries(expectations)) {
    assert.equal(tokenClassName([type]), expected, `${type} 应为 ${expected}`);
  }
});
