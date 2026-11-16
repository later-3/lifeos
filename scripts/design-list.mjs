/**
 * 组件清单生成（Task 0015 · A2，借 shadcn registry 机制 + Twenty 字典的自动生成）：
 * 扫 `frontend/src/design/` 的导出 → 机器可读 manifest（JSON）+ 人读索引（MD）。
 * 快照测试（test/design-manifest.test.mjs）锁住"清单与导出一致"——
 * 新增/改名 primitive 忘登记/清单漂移都会红。
 * 用法：pnpm design:list
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "frontend/src/design";
const OUT_JSON = "frontend/design-manifest.json";
const OUT_MD = "frontend/src/design/AGENTS.md";

const files = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f));
const entries = [];
for (const f of files) {
  const s = readFileSync(join(DIR, f), "utf8");
  for (const m of s.matchAll(/^export (?:async )?(function|const) ([A-Za-z][A-Za-z0-9]*)/gm)) {
    entries.push({ name: m[2], kind: m[1], file: `src/design/${f}` });
  }
}
entries.sort((a, b) => a.name.localeCompare(b.name));

const manifest = { generated: new Date().toISOString().slice(0, 10), count: entries.length, entries };
writeFileSync(OUT_JSON, JSON.stringify(manifest, null, 1) + "\n");

// 人读索引：AGENTS.md 的清单段（自动生成段用标记包裹，人工段落保留）
const BEGIN = "<!-- design-manifest:auto BEGIN -->";
const END = "<!-- design-manifest:auto END -->";
let md = "";
try { md = readFileSync(OUT_MD, "utf8"); } catch { md = ""; }
const auto = `${BEGIN}\n## 组件清单（自动生成，pnpm design:list）\n\n共 ${entries.length} 项：\n\n${entries.map((e) => `- **${e.name}**（${e.kind}）— \`${e.file}\``).join("\n")}\n${END}\n`;
if (md.includes(BEGIN)) {
  md = md.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}`), auto.trimEnd());
} else {
  md = (md || "") + "\n" + auto;
}
writeFileSync(OUT_MD, md);
console.log(`design-manifest: ${entries.length} 项 → ${OUT_JSON} + ${OUT_MD}`);
