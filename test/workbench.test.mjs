/**
 * 工作台数据层的契约测试（Task 0023 · S1）。
 *
 * 这些断言在**浏览器之外**跑（node --test），锁的是：
 * 1. 桩纪律（STUB 只在 fixtures；S4 归零的度量在这）；
 * 2. 契约形状（at 全 Z 结尾 / documents·todos 是空数组不是省略 / kind 缺失是合法输入）；
 * 3. R3：断言只写关系（排除 daily 用 type，卡数相加等于非 daily 条数）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  STUB_FEED, STUB_TASKS, STUB_PROJECTS, STUB_DAYS, allAtAreUtc,
} from "../frontend/src/api/workbench-fixtures.ts";

const ROOT = process.cwd();

test("S1-W1 桩数据只住在 workbench-fixtures.ts（grep 度量，S4 归零）", () => {
  // 这条断言**现在的值**写进输出，便于 architect 追踪下降曲线；但断言本身只锁"范围"。
  const files = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(f.name)) continue;
      const text = readFileSync(p, "utf8");
      if (/STUB:/.test(text)) files.push(p.replace(ROOT + "/", ""));
    }
  };
  walk(join(ROOT, "frontend/src"));
  for (const f of files) {
    assert.ok(f.endsWith("workbench-fixtures.ts"), `STUB: 出现在 ${f}——假数据只允许住在 workbench-fixtures.ts`);
  }
  console.log(`  → STUB: 当前 ${files.length} 个文件（S4 目标 0）`);
});

test("S1-W2 R1：桩里所有 at 都以 Z 结尾（时区明确的时刻，不是本地字面字符串）", () => {
  assert.equal(allAtAreUtc(STUB_DAYS), true, "存在不以 Z 结尾的 at");
});

test("S1-W3 R1：log 条目的 at 形态是本地零点的 UTC（…T16:00:00.000Z），不是 T00:00:00", () => {
  const logs = STUB_DAYS.flatMap((d) => d.activity).filter((a) => a.kind === "log");
  assert.ok(logs.length > 0, "夹具里应有 log 条目");
  for (const a of logs) {
    assert.match(a.at, /T16:00:00\.000Z$/, `log 的 at 应为 …T16:00:00.000Z（实际 ${a.at}）`);
  }
});

test("S1-W4 R1：session 条目的 at 形态不是本地零点（与 log 可区分）", () => {
  const sessions = STUB_DAYS.flatMap((d) => d.activity).filter((a) => a.kind === "session");
  assert.ok(sessions.length > 0);
  for (const a of sessions) {
    assert.doesNotMatch(a.at, /T16:00:00\.000Z$/, "session 的 at 不应长得像 log 的本地零点");
  }
});

test("S1-W5 R1：documents / todos 是空数组字段（不是省略字段）——S1 契约要求前端能区分", () => {
  for (const d of STUB_DAYS) {
    assert.ok(Array.isArray(d.documents), `documents 应是数组（${d.date}）`);
    assert.ok(Array.isArray(d.todos), `todos 应是数组（${d.date}）`);
    assert.deepEqual(d.documents, [], "S1 里 documents 恒为空");
    assert.deepEqual(d.todos, [], "S1 里 todos 恒为空");
  }
});

test("S1-W6 R3：排除 daily 的唯一判据是 type==='daily'；看板卡数关系可从桩推出", () => {
  // 这两条"今天同值"，但判据只用 type（不用 isDefault）——写在这里作为契约提醒
  const nonDaily = STUB_TASKS.filter((t) => t.type !== "daily");
  const byState = { run: 0, done: 0, move: 0, other: 0 };
  for (const t of nonDaily) {
    if (t.state === "进行中") byState.run += 1;
    else if (t.state === "已完成") byState.done += 1;
    else if (t.state === "已移交") byState.move += 1;
    else byState.other += 1;
  }
  assert.equal(byState.run + byState.done + byState.move + byState.other, nonDaily.length,
    "四列卡数相加必须等于非 daily 条数（R3 关系式）");
  // 桩里必须有一张"其他"（R4 活性验证的数据源）
  assert.ok(byState.other > 0, "桩里应有 state='其他' 的卡（R4 尾部组的数据源）");
});

test("S1-W7 R4：桩里「其他」卡必须带原文 status（否则用户分不清已作废和写错）", () => {
  const others = STUB_TASKS.filter((t) => t.state === "其他");
  for (const t of others) {
    assert.ok(t.status.length > 0 && t.status !== "其他", `「其他」卡的原文 status 应有内容（${t.id}）`);
  }
});

test("S1-W8 R3：项目条数关系——每个项目的 agentIds 非空（N 位助手的来源）", () => {
  for (const p of STUB_PROJECTS) {
    assert.ok(Array.isArray(p.agentIds) && p.agentIds.length > 0, `agentIds 应非空（${p.id}）`);
  }
});

test("S1-W9 architect 回应③：kind 缺失是合法输入（桩里必须有一条无 kind 的卡）", () => {
  const noKind = STUB_FEED.filter((f) => f.kind === undefined);
  assert.ok(noKind.length > 0, "桩里应有一条 kind 缺失的卡（渲染层 fallback 的数据源）");
});

test("S1-W10 R3：桩条目必须带 _stub: true（界面显式标「示例」的依据）", () => {
  for (const f of STUB_FEED) {
    assert.equal(f._stub, true, `桩卡 ${f.id} 应带 _stub 标记`);
  }
});

/* ════════════════ 前端纯函数（第 2 块：页面骨架的行为层）════════════════ */

