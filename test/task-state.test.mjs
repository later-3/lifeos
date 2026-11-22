// Task 状态归一（S1 契约 §1）：纯函数 + 真实原值穷举。
//
// 断言原则（specs/code/testing 2.5）：断"给定原值 → 得到哪个枚举"，不断言实现细节。
// 夹具里的 42 个原值是 2026-11-22 从真实家目录（135 个 Task）里抄下来的**全部**取值，
// 所以"新写法漏掉"会在这里被抓住；同时这些值会随时间增长，所以断言的是**每条映射规则**
// 而不是"今天一共 42 种"。
import { test } from "node:test";
import assert from "node:assert/strict";
import { TASK_STATES, normalizeTaskState } from "../src/task-state.ts";

// —— 规则 ——

test("S1-1 剥 `**` 强调：`**已完成**（…）` → 已完成（不剥会落「其他」）", () => {
  assert.equal(normalizeTaskState("**已完成**（2026-11-04 合并进 main 并推送，commit `b974bb5`）"), "已完成");
  assert.equal(normalizeTaskState("**已修复**（2026-11-03）"), "已完成");
  assert.equal(normalizeTaskState("进行中（**已合并 main 并推送 `d383744`**；代码在主实例上**尚未生效**）"), "进行中");
});

test("S1-2 取首个词：括号/空白/全半角标点都是分隔符", () => {
  assert.equal(normalizeTaskState("进行中（P1 已验收）"), "进行中");
  assert.equal(normalizeTaskState("已完成（待检视合并）"), "已完成");
  assert.equal(normalizeTaskState("已移交（归属改为 frontend-developer / lifeos）"), "已移交");
  assert.equal(normalizeTaskState("已完成（v1，2026-10-31）"), "已完成");
  assert.equal(normalizeTaskState("已完成（已合并 main = ecca32c）"), "已完成");
  // 半角括号与空格
  assert.equal(normalizeTaskState("已完成 (2026-11-16)"), "已完成");
  // 前后空白不影响
  assert.equal(normalizeTaskState("  进行中  "), "进行中");
});

test("S1-3 `已修复` → 已完成（同一事实：这件事不再需要做）", () => {
  assert.equal(normalizeTaskState("已修复"), "已完成");
  assert.equal(normalizeTaskState("已修复（2026-11-03）"), "已完成");
});

test("S1-4 匹配不上 → 其他（不猜）；空值也落其他", () => {
  for (const raw of ["已作废（2026-11-22，architect 误建，未使用）", "归档", "未知状态", "待开始"]) {
    assert.equal(normalizeTaskState(raw), "其他", `「${raw}」不该被猜成某个已知状态`);
  }
  assert.equal(normalizeTaskState(""), "其他");
  assert.equal(normalizeTaskState("   "), "其他");
  assert.equal(normalizeTaskState(undefined), "其他");
});

test("S1-5 枚举是四个值且顺序稳定（看板列头按它排）", () => {
  assert.deepEqual([...TASK_STATES], ["进行中", "已完成", "已移交", "其他"]);
});

// —— 真实原值穷举（2026-11-22 实测的全部 42 种）——

const REAL_VALUES = [
  ["进行中", 80],
  ["已完成", 14],
  ["已完成（2026-11-16 已合并 main 并推送 `caa655e`；工作区已摘除）", 2],
  ["已作废（2026-11-22，architect 误建，未使用）", 1],
  ["已完成（2026-10-24 用户验收；副本已免停服 cp 同步，规范措辞已修）", 1],
  ["已完成（2026-11-01，回执已交 architect，等其逐条回应）", 1],
  ["进行中（P0 背景已写：现状事实/实测/截图均已落盘；卡在用户对四项决策拍板）", 1],
  ["进行中（P1/P2/S1–S4-a 已验收；S4-h/S4-i/P4/G5/G6/G8/G9/G10/G11/G12/G14/D29/D31/D32 已交付；**G15 md 渲染态 diff 已交付待验**）", 1],
  ["进行中（代码已完成并通过门禁，在独立实例验完，等用户确认后合并 main）", 1],
  ["已完成（2026-11-05 已合并 main 并推送 `7b4c5e6`；主实例 43120 未重启，新代码在下次重启后生效）", 1],
  ["进行中（P1/P2/P3 已实现、验证、**已合并 main 并推送 `2afb397`**；主实例尚未重建，等用户验收）", 1],
  ["进行中（**已合并 main 并推送 `d383744`**；代码在主实例上**尚未生效**，见当前指针的三步）", 1],
  ["已完成（已合入 main 并推送；主实例 43120 待用户重启生效）", 1],
  ["已完成（代码删净、门禁全绿；等用户重建主实例后目视确认）", 1],
  ["已完成（2026-11-19 合并 main 并推送 `e9d14b2`；家目录仓 `96cc780`；两个工作区已摘除）", 1],
  ["进行中（代码与文档已完成、门禁全绿；2 处基线待用户人眼确认后刷新；等用户确认后合并）", 1],
  ["**已完成**（2026-11-04 合并进 main 并推送，commit `b974bb5`）", 1],
  ["**已完成**（2026-11-03 用户实例验收通过，已合并 `fcdbad1` 到 main 并推送 `a6d3de4..fcdbad1`）", 1],
  ["**已完成**（2026-11-04 合并到 main；后续追加状态机重写、场景矩阵、徽标改版，全部已推送）", 1],
  ["**已完成**（2026-11-03 已提交 `9e061be` 并合并 `8eb234d` 到 main；手机端按用户指示不做，已转 todo）", 1],
  ["**已完成**（2026-11-03 合并 `54b5acc` 到 main 并推送 `913c171..54b5acc`）", 1],
  ["**已完成**（2026-11-06 合入 main `7be80dd` 并推送）", 1],
  ["已移交（归属改为 frontend-developer / lifeos）", 1],
  ["已完成（R3 两条缺陷已由 coder 532cf1e 修复，R3b 复跑 37/37 全绿）", 1],
  ["已完成（2026-10-26 用户验收通过；后续视觉微调回此 Task 继续即可）", 1],
  ["已完成（2026-11-02 用户指令提交/合并/推送；已推送 origin/main 69d88ab）", 1],
  ["已完成（评估收束 2026-11-13：单点止血落地于 Task 0014；主题架构执行承接至 Task 0015；讨论材料原地保留，0015 以指针引用）", 1],
  ["已完成（待检视合并）", 1],
  ["已完成（待用户检视合并）", 1],
  ["已完成（2026-11-17 合并推送；P5 量化目标未达成，见 log.md 与 todo#6）", 1],
  ["已完成（2026-11-16 已合入 main · 待用户实机观察）", 1],
  ["已完成（2026-11-17 本 Task 范围内收口；待用户检视 + 合并）", 1],
  ["已完成（P1–P7 + 第九～十三轮修复，门禁全绿，已按用户指令合并推送）", 1],
  ["进行中（第二轮：正式前端开发阶段 · 2026-11-21）", 1],
  ["已移交（本目录仅留指针，不再维护）", 1],
  ["进行中（2026-11-05 笔试阶段，简历已定稿投递）", 1],
  ["进行中（面试：下周二下午，75 分钟，2 位面试官：团队开发负责人 + 一名开发）", 1],
  ["已完成（已合并 main = ecca32c）", 1],
  ["**已完成**（2026-11-02，main 已合并并推送 `55a19c7`）", 1],
  ["**已修复**（2026-11-03）", 1],
  ["进行中（事项表已落，待逐条批复）", 1],
  ["已完成（v1，2026-10-31）", 1],
];

