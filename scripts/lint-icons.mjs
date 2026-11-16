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
const ALLOW = new Set(["design/icons.tsx", "design/icon-sets.tsx", "design/icon-sets.generated.ts"]);
const offenders = walk(SRC).filter((f) => !ALLOW.has(f.split("/").slice(-2).join("/"))).filter((f) => readFileSync(f, "utf8").includes(LIB));
if (offenders.length) {
  console.error("✗ 图标直引（必须经 design/icons 的 AppIcon）：");
  for (const f of offenders) console.error("  ", relative(SRC, f));
  process.exit(1);
}
/**
 * Task 0016 · P2-S1：生成文件必须与源表一致。
 * 不加这一条的话"改了语义名/改了 map 却没重跑 gen:icons"不会被任何门禁发现——
 * 症状是图标静默缺失（`iconOf` 返回 null → 回退 tabler），而不是报错。
 */
import { execFileSync } from "node:child_process";
try {
  execFileSync(process.execPath, ["scripts/gen-icon-sets.mjs", "--check"], { stdio: "pipe" });
} catch (error) {
  console.error("✗ design/icon-sets.generated.ts 与源表不一致：运行 `pnpm gen:icons` 后提交");
  console.error(String(error.stdout ?? "").trim() || String(error));
  process.exit(1);
}

console.log("✓ 图标直引检查通过（唯一映射处 design/icons.tsx 之外无直引）");
console.log("✓ 图标生成文件与源表一致（gen:icons --check）");
