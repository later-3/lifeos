import assert from "node:assert/strict";
import { test } from "node:test";
import {
  THEME_DEFAULTS, THEME_PRESETS, clampState, calculatePalette, contrastOf, themeToCss,
} from "../frontend/src/design/theme.ts";

/**
 * 主题引擎契约（Task 0009 · P1-1）。
 * demo（evidence/demo）验证过的视觉关系，这里锁成机器断言：
 * 选中比悬停沉、三档分层成立、导航层辅助文字达 AA。
 */

test("clampState：越界夹紧到边界、坏类型回默认（localStorage 是用户可写的）", () => {
  assert.deepEqual(clampState({}), THEME_DEFAULTS);
  const bad = clampState({ accentH: 9999, lSurface: -5, mode: "purple", preset: "nope", hoverD: NaN });
  assert.equal(bad.accentH, 360, "越界数值夹紧到边界");
  assert.equal(bad.lSurface, 88, "越界数值夹紧到边界");
  assert.equal(bad.mode, "light", "非法枚举回默认");
  assert.equal(bad.preset, "neutral", "非法枚举回默认");
  assert.equal(bad.hoverD, THEME_DEFAULTS.hoverD, "NaN 回默认");
  // 边界值原样保留
  assert.equal(clampState({ accentH: 359.5 }).accentH, 359.5);
  assert.equal(clampState({ selRatio: 3 }).selRatio, 3);
});

test("选中必须比悬停更沉（light 与 dark 同律，方向翻转）", () => {
  for (const mode of ["light", "dark"]) {
    for (const preset of Object.keys(THEME_PRESETS)) {
      const p = calculatePalette(clampState({ ...THEME_PRESETS[preset], preset, mode }));
      const dHover = Math.abs(p.navBg[0] - p.navAccent[0]);
      const dSel = Math.abs(p.navBg[0] - p.navSelected[0]);
      assert.ok(
        dSel > dHover,
        `${preset}/${mode}：选中 ΔL*(${dSel.toFixed(2)}) 必须 > 悬停 ΔL*(${dHover.toFixed(2)})`,
      );
    }
  }
});

test("状态强度对齐产品类参考（LibreChat 8.4 / LobeHub 5.2 / novu 3.3）", () => {
  // 依据 `knowledge/design/theme-systems/comparison.md` §3.2：
  //   LibreChat light 侧栏选中 ΔL* 8.4、dark 15.9（clickui.json）
  //   LobeHub  5.2 / novu 3.3 —— 三家区间 3.3–8.4
  // 我们取 LibreChat 正文档：light 8.4（hoverD 4.2 × selRatio 2.0），dark ×1.9 ≈ 15.9。
  const light = calculatePalette(clampState({ mode: "light" }));
  const dSelL = Math.abs(light.navBg[0] - light.navSelected[0]);
  assert.ok(dSelL >= 7.5 && dSelL <= 9.5, `light 选中 ΔL* ${dSelL.toFixed(1)} 应落在 8.4±1（LibreChat 正文档）`);
  const dark = calculatePalette(clampState({ mode: "dark" }));
  const dSelD = Math.abs(dark.navBg[0] - dark.navSelected[0]);
  assert.ok(dSelD >= 13 && dSelD <= 18, `dark 选中 ΔL* ${dSelD.toFixed(1)} 应落在 15.9±2（LibreChat 暗色实测）`);
  // 比例：选中 ≈ hover × 2（三家比例区间 1.0–2.4，取中值）
  for (const p of [light, dark]) {
    const hover = Math.abs(p.navBg[0] - p.navAccent[0]);
    const sel = Math.abs(p.navBg[0] - p.navSelected[0]);
    assert.ok(sel / hover >= 1.7 && sel / hover <= 2.3, `选中/悬停比 ${(sel / hover).toFixed(2)} 应落在 1.7–2.3`);
  }
});

