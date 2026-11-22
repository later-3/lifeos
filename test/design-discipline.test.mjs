/**
 * 控件纪律（Task 0015 · S4 阶段门）。
 *
 * 三件事：
 * ① 页面层自绘控件必须全部登记白名单（lint:primitives 的测试版，可被 node --test 跑到）；
 * ② 白名单每一条都必须有理由（禁止空理由/占位理由）；
 * ③ 自绘总数有基线，**只许降不许升**（防止"改回去"）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "frontend/src");
const SCRIPT = readFileSync(join(ROOT, "scripts/lint-primitives.mjs"), "utf8");

/** 解析 ALLOW 白名单（从脚本里读，避免两处维护）。 */
function allowList() {
  const entries = [];
  for (const m of SCRIPT.matchAll(/\["([^"]+\.tsx?)",\s*"([^"]*)"\]/g)) {
    entries.push({ file: m[1], why: m[2] });
  }
  return entries;
}

/** 统计页面层自绘 <button>（跳过注释行）。 */
function countButtons() {
  const out = new Map();
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "design" || entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const rel = relative(SRC, full);
      const lines = readFileSync(full, "utf8").split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"));
      const n = (lines.join("\n").match(/<button\b/g) ?? []).length;
      if (n > 0) out.set(rel, n);
    }
  })(SRC);
  return out;
}

test("白名单每一条都有具体理由（≥8 字，不是占位）", () => {
  const entries = allowList();
  assert.ok(entries.length >= 10, `白名单条目太少（${entries.length}），可能解析失败`);
  for (const e of entries) {
    assert.ok(e.why.length >= 8, `${e.file} 的白名单理由太短：「${e.why}」`);
  }
});

test("页面层自绘控件全部登记（未登记即红）", () => {
  const allowed = new Set(allowList().map((e) => e.file));
  const unregistered = [...countButtons().keys()].filter((f) => !allowed.has(f));
  assert.deepEqual(unregistered, [], `未登记的自绘控件文件：${unregistered.join("、")}`);
});

/**
 * 基线：S4 收敛后从 70 降到 25；每轮再降就收紧基线，永不回调。
 *
 * 2026-11-16（Task 0016 · P7-S1）**向上调 2 次**，理由写在下面，且是"不得不"而不是"顺手"：
 * 手机抽屉的会话动作菜单需要 `role=menu` + 两个 `role=menuitem` 的行（原生 button 承载），
 * 这是本项目里第一次出现**菜单语义**的浮层——`MicroButton` 的 tone 枚举装不下 role，
 * 包一层则会破坏 menuitem 的语义（读屏按 menu 角色导航时子节点必须是 menuitem）。
 * 因此：白名单登记 `mobile-nav.tsx`（一条具体理由），基线 25 → 27。
 *
 * 2026-11-19（Task 0020 · P2）**再涨 1**：消息导航竖条的刻度（`views/message-rail.tsx`）。
 * 它是轨道上的"刻度"本身——高度由内容量算出来、宽度随悬停在两档间过渡、整条轨道有几十个同类节点。
 * `MicroButton` 的内距（`px-1.5 py-0.5` + 文字）装不下"一条可变高的空竖线"，硬套会把刻度挤成按钮形状。
 * 基线 27 → 28。
 *
 * 这是两条"涨"，每条都写清了理由：任何再涨都要在这里写出同样的具体理由，否则不许改。
 *
 * 2026-11-23（Task 0023 · S1 第 2 块）**再涨 4**（28 → 32），四条理由都已写进
 * `lint-primitives.mjs` 的 ALLOW：① stories 头像环（avatar 套 ring + 名字，aria-pressed）
 * —— ToggleChip 的 border 模型装不下头像环；② 月历格（热力四档底色数据格）；
 * ③ 卡片动作行的四等分（flex-1）行内动作。均为首次出现、无既有 primitive 能承接；
 * 可改用 primitive 的都已改（月切换 → IconButton、项目行 → ClickableRow、筛选 chip → MicroButton）。
 */
const BASELINE = 32;

test("自绘总数不超过基线（只许降不许升）", () => {
  const total = [...countButtons().values()].reduce((a, b) => a + b, 0);
  console.log(`  当前自绘 <button>：${total}（基线 ${BASELINE}，起点 70）`);
  assert.ok(total <= BASELINE, `自绘控件涨到 ${total}（基线 ${BASELINE}）——新增自绘必须改用 primitive`);
});

test("收敛成果：自绘总数 ≤ 降一个量级的目标（70 → ≤32；2026-11-23 工作台四条，理由见 BASELINE 注释）", () => {
  const total = [...countButtons().values()].reduce((a, b) => a + b, 0);
  assert.ok(total <= 32, `自绘 ${total} 处，超过目标（≤32；四条涨的理由见 BASELINE 注释）`);
});

test("MicroButton / ClickableRow 已成为 design/ 的 primitive（收敛的落点存在）", () => {
  const ui = readFileSync(join(SRC, "design/ui.tsx"), "utf8");
  assert.ok(/export function MicroButton/.test(ui), "缺 MicroButton");
  assert.ok(/export function ClickableRow/.test(ui), "缺 ClickableRow");
});
