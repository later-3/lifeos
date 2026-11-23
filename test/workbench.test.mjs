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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
  // 关系：每组的天 = 输入里**相邻去重**的天序列；每组条数 = 该天在原顺序里的连续段长
  const expectedDays = [];
  let last;
  for (const item of STUB_FEED) {
    if (item.day !== last) { expectedDays.push(item.day); last = item.day; }
  }
  assert.deepEqual(groups.map((g) => g.day), expectedDays);
  // 合并后总条数守恒（不丢不重）
  assert.equal(groups.reduce((sum, g) => sum + g.items.length, 0), STUB_FEED.length);
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

/* ════════════════ 第 4 块：卡型与媒体网格（纯函数）════════════════ */

import {
  FEED_KIND_META, kindMetaOf, mediaTierOf, mediaCellClassOf, mediaFrameClassOf,
  visibleMediaOf, chartBarsOf, progressPercentOf, textClampedOf, reviewSummaryOf, MEDIA_GRID_CLASS,
} from "../frontend/src/api/feed-cards.ts";

test("S1-W20 契约 §4：媒体网格 5 档（1/2/3/4/5+）", () => {
  assert.equal(mediaTierOf(0), undefined);
  assert.equal(mediaTierOf(1), "n1");
  assert.equal(mediaTierOf(2), "n2");
  assert.equal(mediaTierOf(3), "n3");   // 1 大 2 小
  assert.equal(mediaTierOf(4), "n4");   // 2×2
  assert.equal(mediaTierOf(5), "nmany");
  assert.equal(mediaTierOf(12), "nmany");
});

test("S1-W21 三格 = 1 大 2 小（首图跨两行两列，其余两格），四格 = 2×2，5+ = 三列 +N", () => {
  assert.equal(mediaCellClassOf("n3", 0), "col-span-3 row-span-2");
  assert.equal(mediaCellClassOf("n3", 1), "col-span-2");
  const { shown, overflow } = visibleMediaOf([1, 2, 3, 4, 5, 6]);
  assert.equal(shown.length, 4);        // 5+ 只画前 4 格
  assert.equal(overflow, 2);            // 其余折成 +N
  assert.equal(visibleMediaOf([1, 2, 3]).overflow, 0);
});

test("S1-W22 媒体网格类：每档都有真实 grid 定义，且不锁 16:9 的只有 nmany", () => {
  for (const tier of ["n1", "n2", "n3", "n4", "nmany"]) {
    assert.match(MEDIA_GRID_CLASS[tier], /grid/, `${tier} 必须是 grid`);
  }
  assert.equal(mediaFrameClassOf("n1"), "aspect-video");
  assert.equal(mediaFrameClassOf("nmany"), "");   // 三列每格 1:1，不锁整体比例
});

test("S1-W23 卡型 chip：8 kind 都有显示名；未知/缺失走中性（不编色相）", () => {
  for (const kind of ["dev", "demo", "knowledge", "case", "review", "mood", "study", "media"]) {
    assert.ok(FEED_KIND_META[kind].label.length > 0, `${kind} 缺 label`);
    assert.ok(FEED_KIND_META[kind].chip.includes("bg-"), `${kind} 缺 chip 类`);
  }
  // study / media 契约标「待定」：不编色相 → 与未知 kind 同一档中性 chip
  assert.equal(kindMetaOf("study").chip, kindMetaOf(undefined).chip);
  assert.equal(kindMetaOf("media").chip, kindMetaOf(undefined).chip);
  // 六个有契约色相的 kind，chip 必须引用 feed token（不许裸色板）
  for (const kind of ["dev", "demo", "knowledge", "case", "review", "mood"]) {
    assert.match(kindMetaOf(kind).chip, /feed-/, `${kind} 的 chip 必须用 --color-feed-* 派生的类`);
  }
  assert.equal(kindMetaOf(undefined).label, "动态");
});