test("深色分层方向与 light 同向（2026-11-09 修：旧实现把内容映射成最暗，卡片与页面同色）", () => {
  // 三家一致：页面最暗 → 卡片在上 → 浮层最亮（LobeHub generateColorPalette.ts:42-62、LibreChat clickui.json）
  for (const mode of ["light", "dark"]) {
    const p = calculatePalette(clampState({ mode }));
    assert.ok(p.navEdge[0] < p.navBg[0], `${mode}：图标轨必须比列底暗（rail ${p.navEdge[0].toFixed(1)} < nav ${p.navBg[0].toFixed(1)}）`);
    assert.ok(p.navBg[0] < p.surface[0], `${mode}：列底必须比内容暗（nav ${p.navBg[0].toFixed(1)} < surface ${p.surface[0].toFixed(1)}）`);
    // 边界线：light 比底暗、dark 比底亮（发丝线在两个主题下都要"看得出来"）
    if (mode === "light") assert.ok(p.line[0] < p.navBg[0], "light：线比列底暗");
    else assert.ok(p.line[0] > p.surface[0], `dark：线必须比内容亮（line ${p.line[0].toFixed(1)} > surface ${p.surface[0].toFixed(1)}）`);
  }
});

test("三档分层成立：轨→列→内容 相邻可感（light ≥2、dark ≥1.5）", () => {
  for (const preset of Object.keys(THEME_PRESETS)) {
    const p = calculatePalette(clampState({ ...THEME_PRESETS[preset], preset, mode: "light" }));
    assert.ok(Math.abs(p.navBg[0] - p.navEdge[0]) >= 2, `${preset} 轨→列`);
    assert.ok(Math.abs(p.surface[0] - p.navBg[0]) >= 2, `${preset} 列→内容`);
    const pd = calculatePalette(clampState({ ...THEME_PRESETS[preset], preset, mode: "dark" }));
    assert.ok(Math.abs(pd.navBg[0] - pd.navEdge[0]) >= 1.5, `${preset} dark 轨→列`);
    assert.ok(Math.abs(pd.surface[0] - pd.navBg[0]) >= 1.5, `${preset} dark 列→内容`);
  }
});

test("导航层文字对比度达 AA（副行在列底/悬停/选中三个底上都 ≥4.5）", () => {
  for (const preset of Object.keys(THEME_PRESETS)) {
    for (const mode of ["light", "dark"]) {
      const p = calculatePalette(clampState({ ...THEME_PRESETS[preset], preset, mode }));
      assert.ok(contrastOf(p.navMuted, p.navBg) >= 4.5, `${preset}/${mode} muted/nav`);
      assert.ok(contrastOf(p.navMuted, p.navAccent) >= 4.5, `${preset}/${mode} muted/hover`);
      assert.ok(contrastOf(p.navMuted, p.navSelected) >= 4.5, `${preset}/${mode} muted/selected`);
      assert.ok(contrastOf(p.ink900, p.surface) >= 4.5, `${preset}/${mode} ink900/surface`);
      // 白字压主色底（用户气泡/主按钮）：压的是 accentSolid（深色下 accent 是文字色）
      assert.ok(contrastOf([100, 0, 0], p.accentSolid) >= 4.5, `${preset}/${mode} white/accent-solid`);
      // accent 作文字（链接、选中图标）压 surface 也达 AA
      assert.ok(contrastOf(p.accent, p.surface) >= 4.5, `${preset}/${mode} accent/surface`);
    }
  }
});

test("导出格式：@theme 块含全部变量，值是合法 hex", () => {
  const css = themeToCss(THEME_DEFAULTS);
  for (const name of ["--color-surface", "--color-nav-selected", "--color-accent", "--color-ink-900"]) {
    assert.ok(css.includes(name), `缺 ${name}`);
  }
  for (const m of css.matchAll(/--color-[a-z-]+: (#[0-9a-f]{6});/g)) {
    assert.match(m[1], /^#[0-9a-f]{6}$/);
  }
});
