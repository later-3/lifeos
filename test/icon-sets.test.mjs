/**
 * 图标解析与覆盖度（Task 0016 · P2-S1）。
 *
 * 这一组门禁要防的是一类**不报错、只在慢网络上表现为"打不开"**的回归：
 *
 * 2026-11-16 实测（案例 C001）：`icon-sets.tsx` 用了
 * `import * as Tabler/Lucide/Phosphor` + `bag[name]` 动态索引，tree-shaking 失效 →
 * **三个库整包进首屏 8572 KB**（主 chunk 9.27 MB 的 ≈87%–92%），而我们只用 41 个语义名。
 * 它通过了 1356 条单测 + 219 条 UI 契约 + 三类 lint —— 因为没有任何门禁看产物大小。
 *
 * 这里锁四件事：
 *  1. 判定逻辑（缺项 → null，不抛、不静默回退）；
 *  2. 覆盖度算法（哪套缺哪些名）；
 *  3. 注册表**不得**再出现命名空间导入（静态检查，改回去立刻红）；
 *  4. 生成文件与源表一致（`gen:icons --check`，漏跑脚本 = 红）。
 *
 * 注意：**不在这个文件里 import `icon-sets.tsx`** —— 它会 import 三个图标库的真实组件，
 * Node 直接加载 `.tsx` 做不到。跨文件的事实一致性由 `lint:icons`（esbuild 打包后量产物）与
 * `test/design-manifest` 覆盖。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { coverageOf, pickFrom } from "../frontend/src/design/icon-sets-resolve.ts";

const SETS = readFileSync(new URL("../frontend/src/design/icon-sets.tsx", import.meta.url), "utf8");
const GENERATED = readFileSync(new URL("../frontend/src/design/icon-sets.generated.ts", import.meta.url), "utf8");

// ── 判定逻辑 ────────────────────────────────────────────────────────────────

test("pickFrom：命中返回组件", () => {
  const table = { a: "A", b: "B" };
  assert.equal(pickFrom(table, "a"), "A");
});

test("pickFrom：显式 null（该源缺此项）→ null，不抛异常", () => {
  const table = { a: "A", b: null };
  assert.equal(pickFrom(table, "b"), null);
});

test("pickFrom：键不存在（拼写错 / 漏生成）→ null，不抛异常（一个图标缺失不该白屏）", () => {
  assert.equal(pickFrom({ a: "A" }, "typo"), null);
});

// ── 覆盖度 ──────────────────────────────────────────────────────────────────

test("coverageOf：分别报告每套缺哪些语义名", () => {
  const names = ["a", "b", "c"];
  const report = coverageOf(names, {
    full: { a: 1, b: 2, c: 3 },
    missingB: { a: 1, b: null, c: 3 },
    missingAll: { a: null, b: null, c: null },
  });
  assert.deepEqual(report.full, { total: 3, missing: [] });
  assert.deepEqual(report.missingB, { total: 3, missing: ["b"] });
  assert.deepEqual(report.missingAll, { total: 3, missing: ["a", "b", "c"] });
});

test("coverageOf：空表 = 全部缺失（不是 0 项）", () => {
  const report = coverageOf(["a", "b"], { empty: {} });
  assert.deepEqual(report.empty, { total: 2, missing: ["a", "b"] });
});

// ── 静态检查（防回归） ────────────────────────────────────────────────────

test("注册表不再用命名空间导入（tree-shaking 的结构性杀手）", () => {
  for (const pkg of ["@tabler/icons-react", "lucide-react", "@phosphor-icons/react"]) {
    const pattern = new RegExp(`import \\* as \\w+ from "${pkg.replace("/", "\\/")}"`);
    assert.ok(!pattern.test(SETS), `icon-sets.tsx 又出现了 \`import * as … from "${pkg}"\`——它会让整个库进首屏`);
  }
});

test("动态索引 bag[name] 不得复活", () => {
  assert.ok(!/bag\[name\]/.test(SETS), "动态索引 bag[name] 回来了：tree-shaking 会再次失效");
});

test("生成文件带 @generated 头，且不含命名空间导入", () => {
  assert.ok(GENERATED.startsWith("// @generated"), "生成文件缺 @generated 头（无法区分手改与脚本产出）");
  // 只看真正的 import 行：文件头注释里为了解释原因也提到了 `import * as` 字样。
  const importLines = GENERATED.split("\n").filter((line) => line.trimStart().startsWith("import "));
  assert.ok(!importLines.some((line) => /import \* as/.test(line)), "生成文件里出现命名空间导入");
});

test("生成文件与源表一致（改了 map 忘跑 gen:icons = 红）", () => {
  execFileSync(process.execPath, ["scripts/gen-icon-sets.mjs", "--check"], { stdio: "pipe" });
});

test("三张表的键数相同且等于语义名数（生成器的前置条件）", () => {
  const keyCounts = ["TABLER_ICONS", "LUCIDE_ICONS", "PHOSPHOR_ICONS"].map((table) => {
    const body = GENERATED.slice(GENERATED.indexOf(`export const ${table}`));
    return [...body.slice(0, body.indexOf("};")).matchAll(/^\s{2}"([\w-]+)":/gm)].length;
  });
  assert.ok(keyCounts[0] >= 41, `语义名只有 ${keyCounts[0]} 个（基线 41）`);
  assert.deepEqual(keyCounts, [keyCounts[0], keyCounts[0], keyCounts[0]], `三张表键数不一致：${keyCounts.join("/")}`);
});
