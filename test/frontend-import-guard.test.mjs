// 门禁：前端不得**值导入**带 `node:*` 的服务端模块（C191 的机器化）。
//
// 背景：S4-e 里 `ReviewPanel.tsx` 写了 `import { canCloseComment } from "../../src/review-comments"`，
// 而那个模块有 `node:fs/promises` → Vite externalize → 浏览器运行到 `mkdir` 抛错 → **整页白屏**。
// 而 `typecheck`（类型解析）与 Node 单测（node:fs 当然可用）**都是绿的**。
//
// 本测试补上那道缺失的门禁：
//   1. 扫描 `frontend/src/**` 里所有**值导入**（`import { x } from "..."`，排除 `import type`）；
//   2. 解析指向 `src/**` 的目标文件，**递归**看它（及其依赖）有没有 `node:*` 导入；
//   3. 有 → 红，报出"谁导入了谁、链路是什么"。
//
// 为什么 `import type` 放行：类型导入在编译期被擦除（App.tsx 就有 `import type { SessionRow }`），
// 不进运行时包（实测 build 通过）。
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND_SRC = join(ROOT, "frontend/src");

async function listTs(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listTs(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** 一个文件里的**值导入**目标（排除 `import type`）。 */
function valueImportsOf(text) {
  const out = [];
  const re = /import\s+(?!type\s)([^;]*?)\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const clause = m[1] ?? "";
    // `import { type A, b }` 这种混合：只要有一个非 type 的具名绑定就算值导入
    const names = clause.replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
    const hasValue = names.length === 0 ? true : names.some((n) => !n.startsWith("type "));
    if (hasValue) out.push(m[2]);
  }
  return out;
}

/** 递归收集一个模块（及依赖）里出现的 `node:*` 导入。 */
async function nodeDepsOf(file, seen = new Set(), chain = []) {
  if (seen.has(file)) return [];
  seen.add(file);
  let text;
  try { text = await readFile(file, "utf8"); } catch { return []; }
  const found = [];
  for (const spec of valueImportsOf(text)) {
    if (spec.startsWith("node:")) { found.push([...chain, `${relative(ROOT, file)} → ${spec}`].join(" → ")); continue; }
    if (!spec.startsWith(".")) continue;                       // 裸包名不管（前端自己的依赖）
    const base = resolve(dirname(file), spec);
    const candidate = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
    let target;
    for (const c of candidate) {
      try { await readFile(c, "utf8"); target = c; break; } catch { /* 继续试 */ }
    }
    if (target === undefined) continue;
    found.push(...await nodeDepsOf(target, seen, [...chain, relative(ROOT, file)]));
  }
  return found;
}

test("G·import-1 前端不得值导入带 node:* 的服务端模块（递归检查）", async () => {
  const files = await listTs(FRONTEND_SRC);
  assert.ok(files.length > 10, `扫到 ${files.length} 个前端文件（太少，可能路径错了）`);
  const violations = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const spec of valueImportsOf(text)) {
      if (spec.startsWith("node:")) {
        violations.push(`${relative(ROOT, file)} → ${spec}`);
        continue;
      }
      if (!spec.startsWith(".")) continue;
      const base = resolve(dirname(file), spec);
      const candidate = [base, `${base}.ts`, `${base}.tsx`];
      let target;
      for (const c of candidate) {
        try { await readFile(c, "utf8"); target = c; break; } catch { /* 继续 */ }
      }
      if (target === undefined) continue;
      const deps = await nodeDepsOf(target);
      if (deps.length > 0) violations.push(`${relative(ROOT, file)} → ${deps[0]}`);
    }
  }
  assert.deepEqual(violations, [], `前端引入了 node 依赖（浏览器会白屏）：\n${violations.join("\n")}`);
});

test("G·import-2 活性验证：把 review-comments 加回 ReviewPanel 的值导入，本门禁必红", async () => {
  // 不真的改文件——只验证"检测函数本身有效"：构造一段文本走同一个解析器
  const sample = 'import { canCloseComment } from "../../src/review-comments";';
  const specs = valueImportsOf(sample);
  assert.deepEqual(specs, ["../../src/review-comments"]);
  const target = resolve(FRONTEND_SRC, "../../src/review-comments".replace("../../src/", "../../src/"));
  const deps = await nodeDepsOf(`${target}.ts`);
  assert.ok(deps.length > 0, `review-comments.ts 应该有 node 依赖（实际 ${deps.length}）`);
  // type-only 导入必须放行
  assert.deepEqual(valueImportsOf('import type { X } from "../../src/review-comments";'), []);
});
