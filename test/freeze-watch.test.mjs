/**
 * 冻结观测的纯函数契约测试（Task 0033 · P0/P1）。
 *
 * 为什么这些能测：判定逻辑（阈值、冻结时长、轨迹、长任务分桶、批分片）全部被抽成纯函数
 * 放在 `freeze-watch-const.ts`，Worker 里只剩 I/O。这样"判定正确性"可以穷举，
 * 不需要起真实 Worker / 真实浏览器（`testing.md` 2.5：断言行为结果，不测实现细节）。
 *
 * 活性验证（`testing.md` 2.4）：把 `frozenFor` 的比较改成 `>` 或把 `FROZEN_MS` 改小，
 * 下面的用例必须变红。对应的活动做法写在每条用例的注释里。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  FROZEN_MS,
  LONG_TASK_MS,
  THROTTLED_FROZEN_MS,
  TRAIL_MAX,
  UPLOAD_BATCH_MAX,
  alreadyReported,
  chunkRows,
  freezeDurationOf,
  frozenFor,
  longTaskBucket,
  pushTrail,
} from "../frontend/src/api/freeze-watch-const.ts";
import { readSnapshot, resetSnapshotForTest, updateSnapshot } from "../frontend/src/api/freeze-snapshot.ts";

/* ───────────────────────────── 冻结判定 ───────────────────────────── */

test("T33-1 未收到任何报活（lastBeatAt=0）不算冻结", () => {
  // 页面刚加载，主线程本来就忙着；这一段由 longtask 覆盖，不该报"冻结"。
  assert.equal(frozenFor(0, 60_000), 0);
  // 活性：把 `lastBeatAt <= 0` 的早退删掉 → 本用例变红
});

test("T33-2 未达阈值不算冻结（2999ms）", () => {
  assert.equal(frozenFor(1_000, 1_000 + FROZEN_MS - 1), 0);
  // 活性：把 `>=` 改成 `>` 且把返回值改成 gap+1 都不能让它变红；把 FROZEN_MS 调小到 2999 才会红
});

test("T33-3 正好达到阈值算冻结，并返回真实时长", () => {
  assert.equal(frozenFor(1_000, 1_000 + FROZEN_MS), FROZEN_MS);
  // 活性：把 `>=` 改成 `>` → 本用例变红（边界闭开写错就抓得住）
});

test("T33-4 长时间冻结返回的是真实间隔，不是阈值", () => {
  // 用户要的是"卡了多久"，报 3000 等于抹掉信息（实测有 7.6 小时的满核）。
  assert.equal(frozenFor(1_000, 1_000 + 60_000), 60_000);
  // 活性：把 `return gap` 改成 `return FROZEN_MS` → 本用例变红
});

/* ───────────────────────────── 动作轨迹 ───────────────────────────── */

test("T33-5 轨迹按时间追加，保持原数组不变（可安全用于快照）", () => {
  const first = pushTrail([], 100, "open-session");
  assert.deepEqual(first, [{ at: 100, what: "open-session" }]);
  const second = pushTrail(first, 200, "send");
  assert.equal(first.length, 1, "入参不能被改（快照可能同时被读取）");
  assert.deepEqual(second.map((entry) => entry.what), ["open-session", "send"]);
});

test("T33-6 轨迹超过容量时丢最旧的，保留最近 TRAIL_MAX 条", () => {
  let trail = pushTrail([], 0, "a");
  for (let i = 1; i < TRAIL_MAX + 10; i += 1) trail = pushTrail(trail, i, `act-${i}`);
  assert.equal(trail.length, TRAIL_MAX);
  assert.equal(trail[0]?.what, "act-10", "最旧的那条应被淘汰");
  assert.equal(trail[trail.length - 1]?.what, `act-${TRAIL_MAX + 9}`);
});

/* ───────────────────────────── 长任务分桶 ───────────────────────────── */

test("T33-7 长任务按 100ms 量级分桶（120ms 与 800ms 不合并）", () => {
  assert.equal(longTaskBucket(100), 100);
  assert.equal(longTaskBucket(199), 100);
  assert.equal(longTaskBucket(200), 200);
  assert.equal(longTaskBucket(800), 800);
  assert.equal(longTaskBucket(0), LONG_TASK_MS, "0 也要落在一个正数桶里，不能是 0");
  // 活性：把 `Math.floor` 改成 `Math.round` → 199 会落进 200，本用例变红
});

/* ───────────────────────────── 上报分片 ───────────────────────────── */

test("T33-8 分片遵守 50 条上限，且不丢任何一条", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({
    ts: "2026-11-23T00:00:00.000Z",
    level: "info",
    module: "test",
    msg: `row-${i}`,
  }));
  const { chunks, dropped } = chunkRows(rows);
  assert.equal(dropped, 0);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((chunk) => chunk.length <= UPLOAD_BATCH_MAX));
  assert.equal(chunks.flat().length, 120, "分片不能丢行");
  // 活性：把 `candidate.length > UPLOAD_BATCH_MAX` 的 `>` 改成 `>=` → 每片只剩 49 条，chunks 变 3 但断言 50 上限仍过；
  // 把 slice 逻辑写错（丢行）→ 最后一条断言变红
});

