/**
 * 外部主题转译器（Task 0015 · B1）：用**真实主题样本**（fixtures/，本机 VSCode 内置
 * 主题合并 + Obsidian 社区头部主题）验证「导入 → 转译 → 校验」全链——
 * 测试隔离（不读 /Applications），样本已拷入 fixtures。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { translateVscodeTheme, translateObsidianTheme } from "../frontend/src/design/theme-translators.ts";
import { validateThemePack, CONTRACT_KEYS } from "../frontend/src/design/theme-package.ts";

const FIX = join(process.cwd(), "frontend/test/fixtures/themes");
const read = (p) => readFileSync(join(FIX, p), "utf8");

const VSC_FILES = ["2026-dark.json", "2026-light.json", "monokai.json", "quiet-light.json"];
const OBS_FILES = ["minimal.css", "graphite-pie.css", "gruvbox.css", "sanctum.css", "blue-topaz.css"];

test("VSCode 四主题：转译 → 覆盖度 → 校验通过", () => {
  for (const f of VSC_FILES) {
    const json = JSON.parse(read(join("vscode", f)));
    const { pack, report } = translateVscodeTheme(json, f);
    assert.equal(pack.kind, "lifeos-theme-pack");
    assert.ok(Object.keys(pack.modes.dark ?? pack.modes.light ?? {}).length >= 8, `${f} 覆盖度过低`);
    const r = validateThemePack(pack);
    assert.ok(r.ok, `${f} 校验未过：` + r.issues.map((i) => i.message).join("；"));
    // 语法八族至少命中 5（VSCode tokenColors 覆盖充分）
    const mode = pack.modes.dark ?? pack.modes.light;
    const syn = Object.keys(mode).filter((k) => k.startsWith("--color-syn-"));
    assert.ok(syn.length >= 5, `${f} 语法色命中不足：${syn.join(",")}`);
  }
});

test("Obsidian 五主题（含 1.3MB 压测样本）：转译 → 覆盖充分 → 校验结论如实", () => {
  for (const f of OBS_FILES) {
    const css = read(join("obsidian", f));
    const { pack, report } = translateObsidianTheme(css, f, f.replace(".css", ""));
    const coverage = Math.max(Object.keys(pack.modes.dark ?? {}).length, Object.keys(pack.modes.light ?? {}).length);
    assert.ok(coverage >= 4, `${f} 覆盖度过低：${coverage}`);
    const r = validateThemePack(pack);
    // 对比度不足是**主题质量事实**（如 graphite-pie light 正文 4.47），校验器必须如实拒绝——
    // 测试锁的是"转译/校验机制正确"，不是"所有社区主题都合格"。
    if (!r.ok) {
      assert.ok(r.issues.some((i) => i.level === "error" && i.message.includes("对比度")),
        `${f} 未通过且无对比度原因（结论不符预期）`);
    }
  }
});

test("未映射项零静默：merged/dropped 报告存在且结构化", () => {
  const json = JSON.parse(read(join("vscode", "2026-dark.json")));
  const { report } = translateVscodeTheme(json);
  assert.ok(report.mapped.length > 10 && report.merged.length > 50, "映射/归并清单应成规模");
  const css = read(join("obsidian", "minimal.css"));
  const { report: r2 } = translateObsidianTheme(css, "minimal", "Minimal");
  assert.ok(r2.mapped.length > 5);
});

test("病态包被校验器拦住（对比度/契约外变量/空包）", () => {
  const r1 = validateThemePack({ kind: "lifeos-theme-pack", version: 1, meta: { name: "x", source: "custom" }, modes: {} });
  assert.equal(r1.ok, false);
  const bad = {
    kind: "lifeos-theme-pack", version: 1, meta: { name: "bad", source: "custom" },
    modes: { dark: { "--color-surface": "#ffffff", "--color-ink-900": "#333333", "--color-not-in-contract": "#123456" } },
  };
  const r2 = validateThemePack(bad);
  assert.equal(r2.ok, false);
  assert.ok(r2.issues.some((i) => i.message.includes("亮度偏高")));
  assert.ok(r2.issues.some((i) => i.message.includes("契约外变量")));
});

test("契约键覆盖 syn/soft/message/diff/anno 全族（A4 收编的完整性）", () => {
  const joined = CONTRACT_KEYS.join(",");
  for (const family of ["--color-syn-keyword", "--color-danger-soft", "--color-message-user", "--color-diff-add", "--color-anno-query"]) {
    assert.ok(joined.includes(family), `契约缺 ${family}`);
  }
});
