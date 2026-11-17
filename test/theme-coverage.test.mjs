/**
 * 主题覆盖度矩阵（Task 0015 · S1）——**这是 S1 的阶段门**。
 *
 * 之前实测：VSCode 37% / Monokai 29% / Minimal 20% / Gruvbox 15% / Sanctum 7%。
 * 目标：派生补齐后，8 个预载主题 × 契约 59 变量 ≥85%。
 *
 * 活性验证（testing 2.4）：把 deriveMissingVars 的某个族注释掉，本测试必须红。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRACT_KEYS, validateThemePack } from "../frontend/src/design/theme-package.ts";
import { derivePack } from "../frontend/src/design/theme-derive.ts";

const ROOT = process.cwd();
const themes = JSON.parse(readFileSync(join(ROOT, "frontend/src/design/preloaded-themes.json"), "utf8"));
const TOTAL = CONTRACT_KEYS.length;

function coverage(pack, mode) {
  const vars = pack.modes[mode] ?? {};
  const filled = CONTRACT_KEYS.filter((k) => typeof vars[k] === "string").length;
  return { filled, ratio: filled / TOTAL };
}

test("派生补齐后：8 个预载主题覆盖度 ≥85%（S1 阶段门）", () => {
  const rows = [];
  for (const pack of themes) {
    const derived = derivePack(pack);
    const modes = Object.keys(pack.modes);
    let best = { filled: 0, ratio: 0, mode: "" };
    for (const mode of modes) {
      const c = coverage(derived, mode);
      if (c.filled > best.filled) best = { ...c, mode };
    }
    rows.push({ name: pack.meta.name, ...best });
    console.log(`  ${pack.meta.name.padEnd(18)} ${best.filled}/${TOTAL} = ${Math.round(best.ratio * 100)}% (${best.mode})`);
    assert.ok(
      best.ratio >= 0.85,
      `${pack.meta.name} 覆盖度 ${Math.round(best.ratio * 100)}% < 85%（${best.filled}/${TOTAL}）`,
    );
  }
});

/*
 * 「只补不改」的**两处例外**（都是 Task 0017 · P2，有实测依据，不是放宽）：
 *
 * ① 带 alpha 的 8 位/4 位 hex 归一成 6 位（`#3994bcb3` → `#3994bc`）——fill 契约必须不透明。
 *
 * ② **行态三件**（`--color-hover` / `--color-nav-accent` / `--color-nav-selected`）
 *    带 alpha 时**整个丢掉**，交给 ΔL 派生。理由：VSCode 的 `list.hoverBackground`
 *    是 `#ffffff14`（8% 白），剥掉 alpha 写进实底 = 一整块纯白，行标题白字压白底 **1.00:1**
 *    （`test/wash-layer.test.mjs` 抓到 48 处）。这类"薄涂强度"不该塞进 fill 契约，
 *    等 wash 有独立来源槽（v2）再读它的 alpha。
 */
const ROW_STATE_KEYS = new Set(["--color-hover", "--color-nav-accent", "--color-nav-selected"]);

test("派生不改变已有值的**语义**（只补不改；两处已登记的例外见注释）", () => {
  const pack = themes[0];
  const derived = derivePack(pack);
  for (const mode of Object.keys(pack.modes)) {
    for (const [k, v] of Object.entries(pack.modes[mode] ?? {})) {
      const got = derived.modes[mode][k];
      const raw = String(v).toLowerCase();
      const hasAlpha = /^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/.test(raw);
      if (hasAlpha && ROW_STATE_KEYS.has(k)) {
        // 例外 ②：丢掉外来值，改由派生给出（列在报告里，零静默）
        assert.ok(typeof got === "string" && /^#[0-9a-f]{6}$/.test(got), `${mode}.${k} 丢弃后应有派生值：${got}`);
        continue;
      }
      const normalized = raw.replace(/^#([0-9a-f]{6})[0-9a-f]{2}$/, "#$1");
      assert.equal(got, normalized, `${mode}.${k} 被派生覆盖了（应只补不改）：${v} → ${got}`);
    }
  }
});

test("派生报告可追溯：每个补出来的变量都有规则说明", () => {
  const derived = derivePack(themes[4]); // Minimal（覆盖度低）
  assert.ok(derived.deriveReport.length > 20, "派生项太少，可能没补齐");
  for (const r of derived.deriveReport) {
    assert.ok(typeof r.rule === "string" && r.rule.length > 3, `${r.mode}.${r.name} 无规则说明`);
  }
});

test("派生不引入新的对比度违规（原主题自带的由校验器如实报告，派生层不负责）", () => {
  for (const pack of themes) {
    const before = validateThemePack(pack);
    const derived = derivePack(pack);
    const after = validateThemePack(derived);
    const count = (r) => r.issues.filter((i) => i.level === "error" && i.message.includes("对比度")).length;
    assert.ok(
      count(after) <= count(before),
      `${pack.meta.name} 派生**新增**了对比度违规：${count(before)} → ${count(after)}` +
        `（新增项：${after.issues.filter((i) => i.level === "error" && i.message.includes("对比度")).map((i) => i.message.slice(0, 50)).join("；")}）`,
    );
  }
});

test("派生结果跨主题不串味：每个主题派生出的值反映自己的 surface", () => {
  const dark = derivePack(themes.find((t) => t.meta.name.includes("Dark")));
  const light = derivePack(themes.find((t) => t.meta.name.includes("Light")));
  const darkSurface = dark.modes.dark?.["--color-surface"];
  const lightSurface = light.modes.light?.["--color-surface"];
  assert.notEqual(darkSurface, lightSurface, "深/浅主题的 surface 不应相同");
  // 派生出的 sunken 应该跟着各自的 surface 走
  const darkSunken = dark.modes.dark?.["--color-sunken"];
  const lightSunken = light.modes.light?.["--color-sunken"];
  assert.notEqual(darkSunken, lightSunken, "派生 sunken 串味了（两个主题算成了同一个值）");
});