import {
  calendarCellsOf, dayLevelOf, groupFeedByDay, filterFeedOf,
  stateColumnsOf, taskCountsByProject, dayLabelOf, monthRangeOf, todayLocal,
} from "../frontend/src/api/workbench.ts";

test("S1-W11 本地日期口径与后端同一条（src/tasks.ts:123 localDate：本地时区切日）", () => {
  // 东八区 2026-11-23 01:00 本地 = 2026-11-22T17:00Z：UTC 切日会说成 22，本地必须是 23
  const fakeNow = new Date("2026-11-22T17:00:00.000Z");
  const local = new Date(fakeNow.getTime() + 8 * 3600_000);
  assert.equal(todayLocal(local), "2026-11-23");
});

test("S1-W12 monthRange：含两端、本地月的第一天到最后一天", () => {
  assert.deepEqual(monthRangeOf(2026, 10), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(monthRangeOf(2024, 1), { from: "2024-02-01", to: "2024-02-29" });  // 闰年
});

test("S1-W13 热力四档 = Memos 相对阈值（count/max 的 .25/.5/.75）", () => {
  assert.equal(dayLevelOf(0, 10), 0);
  assert.equal(dayLevelOf(2, 10), 1);    // 0.2 ≤ 0.25
  assert.equal(dayLevelOf(3, 10), 2);    // 0.3 ∈ (0.25, 0.5]
  assert.equal(dayLevelOf(6, 10), 3);    // 0.6 ∈ (0.5, 0.75]
  assert.equal(dayLevelOf(8, 10), 4);    // 0.8 > 0.75
  assert.equal(dayLevelOf(10, 10), 4);
  assert.equal(dayLevelOf(5, 0), 0);     // max=0（全空月）不炸
});

test("S1-W14 月历网格：周一开头、补位到整行、格子数 = 当月天数 + 前导", () => {
  // 2026-11-01 是周日 → 周一开头的前导 = 6；30 天 → 6+30=36 → 6 行 = 42 格
  const cells = calendarCellsOf(2026, 10, STUB_DAYS, "2026-11-22");
  assert.equal(cells.length, 42);
  assert.equal(cells[0].date, null);
  assert.equal(cells[6].date, "2026-11-01");
  // 归日只认 Day.date：STUB_DAYS 的 11-22 有 3 条 → 该格 count=3
  const d22 = cells.find((c) => c.date === "2026-11-22");
  assert.equal(d22?.count, 3);
  assert.equal(d22?.isToday, true);
});

test("S1-W15 feed 分组：保持输入顺序、相邻同日合并（不做当天内折叠——边界 #9）", () => {
  const groups = groupFeedByDay(STUB_FEED);
  assert.deepEqual(groups.map((g) => g.day), ["2026-11-22", "2026-11-21"]);
  assert.equal(groups[0].items.length, 3);
});

test("S1-W16 feed 筛选：动态=全部（kind 缺失也是动态，渲染层 fallback）/待办 S1 恒空 × 作者（me 按 kind=user）", () => {
  assert.equal(filterFeedOf(STUB_FEED, "all", undefined).length, STUB_FEED.length);
  // kind 缺失的卡（stub-4）也是「动态/笔记」（只是渲染降级），不得落到待办
  assert.equal(filterFeedOf(STUB_FEED, "post", undefined).length, STUB_FEED.length);
  assert.equal(filterFeedOf(STUB_FEED, "todo", undefined).length, 0);
  // 我 = author.kind === "user"（不是 id 字符串猜）
  assert.equal(filterFeedOf(STUB_FEED, "all", "me").every((f) => f.author.kind === "user"), true);
  assert.equal(filterFeedOf(STUB_FEED, "all", "me").length, STUB_FEED.filter((f) => f.author.kind === "user").length);
  // 具体作者
  assert.equal(filterFeedOf(STUB_FEED, "all", "coder").every((f) => f.author.id === "coder"), true);
});

test("S1-W17 看板四列：排除 daily 只判 type；四列相加 = 非 daily 条数（R3 关系）", () => {
  const columns = stateColumnsOf(STUB_TASKS);
  const sum = columns.run.length + columns.done.length + columns.moved.length + columns.other.length;
  const nonDaily = STUB_TASKS.filter((t) => t.type !== "daily").length;
  assert.equal(sum, nonDaily);
  assert.equal(columns.other.length, 1);          // 桩里唯一「其他」= 0005 已作废
  assert.equal(columns.other[0].status.includes("已作废"), true);  // 原文保留（R4）
});

test("S1-W18 项目计数：running 只数进行中、total 只数非 daily（与看板同口径）", () => {
  const counts = taskCountsByProject(STUB_TASKS);
  const lifeos = counts.get("lifeos");
  assert.equal(lifeos?.total, STUB_TASKS.filter((t) => t.projectId === "lifeos" && t.type !== "daily").length);
  assert.equal(lifeos?.running, STUB_TASKS.filter((t) => t.projectId === "lifeos" && t.type !== "daily" && t.state === "进行中").length);
});

test("S1-W19 日期分隔文案：今天/昨天/M月D日（跨年补年份）", () => {
  assert.equal(dayLabelOf("2026-11-22", "2026-11-22"), "今天");
  assert.equal(dayLabelOf("2026-11-21", "2026-11-22"), "昨天");
  assert.equal(dayLabelOf("2026-11-01", "2026-11-22"), "11月1日");
  assert.equal(dayLabelOf("2025-12-31", "2026-11-22"), "2025年12月31日");
});