test("S1-W24 图表柱高：第三元已是百分比（不归一到最大值）；muted 是下标列表，不是「值为 0」", () => {
  // 契约 §3：`bars: [["P0",0,12],…], muted: [0,3]` —— 第三个是 heightPercent，muted 标"这几根不强调"
  const bars = chartBarsOf([["P0", 0, 12], ["P1", 2, 26], ["质量", 2, 42], ["功能", 0, 12]], [0, 3]);
  assert.deepEqual(bars.map((bar) => bar.percent), [12, 26, 42, 12]);   // 原样，不缩放
  assert.equal(bars[0].muted, true);     // 下标 0 在 muted 里
  assert.equal(bars[1].muted, false);    // 1 不在
  assert.equal(bars[3].muted, true);
  // 值为 0 但没被标 muted → 不是灰柱（语义不被数值偷换）；越界钳到 0–100
  const notMuted = chartBarsOf([["A", 0, 0], ["B", 9, 260], ["C", 1, -30]], []);
  assert.equal(notMuted[0].muted, false);
  assert.deepEqual(notMuted.map((bar) => bar.percent), [0, 100, 0]);
});

test("S1-W25 进度百分比：0–1 收敛到 0–100，缺失/越界不炸", () => {
  assert.equal(progressPercentOf(0.7), 70);
  assert.equal(progressPercentOf(1), 100);
  assert.equal(progressPercentOf(undefined), 0);
  assert.equal(progressPercentOf(2), 100);
  assert.equal(progressPercentOf(-1), 0);
  assert.equal(progressPercentOf(Number.NaN), 0);
});

test("S1-W26 契约 §5：有图卡正文两行截断；检视闭环文案 closed/total", () => {
  assert.equal(textClampedOf(0), false);
  assert.equal(textClampedOf(1), true);
  assert.equal(reviewSummaryOf({ closed: 2, total: 2, note: "检视闭环" }), "检视闭环 2/2");
  assert.equal(reviewSummaryOf({ closed: 1, total: 3 }), "检视 1/3");
});

test("S1-W27 桩覆盖契约 §2 的 8 kind + kind 缺失，并覆盖 §4 的全部 5 档媒体", () => {
  const kinds = new Set(STUB_FEED.map((item) => item.kind));
  for (const kind of ["dev", "demo", "knowledge", "case", "review", "mood", "media"]) {
    assert.ok(kinds.has(kind), `桩里缺 kind=${kind}（契约 §2 的卡型要能被看见）`);
  }
  assert.ok(STUB_FEED.some((item) => item.kind === undefined), "桩里必须有一条 kind 缺失（回应③）");
  // study 契约标「预留」：S1 不做它的专属块，桩里不必须有
  const tiers = new Set(STUB_FEED.map((item) => mediaTierOf((item.media ?? []).length)));
  for (const tier of ["n1", "n2", "n3", "n4", "nmany"]) {
    assert.ok(tiers.has(tier), `桩里缺媒体档 ${tier}（契约 §4 的 5 档要都能被看见）`);
  }
});

test("S1-W28 桩块覆盖契约 §3 的三类 blocks 与 refs 的全部字段", () => {
  const blocks = STUB_FEED.flatMap((item) => item.blocks ?? []);
  for (const type of ["code", "diagram", "chart"]) {
    assert.ok(blocks.some((block) => block.type === type), `桩里缺 block=${type}`);
  }
  // refs：project / task / worktree / review / docs 都要有（session/knowledge/case S1 无数据源）
  assert.ok(STUB_FEED.some((item) => item.projectId !== undefined));
  assert.ok(STUB_FEED.some((item) => item.task !== undefined));
  assert.ok(STUB_FEED.some((item) => item.worktree !== undefined));
  assert.ok(STUB_FEED.some((item) => item.review !== undefined));
  assert.ok(STUB_FEED.some((item) => item.docs !== undefined));
  assert.ok(STUB_FEED.some((item) => item.likers !== undefined && item.likers.length > 0));
});
/* ════════════════ 修正批 1：P2-2 徽标机制 / P1-3 ink-300 禁承载文字 ════════════════ */

