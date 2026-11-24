/**
 * sourcemap 解码的自测（Task 0033 · P5）。
 *
 * ## 为什么必须测这个
 *
 * VLQ 解码是我自己写的（不引依赖）。写错的表现很危险：**不报错，只是给出错的行号**
 * ——那会让取证结论指向完全无关的代码。所以要用**已知正确答案**的映射验证。
 *
 * 验证素材有两份，都是真实产物：
 *  1. Vite dev 的模块（内联 base64 sourcemap）—— 检验"能拉到并解出源码行"；
 *  2. 手造的极简 mapping（`AAAA` 这类）—— 检验 VLQ 解码本身。
 *
 * 用法：node --experimental-strip-types --test test/sourcemap-translate.test.mjs
 */

import assert from "node:assert/strict";
import test from "node:test";

import { decodeMappingsForTest, firstNonEmpty, originalPositionFor, prettifySource } from "../scripts/sourcemap-translate.mjs";

/*
 * VLQ 基础：`AAAA` = [0,0,0,0]（生成列 0、源 0、行 0、列 0）
 * 手算依据：A=0（value 0，符号位 0）→ 四个字段都是 0。
 */
test("T33-15 VLQ：AAAA 解出源文件第 1 行第 1 列", () => {
  const position = decodeMappingsForTest("AAAA", 1, 0, ["a.ts"]);
  assert.equal(position?.source, "a.ts");
  assert.equal(position?.line, 1);
  assert.equal(position?.column, 1);
});

/*
 * `IACA`：I=8 → 无符号 4（符号位为 0，右移 1 位）→ 生成列 +4；
 * A=0 源索引；C=2 → 无符号 1 → 源行 +1；A=0 源列。
 * 同一行第二个 segment 的生成列应当是 0+4=4。
 */
test("T33-16 VLQ：IACA 表示「生成列 4 对应源码第 2 行第 1 列」", () => {
  const position = decodeMappingsForTest("AAAA,IACA", 1, 4, ["a.ts"]);
  assert.equal(position?.line, 2, "第二个 segment 的源行应为第 2 行（+1）");
  assert.equal(position?.column, 1);
  // 活性：把 `state.line += values[2]` 写成 `state.line = values[2]` → 本用例变红
});

test("T33-17 生成列小于第一个 segment 时，不返回任何结果（而不是硬塞第一个）", () => {
  // 这是"宁可没有，也不给错答案"：取不到就说取不到，不能拿一个不相干的 segment 糊上
  const position = originalPositionFor({ mappings: "IACA", sources: ["a.ts"] }, 1, 0);
  assert.equal(position, undefined);
});

test("T33-18 多行 mappings：分号分段，第二行的状态从第一行继续累加", () => {
  /*
   * `AAAA;AACA`
   * 行 1：生成列 0 → 源 0 / 行 0 / 列 0
   * 行 2：`AACA` = 生成列 +0、源 +0、源行 +1、源列 +0  → 源行 2
   * 注意 VLQ 是**跨行连续的绝对状态**，不是每行从 0 开始。
   */
  const position = decodeMappingsForTest("AAAA;AACA", 2, 0, ["a.ts"]);
  assert.equal(position?.line, 2);
  // 活性：把 `for (row = 0; row <= index; ...)` 的上界写错成 `row < index` → 第二行取不到 → 变红
});

test("T33-19 越界行号返回 undefined，不抛错", () => {
  assert.equal(originalPositionFor({ mappings: "AAAA", sources: ["a.ts"] }, 5, 0), undefined);
  assert.equal(originalPositionFor({}, 1, 0), undefined);
  assert.equal(originalPositionFor(undefined, 1, 0), undefined);
});

test("T33-20 同一行多个 segment：取「生成列 ≤ 目标」的最后一个（就近原则）", () => {
  /*
   * `AAAA,KACA`：第二个 segment 生成列 +5（K=10 → 右移 1 = 5），源行 +1（C=1）
   * 目标列 6 应落在第二个 segment（源行 2）；目标列 3 应落在第一个（源行 1）。
   */
  const at6 = decodeMappingsForTest("AAAA,KACA", 1, 6, ["a.ts"]);
  const at3 = decodeMappingsForTest("AAAA,KACA", 1, 3, ["a.ts"]);
  assert.equal(at6?.line, 2, "列 6 应命中第二个 segment");
  assert.equal(at3?.line, 1, "列 3 应命中第一个 segment");
});

