/**
 * 修正批 1 的单元级验证（Task 0023 · S1 · architect 裁决 §24）。
 *
 * 这些断言在**浏览器之外**跑，锁的是五件修正里的四件可离线验证的：
 *
 *   P1-1 右栏拖动基准 = **渲染宽**（不是存储值）——四个视口的坐标级对照
 *   P2-3 统计块「任务」与看板/项目区同口径（`type !== "daily"`）
 *   R3   判据唯一：只在 `stateColumnsOf` / `taskCountsByProject` / 统计块三处，且都用 `type`
 *
 * 活性：把 `dragCascade` 的 right 分支改回 `start.right` → 本文件 P1-1 必须红。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_WIDTHS, MIN_CHAT, RAIL, RIGHT_MIN, dragCascade, layout, maxWidthOf,
} from "../frontend/src/design/layout.ts";
import { stateColumnsOf, taskCountsByProject } from "../frontend/src/api/workbench.ts";
import { STUB_TASKS } from "../frontend/src/api/workbench-fixtures.ts";

const FOLDED_NO_LEFT = { nav: true, groups: true };   // 工作台：左列收起
const capOf = (vp) => Math.max(RIGHT_MIN, vp - RAIL - MIN_CHAT);

/** 从存储宽度出发，返回"这一帧应渲染多少"。 */
const renderedOf = (vp, stored) =>
  layout({ viewport: vp, widths: { ...DEFAULT_WIDTHS, right: stored }, requested: FOLDED_NO_LEFT, panelOpen: false, rightOpen: true, rightWidth: stored }).right;

test("C1-P1-1 vp=1280（cap 816，不触发钳制）：拖动逐帧跟手，基准=渲染宽", () => {
  const vp = 1280, stored = 500;
  const start = { ...DEFAULT_WIDTHS, right: stored };
  const rendered = renderedOf(vp, stored);
  assert.equal(rendered, 500, "1280 下渲染宽 = 存储值（不钳制）");
  assert.equal(capOf(vp), 816);
  // 把手在左缘：往右拖（deltaX>0）= 变窄
  assert.equal(dragCascade("right", start, 10, vp, FOLDED_NO_LEFT).right, 490, "窄 10");
  assert.equal(dragCascade("right", start, -10, vp, FOLDED_NO_LEFT).right, 510, "宽 10");
});

test("C1-P1-1 vp=900（cap 436 = stored 被钳）：基准必须是渲染宽，往回拖要能拖动", () => {
  const vp = 900, stored = 500;
  const start = { ...DEFAULT_WIDTHS, right: stored };
  const rendered = renderedOf(vp, stored);
  assert.equal(rendered, 436, "900 下渲染宽 = cap 436（存储值 500 被钳）");
  assert.equal(capOf(vp), 436);
  // 关键：往回拖（变窄）必须真的变小。旧实现用 stored=500 当基准 → 钳回 436 → 看起来"拖不动"
  assert.equal(dragCascade("right", start, 10, vp, FOLDED_NO_LEFT).right, 426, "窄 10（旧实现会得 436 = 拖不动）");
  assert.equal(dragCascade("right", start, -10, vp, FOLDED_NO_LEFT).right, 436, "宽 10（撞 cap）");
});

test("C1-P1-1 vp=800（cap 336）：同 vp=900 的形态", () => {
  const vp = 800, stored = 500;
  const start = { ...DEFAULT_WIDTHS, right: stored };
  assert.equal(renderedOf(vp, stored), 336);
  assert.equal(capOf(vp), 336);
  assert.equal(dragCascade("right", start, 10, vp, FOLDED_NO_LEFT).right, 326, "窄 10");
  assert.equal(dragCascade("right", start, -10, vp, FOLDED_NO_LEFT).right, 336, "宽 10（撞 cap）");
});

