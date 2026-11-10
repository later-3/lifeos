import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  BADGE_DEFAULTS, badgeBreatheMax, badgePeriodS, badgeSoft, badgeVarsOf,
  dotBreatheMax, hexToRgb, mixOver, parseBadges, rgbToHex,
} from "../frontend/src/badge-prefs.ts";
import { calculatePalette, clampState, contrastRgb, hex as themeHex, THEME_PRESETS } from "../frontend/src/design/theme.ts";

/**
 * 状态徽标偏好（2026-11-10 用户：速率/幅度/配色强度单独可调；深浅色都要到位）。
 *
 * 锁住四件事实：
 * 1. **默认档 = v5 现值**（用户 2026-11-06 在 animlab 调定的 3s / 1.02 / 1.30 一厘不动）；
 * 2. 深浅色 × 三强度 × 三语义色的 soft 底全部能让它的**字**达 AA ≥4.5；
 * 3. **深色 soft 底不得比页面底更暗**（旧 #10263a 的"凹陷"病，2026-11-10 修）；
 * 4. 坏输入（localStorage 手改坏）一律钳制回合法域，不炸界面。
 *
 * `hex()` 从 theme.ts 导入（`frontend/src/design/theme.ts` 的 sRGB 输出）——
 * 界面写 :root 与这里的断言用同一把尺子，不存在第二份数学（规范 2.7）。
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const RGB_BLACK = [0, 0, 0];

/** theme.ts 的 hex() 在 .mjs 里直接调用（.mjs 不吃 TS 语法） */
function hexOfKey(p, key) {
  const [l, c, h] = p[key];
  return themeHex(l, c, h);
}

test("默认档就是 v5 现值（用户在 animlab 调定过的观感不动）", () => {
  assert.equal(BADGE_DEFAULTS.speed, 1);
  assert.equal(badgePeriodS(BADGE_DEFAULTS.speed), 3);
  assert.equal(badgeBreatheMax(BADGE_DEFAULTS.amplitude), 1.02);
  assert.equal(dotBreatheMax(BADGE_DEFAULTS.amplitude), 1.30);
});

test("速率与幅度的区间钳制（0.5–2.5× / 0–100%）与换算", () => {
  assert.equal(badgePeriodS(2.5), 1.2);
  assert.equal(badgePeriodS(0.5), 6);
  assert.equal(badgePeriodS(99), 1.2, "超上限照上限算");
  assert.equal(badgePeriodS(-1), 6);
  assert.equal(dotBreatheMax(0), 1, "幅度 0 = 完全静止");
  assert.equal(dotBreatheMax(1), 1.45);
  assert.equal(badgeBreatheMax(0), 1);
  assert.equal(badgeBreatheMax(1), 1.03);
  assert.equal(dotBreatheMax(0.667), 1.3);
});

test("mixOver 与 color-mix(in srgb) 同结果（白底上 9% 蓝）", () => {
  // #0062b5 在 #ffffff 上 9% → 通道插值（与方程 #eef2ff 的邻居一致）
  const mixed = mixOver([0, 98, 181], [255, 255, 255], 9);
  assert.deepEqual(mixed, [232, 241, 248]);
});

test("解析：坏输入一律钳回合法域（localStorage/手改坏 ui.json 不炸界面）", () => {
  assert.deepEqual(parseBadges(undefined), BADGE_DEFAULTS);
  assert.deepEqual(parseBadges({ speed: 99, amplitude: -5, strength: "hot" }),
    { speed: 2.5, amplitude: 0, strength: "standard" });
  assert.deepEqual(parseBadges({ speed: "fast" }), BADGE_DEFAULTS);
});

/** 与语义色的「距离」（通道绝对差之和）：强度越高（mix 越多），底离语义色应越近。 */
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