test("S1-W29 P2-2：「示例」徽标由 _stub 驱动（正反两条），不是无条件渲染", () => {
  // 正：桩条目必须有 _stub: true（渲染层据此出徽标）
  for (const item of STUB_FEED) {
    assert.equal(item._stub, true, `桩卡 ${item.id} 缺 _stub —— 徽标就不会出现`);
  }
  // 反：**渲染层必须条件渲染**。这条防的是 reviewer 抓到的"两条断言各自为真、合起来假绿"：
  //   旧实现无条件 <StubBadge />，而 FeedItem 连 _stub 都没有 —— S2 的真卡也会戴「示例」。
  const source = readFileSync(join(ROOT, "frontend/src/views/workbench-feed.tsx"), "utf8");
  const badgeLines = source.split("\n").filter((line) => line.includes("<StubBadge />"));
  assert.equal(badgeLines.length, 1, "StubBadge 只应有一处渲染点");
  assert.ok(badgeLines[0].includes("item._stub === true"),
    `StubBadge 必须条件渲染（实际：${badgeLines[0].trim()}）—— 无条件渲染会让 S2 真卡也戴「示例」`);
  // 类型层：_stub 只允许 true（语义是"这是桩"，不是布尔开关）
  const types = readFileSync(join(ROOT, "frontend/src/api/workbench.ts"), "utf8");
  assert.ok(/_stub\?: true/.test(types), "FeedItem._stub 的类型必须是 `?: true`");
});

