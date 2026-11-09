// 首屏防闪（index.html 内联脚本）与主题引擎的一致性（Task 0009 · C2）。
//
// 为什么需要这条：为了让首帧就是对的，index.html 里内联了一段**同步**脚本，
// 它按深/浅色写几个最关键的 CSS 变量（不能 import 模块，只能复制公式）。
// 复制必然有漂移风险 —— 这个测试把两边钉在一起：
//   · 深色下那 6 个变量必须等于 `calculatePalette(默认深色)` 的结果；
//   · 浅色同理；
//   · 脚本必须真的**写颜色**（只写 data-theme-mode 的版本实测会白闪 44–99ms）。
//
// 如果将来改了默认底色（lSurface/lNav/lRail/lLine），这里会红 —— 那时要同步改 index.html，
// 而不是把测试放宽。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { calculatePalette, clampState, hex } from "../frontend/src/design/theme.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = readFileSync(join(ROOT, "frontend", "index.html"), "utf8");

/** 从 index.html 的内联脚本里取出"写某个变量"的字面值（按 dark / else 分支切段）。 */
function bootColor(branch, variable) {
  const darkStart = HTML.indexOf("if (dark) {");
  assert.ok(darkStart >= 0, "index.html 里找不到 if (dark) 分支");
  const elseStart = HTML.indexOf("} else {", darkStart);
  assert.ok(elseStart > darkStart, "index.html 里找不到 else 分支");
  // else 段到"设置背景色"那一行为止（后面是脚本收尾，不属于任何分支）
  const tail = HTML.indexOf("root.style.backgroundColor", elseStart);
  const segment = branch === "dark"
    ? HTML.slice(darkStart, elseStart)
    : HTML.slice(elseStart, tail >= 0 ? tail : HTML.length);
  const match = segment.match(new RegExp(`setProperty\\("${variable}",\\s*"(#[0-9a-fA-F]{3,8})"\\)`));
  return match?.[1];
}

test("首屏脚本真的写了颜色（不只是 data-theme-mode）", () => {
  // 反例（2026-11-09 实测）：只写 data-theme-mode + color-scheme 时，深色刷新先白 44–99ms。
  assert.match(HTML, /setProperty\("--color-surface"/, "首屏脚本必须写 --color-surface");
  assert.match(HTML, /setProperty\("--color-ink-900"/, "首屏脚本必须写 --color-ink-900");
  assert.match(HTML, /backgroundColor/, "必须同时设置 documentElement 背景色（body 是透明的）");
});

test("深色的首屏取值与 theme.ts 的默认深色调色板一致", () => {
  const palette = calculatePalette(clampState({ mode: "dark" }));
  const expected = {
    "--color-surface": hex(...palette.surface),
    "--color-sunken": hex(...palette.sunken),
    "--color-nav-bg": hex(...palette.navBg),
    "--color-nav-edge": hex(...palette.navEdge),
    "--color-ink-900": hex(...palette.ink900),
    "--color-line": hex(...palette.line),
  };
  for (const [variable, want] of Object.entries(expected)) {
    const got = bootColor("dark", variable);
    assert.ok(got !== undefined, `index.html 深色分支缺 ${variable}`);
    assert.equal(got.toLowerCase(), want.toLowerCase(), `${variable} 漂移：index.html=${got} vs theme.ts=${want}`);
  }
});

test("浅色的首屏取值与 theme.ts 的默认浅色调色板一致", () => {
  const palette = calculatePalette(clampState({ mode: "light" }));
  const expected = {
    "--color-surface": hex(...palette.surface),
    "--color-sunken": hex(...palette.sunken),
    "--color-nav-bg": hex(...palette.navBg),
    "--color-nav-edge": hex(...palette.navEdge),
    "--color-ink-900": hex(...palette.ink900),
    "--color-line": hex(...palette.line),
  };
  for (const [variable, want] of Object.entries(expected)) {
    const got = bootColor("light", variable);
    assert.ok(got !== undefined, `index.html 浅色分支缺 ${variable}`);
    assert.equal(got.toLowerCase(), want.toLowerCase(), `${variable} 漂移：index.html=${got} vs theme.ts=${want}`);
  }
});
