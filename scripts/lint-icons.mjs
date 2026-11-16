/**
 * 图标直引门禁（Task 0015 · A1）：页面层禁止直接 import 图标库，
 * 一律经 `src/design/icons.tsx` 的 AppIcon/ICONS（唯一映射处，C214 同类教训：散装引用 = 换集即全站改）。
 * 例外：design/icons.tsx 自身（注册表本体）。
 * 用法：node scripts/lint-icons.mjs frontend/src
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const SRC = process.argv[2] ?? "frontend/src";
const LIB = "@tabler/icons-react";
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}
/* 例外：图标集注册表（icon-sets.tsx）就是"多个图标源的唯一汇聚处"——
 * 与 icons.tsx 同性质。页面层仍然只能经 AppIcon。 */
const ALLOW = new Set(["design/icons.tsx", "design/icon-sets.tsx"]);
const offenders = walk(SRC).filter((f) => !ALLOW.has(f.split("/").slice(-2).join("/"))).filter((f) => readFileSync(f, "utf8").includes(LIB));
if (offenders.length) {
  console.error("✗ 图标直引（必须经 design/icons 的 AppIcon）：");
  for (const f of offenders) console.error("  ", relative(SRC, f));
  process.exit(1);
}
console.log("✓ 图标直引检查通过（唯一映射处 design/icons.tsx 之外无直引）");