test("badgeSoft：三强度档单调（mix 升 → 底与语义色的距离下降）", () => {
  // 直接测三档混入（soft/standard/vivid 在 dark 档的 alpha = 10/14/20%）——用 base/surface 中间例，
  // 避免依赖拍板数值：语义上只要「mix 越大 → 离 base 越近」这一单调关系成立。
  const base = hexToRgb("#1cc0ff"), surface = hexToRgb("#292828");
  const vals = [10, 14, 20].map((alpha) => mixOver(base, surface, alpha));
  for (let i = 1; i < vals.length; i += 1) {
    assert.ok(dist(vals[i], base) <= dist(vals[i - 1], base) + 1e-6,
      `第 ${i} 档应更贴近语义色（dist ${dist(vals[i - 1], base)} → ${dist(vals[i], base)}）`);
  }
});

test("深浅色 × 三强度 × 三语义色：soft 底上的字全部 ≥4.5（AA）", () => {
  for (const preset of Object.keys(THEME_PRESETS)) {
    for (const mode of ["light", "dark"]) {
      const p = calculatePalette(clampState({ ...THEME_PRESETS[preset], preset, mode }));
      for (const [kind, textKey] of [["running", "running"], ["success", "success"], ["danger", "danger"]] ) {
        const base = hexOfKey(p, textKey);
        const surface = hexOfKey(p, "surface");
        for (const strength of ["soft", "standard", "vivid"]) {
          const soft = badgeSoft(kind, mode, strength, base, surface);
          const ratio = contrastRgb(hexToRgb(soft), hexToRgb(base));
          assert.ok(ratio >= 4.5,
            `${preset}/${mode}/${kind}/${strength}: 字 vs soft 底 = ${ratio.toFixed(2)} < 4.5（soft=${soft}）`);
        }
      }
    }
  }
});

test("hex 往返无损（hexToRgb ↔ rgbToHex）", () => {
  for (const hex of ["#292828", "#1cc0ff", "#ffffff", "#123456"]) {
    assert.equal(rgbToHex(hexToRgb(hex)), hex.toLowerCase());
  }
  assert.deepEqual(hexToRgb("bad"), [0, 0, 0]);
});

test("深色下 soft 底不得比页面底更暗（「凹陷」病回归锁）", () => {
  // 表述：soft 对黑的对比值 ≥ 页面底对黑的对比值（同一把尺子下 = 亮度不降低）。
  for (const preset of Object.keys(THEME_PRESETS)) {
    const p = calculatePalette(clampState({ ...THEME_PRESETS[preset], preset, mode: "dark" }));
    const surfaceLum = contrastRgb(hexToRgb(hexOfKey(p, "surface")), RGB_BLACK);
    for (const kind of ["running", "success", "danger"]) {
      const base = hexOfKey(p, kind);
      const soft = badgeSoft(kind, "dark", "standard", base, hexOfKey(p, "surface"));
      const softLum = contrastRgb(hexToRgb(soft), RGB_BLACK);
      assert.ok(softLum >= surfaceLum - 1e-9,
        `${preset}/${kind}: dark soft (${soft}) 必须比页面底（${surfaceLum.toFixed(3)}）更亮（实际 ${softLum.toFixed(3)}）`);
    }
  }
});

test("badgeVarsOf 的四个变量必须被 tokens.css 的 keyframes 消费（改名 = 断链先红）", () => {
  const vars = badgeVarsOf(BADGE_DEFAULTS);
  assert.deepEqual(Object.keys(vars),
    ["--badge-motion-period", "--badge-breathe-max", "--dot-breathe-max", "--badge-ring-spread"]);
  assert.equal(vars["--badge-motion-period"], "3s");
  assert.equal(vars["--badge-ring-spread"], "3.4px", "默认幅度（dot 1.30）时 halo = 版径增量 0.9 + 余量 2.5 = 3.4px");
  const css = readFileSync(join(HERE, "..", "frontend/src/design/tokens.css"), "utf8");
  for (const name of ["--badge-motion-period", "--badge-breathe-max", "--dot-breathe-max", "--badge-ring-spread"]) {
    assert.ok(css.includes(name), `tokens.css 必须消费 ${name}（动画参数可调的线）`);
  }
  // halo 颜色必须从语义色派生（→ dark/light 各自合适；写死 rgba 的旧做法回归即红）
  assert.ok(/badge-ring\s*{[\s\S]*color-mix\(in srgb, var\(--color-running\)/.test(css.replace(/\n/g, " ")),
    "badge-ring 的颜色必须来自 --color-running（keyframes color-mix）");
});