test("T33-9 单条自己就超 16KiB：丢掉并计数，不静默、也不塞进批里被后端 400", () => {
  // 反过来测两次：能装下的不丢；装不下的必须报出来。
  const fits = { ts: "2026-11-23T00:00:00.000Z", level: "error", module: "test", msg: "x".repeat(6000) };
  const tooBig = { ts: "2026-11-23T00:00:00.000Z", level: "error", module: "test", msg: "x".repeat(20000) };
  const small = { ts: "2026-11-23T00:00:00.000Z", level: "info", module: "test", msg: "ok" };

  const a = chunkRows([small, fits, small]);
  assert.equal(a.dropped, 0, "6000 字节能装下，不该丢");
  assert.ok(a.chunks.every((chunk) => JSON.stringify({ events: chunk }).length <= 16 * 1024));

  const b = chunkRows([small, tooBig, small]);
  assert.equal(b.dropped, 1, "超 16KiB 的单条必须被计数丢掉（否则整批发不出去，后端 400）");
  assert.equal(b.chunks.flat().length, 2, "其余两条照常发");
  // 活性：把 `dropped += 1` 删掉 → 本用例变红；把单条判断删掉 → 它会被塞进批里导致超限断言也红
});

/* ───────────────────────────── 现场快照寄存器 ───────────────────────────── */

test("T33-10 快照只更新传入的字段，其余保持", () => {
  resetSnapshotForTest();
  updateSnapshot({ messages: 1860, visibleCount: 1860, busy: true });
  const snap = readSnapshot();
  assert.equal(snap.messages, 1860);
  assert.equal(snap.visibleCount, 1860);
  assert.equal(snap.busy, true);
  assert.equal(snap.domNodes, -1, "node 环境没有 document：明确返回 -1，而不是 0（0 会让人以为页面是空的）");
});

test("T33-11 局部更新不覆盖其他字段", () => {
  resetSnapshotForTest();
  updateSnapshot({ agentId: "coder", sessionId: "s1", messages: 10 });
  updateSnapshot({ messages: 20 });
  const snap = readSnapshot();
  assert.equal(snap.agentId, "coder", "没传入的字段不能被抹掉");
  assert.equal(snap.sessionId, "s1");
  assert.equal(snap.messages, 20);
});

/* ───────────── 同一段冻结只报一次（这是 E2E 里抓到的真实缺陷） ───────────── */

test("T33-12 一段冻结只报一次：判据是\"报过没\"，不是 gap 相等（实测缺陷的回归锁）", () => {
  /*
   * 实测现场（2026-11-23）：E2E 制造 5 秒冻结，日志里出现 **两条** "主线程冻结"
   * （3525ms 与 4525ms）。第一版用 `gap === reportedForGap` 去重，而 `frozenFor()`
   * 返回的是"当前已冻多久"——同一段冻结每秒都在涨，所以永远不相等，等于没去重。
   * 用户读日志会以为"卡了两次"。
   */
  assert.equal(alreadyReported(0), false, "没报过");
  assert.equal(alreadyReported(3525), true, "报过（值是多少都无所谓，只要有值）");
  // 活性：把 alreadyReported 改成 `return reported > FROZEN_MS` 之类比较 gap 的写法 → 下面这条断言变红
  assert.equal(alreadyReported(1), true, "哪怕只报过一次（1ms 这种不可能的值），也必须是\"报过\"");
});

test("T33-13 恢复时长用「最后报活 → 恢复后首次报活」重算，不是检测时的 gap", () => {
  // 实测：检测报 3525ms，真实 5005ms。只存检测值会让所有记录系统性偏小。
  assert.equal(freezeDurationOf(1_000, 6_005), 5_005);
  assert.equal(freezeDurationOf(0, 6_005), 0, "从没报活过就不能编一个时长");
  // 活性：把实现改成 `return firstBeat - lastBeat + FROZEN_MS` → 第一条变红
});

test("T33-14 恢复时长的边界：时间倒流不产生负数", () => {
  // 系统时间被改 / 单调时钟与墙上时钟不一致时，不能出现 durationMs = -800 这种记录
  assert.equal(freezeDurationOf(5_000, 4_200), 0);
});

/* ───────── 隐藏标签页节流（2026-11-23 真实现场抓到的假阳性） ───────── */

test("T33-23 隐藏标签页：60 秒不再算冻结（Chrome 节流周期 60s）", () => {
  /*
   * 实测现场：连续 7 条假记录，时长 53000/60012/59772/60000/59998/59999/44498ms，
   * 全部 visibility:hidden。Chrome 把隐藏页定时器压到 60 秒一次，
   * 主线程 beat(500ms) 与 Worker check(1s) 同时被压 → 每分钟误报一条"冻结 60 秒"。
   */
  assert.equal(frozenFor(1_000, 1_000 + 60_000, false), 0, "隐藏页 60 秒不该算冻结");
  assert.equal(frozenFor(1_000, 1_000 + 89_000, false), 0, "隐藏页 89 秒仍不算（阈值 90s）");
  // 活性：把 threshold 改成固定 FROZEN_MS → 本用例第一条变红
});

test("T33-24 隐藏标签页：超过 90 秒仍然要报（后台卡死不能漏）", () => {
  assert.equal(frozenFor(1_000, 1_000 + THROTTLED_FROZEN_MS, false), THROTTLED_FROZEN_MS, "正好 90 秒要报");
  assert.equal(frozenFor(1_000, 1_000 + 120_000, false), 120_000, "真实时长，不是阈值");
  // 活性：把 hidden 分支删掉（永远用 FROZEN_MS）→ T33-23 红；把 threshold 改成 Infinity → 本用例红
});

test("T33-25 前台不受影响：3 秒就报", () => {
  assert.equal(frozenFor(1_000, 1_000 + FROZEN_MS, true), FROZEN_MS);
  assert.equal(frozenFor(1_000, 1_000 + 60_000, true), 60_000);
  // 活性：把 visible 判断写反（visible 走 90s）→ 本用例变红
});
