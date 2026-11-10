// 设计系统契约（Task 0009 · 2026-11-09）。
//
// 为什么有这个测试：`lint:tokens` 只查"写法"（禁任意值/裸调色板/裸 hex），
// `ui-contract` 只查"某个交互对不对"，而**没有任何东西保证设计系统内部是自洽的**。
// 参考项目 LibreChat 有 `semanticTokens.spec.ts`（把 "dark dialog 必须是 gray-875" 写成断言），
// novu 有 18 条 `.grit` 自定义 lint 规则 —— 我们的纪律一直只写在文档里。
//
// 这一组断言便宜（纯静态读文件 + 纯函数计算，秒级、不启浏览器），但能防住：
//  ① 浮层再分裂出第 N 套外观（现在有 5 套：border+shadow-md / ring+shadow-lg / ...）；
//  ② z-index 随手写导致层级顺序错（Toast 与 Modal 同为 50）；
//  ③ token 写了没人用（现存 5 个）；
//  ④ 深浅色只做一半（dark 的 popover 少了白色描边 → 浮层在黑底上糊成一片）；
//  ⑤ 状态强度关系倒退（hover 比选中还重）。
//
// 纪律：**断言的是"关系"与"唯一来源"，不是具体数值**。数值只允许出现在 tokens.css / theme.ts，
// 这里出现任何 `0.06` 这类数字都说明测试自己变成了第二事实源。

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { LAYER, LAYER_CLASS, SCRIM_CLASS, SURFACE, surfaceClass, surfaceStyle } from "../frontend/src/design/surface.ts";
import { calculatePalette, clampState, contrastOf, elevationOf, THEME_PRESETS } from "../frontend/src/design/theme.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "frontend/src");

/** 递归收集前端源码（不含 design/：设计系统自己的实现层允许出现 token 名与阴影变量）。 */
function sourceFiles(dir = SRC, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "design") continue;
      sourceFiles(full, out);
      continue;
    }
    if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

/** 去掉注释行，避免注释里提到 `shadow-lg` 就误报（本文件里就写了很多）。 */
function codeLines(file) {
  return readFileSync(file, "utf8").split("\n")
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => {
      const trimmed = text.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    });
}

const FILES = sourceFiles();

test("浮层阴影只允许来自 --surface-*（禁止 Tailwind 裸 shadow-*）", () => {
  // 为什么：`shadow-md/lg/xl` 是固定黑投影，深色底下几乎不可见（实测 #292828 上肉眼无差）；
  // theme.ts 的 `--surface-popover/-modal` 在 deep 下有 1px 白色微描边，边界才看得出来。
  // 例外：`shadow-anno*` 是批注卡专用的既有 token（annotation-card 的连线视觉），它本身是 token 而不是裸值。
  const offenders = [];
  for (const file of FILES) {
    for (const { text, line } of codeLines(file)) {
      const hits = text.match(/\bshadow-(?:sm|md|lg|xl|2xl|inner)\b/g);
      if (hits === null) continue;
      offenders.push(`${relative(ROOT, file)}:${line} ${hits.join(",")}`);
    }
  }
  assert.deepEqual(offenders, [], `浮层阴影必须用 SURFACE / --surface-*，发现：\n${offenders.join("\n")}`);
});

test("z-index 只允许来自 LAYER（禁止裸 z-<数字>）", () => {
  const offenders = [];
  for (const file of FILES) {
    for (const { text, line } of codeLines(file)) {
      // `z-10` 这类 Tailwind 类；`zIndex` 内联也一并禁（必须走 layerStyle）
      const tailwind = text.match(/\bz-(?:5|10|20|30|40|50|60|auto)\b/g);
      const inline = /\bzIndex\s*:\s*\d+/.test(text);
      if (tailwind === null && !inline) continue;
      offenders.push(`${relative(ROOT, file)}:${line} ${[...(tailwind ?? []), ...(inline ? ["zIndex:<数字>"] : [])].join(",")}`);
    }
  }
  assert.deepEqual(offenders, [], `层级必须用 LAYER / layerStyle()，发现：\n${offenders.join("\n")}`);
});