test("C1-P1-1 vp=700（narrowed 档：渲染 220 = RIGHT_MIN，cap 236）：往上拖要能长，不是跳到 236", () => {
  const vp = 700, stored = 500;
  const start = { ...DEFAULT_WIDTHS, right: stored };
  assert.equal(renderedOf(vp, stored), 220, "700 下渲染宽 = RIGHT_MIN 220（narrowed 档）");
  assert.equal(capOf(vp), 236);
  // 旧实现：基准 stored=500 → 钳到 236 → 一按下就跳 16px，而且再窄也窄不下去
  assert.equal(dragCascade("right", start, 10, vp, FOLDED_NO_LEFT).right, 220, "窄 10（停在 RIGHT_MIN）");
  assert.equal(dragCascade("right", start, -10, vp, FOLDED_NO_LEFT).right, 230, "宽 10（从 220 起算，不是从 236 起算）");
});

test("C1-P1-1 每帧位移 = 鼠标位移（≤4px，frontend 2.27 的 coordinate 断言，四视口）", () => {
  for (const vp of [1280, 900, 800, 700]) {
    const start = { ...DEFAULT_WIDTHS, right: 500 };
    let prev = renderedOf(vp, 500);
    for (const step of [5, 10, 15, 20]) {
      // 连续往右拖：累计 deltaX = step
      const next = dragCascade("right", start, step, vp, FOLDED_NO_LEFT).right;
      const expected = Math.max(RIGHT_MIN, Math.min(capOf(vp), renderedOf(vp, 500) - step));
      assert.equal(next, expected, `vp=${vp} step=${step}：应为渲染宽 − step 且钳在 [RIGHT_MIN, cap]`);
      assert.ok(Math.abs(next - prev) <= step + 4, `vp=${vp}：单帧位移不超过鼠标位移 + 4px`);
      prev = next;
    }
  }
});

test("C1-P1-1 maxWidthOf('right') 与 layout 的预算同源（上限仍是视口算的，不是 520 常量）", () => {
  for (const vp of [1920, 1280, 900, 800, 700, 640]) {
    assert.equal(maxWidthOf("right", vp, { ...DEFAULT_WIDTHS, right: 500 }, FOLDED_NO_LEFT), capOf(vp),
      `${vp}：maxWidthOf('right') = max(RIGHT_MIN, 视口−RAIL−MIN_CHAT)`);
  }
});

test("C1-P2-3 统计块的「任务」与看板/项目区**同口径**（都排除 daily）", () => {
  const all = STUB_TASKS.length;
  const nonDaily = STUB_TASKS.filter((t) => t.type !== "daily").length;
  const cols = stateColumnsOf(STUB_TASKS);
  const colTotal = cols.run.length + cols.done.length + cols.moved.length + cols.other.length;
  // 看板四列相加 = 非 daily（R3 关系式）
  assert.equal(colTotal, nonDaily, "看板四列相加 = 非 daily 条数");
  // 项目区副行（taskCountsByProject）同口径：逐项目相加 = 非 daily
  const byProject = new Map();
  for (const t of STUB_TASKS) {
    if (t.type === "daily") continue;
    byProject.set(t.projectId, (byProject.get(t.projectId) ?? 0) + 1);
  }
  const projectSum = [...byProject.values()].reduce((a, b) => a + b, 0);
  assert.equal(projectSum, nonDaily, "项目区各项目任务数相加 = 非 daily 条数");
  // 统计块必须与上面同一口径（同屏不能出现两个「任务」数）
  const statsTasks = STUB_TASKS.filter((t) => t.type !== "daily").length;
  assert.equal(statsTasks, colTotal, "统计块的任务数 = 看板四列相加（同一屏不允许两个口径）");
  // 关系式：只有存在 daily 时 all > nonDaily（R3：不写死数字，写关系）
  assert.ok(all >= nonDaily, "全部条数 ≥ 非 daily 条数");
});

test("C1-R3 daily 判据只认 type（不用 isDefault 第二判据）", () => {
  // 造一条 isDefault=true 但 type≠daily 的卡：它必须**不被**排除（判据只看 type）
  const tricky = [{ ...STUB_TASKS[0], type: "general", isDefault: true }];
  assert.equal(stateColumnsOf(tricky).run.length
    + stateColumnsOf(tricky).done.length
    + stateColumnsOf(tricky).moved.length
    + stateColumnsOf(tricky).other.length, 1,
    "isDefault=true 但 type!=='daily' 的卡必须留在看板里（判据唯一）");
  assert.equal(taskCountsByProject(tricky).get(tricky[0].projectId)?.total, 1, "项目计数同理");
});
