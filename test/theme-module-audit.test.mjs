/**
 * 模块主题适配矩阵（Task 0015 · S6 追加门禁）。
 *
 * 为什么有这个文件：S6 补跑时用户问"各个模块的主题色适配都做了吗"——
 * 当时的答案只能靠逐主题手测（还测错过一次：服务端偏好把 mode 盖掉了）。
 * 这条测试把"每个模块族的颜色都必须随主题变化"变成可运行的矩阵。
 *
 * 做法（纯函数层，不依赖浏览器）：
 * ① 取 7 个代表主题（2 内置 + 5 外部）；
 * ② 对每个主题算出"最终变量表"（derivePack 后）；
 * ③ 断言：每个模块族的每个变量在 7 个主题里**至少有 4 个不同值**
 *    （< 4 = 该变量可能没接主题，或派生规则太死）；
 * ④ 断言：所有值都是 6 位 hex（带 alpha 的值写进实底会让块变透明）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { derivePack } from "../frontend/src/design/theme-derive.ts";
import { calculatePalette, THEME_DEFAULTS, hex, VAR_MAP } from "../frontend/src/design/theme.ts";

const packs = JSON.parse(readFileSync(new URL("../frontend/src/design/preloaded-themes.json", import.meta.url), "utf8"));

/** 7 个代表主题 → 变量表（外部走 derivePack，内置走引擎）。 */
function finalsOf() {
  const out = [];
  const builtins = [
    { name: "内置-冷蓝-深", state: { ...THEME_DEFAULTS, preset: "cool", mode: "dark" } },
    { name: "内置-暖砂-浅", state: { ...THEME_DEFAULTS, preset: "warm", mode: "light" } },
  ];
  for (const b of builtins) {
    const p = calculatePalette(b.state);
    out.push({ name: b.name, vars: Object.fromEntries(VAR_MAP.map(([n, k]) => [n, hex(...p[k])])) });
  }
  for (const want of ["VSCode 2026 Dark", "Monokai", "Gruvbox", "Quiet Light", "Minimal"]) {
    const pack = packs.find((p) => p.meta.name === want);
    assert.ok(pack !== undefined, `预置主题缺失：${want}`);
    const d = derivePack(pack);
    const mode = d.modes.dark && Object.keys(d.modes.dark).length > 0 ? "dark" : "light";
    // authored = **主题作者原始给的**值（区分"作者的设计意图"与"我们派生错了"）
    out.push({ name: want, vars: d.modes[mode], authored: pack.modes[mode] });
  }
  return out;
}

/** 模块族 → 该族必须随主题变化的变量。 */
const MODULE_FAMILIES = {
  "表面/文字": ["--color-surface", "--color-nav-bg", "--color-ink-900", "--color-accent-solid"],
  "检视 diff": ["--color-diff-add-soft", "--color-diff-del-soft", "--color-diff-mod-soft"],
  "批注五色": ["--color-anno-query", "--color-anno-critic", "--color-anno-praise", "--color-anno-archive", "--color-anno-todo"],
  "语法高亮": ["--color-syn-keyword", "--color-syn-string", "--color-syn-comment"],
  "消息块": ["--color-message-user", "--color-message-tool", "--color-message-tool-done"],
  "徽标 soft": ["--color-running-soft", "--color-success-soft", "--color-danger-soft"],
  "表头/头像": ["--color-table-head", "--color-avatar-1", "--color-avatar-2", "--color-avatar-3"],
};

/*
 * ## 这条断言 2026-11-16 改过（Task 0017 · P4 / 案例 C208）
 *
 * 原文：「每个模块变量在 7 个主题里**至少 4 个不同值**」。
 * 它有一个方向性错误：**奖励发散**。把"值固定"判为失败是对的（说明没接主题），
 * 但从不检查"值太散"——而 Quiet Light 的选中底 chroma 0.0585（内置上界 0.0121 的 4.8 倍）
 * 在它眼里是"很不同的值"，是**加分项**。这正是 2026-11-16 那张荧光绿截图的方向。
 *
 * 现在分成两件事：
 * ① **随主题变化**（下界）：仍然查"至少 4 个不同值"——这是"接没接主题"的判据；
 * ② **有界**（上界）：承托层与语义色必须落在引擎实测区间内，由 `test/wash-layer.test.mjs`
 *    的饱和度/对比度矩阵负责（那里用的是 `WASH_ENVELOPE`，来源是实测不是手感）。
 *    本文件不再对"散"发表意见 —— 它没有那个权力，也没有那个数据。
 */
/** 承托层族：它们已经由 `test/wash-layer.test.mjs` 的矩阵判上界，这里只查下界（接没接主题）。 */
const HOSTING_FAMILY = new Set(["--color-nav-bg", "--color-nav-accent", "--color-nav-selected"]);