test("层级顺序：toast 永远最上，modal 高于 drawer，drawer 高于 popover", () => {
  assert.ok(LAYER.toast > LAYER.modal, "toast 必须高于 modal（否则模态打开时看不到反馈）");
  assert.ok(LAYER.modal > LAYER.drawer, "modal 必须高于 drawer");
  assert.ok(LAYER.drawer > LAYER.popover, "drawer 必须高于 popover");
  assert.ok(LAYER.popover > LAYER.rail, "popover 必须高于轨上浮标");
});

test("LAYER 与 index.css 的 --z-* 一致（改一处忘另一处会红）", () => {
  // 层级有两处表达：TS 常量（给组件计算用）与 CSS 变量（给 .layer-* 类用）。
  // 两处不一致时现象是"某个浮层莫名其妙被盖住"，而且只在特定组合下复现 —— 极难排查。
  const css = readFileSync(join(SRC, "index.css"), "utf8");
  for (const [name, value] of Object.entries(LAYER)) {
    const match = css.match(new RegExp(`--z-${name}\\s*:\\s*(\\d+)`));
    assert.ok(match !== null, `index.css 缺 --z-${name}`);
    assert.equal(Number(match[1]), value, `--z-${name}（${match[1]}）与 LAYER.${name}（${value}）不一致`);
  }
  // 语义类必须真的被定义（否则 className 里写了也不生效）
  for (const className of Object.values(LAYER_CLASS)) {
    assert.ok(css.includes(`.${className}`), `index.css 缺 .${className}`);
  }
});

test("每个 SurfaceTone 的配方引用真实存在的 token（不自造名字）", () => {
  const tokens = readFileSync(join(SRC, "design", "tokens.css"), "utf8");
  const surfaceVars = new Set(
    [...readFileSync(join(SRC, "index.css"), "utf8").matchAll(/--surface-[a-z-]+/g)].map((m) => m[0]),
  );
  for (const [tone, recipe] of Object.entries(SURFACE)) {
    // 圆角档必须真的定义在 tokens.css 里
    assert.ok(tokens.includes(recipe.radius.replace("rounded-", "--radius-") + ":"),
      `${tone} 的圆角 ${recipe.radius} 在 tokens.css 里没有对应定义`);
    // 阴影必须是已声明的 --surface-*（theme.ts 会写，index.css 有默认值）
    const varName = recipe.shadow.match(/var\((--surface-[a-z-]+)\)/)?.[1];
    assert.ok(varName !== undefined, `${tone} 的阴影必须写成 var(--surface-*)，实际 ${recipe.shadow}`);
    assert.ok(surfaceVars.has(varName), `${tone} 的阴影变量 ${varName} 没有任何地方声明`);
    assert.equal(recipe.edge, "ring", `${tone} 的边界必须用 ring（border 会占 1px 布局，浮层高度会差 2px）`);
  }
});

