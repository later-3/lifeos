/**
 * 组件清单一致性（Task 0015 · A2）：design-list 生成的 manifest 与
 * design/ 实际导出、AGENTS.md 的自动段必须一致——新 primitive 忘跑清单 = 红。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const manifest = JSON.parse(readFileSync(join(ROOT, "frontend/design-manifest.json"), "utf8"));

test("manifest 与 design/ 实际导出一致（新增忘跑清单 = 红）", () => {
  const files = readdirSync(join(ROOT, "frontend/src/design")).filter((f) => /\.(ts|tsx)$/.test(f));
  const actual = new Set();
  for (const f of files) {
    const s = readFileSync(join(ROOT, "frontend/src/design", f), "utf8");
    for (const m of s.matchAll(/^export (?:async )?(function|const) ([A-Za-z][A-Za-z0-9]*)/gm)) {
      actual.add(`${m[2]}|src/design/${f}`);
    }
  }
  const declared = new Set(manifest.entries.map((e) => `${e.name}|${e.file}`));
  assert.deepEqual([...actual].sort(), [...declared].sort());
});

test("AGENTS.md 的自动段存在且含全部条目", () => {
  const md = readFileSync(join(ROOT, "frontend/src/design/AGENTS.md"), "utf8");
  assert.ok(md.includes("design-manifest:auto BEGIN"));
  for (const e of manifest.entries) assert.ok(md.includes(`**${e.name}**`), `AGENTS.md 缺 ${e.name}`);
});

test("核心 primitive 都在清单里（防误删）", () => {
  const names = new Set(manifest.entries.map((e) => e.name));
  for (const n of ["Button", "IconButton", "Modal", "ConfirmDialog", "Row", "SessionRow", "AppIcon", "ToastProvider", "Spinner", "EmptyState"]) {
    assert.ok(names.has(n), `清单缺核心 primitive ${n}`);
  }
});

test("A4 三源消亡：index.css 无 [data-theme-mode=dark] 硬编码色块（收编进引擎后不再有补丁源）", () => {
  const css = readFileSync(join(ROOT, "frontend/src/index.css"), "utf8");
  // 允许：引用 var() 的方向规则（如表头底 var(--color-hover)）；禁止：dark 块内写死 hex
  const blocks = css.match(/\[data-theme-mode="dark"\][^{]*\{[^}]*\}/g) ?? [];
  for (const b of blocks) {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(b), "dark 补丁块含硬编码 hex（应收编进引擎）：" + b.slice(0, 80));
  }
});
