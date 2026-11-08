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

test("状态强度达到参考量级（用户 2026-11-09：高亮不明显、深色等于没有）", () => {
  // VS Code 2026 默认主题实测（alpha 叠在 sideBar.background 上换算）：
  //   light 选中 ΔL* 12.7 / 悬停 7.0；dark 选中 14.7 / 悬停 8.7
  // 我们取 hoverD 4.5 + selRatio 2.8（选中 ≈12.6），dark 再 ×1.25。
  for (const mode of ["light", "dark"]) {
    const p = calculatePalette(clampState({ mode }));
    const dHover = Math.abs(p.navBg[0] - p.navAccent[0]);
    const dSel = Math.abs(p.navBg[0] - p.navSelected[0]);
    assert.ok(dSel >= 11, `${mode}：选中 ΔL* ${dSel.toFixed(1)} 必须 ≥11（VS Code 12.7/14.7 量级）`);
    assert.ok(dHover >= 4, `${mode}：悬停 ΔL* ${dHover.toFixed(1)} 必须 ≥4（太弱看不出）`);
    assert.ok(dHover <= 9, `${mode}：悬停 ΔL* ${dHover.toFixed(1)} 必须 ≤9（每行都变暗 7+ 会太吵）`);
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