/*
 * T33-21 这条是**真实数据抓出来的缺陷**的回归锁。
 *
 * 第一版把"生成列"跨行累加了（只有 source/line/offset 该跨行累加）。
 * 手造映射 `AAAA;AACA` 每行第一个 segment 的生成列增量恰好是 0，所以 T33-18 仍然通过 ——
 * 拿 Vite 真实映射一试，第 2 行以后全部 `undefined`。
 *
 * 这里刻意把第一行的生成列设成很大的值（`gBAA` → +100），
 * 第二行若还从 100 起算，生成列 0 就永远查不到。
 */
test("T33-21 生成列每行从 0 重新开始（真实映射抓到的缺陷）", () => {
  /*
   * `gBAA;AAAA`
   * 行 1：生成列 +100（gB = 100），源 0 / 行 0 / 列 0
   * 行 2：`AAAA` = 生成列 +0 → 应当是**第 0 列**（若跨行累加就会变成 100）
   */
  const second = decodeMappingsForTest("gBAA;AAAA", 2, 0, ["a.ts"]);
  assert.notEqual(second, undefined, "第二行生成列 0 必须查得到");
  // 活性：把 `state.column = 0` 删掉 → 本用例变红（查不到）
});

test("T33-22 真实 Vite 映射：多行都能翻译（不依赖手造数据）", async () => {
  /* 只在 dev server 活着时跑；不在就跳过（不能因为环境缺失让门禁红） */
  let map;
  try {
    map = await (await import("../scripts/sourcemap-translate.mjs")).loadSourceMapFor("http://localhost:5183/src/md-stream.ts");
  } catch {
    return;
  }
  if (map === undefined) return;   // dev server 没起：跳过

  const lines = [1, 2, 3, 10, 20];
  const resolved = lines.map((line) => originalPositionFor(map, line, 0));
  const found = resolved.filter((position) => position !== undefined);
  assert.equal(found.length, lines.length, `这 ${lines.length} 行都该能翻译，实际 ${found.length} 行`);
  // 活性：删掉 `state.column = 0` → 只剩第 1 行能翻译，本用例变红
});

test("T33-26 源码路径收敛：相对路径与第三方库都可读（生产产物实测形态）", () => {
  // 生产 map 里我们自己的源码长这样（实测）
  assert.equal(prettifySource("../../src/api/review-segments.ts"), "src/api/review-segments.ts");
  // 第三方库在 .pnpm 深层，一屏里全是这种路径会盖住重点
  const pnpm = "../../../../../../../../../../../Code/lifeos/node_modules/.pnpm/marked@18.1.1/node_modules/marked/lib/marked.esm.js";
  assert.equal(prettifySource(pnpm), "marked@18.1.1/marked.esm.js");
  assert.equal(prettifySource("node_modules/react/cjs/react.production.js"), "react/react.production.js");
  // 不能把产物自身的路径也改掉（它是"没翻译成功"的标志）
  assert.equal(prettifySource("/assets/index-BHp-9GxW.js"), "/assets/index-BHp-9GxW.js");
  // 活性：把前导 ../ 的去掉逻辑删掉 → 第一条变红
});

test("T33-30 CDP 用空字符串表示\"没有 url\"：必须回落到 scriptParsed 映射", () => {
  /*
   * 实测缺陷（2026-11-24，白折腾一小时）：
   * `callFrame.url` 是 `""` 而不是 undefined，于是 `frame.url ?? fallback` 永远短路，
   * 拿到空串 → 日志一直显示 `url=空`，而映射表里明明有 `scriptId=4 → index-BHp-9GxW.js`。
   */
  assert.equal(firstNonEmpty("", "", "http://x/index-abc.js"), "http://x/index-abc.js");
  assert.equal(firstNonEmpty(undefined, null, "http://x/a.js"), "http://x/a.js");
  assert.equal(firstNonEmpty("", undefined, null), "", "全空时返回空串，不返回 undefined");
  assert.equal(firstNonEmpty("http://x/first.js", "http://x/second.js"), "http://x/first.js", "取第一个");
  // 活性：把 firstNonEmpty 改成 `return values.find(v => v !== undefined) ?? ""` → 第一条变红（返回 ""）
});