/**
 * 每个原值**按契约规则**应该得到的结果（人工逐条判定，不是从实现反推）。
 *
 * 这里重写一遍"首词"判定，是为了让断言不靠被浏实现：契约说的是
 * 「剥 `**` → 取首词 → 别名表」，所以期望值也必须按这个顺序算出来。
 * 特别注意不能用 `includes("已完成")` —— `进行中（代码已完成并通过门禁…）` 里就含 "已完成"，
 * 那是**正文**里的词，不是状态词（第一版就这么写错过，被自己的用例抓到了）。
 */
const expectedOf = (raw) => {
  const bare = raw.replace(/\*\*/g, "").trim();
  const word = /^[^\s（(，,。；;：:、/]+/.exec(bare)?.[0] ?? "";
  if (word === "进行中" || word === "已完成" || word === "已移交") return word;
  if (word === "已修复") return "已完成";
  return "其他";
};

test("S1-6 真实原值穷举：42 种取值逐条落到预期枚举（`已作废` 之外的都命中）", () => {
  const counts = { 进行中: 0, 已完成: 0, 已移交: 0, 其他: 0 };
  const others = [];
  for (const [raw, weight] of REAL_VALUES) {
    const state = normalizeTaskState(raw);
    assert.equal(state, expectedOf(raw), `「${raw}」应归一为 ${expectedOf(raw)}，实际 ${state}`);
    counts[state] += weight;
    if (state === "其他") others.push(raw);
  }
  // 42 种原值 → 4 个枚举，没有第 5 种可能
  assert.deepEqual(Object.keys(counts).sort(), ["其他", "已完成", "已移交", "进行中"].sort());
  // **唯一**落「其他」的是 `已作废`（1 个）。这条断言就是"0 个落其他"的门槛：
  // 一旦实现开始猜（把没见过的词硬塞进已完成/进行中），这里会变红；一旦真实数据里出现
  // 新的已知状态词，也该在这里显式补一条 expectedOf 规则。
  assert.deepEqual(others, ["已作废（2026-11-22，architect 误建，未使用）"]);
  assert.equal(counts["其他"], 1);
});

test("S1-7 活性：把「剥 `**`」这一步去掉 → 本夹具立刻出现大批「其他」", () => {
  // 复刻"不剥 **"的错误实现（就是契约要防的那一种退化）。
  const naive = (raw) => {
    const word = /^[^\s（(，,。；;：:、/]+/.exec((raw ?? "").trim())?.[0] ?? "";
    return ({ 进行中: "进行中", 已完成: "已完成", 已移交: "已移交" })[word] ?? "其他";
  };
  // 实测：夹具里 42 个原值中 11 个含 `**`，其中 **9 个以 `**` 开头**（那另外 2 个 `**` 在正文里，
  // 不剥也不影响首词）。所以"去掉剥 ** 这一步"至少会让 9 个落「其他」。
  const naiveOthers = REAL_VALUES.filter(([raw]) => naive(raw) === "其他");
  assert.ok(naiveOthers.length >= 9, `不剥 ** 时至少 9 个原值会落「其他」，实际 ${naiveOthers.length}`);
  // 正确的实现同一批数据只剩 1 个（已作废）
  assert.equal(REAL_VALUES.filter(([raw]) => normalizeTaskState(raw) === "其他").length, 1);
});