test("深色阴影必须带 1px 白色微描边（否则浮层在黑底上糊成一片）", () => {
  // 依据：实测 dark #292828 上 Tailwind shadow-lg 不可见；LobeHub/LibreChat 的深色浮层都靠
  // "1px 白色低 alpha 描边 + 极低 alpha 扩散"建立边界（knowledge/design/theme-systems/）。
  const dark = elevationOf("dark");
  for (const key of ["popover", "modal"]) {
    assert.match(dark[key], /rgba\(255,\s*255,\s*255/, `dark.${key} 必须含白色描边：${dark[key]}`);
  }
  const light = elevationOf("light");
  for (const key of ["popover", "modal"]) {
    assert.doesNotMatch(light[key], /rgba\(255,\s*255,\s*255/, `light.${key} 不该用白色描边（白底上无意义）`);
  }
});

test("遮罩只有一种写法（SCRIM_CLASS），页面不许自己写 bg-ink-900/NN", () => {
  const offenders = [];
  for (const file of FILES) {
    for (const { text, line } of codeLines(file)) {
      const hits = text.match(/bg-ink-900\/\d+/g);
      if (hits === null) continue;
      if (text.includes("SCRIM_CLASS")) continue;
      offenders.push(`${relative(ROOT, file)}:${line} ${hits.join(",")}`);
    }
  }
  assert.deepEqual(offenders, [], `遮罩必须用 SCRIM_CLASS（否则会有 20%/35% 两种压暗）：\n${offenders.join("\n")}`);
  assert.match(SCRIM_CLASS, /^bg-ink-900\/\d+$/);
});

test("surfaceClass / surfaceStyle 产出的类名与 token 一致", () => {
  const popover = surfaceClass("popover");
  assert.match(popover, /bg-surface/);
  assert.match(popover, /rounded-panel/);
  assert.match(popover, /ring-1 ring-line/);
  assert.equal(surfaceStyle("modal").boxShadow, SURFACE.modal.shadow);
});

test("设计 token 都真的被用上（颜色/容器查工具类，其余查变量名）", () => {
  /*
   * 2026-11-09 审计：`--surface-popover/-modal`、`--motion-*`、`--tracking-*`、`--radius-full`
   * 全都写好了但 0 使用 —— 这正是"浮层各写一套"的另一面：token 层做了，没人接。
   *
   * 三个口径（第一版全按"变量名出现两次"查，得到 41 个假失败，见 cases/2026-11-09.md）：
   *  ① 颜色：`--color-danger-soft` 被 Tailwind 生成成 `bg-danger-soft` 这类**工具类**，查类名；
   *  ② 容器档：`--container-reading` 被生成成 `max-w-reading`，查类名；
   *  ③ 其余：查 `var(--x)` / `getPropertyValue("--x")` 形式的**真实使用**。
   * 并且**声明处不算使用** —— 所以扫描范围排除 tokens.css 自身。
   */
  const tokensCss = readFileSync(join(SRC, "design", "tokens.css"), "utf8");
  const declared = [...tokensCss.matchAll(/^\s*(--[a-z][a-z0-9-]*):/gm)].map((m) => m[1]);

  // 扫描范围：src 下所有 ts/tsx/css，**包含 design/**（颜色与容器档大量用在 rail/ui 里），
  // 但排除 tokens.css（声明处不算使用）。
  const consumers = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules") walk(full);
        continue;
      }
      if (!/\.(tsx?|css)$/.test(entry)) continue;
      if (full === join(SRC, "design", "tokens.css")) continue;
      consumers.push(readFileSync(full, "utf8"));
    }
  })(SRC);
  const sources = consumers.join("\n");

  /** 这些族由 CSS 自身或 Tailwind 配对机制消费，不作为"该被使用"的判据。 */
  const ALLOW_PREFIX = [
    "--text-",        // 字阶（含 --text-*-line-height 配对值）
    "--color-syn-",   // 语法高亮（index.css 的 .md-body pre）
    "--anno-pin-",    // 批注钉位偏移（按 index 生成）
    "--animate-",     // 动画（@keyframes 的引用方）
    "--radius-",      // 圆角档（与 Tailwind rounded-* 同值，两套并存是有意的）
    "--shadow-anno",  // 批注卡专用阴影
    "--color-diff-",  // 差异视图（review CSS）
    "--color-message-",
    "--color-anno-",
  ];
  const ALLOW_UNUSED = new Set([
    "--surface-card-hover", // 卡片 hover 档：留给交互卡的 hover 态
    "--container-anno-popup-max", // 批注弹层的视口上限，由 anno-popup 宽度 clamp 组合使用（见 css 注释）
  ]);

  const unused = declared.filter((name) => {
    if (ALLOW_UNUSED.has(name)) return false;
    if (ALLOW_PREFIX.some((prefix) => name.startsWith(prefix))) return false;

    if (name.startsWith("--color-")) {
      const utility = name.slice("--color-".length).replace(/-/g, "\\-");
      const pattern = new RegExp(`(?:bg|text|border|ring|from|via|to|fill|stroke|divide|placeholder|decoration|shadow|outline|accent|theme)-${utility}\\b`);
      if (pattern.test(sources)) return false;
      // 也可能以 var(--color-x) 形式在 CSS 里用（如 .md-body a 的 color）
      return sources.split(name).length - 1 === 0;
    }
    if (name.startsWith("--container-")) {
      const utility = name.slice("--container-".length).replace(/-/g, "\\-");
      if (new RegExp(`(?:max|min)-w-${utility}\\b`).test(sources)) return false;
      return sources.split(name).length - 1 === 0;
    }
    return sources.split(name).length - 1 === 0;
  });

  assert.deepEqual(unused, [], `这些 token 声明了但没人用（接上，或写进 ALLOW_UNUSED 说明理由）：\n${unused.join("\n")}`);
});

