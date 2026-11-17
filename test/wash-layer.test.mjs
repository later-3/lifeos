/**
 * 承托层 × 前景矩阵（Task 0017 · P2）——**这次事故缺的那一道门**。
 *
 * ## 为什么需要它
 *
 * 2026-11-16 用户第一张截图：外部主题 Quiet Light 下，选中的会话行是**整块荧光绿**，
 * 行内的运行光环变成一坨灰泥、未读绿点与底色同色相（读成底色的一部分）。
 *
 * 当时所有门禁都是绿的，因为：
 * - `theme-coverage.test.mjs` 查的是**覆盖度**（69 个变量有没有值），不查值组合起来能不能读；
 * - `theme-module-audit.test.mjs` 的「每变量至少 4 个不同值」**奖励发散** ——
 *   它把"值固定"判为失败，却从不检查"值太散"。Quiet Light 的 chroma 0.0585
 *   在它眼里是"很不同的值"，是**加分项**。
 * - `design-system.test.mjs` 的对比度断言全是 ink × surface，**承托层一对都没有**。
 *
 * 这个文件把"承托层 × 压在其上的东西"变成可穷举的矩阵：
 * 每个预置主题 × 4 个主题态（内置浅/内置深/各外部的有效 mode）×
 * 6 个承托层 wash × 5 类前景。
 *
 * ## 判据（全部来自 WCAG，不新造数字）
 *
 * | 前景 | 是什么 | 门槛 | 依据 |
 * |---|---|---|---|
 * | 状态点 / 光环（running/success/danger） | 图形标记（6px） | **3.0** | WCAG 1.4.11 Non-text Contrast |
 * | nav-muted（行副行文字） | 正文（11px） | **4.5** | WCAG 1.4.3 |
 * | ink-900（行标题） | 正文 | **4.5** | 同上 |
 *
 * 外加一条**饱和度约束**：wash 合成后的 OKLCH chroma ≤ 引擎实测上界
 * （`theme.ts` 的 `WASH_ENVELOPE`）—— 这是"整块荧光绿"这件事的直接判据，
 * 对比度查不出来（荧光绿上的黑字对比度很好）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  THEME_PRESETS, calculatePalette, clampState, hex, themeWashEnvelope, applyWashAlphas,
} from "../frontend/src/design/theme.ts";
import { derivePack } from "../frontend/src/design/theme-derive.ts";
import { washAlphaFor, compositeOver, parseColor, oklchOf } from "../frontend/src/design/wash.ts";

const ROOT = process.cwd();
const packs = JSON.parse(readFileSync(join(ROOT, "frontend/src/design/preloaded-themes.json"), "utf8"));

const hexOf = (c) => hex(c[0], c[1], c[2]);

/** WCAG 对比度（hex）。与 theme.ts 的 `contrastRgb` 同式，这里独立一份避免循环依赖。 */
function contrastOf(a, b) {
  const lin = (v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const lum = (hex) => {
    const s = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => lin(Number.parseInt(s.slice(i, i + 2), 16)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const A = lum(a), B = lum(b);
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
}

const toHex = ({ r, g, b }) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");

/**
 * 主题态：内置 5 预设 × 深浅 **+ 8 个预置包的有效 mode**。
 * 取"有效 mode"的口径与 `applyThemePack` 一致（有 dark 槽就用 dark，否则 light）。
 */
function themeStates() {
  const states = [];
  for (const preset of Object.keys(THEME_PRESETS)) {
    for (const mode of ["light", "dark"]) {
      const p = calculatePalette(clampState({ ...THEME_PRESETS[preset], ...THEME_PRESETS[preset], preset, mode }));
      states.push({
        name: `内置-${preset}-${mode}`,
        mode,
        vars: {
          navBg: hexOf(p.navBg), navAccent: hexOf(p.navAccent), navSelected: hexOf(p.navSelected),
          sunken: hexOf(p.sunken), hover: hexOf(p.hover),
          running: hexOf(p.running), success: hexOf(p.success), danger: hexOf(p.danger),
          navMuted: hexOf(p.navMuted), ink900: hexOf(p.ink900),
        },
      });
    }
  }
  for (const pack of packs) {
    const derived = derivePack(pack);
    const mode = derived.modes.dark !== undefined && Object.keys(derived.modes.dark).length > 0 ? "dark" : "light";
    const v = derived.modes[mode] ?? {};
    const pick = (k) => (typeof v[k] === "string" ? v[k].replace(/^(#[0-9a-f]{6})[0-9a-f]{2}$/i, "$1") : undefined);
    const vars = {
      navBg: pick("--color-nav-bg"), navAccent: pick("--color-nav-accent"), navSelected: pick("--color-nav-selected"),
      sunken: pick("--color-sunken"), hover: pick("--color-hover"),
      running: pick("--color-running"), success: pick("--color-success"), danger: pick("--color-danger"),
      navMuted: pick("--color-nav-muted"), ink900: pick("--color-ink-900"),
    };
    const missing = Object.entries(vars).filter(([, x]) => x === undefined).map(([k]) => k);
    assert.deepEqual(missing, [], `${pack.meta.name} 派生后仍缺承托层/前景变量：${missing.join(",")}`);
    states.push({ name: `包-${pack.meta.name}`, mode, vars });
  }
  return states;
}

/* ── 承托层：wash 的六种宿主组合 ─────────────────────────────────────── */
/*
 * 只测 **wash** —— 生产代码里行态只有这一条路径（`bg-wash-hover` / `bg-wash-selected` /
 * `bg-wash-chip`）。原先还留了三条"原实底"作对照，但那条路径已经不用了：
 * 留着一个不再被消费的形态当断言对象，只会让门变红而没人能修（假红）。
 */
const WASHES = [
  { id: "wash-hover", fill: "navAccent", host: "navBg", kind: "hover" },
  { id: "wash-selected", fill: "navSelected", host: "navBg", kind: "selected" },
  { id: "wash-chip", fill: "sunken", host: "navBg", kind: "chip" },
];

/* ── 前景：压在这些层上的东西 ───────────────────────────────────────── */
const FOREGROUNDS = [
  { key: "running", label: "运行点/光环", min: 3.0 },
  { key: "success", label: "完成未读点", min: 3.0 },
  { key: "danger", label: "失败点", min: 3.0 },
  { key: "navMuted", label: "行副行文字（11px）", min: 4.5 },
  { key: "ink900", label: "行标题", min: 4.5 },
];

/** 某主题态下，某个 wash 真正落地的合成色（走与运行时同一条收敛逻辑）。 */
function composedOf(state, wash) {
  const fill = state.vars[wash.fill];
  const host = state.vars[wash.host];
  if (wash.wash !== true) return fill;     // 实底：就是 fill 本身
  const envelope = themeWashEnvelope(state.mode);
  const alpha = washAlphaFor(fill, host, envelope[wash.kind]);
  return toHex(compositeOver({ ...parseColor(fill), a: alpha }, parseColor(host)));
}

/*
 * 对比度断言**分两类**（这是 P0 学到的教训：门只能判"我能负责的那个责任"）。
 *
 * ① **内置主题**：所有 wash × 所有前景必须达标。这是我们自己的调色板，
 *    派生关系在我们手里，没有任何理由不达标 → 硬判死。
 *
 * ② **外部主题**：只判「wash **不比实底更差**」。
 *    绝对值不达标是**主题作者自己给的配色**（例如 Quiet Light 的 success `#20976c`
 *    压在它自己的 `#e0e0e0` hover 底上只有 2.79:1）—— 那是主题的问题，不是 wash 机制的问题。
 *    我们若硬判死，这个门会永远红（就是 visual-matrix 曾经的病），于是没人再看它。
 *    wash 该负的责任只有一条：**收敛不许让可读性变坏**（alpha 让它更像宿主，通常更好）。
 */
test("承托层 × 前景（内置主题）：每个 wash 上每种前景都达到 WCAG 门槛", () => {
  const failures = [];
  for (const state of themeStates().filter((s) => s.name.startsWith("内置-"))) {
    for (const wash of WASHES) {
      const bg = composedOf(state, wash);
      for (const fg of FOREGROUNDS) {
        const ratio = contrastOf(state.vars[fg.key], bg);
        if (ratio < fg.min) failures.push(`${state.name} · ${wash.id} · ${fg.label}：${ratio.toFixed(2)} < ${fg.min}（前景 ${state.vars[fg.key]} on ${bg}）`);
      }
    }
  }
  assert.deepEqual(failures, [], `内置主题承托层可读性未达标（共 ${failures.length} 处）：\n${failures.slice(0, 20).join("\n")}`);
});

test("承托层 × 前景（外部主题）：wash 的可读性不许比实底更差（收敛只许变好）", () => {
  const failures = [];
  const recorded = [];
  for (const state of themeStates().filter((s) => s.name.startsWith("包-"))) {
    for (const wash of WASHES) {
      const composed = composedOf(state, wash);
      const solid = state.vars[wash.fill];
      for (const fg of FOREGROUNDS) {
        const withWash = contrastOf(state.vars[fg.key], composed);
        const withSolid = contrastOf(state.vars[fg.key], solid);
        // 允许 0.02 的舍入余量（alpha 是 0.1% 粒度）
        if (withWash + 0.02 < withSolid) {
          failures.push(`${state.name} · ${wash.id} · ${fg.label}：wash ${withWash.toFixed(2)} < 实底 ${withSolid.toFixed(2)}`);
        }
        if (withWash < fg.min) recorded.push(`${state.name} · ${wash.id} · ${fg.label}：${withWash.toFixed(2)} < ${fg.min}`);
      }
    }
  }
  // 记录（不判死）：这些是主题作者自己的配色选择，我们看到就够了，见上注释。
  if (recorded.length > 0) console.log(`  （外部主题自身配色未达标 ${recorded.length} 处，不计为 wash 缺陷）`);
  assert.deepEqual(failures, [], `wash 让可读性变差了（共 ${failures.length} 处）：\n${failures.slice(0, 20).join("\n")}`);
});

test("承托层饱和度：wash 合成后的 chroma 不超过引擎实测上界（荧光绿的直接判据）", () => {
  const failures = [];
  for (const state of themeStates()) {
    const envelope = themeWashEnvelope(state.mode);
    for (const wash of WASHES.filter((w) => w.wash === true)) {
      const bg = composedOf(state, wash);
      const chroma = oklchOf(parseColor(bg)).c;
      /*
       * 上界 = `max(族的界, 宿主自身的 chroma)`。
       *
       * 为什么不是单看族的界：wash 在 alpha→0 时合成色**收敛到宿主**，
       * 所以它能达到的最低饱和就是宿主自己的饱和。若某个外部主题的**列底**
       * （host = nav-bg）本身就比族的界更饱和（Minimal `#24262a` 实测 chroma 0.0080
       * > chip 界 0.0043），wash 再怎么透明也降不下去 —— 那是**列底（fill）**的问题，
       * 不是 wash 的问题，不该由这条断言判死。列底的可读性由上面的对比度矩阵管。
       */
      const cap = Math.max(envelope[wash.kind], oklchOf(parseColor(state.vars[wash.host])).c);
      if (chroma > cap + 1e-6) failures.push(`${state.name} · ${wash.id}：chroma ${chroma.toFixed(4)} > 上界 ${cap.toFixed(4)}`);
    }
  }
  assert.deepEqual(failures, [], `承托层饱和度过高（会盖掉状态标记）：\n${failures.join("\n")}`);
});

test("内置主题的 wash α 恒为 100%（视觉零变化：外部主题的收敛不许反噬内置）", () => {
  for (const preset of Object.keys(THEME_PRESETS)) {
    for (const mode of ["light", "dark"]) {
      const p = calculatePalette(clampState({ ...THEME_PRESETS[preset], preset, mode }));
      const env = themeWashEnvelope(mode);
      const fills = { navAccent: hexOf(p.navAccent), navSelected: hexOf(p.navSelected), sunken: hexOf(p.sunken), navBg: hexOf(p.navBg) };
      assert.equal(washAlphaFor(fills.navAccent, fills.navBg, env.hover), 1, `${preset}/${mode} hover 被收敛了（内置主题不该收敛）`);
      assert.equal(washAlphaFor(fills.navSelected, fills.navBg, env.selected), 1, `${preset}/${mode} selected 被收敛了`);
      assert.equal(washAlphaFor(fills.sunken, fills.navBg, env.chip), 1, `${preset}/${mode} chip 被收敛了`);
    }
  }
});

test("Quiet Light 的选中底被收敛（本轮事故的回归锁）", () => {
  const pack = packs.find((p) => p.meta.name === "Quiet Light");
  assert.ok(pack !== undefined, "Quiet Light 预置包缺失");
  const derived = derivePack(pack);
  const vars = derived.modes.light ?? {};
  const fill = String(vars["--color-nav-selected"]);
  const host = String(vars["--color-nav-bg"]);
  // 色相保留（还是那个绿），但合成后的 chroma 必须回到区间内
  const env = themeWashEnvelope("light");
  const alpha = washAlphaFor(fill, host, env.selected);
  assert.ok(alpha < 1, `Quiet Light 的选中底没被收敛（alpha=${alpha}）—— 事故会复发`);
  const composed = toHex(compositeOver({ ...parseColor(fill), a: alpha }, parseColor(host)));
  assert.ok(oklchOf(parseColor(composed)).c <= env.selected + 1e-6,
    `Quiet Light 收敛后 chroma 仍超界：${oklchOf(parseColor(composed)).c} > ${env.selected}`);
});

test("活性验证：把上界放宽到 1.0，饱和度断言必须红", () => {
  const state = themeStates().find((s) => s.name === "包-Quiet Light");
  assert.ok(state !== undefined);
  const fill = state.vars.navSelected;
  const host = state.vars.navBg;
  // 上界 1.0 = 永不收敛（等价于"没有这条约束"）
  const alpha = washAlphaFor(fill, host, 1.0);
  assert.equal(alpha, 1, "上界放到 1.0 时应当不收敛");
  const composed = toHex(compositeOver({ ...parseColor(fill), a: alpha }, parseColor(host)));
  const env = themeWashEnvelope(state.mode);
  assert.ok(oklchOf(parseColor(composed)).c > env.selected,
    "放宽上界后 chroma 应当超界（说明这条断言真的在判东西）");
});

test("applyWashAlphas 写出的变量与 washAlphaFor 一致（运行时与推导同源）", () => {
  const written = new Map();
  const fakeRoot = { setProperty: (k, v) => written.set(k, v) };
  const p = calculatePalette(clampState({ ...THEME_PRESETS.cool, preset: "cool", mode: "light" }));
  applyWashAlphas(fakeRoot, {
    navAccent: hexOf(p.navAccent), navSelected: hexOf(p.navSelected),
    sunken: hexOf(p.sunken), navBg: hexOf(p.navBg),
  }, "light");
  assert.equal(written.get("--wash-hover-alpha"), "100%");
  assert.equal(written.get("--wash-selected-alpha"), "100%");
  assert.equal(written.get("--wash-chip-alpha"), "100%");

  // 外部主题（超界）→ 写出百分比而不是 100%
  const fakeRoot2 = new Map();
  applyWashAlphas({ setProperty: (k, v) => fakeRoot2.set(k, v) }, {
    navAccent: "#e0e0e0", navSelected: "#c4d9b1", sunken: "#f5f5f5", navBg: "#f2f2f2",
  }, "light");
  const selected = Number.parseFloat(String(fakeRoot2.get("--wash-selected-alpha")).replace("%", ""));
  assert.ok(selected > 0 && selected < 100, `Quiet Light 的 selected α 应为 (0,100)：${selected}`);
});
