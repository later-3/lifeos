// G8 语法高亮的纯判定：语言识别 / 行级查 token / 侧选择 / 退化门槛。
//
// 参考：difit `languageDetection.ts:63-145`（扩展名映射）、`useFileLevelTokens.ts:21`（2000 行门槛）、
//      `DiffCodeLine.tsx:46-58`（按行号查 + 删除行用 old 侧）。
// 门槛值的依据是**本机实测**（2000 行 9.9ms / 4000 行 32.5ms），不是照抄。
import test from "node:test";
import assert from "node:assert/strict";
import {
  extensionOf, languageOf, lineCountOf, MAX_HIGHLIGHT_LINES, shouldTokenize, tokenSideOf, tokensAtLine,
} from "../frontend/src/review-highlight.ts";

test("G8·1 扩展名：取小写、无扩展名返回整名、隐藏文件不误判", () => {
  assert.equal(extensionOf("src/a.TS"), "ts");
  assert.equal(extensionOf("README"), "readme");
  assert.equal(extensionOf(".gitignore"), ".gitignore", "`.gitignore` 的 dot 在下标 0，不该当扩展名");
  assert.equal(extensionOf("a/b/c.d.ts"), "ts");
});

test("G8·2 语言映射：我们实际会遇到的类型都认得出（代表性抽样）", () => {
  const cases = {
    "a.ts": "typescript", "a.mts": "typescript", "a.tsx": "tsx",
    "a.js": "javascript", "a.jsx": "jsx", "a.mjs": "javascript",
    "a.css": "css", "a.scss": "css", "a.md": "markdown", "a.json": "json",
    "a.yml": "yaml", "a.sh": "bash", "a.py": "python", "a.go": "go", "a.rs": "rust",
    "a.java": "java", "a.sql": "sql", "a.html": "markup", "a.toml": "toml",
  };
  for (const [path, expected] of Object.entries(cases)) {
    assert.equal(languageOf(path), expected, `${path} 应为 ${expected}`);
  }
});

test("G8·3 认不出的扩展名 → undefined（不高亮；比猜一个语言诚实）", () => {
  assert.equal(languageOf("a.unknownext"), undefined);
  assert.equal(languageOf("Makefile"), undefined);
  assert.equal(languageOf("a.wasm"), undefined);
});

test("G8·4 退化门槛与 difit 同值 2000，且**正好 2000 行仍高亮**（> 才退化）", () => {
  assert.equal(MAX_HIGHLIGHT_LINES, 2000, "difit useFileLevelTokens.ts:21");
  assert.equal(shouldTokenize("typescript", 2000), true);
  assert.equal(shouldTokenize("typescript", 2001), false);
  assert.equal(shouldTokenize(undefined, 10), false, "认不出语言就别分");
  assert.equal(shouldTokenize("typescript", -1), false);
});

test("G8·5 按行查 token：1 起、越界返回 null、null 输入返回 null（不抛）", () => {
  const perLine = [[{ types: ["keyword"], content: "const" }], [{ types: ["plain"], content: "x" }]];
  assert.deepEqual(tokensAtLine(perLine, 1), perLine[0]);
  assert.deepEqual(tokensAtLine(perLine, 2), perLine[1]);
  assert.equal(tokensAtLine(perLine, 3), null);
  assert.equal(tokensAtLine(perLine, 0), null);
  assert.equal(tokensAtLine(perLine, null), null);
  assert.equal(tokensAtLine(null, 1), null);
});

test("G8·6 侧选择：删除行用 old；其它用 new；没有 new 行号回落 old（difit 同判）", () => {
  assert.equal(tokenSideOf({ type: "removed", oldNo: 5, newNo: null }), "old");
  assert.equal(tokenSideOf({ type: "added", oldNo: null, newNo: 6 }), "new");
  assert.equal(tokenSideOf({ type: "context", oldNo: 3, newNo: 3 }), "new");
  assert.equal(tokenSideOf({ type: "context", oldNo: 3, newNo: null }), "old", "只有 old 行号时回落 old");
  assert.equal(tokenSideOf({ type: "removed", oldNo: null, newNo: null }), null);
});

test("G8·7 行数：末尾换行不多算一行（否则每行都错位）", () => {
  assert.equal(lineCountOf("a\nb\nc"), 3);
  assert.equal(lineCountOf("a\nb\nc\n"), 3, "末尾换行不额外算一行");
  assert.equal(lineCountOf(""), 0);
  assert.equal(lineCountOf("\n"), 1);
});

test("G8·8 门槛值必须小于 G5 的大文件预览行数上限的两倍（合理性自检）", () => {
  // 这条不是抄来的，是防"两个常量各自漂移"：高亮门槛应显著大于"默认展开 200 行"，
  // 否则默认展开的 200 行反而没有高亮，用户会觉得高亮"时有时无"。
  assert.ok(MAX_HIGHLIGHT_LINES >= 200 * 4, `MAX_HIGHLIGHT_LINES=${MAX_HIGHLIGHT_LINES} 对 200 行预览太小`);
});
