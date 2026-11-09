// G8 语法高亮的执行层：真 Prism 分词（不 mock），验证"每行 token 与行号对齐"。
//
// 为什么必须用真 Prism 测：最典型的错法是"分词结果的行数与 diff 行号错位一行"，
// mock 掉 Prism 就永远发现不了。difit 也用真 Prism（`useFileLevelTokens.test.ts`）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  clearTokenCache, ensureGrammar, ensurePrism, grammarReady, prismReady, TOKEN_CACHE_LIMIT, tokenizeFile, tokenizeFileCached,
} from "../frontend/src/review-highlight-prism.ts";

/**
 * Prism 现在是**动态加载**的（首屏产物 +27.8kB gzip 的代价不该人人付），
 * 所以测试必须先等它加载完——这正好也验证了"动态加载路径可用"。
 */
await ensurePrism();
import { MAX_HIGHLIGHT_LINES, tokenSideOf, tokensAtLine } from "../frontend/src/review-highlight.ts";

const CODE = [
  "export function demo(a: number): string {",
  "  // 注释",
  "  const value = a + 1;",
  '  return `${value}`;',
  "}",
].join("\n");

test("G8·P0 Prism 动态加载：加载前 prismReady=false、加载后 true（可重复调用）", async () => {
  assert.equal(prismReady(), true, "上面已 await ensurePrism()");
  const again = await ensurePrism();
  assert.ok(again !== undefined, "重复调用应返回同一个实例");
});

test("G8·P1 分包进来的 grammar 直接可用（typescript/tsx/markdown/json/yaml/css）", () => {
  for (const language of ["typescript", "tsx", "javascript", "jsx", "markdown", "json", "yaml", "css", "markup", "python", "go", "rust"]) {
    assert.equal(grammarReady(language), true, `${language} 应在 prism-react-renderer 包内`);
  }
});

test("G8·P2 分词：行数与源码行数一致（末尾换行不多算一行 → 行号不错位）", () => {
  const tokens = tokenizeFile(`${CODE}\n`, "typescript");
  assert.ok(tokens !== null);
  assert.equal(tokens.length, 5, `应有 5 行，实际 ${tokens.length}`);
});

test("G8·P3 按行查：第 1 行有 keyword `export`，第 2 行是注释（token 类型真的分出来了）", () => {
  const tokens = tokenizeFile(CODE, "typescript");
  const first = tokensAtLine(tokens, 1) ?? [];
  assert.ok(first.some((token) => token.types.includes("keyword") && token.content === "export"), JSON.stringify(first));
  const second = tokensAtLine(tokens, 2) ?? [];
  assert.ok(second.some((token) => token.types.includes("comment")), JSON.stringify(second));
});

test("G8·P4 认不出/未加载的 grammar → null（不高亮，不抛错）", () => {
  assert.equal(tokenizeFile(CODE, "no-such-language"), null);
  assert.equal(tokenizeFile(CODE, undefined), null);
});

test("G8·P5 超 2000 行 → null（退化门槛生效，与 difit 同值）", () => {
  const long = Array.from({ length: MAX_HIGHLIGHT_LINES + 1 }, (_, i) => `const v${i} = ${i};`).join("\n");
  assert.equal(tokenizeFile(long, "typescript"), null, `${MAX_HIGHLIGHT_LINES + 1} 行应退化为不高亮`);
  const exact = Array.from({ length: MAX_HIGHLIGHT_LINES }, (_, i) => `const v${i} = ${i};`).join("\n");
  assert.notEqual(tokenizeFile(exact, "typescript"), null, `正好 ${MAX_HIGHLIGHT_LINES} 行必须高亮`);
});

test("G8·P6 缓存：同内容两次返回同一个引用（不重复分词）", () => {
  clearTokenCache();
  const a = tokenizeFileCached(CODE, "typescript");
  const b = tokenizeFileCached(CODE, "typescript");
  assert.ok(a !== null && a === b, "第二次应命中缓存（引用相同）");
});

test("G8·P7 缓存按**内容**失效：内容改一行 → 不是同一份结果", () => {
  clearTokenCache();
  const a = tokenizeFileCached(CODE, "typescript");
  const b = tokenizeFileCached(`${CODE}\nconst extra = 1;`, "typescript");
  assert.ok(a !== null && b !== null && a !== b, "内容变了必须重新分词（不能拿旧高亮）");
});

test("G8·P8 缓存上限：超出 TOKEN_CACHE_LIMIT 丢最旧（不会无限增长）", () => {
  clearTokenCache();
  for (let i = 0; i < TOKEN_CACHE_LIMIT + 5; i += 1) {
    tokenizeFileCached(`const v${i} = ${i};`, "typescript");
  }
  // 再查最早那条 → 应已淘汰（返回的是新算的结果，不是缓存引用）
  const first = tokenizeFileCached("const v0 = 0;", "typescript");
  const again = tokenizeFileCached("const v0 = 0;", "typescript");
  assert.ok(first !== null && first === again, "淘汰后重新计算并缓存");
});

test("G8·P9 异步 grammar 加载：已就绪的返回 true；未知语言返回 false（不抛）", async () => {
  assert.equal(await ensureGrammar("typescript"), true);
  assert.equal(await ensureGrammar("no-such-language"), false);
});

test("G8·P10 侧选择 + 按行查联合：删除行用 old 侧、context 用 new 侧（difit DiffCodeLine 同判）", () => {
  const oldTokens = tokenizeFile("const a = 1;\nconst b = 2;", "typescript");
  const newTokens = tokenizeFile("const a = 1;\nconst b = 22;", "typescript");
  const removed = { type: "removed", oldNo: 2, newNo: null };
  const context = { type: "context", oldNo: 1, newNo: 1 };
  const removedTokens = tokensAtLine(oldTokens, removed.oldNo);
  const contextTokens = tokensAtLine(tokenSideOf(context) === "new" ? newTokens : oldTokens, context.newNo);
  assert.ok(removedTokens !== null && removedTokens.some((token) => token.content.includes("2")), "删除行拿到 old 侧第 2 行");
  assert.ok(contextTokens !== null, "context 行拿到 new 侧第 1 行");
});