test("S1-W30 P1-3：工作台新代码不得用 ink-300 承载文字（tokens.css 明文禁止；axe 实测 2.3:1）", () => {
  /*
   * tokens.css 头注原文：ink-300 只允许用于分隔线、图标、占位装饰，禁止承载文本。
   * 允许的用法（规范明说）：图标 / 装饰箭头 / 边框 / 悬停底 / 柱状图底。
   * 不许的：任何元素包着用户要读的字段（编号、日期、时刻、空态文案）用 text-ink-300。
   *
   * 判据（可复核、不靠人眼）：逐行找 text-ink-300，若同一行没有 aria-hidden
   * 且不是在画图标/边框/底色 → 记违规。白名单只放**已确认的装饰**，每条写理由。
   */
  /*
   * 白名单按**内容片段**匹配，不按行号 —— 行号会因为上面加注释而整体下移，
   * 白名单就悄悄指到别的行上（这条测试自己第一次就踩了：写 `:102`，加了 2 行注释后真实行是 104）。
   */
  const ALLOW_SNIPPETS = [
    // 媒体占位框：这一格**只有一个图标**（AppIcon），没有任何文字；ink-300 是规范允许的"占位装饰"
    "overflow-hidden bg-hover text-ink-300",
  ];
  const files = [
    "frontend/src/views/workbench.tsx",
    "frontend/src/views/workbench-feed.tsx",
    "frontend/src/views/workbench-projects.tsx",
    "frontend/src/views/workbench-calendar.tsx",
    "frontend/src/views/workbench-failure.tsx",
  ];
  const offenders = [];
  for (const rel of files) {
    const lines = readFileSync(join(ROOT, rel), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!line.includes("text-ink-300")) return;
      const key = `${rel}:${index + 1}`;
      if (ALLOW_SNIPPETS.some((snippet) => line.includes(snippet))) return;
      if (line.includes("aria-hidden")) return;   // 纯装饰（箭头 / 图标容器）
      offenders.push(`${key} ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(offenders, [], `ink-300 承载了文字（改 ink-500/ink-700）：\n${offenders.join("\n")}`);
});

test("S1-W31 P1-3：「+N」头像堆叠的底不得是 ink-300 配白字（2.3:1）", () => {
  const source = readFileSync(join(ROOT, "frontend/src/views/workbench-projects.tsx"), "utf8");
  const line = source.split("\n").find((text) => text.includes("+{rest}") || text.includes("rounded-full bg-ink-"));
  assert.ok(line !== undefined, "找不到「+N」角标");
  // 角标是白字：底必须与白字 ≥4.5（ink-500 白字 4.83）；ink-300 白字只有 2.3
  const badgeLine = source.split("\n").find((text) => text.includes("font-semibold text-white") && text.includes("rounded-full"));
  assert.ok(badgeLine !== undefined, "找不到「+N」角标那一行");
  assert.ok(!badgeLine.includes("bg-ink-300"),
    `「+N」角标不能压在 ink-300 上（白字只有 2.3:1）：${badgeLine.trim().slice(0, 100)}`);
});

test("S1-W32 Tabs 在窄容器不折行（nowrap / block 等分 truncate / 非 block 横滚）", () => {
  /*
   * reviewer 实测 390 宽：`动态 / 笔记` 折成两行 → 整条 tab 行高度从 44 变成两倍，
   * 而 44 是命中区契约的一部分（mobile.md §3）。修法按 architect 要求收敛在 **primitive 一处**
   * （frontend 2.20：不在工作台单独加样式）。
   *
   * **这条断言曾经是装饰性的**（案例 C314，architect 抓到）：
   * 旧写法 `assert.ok(/\.length > 0/.test("x.length > 0") && tabs.includes("truncate"))`
   * —— 左边对**字面量**做正则、**永远为真**，于是"锁了两件事"其实只锁了一件。
   * 实测：把 block 分支从 `min-w-0 flex-1` 改成 `""`，这条断言仍然绿（它声称要锁的正是那个失效）。
   *
   * 现在每条都断言**被测代码里的真实字面量**，且各自独立成行（一条失败不会掩盖另一条）。
   */
  const ui = readFileSync(join(ROOT, "frontend/src/design/ui.tsx"), "utf8");
  const raw = ui.slice(ui.indexOf("export function Tabs"), ui.indexOf("export function Segmented"));
  assert.ok(raw.length > 0, "没截到 Tabs 的源码（切片边界变了？）——先确认测到了东西");
  /*
   * **必须剥掉注释行再断言**（第二次踩：注入 `block ? "" : "shrink-0"` 后这条**仍然绿**，
   * 因为函数头注释里本来就写着 `min-w-0 flex-1` —— 断言匹配到了注释而不是代码）。
   * 这与 C314 同族：**匹配到了不该匹配的东西**，只是方向相反（那次是恒真、这次是匹配错位）。
   */
  const tabs = raw.split("\n").filter((line) => {
    const t = line.trimStart();
    return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
  }).join("\n");
  // ① 文案永不折行（按钮上）
  assert.ok(tabs.includes("whitespace-nowrap"), "Tabs 的按钮必须 whitespace-nowrap（文案永不折行）");
  // ② block（等分）时：宽度不够用省略号，不靠换行撑高
  assert.ok(tabs.includes("min-w-0 flex-1"), "block 等分分支必须是 `min-w-0 flex-1`（缺 min-w-0 时 truncate 不生效）");
  assert.ok(tabs.includes("truncate"), "block 等分时必须 truncate（宽度不够用省略号，不撑高）");
  // ③ 非 block（自然宽）时：整条可横向滚，高度不变
  assert.ok(tabs.includes("shrink-0"), "非 block 时按钮必须 shrink-0（不被压窄到折行）");
  assert.ok(tabs.includes("overflow-x-auto"), "非 block（自然宽）时整条 tablist 必须可横向滚，高度不变");
  // ④ 高度是命中区契约：容器与按钮都必须是 h-11（44）
  assert.ok((tabs.match(/h-11/g) ?? []).length >= 2, "Tabs 容器与按钮都要 h-11（44 命中区）");
});

test("S1-W33 测试自己不许出现「正则对字面量」这种恒真断言（C314 的族）", () => {
  /*
   * C314 的形态：断言看起来锁了东西，其实左边对**源码里的字符串常量**做匹配 —— 永远 true。
   * 它在 1765 条绿里没有任何信号，只有人工注入才暴露。
   *
   * 判据（便宜、可静态查）：同一行里出现 `<正则>.test("<字面量>")` 就是这种写法。
   * 允许的形式只有 `xxx.test(source)` 这种"变量进正则"（source 来自 readFileSync）。
   */
  const files = ["test/workbench.test.mjs", "test/workbench-fix1.test.mjs"];
  const offenders = [];
  for (const rel of files) {
    readFileSync(join(ROOT, rel), "utf8").split("\n").forEach((line, index) => {
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
      // 正则字面量紧跟 .test("  → 恒真
      if (/\/[gimsuy]*\.test\(\s*"/.test(line)) offenders.push(`${rel}:${index + 1} ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(offenders, [], `恒真断言（正则对字面量，C314）：\n${offenders.join("\n")}`);
});

/* ════════════════ 修正批 3：R6 阅读宽度（复用同一个设置，不造第二份）════════════════ */

test("S1-W34 R6：内容流套 max-w-reading（复用对话区同一个设置），看板**不套**", () => {
  /*
   * 契约 §R6（用户 2026-11-23 拍板）：内容流是"逐条读"→ 复用对话区的阅读宽度；
   * 看板是"横向扫"→ 不限宽、靠每列最小宽 + 容器横滚。
   *
   * **必须复用同一个变量**：`--container-reading`（= `--container-reading-width`，
   * 由 display-prefs 的 `widthVar()` 写根节点）。这里断言"没有第二份"：
   * 工作台的三个视图文件里不得出现新的宽度设置/存储/变量。
   */
  const feed = readFileSync(join(ROOT, "frontend/src/views/workbench-feed.tsx"), "utf8");
  assert.ok(feed.includes("max-w-reading"), "内容流卡片列必须套 max-w-reading（§R6-1）");
  assert.ok(feed.includes("mx-auto"), "限宽后必须居中（§R6 验收：≤860 且居中）");

  // 看板：不套阅读宽度，但每列要有最小宽 + 容器横滚
  const projects = readFileSync(join(ROOT, "frontend/src/views/workbench-projects.tsx"), "utf8");
  assert.ok(!projects.includes("max-w-reading"), "看板不得套阅读宽度（§R6-3：它是扫不是读）");
  assert.ok(projects.includes("min-w-48"), "看板每列必须有最小宽度（min-w-48 = 192 ≥ 契约的 190）");
  assert.ok(projects.includes("overflow-x-auto"), "看板容器必须可横向滚（不够时不压破）");

  // 「不许新造第二份」：工作台不得出现第二个宽度变量 / 第二个存储键
  for (const rel of ["frontend/src/views/workbench-feed.tsx", "frontend/src/views/workbench-projects.tsx", "frontend/src/views/workbench.tsx"]) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    assert.ok(!/--container-reading-width\s*:/.test(text), `${rel} 不得自己声明阅读宽度变量（§R6-1）`);
    assert.ok(!/localStorage/.test(text), `${rel} 不得自己存宽度（§R6-1：display-prefs 是唯一实现）`);
  }
});

/* ════════════════ 修正批 4：真图 / 详情 / 编辑预览（e2e 第 8、9 条的前置）════════════════ */

test("S1-W35 内容流媒体：真 <img> 渲染（不是占位框），且 URL 指向本地示例图", () => {
  /*
   * e2e 第 8 条的判据是"卡片内 `<img>` 数 ≥1 且 naturalWidth > 0"——
   * 只数到占位 div 是假绿。所以静态层要锁两件：
   * ① 渲染层必须真的输出 `<img>`（不是 `bg-hover` 占位块 + 图标）；
   * ② 桩数据里的 URL 必须指向 `frontend/public/samples/`（本地文件，不是 `/api/attachment`）。
   */
  const feed = readFileSync(join(ROOT, "frontend/src/views/workbench-feed.tsx"), "utf8");
  const mediaGrid = feed.slice(feed.indexOf("function MediaGrid"), feed.indexOf("卡内富块"));
  assert.ok(mediaGrid.includes("<img"), "媒体网格必须渲染真的 <img>（占位框会让 naturalWidth 断言没得测）");
  assert.ok(mediaGrid.includes("object-cover"), "图片必须撑满格子（否则 4:3 原图会撑破 16:9 档）");
  assert.ok(mediaGrid.includes("failureText"), "加载失败要有文案出口（ImageTrigger.failureText）");

  const fixtures = readFileSync(join(ROOT, "frontend/src/api/workbench-fixtures.ts"), "utf8");
  assert.ok(!fixtures.includes("/api/attachment"), "桩媒体不得再用 /api/attachment（那个端点不存在 → 400）");
  const urls = [...fixtures.matchAll(/url: "(\/samples\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(urls.length >= 12, `桩媒体 URL 至少 12 处（实际 ${urls.length}）`);
  for (const url of urls) {
    const file = join(ROOT, "frontend/public", url);
    assert.ok(existsSync(file), `示例图不存在：${url}（缺文件 = 破图，naturalWidth 会是 0）`);
  }
  // 体积纪律（architect：8–12 张、总体积 ≤1MB）
  const unique = [...new Set([...fixtures.matchAll(/url: "\/samples\/([^"]+)"/g)].map((m) => m[1]))];
  const total = unique.reduce((sum, name) => sum + statSync(join(ROOT, "frontend/public/samples", name)).size, 0);
  assert.ok(total <= 1024 * 1024, `示例图总体积 ${Math.round(total / 1024)}KB > 1024KB`);
});

test("S1-W36 动态详情：FeedItem 有 body 字段；卡片正文区可点（且不构成 nested-interactive）", () => {
  const types = readFileSync(join(ROOT, "frontend/src/api/workbench.ts"), "utf8");
  assert.ok(/body\?: string/.test(types), "FeedItem 必须有 body?: string（详情正文，S2 换真）");
  const fixtures = readFileSync(join(ROOT, "frontend/src/api/workbench-fixtures.ts"), "utf8");
  assert.ok(fixtures.includes("body: ["), "桩数据里至少要有详情正文（否则详情浮层是空的）");
  // body 里标题/段落/代码块各至少一处（任务书要求）
  const bodyBlock = fixtures.slice(fixtures.indexOf("body: ["), fixtures.indexOf("body: [") + 2000);
  assert.ok(bodyBlock.includes("# ") && bodyBlock.includes('""') && bodyBlock.includes("```ts"), "桩 body 要含标题/分段/代码块");

  const feed = readFileSync(join(ROOT, "frontend/src/views/workbench-feed.tsx"), "utf8");
  // 打开详情挂在**正文块**（role=button 的兄弟区域），不是卡片根
  assert.ok(feed.includes('data-testid="workbench-feed-card-open"'), "卡片正文区必须有 data-testid=workbench-feed-card-open");
  const articleLine = feed.split("\n").find((line) => line.includes('data-testid="workbench-feed-card"'));
  assert.ok(articleLine !== undefined && !articleLine.includes("onClick"),
    "卡片根不得挂 onClick（媒体/动作行是它的后代，会构成 nested-interactive，frontend 2.25）");
});

test("S1-W37 md 编辑预览：compose 有 编辑/预览 切换，预览用同一个 Markdown 渲染器", () => {
  const compose = readFileSync(join(ROOT, "frontend/src/views/workbench-compose.tsx"), "utf8");
  assert.ok(compose.includes("Segmented"), "切换控件必须是既有 primitive（Segmented），不新造");
  assert.ok(compose.includes('value: "edit"') && compose.includes('value: "preview"'), "必须有编辑/预览两档");
  assert.ok(compose.includes("from \"./message-markdown\""), "预览必须复用对话区的 Markdown（不新写渲染器）");
  assert.ok(compose.includes('data-testid="compose-preview"'), "预览容器要有 testid（e2e 要量实际 DOM）");
  // 内容只在 text 一个 state 里：切档不得清空
  assert.ok(!/setText\(""\)/.test(compose), "切档不得清空正文（setText(\"\") 出现即违规）");
});