test("辅助文字 ink-500 在 4 个底 × 5 预设 × 深浅色下都 ≥4.5（axe 审计抓到的真缺陷）", () => {
  // 2026-11-09 axe 审计：`ink500` 写死 L*42（浅色的解），深色底 #292828 上只有 **2.45:1** ——
  // 深色下头部副标题/空态提示/行内说明全部发灰看不清，axe 报了 30 次 color-contrast。
  // 这条断言把"辅助文字必须按深浅色分开给"锁住：4 个可能出现的底（surface / hover / line / sunken）
  // 都要 ≥4.5，任何一个不达标就红。
  for (const preset of Object.keys(THEME_PRESETS)) {
    for (const mode of ["light", "dark"]) {
      const p = calculatePalette(clampState({ ...THEME_PRESETS[preset], preset, mode }));
      for (const [label, bg] of [["surface", p.surface], ["hover", p.hover], ["line", p.line], ["sunken", p.sunken]]) {
        const ratio = contrastOf(p.ink500, bg);
        assert.ok(ratio >= 4.5, `${preset}/${mode}: ink-500 on ${label} = ${ratio.toFixed(2)} < 4.5`);
      }
    }
  }
});

test("状态强度关系在 5 个预设 × 深浅色下都成立（hover 比选中浅、选中≈hover×2）", () => {
  // 关系断言而不是数值断言：数值可以调，关系不能反（反了就是"hover 比选中还重"）。
  for (const preset of Object.keys(THEME_PRESETS)) {
    for (const mode of ["light", "dark"]) {
      const palette = calculatePalette(clampState({ ...THEME_PRESETS[preset], preset, mode }));
      const hover = Math.abs(palette.navBg[0] - palette.navAccent[0]);
      const selected = Math.abs(palette.navBg[0] - palette.navSelected[0]);
      assert.ok(hover > 0, `${preset}/${mode}: hover 必须有可见变化`);
      assert.ok(selected > hover, `${preset}/${mode}: 选中(${selected.toFixed(1)}) 必须比 hover(${hover.toFixed(1)}) 更强`);
      const ratio = selected / hover;
      assert.ok(ratio >= 1.6 && ratio <= 2.6, `${preset}/${mode}: 选中/hover 比 ${ratio.toFixed(2)} 应落在 1.6–2.6`);
    }
  }
});

test("深浅色分层方向一致：轨 < 列 < 页面（浅色更暗、深色更亮，但顺序相同）", () => {
  for (const mode of ["light", "dark"]) {
    const p = calculatePalette(clampState({ mode }));
    // 口径与 test/theme.test.mjs 相同：**轨 < 列 < 内容(surface)**。
    // 不用 sunken：它是"页面底"的另一种表达（light 比 surface 暗 1.7、dark 比列再暗 1.0），
    // 在 dark 下 sunken 本来就该比 nav 暗 —— 拿它比会得出"列比页面亮"的假失败。
    const rail = p.navEdge[0], nav = p.navBg[0], content = p.surface[0];
    assert.ok(rail < nav, `${mode}: 轨(${rail.toFixed(1)}) 必须比列(${nav.toFixed(1)}) 暗`);
    assert.ok(nav < content, `${mode}: 列(${nav.toFixed(1)}) 必须比内容(${content.toFixed(1)}) 暗`);
  }
});

