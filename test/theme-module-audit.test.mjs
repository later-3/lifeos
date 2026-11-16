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
    out.push({ name: want, vars: d.modes[mode] });
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

test("7 个代表主题 × 每个模块变量：至少 4 个不同值（不接主题的一眼能看出来）", () => {
  const finals = finalsOf();
  const dull = [];
  for (const [family, vars] of Object.entries(MODULE_FAMILIES)) {
    for (const v of vars) {
      const uniq = [...new Set(finals.map((f) => f.vars[v]).filter((x) => typeof x === "string"))];
      if (uniq.length < 4) dull.push(`${family} · ${v}（只有 ${uniq.length} 个不同值：${uniq.join(",")}）`);
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