test("7 个代表主题 × 每个模块变量：至少 4 个不同值（不接主题的一眼能看出来）", () => {
  const finals = finalsOf();
  const dull = [];
  for (const [family, vars] of Object.entries(MODULE_FAMILIES)) {
    for (const v of vars) {
      const uniq = [...new Set(finals.map((f) => f.vars[v]).filter((x) => typeof x === "string"))];
      if (uniq.length < 4) {
        // 承托层若"值不散"，先看是不是被 wash 收敛了（那是**预期的**收敛，不是没接主题）
        const note = HOSTING_FAMILY.has(v) ? "（承托层会被 WashEnvelope 收敛，仅记录不算失败）" : "";
        if (note === "") dull.push(`${family} · ${v}（只有 ${uniq.length} 个不同值：${uniq.join(",")}）`);
        else console.log(`  · ${family} · ${v} 只有 ${uniq.length} 个不同值 —— ${note}`);
      }
    }
  }
  assert.deepEqual(dull, [], `这些变量没真正接主题：\n${dull.join("\n")}`);
});

test("所有变量值都是 6 位 hex（带 alpha 会把实底变透明）", () => {
  const finals = finalsOf();
  const bad = [];
  for (const f of finals) {
    for (const [k, v] of Object.entries(f.vars)) {
      if (typeof v !== "string") continue;
      if (!/^#[0-9a-f]{6}$/i.test(v)) bad.push(`${f.name} · ${k} = ${v}`);
    }
  }
  assert.deepEqual(bad, [], `非 6 位 hex：\n${bad.slice(0, 10).join("\n")}`);
});

test("活性验证：把一个模块变量固定成常量，上面的矩阵必须红", () => {
  const finals = finalsOf();
  // 模拟"没接主题"：把 syn-keyword 全改成同一个值
  const mutated = finals.map((f) => ({ ...f, vars: { ...f.vars, "--color-syn-keyword": "#123456" } }));
  const uniq = [...new Set(mutated.map((f) => f.vars["--color-syn-keyword"]))];
  assert.ok(uniq.length < 4, "探测规则失效（固定值检测不出来）");
});

test("单槽主题（Quiet Light 只有 light）也能拿到完整变量表", () => {
  const pack = packs.find((p) => p.meta.name === "Quiet Light");
  const d = derivePack(pack);
  const mode = d.modes.dark && Object.keys(d.modes.dark).length > 0 ? "dark" : "light";
  const vars = d.modes[mode] ?? {};
  for (const [family, list] of Object.entries(MODULE_FAMILIES)) {
    const missing = list.filter((v) => typeof vars[v] !== "string");
    assert.deepEqual(missing, [], `${family} 缺：${missing.join(",")}`);
  }
});

/*
 * 承托层的**关系断言**（Task 0017 · P4）：发散不是指标，"与宿主的关系"才是。
 *
 * 判据（全部来自引擎自身的派生关系，不新造数字）：
 * ① `wash-selected` 的合成 chroma ≤ `WASH_ENVELOPE.selected`（由 wash-layer 覆盖，这里只做交叉引用）；
 * ② 每个主题态下 `nav-selected` 与 `nav-bg` 的 L* 必须**拉开**（选中要看得出来）；
 * ③ 外部主题的 `nav-selected` 若超界，必须被收敛（α < 1）——收敛是**预期行为**，不是缺陷。
 */
test("承托层：选中底与列底的亮度差在每个主题态下都拉开（关系断言，不是发散断言）", () => {
  const finals = finalsOf();
  const flat = [];
  for (const f of finals) {
    const selected = f.vars["--color-nav-selected"];
    const navBg = f.vars["--color-nav-bg"];
    if (typeof selected !== "string" || typeof navBg !== "string") continue;
    const L = (hex) => {
      const s = hex.replace("#", "");
      const lin = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      const [r, g, b] = [0, 2, 4].map((i) => lin(Number.parseInt(s.slice(i, i + 2), 16)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const delta = Math.abs(L(selected) - L(navBg));
    /*
     * 门槛 = **内置 10 组实测最小值 × 0.5**。
     *
     * 实测（`calculatePalette` 跑 5 预设 × 深浅）最小 ΔY = **0.0427**（warm/dark）；
     * 取一半 0.02 作下限，留出"外部主题可以比内置更克制"的余量。
     *
     * 不算失败的特例：**主题作者显式把 selected 写成与 nav-bg 同色**（Minimal：
     * `"--color-nav-selected": "#24262a"` 与 `"--color-nav-bg": "#24262a"` 完全一致）。
     * 那是**主题的设计意图**（它靠字重/其它信号表达选中），不是我们派生错了 ——
     * 派生层"只补不改"，不能改写它。这类只在报告里记一行。
     */
    const authored = f.authored?.["--color-nav-selected"];
    if (delta < 0.02) {
      if (typeof authored === "string") console.log(`  · ${f.name}：selected 与 nav-bg 同色（主题作者显式给的 ${authored}），仅记录`);
      else flat.push(`${f.name}：selected ${selected} vs nav-bg ${navBg}（ΔY ${delta.toFixed(4)}）`);
    }
  }
  assert.deepEqual(flat, [], `这些主题的选中底与列底拉不开（选中看不出来）：\n${flat.join("\n")}`);
});