test("每个 primitive 都有可访问名（静态扫描：IconButton 必须带 label）", () => {
  // 动态检查在 ui-contract 里（"可见按钮都有可访问名"）；这里守住"新写的 IconButton 忘传 label"。
  const offenders = [];
  for (const file of FILES) {
    const raw = readFileSync(file, "utf8").split("\n");
    raw.forEach((text, index) => {
      const trimmed = text.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      if (!/<IconButton\b/.test(text)) return;
      // label 可能写在同一行，也可能写在紧随的若干行（JSX 多行属性），取到 `>` 或 `/>` 为止
      const window = raw.slice(index, index + 6).join(" ");
      const end = window.indexOf(">");
      const tag = end >= 0 ? window.slice(0, end) : window;
      if (/\blabel=/.test(tag)) return;
      offenders.push(`${relative(ROOT, file)}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `IconButton 必须传 label：\n${offenders.join("\n")}`);
});

test("没有裸 hex 颜色出现在页面层（设计系统层例外）", () => {
  // lint-tokens 已经查这条；这里再查一次是因为 lint-tokens 只跑 src/ 顶层，
  // 而本测试会遍历所有子目录（含未来新增的 views/ 等分层）。
  const offenders = [];
  for (const file of FILES) {
    if (file.endsWith(".css")) continue;  // CSS 里允许（tokens.css 之外的 css 也归设计系统）
    for (const { text, line } of codeLines(file)) {
      const hits = text.match(/#[0-9a-fA-F]{3,8}\b/g)?.filter((hex) => !/^#(?:fff|000)$/i.test(hex));
      if (hits === undefined || hits.length === 0) continue;
      offenders.push(`${relative(ROOT, file)}:${line} ${hits.join(",")}`);
    }
  }
  assert.deepEqual(offenders, [], `颜色只允许在 tokens.css：\n${offenders.join("\n")}`);
});

test("头像三档底色在 5 预设 × 深浅色下都 ≥4.5 于白字（视觉矩阵抓到的缺陷）", () => {
  // 2026-11-09 视觉矩阵（chat-dark-1280）一眼看到：头像只剩一个空白圆。
  // 根因：头像底色用的是 `ink-700/ink-900`，而它们在深色模式下是**近白**（L*82/96），
  // 首字母固定白字 → 白底白字。改成三个专用 token（各色相二分求"白字仍 AA 的最亮 L"）。
  for (const preset of Object.keys(THEME_PRESETS)) {
    for (const mode of ["light", "dark"]) {
      const p = calculatePalette(clampState({ ...THEME_PRESETS[preset], preset, mode }));
      for (const key of ["avatar1", "avatar2", "avatar3"]) {
        const ratio = contrastOf(p[key], [100, 0, 0]);
        assert.ok(ratio >= 4.5, `${preset}/${mode}: ${key} vs 白字 = ${ratio.toFixed(2)} < 4.5（头像白字看不见）`);
      }
      // 三档必须彼此可区分（否则"按 id 派生"没有意义）
      for (const [a, b] of [["avatar1", "avatar2"], ["avatar2", "avatar3"], ["avatar1", "avatar3"]]) {
        const dh = Math.abs(p[a][2] - p[b][2]);
        assert.ok(Math.min(dh, 360 - dh) >= 100, `${preset}/${mode}: ${a} 与 ${b} 色相太近（${dh.toFixed(0)}°）`);
      }
    }
  }
});

test("文字选区：普通文本 = accent-solid + 白字 ≥4.5；代码区用 alpha 档（2026-11-10）", () => {
  // 用户 2026-11-10（暗色模式）："鼠标选中拖一段文字，那个背景高亮我基本上看不到。"
  // 旧值是 accent-soft：深色下 L*≤30，与页面底（L*≈29）几乎同亮度 → 选区隐形。
  // 参考产品（普通文本都是实心主色 + 反色字）：Gitea base.css:269-272、
  // 代码区 alpha + currentcolor：gitea codeeditor.css:177-181（light 30%/dark 50%）、
  // LobeChat chatPanel.css.ts:544（22%）、Rocket.Chat codeBlockStyles.ts:13。
  // tokens.css 只有 accent-solid 引用（测试锁结构而不是具体数值）。
  const css = readFileSync(join(SRC, "design/tokens.css"), "utf8");
  assert.ok(/::selection\s*{[^}]*--color-accent-solid/.test(css.replace(/\n/g, " ")),
    "全局 ::selection 必须用 accent-solid（实心、白字可达 AA）");
  assert.ok(/pre ::selection[^}]*color-mix/.test(css.replace(/\n/g, " ")),
    "代码区（pre）选区必须是 alpha 档，语法 token 色不能被盖死");
  // accent-solid 与白字的 AA 由 maxLforWhiteText 语义保证；这里锁矩阵（同头像一案的写法）
  for (const preset of Object.keys(THEME_PRESETS)) {
    for (const mode of ["light", "dark"]) {
      const p = calculatePalette(clampState({ ...THEME_PRESETS[preset], preset, mode }));
      const ratio = contrastOf(p.accentSolid, [100, 0, 0]);
      assert.ok(ratio >= 4.5, `${preset}/${mode}: 选区白字 vs accent-solid = ${ratio.toFixed(2)} < 4.5`);
    }
  }
});
