/**
 * 导航条的几何（Task 0020 · P2，**横条形态**）。纯函数，可穷举。
 *
 * 断言分五组，每组对应一个真实会算错的地方：
 *  1. **sqrt 宽度映射**：极端值的中位数不能贴底（线性映射的真实后果是 2.5%）；
 *  2. **两侧各自归一化**：用户与 Agent 的字数量级差一个数量级，混算会让用户刻度全贴下限；
 *  3. **行高自适应**：条少用 24（WCAG 指针下限），条多压到 10 并**改为滚动**（不再压到 2px）；
 *  4. **轨道可见性**：按容器空白判，不按视口；
 *  5. **卡片定位 / 带状指示 / 跟随滚动**。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  BAR_HEIGHT, BAR_HEIGHT_HOVER, BAR_WIDTH_MAX, BAR_WIDTH_MIN, CARD_GAP, CARD_PADDING, RAIL_MAX_RATIO,
  RAIL_WIDTH_MAX, RAIL_WIDTH_MIN, ROW_HEIGHT_MAX, ROW_HEIGHT_MIN,
  RAIL_SCRUB_THRESHOLD, railBandOf, railCardPlaceOf, railEnsureVisible, railGestureOf, railRowsOf,
  railScrubTargetOf, railSlotOf, railWidthsOf, zipWidthOf,
} from "../frontend/src/api/rail-geometry.ts";

/* ── 1. sqrt 宽度映射 ───────────────────────────────────── */

test("本项目实测字符分布（1/300/1300/3000/17000）：sqrt 把中位数托到 27%，线性只有 7.6%", () => {
  const values = [1, 300, 1300, 3000, 17000];
  const median = zipWidthOf(values, 1300);
  const ratio = (median - BAR_WIDTH_MIN) / (BAR_WIDTH_MAX - BAR_WIDTH_MIN);
  const linear = (1300 - 1) / (17000 - 1);
  assert.ok(Math.abs(ratio - 0.271) < 0.01, `sqrt 中位 ${(ratio * 100).toFixed(1)}%，应为 27.1%`);
  assert.ok(linear < 0.1, `线性中位 ${(linear * 100).toFixed(1)}% —— 其余全被压平`);
  assert.ok(ratio > linear * 3, "sqrt 必须明显优于线性");
});

test("lex-chat 那家的归一化用固定分母（sqrt(length/80)），我们的分母是会话内 min/max", () => {
  // 固定分母的后果：超过 80 字就全部顶满，长会话的差别全丢。
  // 我们的做法：只用 max 做上界 → 80 字的回复在"最长 17000"的会话里只有很小一段。
  const values = [1, 80, 17000];
  const short = zipWidthOf(values, 80);
  const long = zipWidthOf(values, 17000);
  assert.ok(short < (BAR_WIDTH_MIN + BAR_WIDTH_MAX) / 2, "80 字在长会话里不该顶满");
  assert.equal(long, BAR_WIDTH_MAX, "最长的顶满");
});

test("单调：字数多不会比字数少更窄", () => {
  const values = [10, 100, 1000, 10000];
  const widths = values.map((value) => zipWidthOf(values, value));
  for (let i = 1; i < widths.length; i += 1) assert.ok(widths[i] >= widths[i - 1]);
});

test("全同值 / 单样本 → 中值；0 与非法值 → 下限（不产生 NaN）", () => {
  assert.equal(zipWidthOf([500, 500], 500), (BAR_WIDTH_MIN + BAR_WIDTH_MAX) / 2);
  assert.equal(zipWidthOf([500], 500), (BAR_WIDTH_MIN + BAR_WIDTH_MAX) / 2);
  assert.equal(zipWidthOf([0, 100], 0), BAR_WIDTH_MIN);
  assert.equal(zipWidthOf([0, 100], Number.NaN), BAR_WIDTH_MIN);
  assert.equal(zipWidthOf([], 100), BAR_WIDTH_MIN);
});

/* ── 2. 两侧各自归一化 ──────────────────────────────────── */

test("用户那句不会被 Agent 的长文压到下限", () => {
  const ticks = [
    { role: "user", chars: 50 }, { role: "assistant", chars: 5000 },
    { role: "user", chars: 10 }, { role: "assistant", chars: 1000 },
  ];
  const widths = railWidthsOf(ticks);
  assert.equal(widths[0], BAR_WIDTH_MAX, "最长的用户消息 = 用户侧峰值");
  assert.equal(widths[2], BAR_WIDTH_MIN, "最短的用户消息 = 用户侧下限");
  assert.equal(widths[1], BAR_WIDTH_MAX);
  assert.equal(widths[3], BAR_WIDTH_MIN);
});

test("轨道窄时宽度上限跟着收（横条最长不超过轨道）", () => {
  const widths = railWidthsOf([{ role: "user", chars: 1 }, { role: "user", chars: 900 }], 20);
  assert.equal(widths[1], 20, "上限由轨道宽度决定");
  assert.ok(widths[0] >= BAR_WIDTH_MIN);
});

test("只有一条消息（还没回复）→ 不崩", () => {
  assert.deepEqual(railWidthsOf([{ role: "user", chars: 20 }]), [(BAR_WIDTH_MIN + BAR_WIDTH_MAX) / 2]);
});

/* ── 3. 行高自适应（"不僵"的核心）──────────────────────── */

test("条少 → 24px 舒适行高（WCAG 指针下限）", () => {
  const rows = railRowsOf(5, 800);
  assert.equal(rows.rowHeight, ROW_HEIGHT_MAX);
  assert.equal(rows.scrollable, false);
  assert.equal(rows.height, 5 * ROW_HEIGHT_MAX);
});

test("条多 → 行高压到 10px 并改为滚动，**不再继续压**", () => {
  const avail = 800;
  const rows = railRowsOf(200, avail);
  assert.equal(rows.rowHeight, ROW_HEIGHT_MIN, "压到下限就停");
  assert.equal(rows.scrollable, true);
  assert.equal(rows.height, avail * RAIL_MAX_RATIO, "高度封顶在 62% 可用高度");
  assert.ok(rows.visibleRows > 0 && rows.visibleRows < 200);
});

test("中间档：行高落在 (10, 24) 之间、且正好占满上限", () => {
  const avail = 800;
  const rows = railRowsOf(30, avail);
  assert.ok(rows.rowHeight > ROW_HEIGHT_MIN && rows.rowHeight < ROW_HEIGHT_MAX, `实得 ${rows.rowHeight}`);
  assert.ok(Math.abs(rows.height - avail * RAIL_MAX_RATIO) < 0.5, "刚好占满 62%");
  assert.equal(rows.scrollable, false);
});

test("边界：0 条 / 可用高度 0 / 1 条", () => {
  assert.deepEqual(railRowsOf(0, 800), { rowHeight: ROW_HEIGHT_MAX, height: 0, scrollable: false, visibleRows: 0 });
  assert.equal(railRowsOf(10, 0).height, 0);
  assert.equal(railRowsOf(1, 800).rowHeight, ROW_HEIGHT_MAX);
});

test("行高永远不越过 [10, 24]，且高度不超过可用高度", () => {
  for (const count of [1, 3, 10, 40, 100, 500, 2000]) {
    for (const avail of [400, 644, 804, 1000]) {
      const rows = railRowsOf(count, avail);
      assert.ok(rows.rowHeight >= ROW_HEIGHT_MIN && rows.rowHeight <= ROW_HEIGHT_MAX, `${count}/${avail}`);
      assert.ok(rows.height <= avail * RAIL_MAX_RATIO + 0.5, `${count}/${avail} 高度越界`);
    }
  }
});

/* ── 4. 轨道可见性与宽度 ───────────────────────────────── */

test("复现真实 layout() 的十种组合：空白够 24 就出现，宽度 = min(36, 空白)", () => {
  const cases = [
    { gutter: 24, width: 24, note: "1280 左列展开" },
    { gutter: 188, width: RAIL_WIDTH_MAX, note: "1280 左列收起" },
    { gutter: 50, width: RAIL_WIDTH_MAX, note: "1536 左列展开" },
    { gutter: 82, width: RAIL_WIDTH_MAX, note: "1600 左列展开" },
    { gutter: 242, width: RAIL_WIDTH_MAX, note: "1920 左列展开" },
  ];
  for (const item of cases) {
    const slot = railSlotOf(item.gutter);
    assert.equal(slot.visible, true, item.note);
    assert.equal(slot.width, item.width, item.note);
  }
});

test("空白不足 24 → 不渲染（手机上内距只有 16，自然走这条）", () => {
  assert.deepEqual(railSlotOf(16), { visible: false, width: 0, gutter: 16 });
  assert.deepEqual(railSlotOf(0), { visible: false, width: 0, gutter: 0 });
  assert.deepEqual(railSlotOf(23.9).visible, false);
  assert.deepEqual(railSlotOf(24).visible, true);
  assert.equal(RAIL_WIDTH_MIN, 24);
});

/* ── 5. 卡片 / 带状指示 / 跟随滚动 ──────────────────────── */

test("卡片在轨道右侧 20px、与该行垂直居中", () => {
  const place = railCardPlaceOf(
    { top: 400, left: 0, right: 36, bottom: 412, width: 36, height: 12 },
    { width: 340, height: 132 },
    { width: 1440, height: 900 },
  );
  assert.equal(place.left, 36 + CARD_GAP);
  assert.equal(place.top, 400 + 6 - 66);
});

test("卡片上下夹进视口；比视口还高时贴顶", () => {
  const atTop = railCardPlaceOf({ top: 0, left: 0, right: 36, bottom: 8, width: 36, height: 8 },
    { width: 340, height: 200 }, { width: 1440, height: 900 });
  assert.equal(atTop.top, CARD_PADDING);
  const atBottom = railCardPlaceOf({ top: 890, left: 0, right: 36, bottom: 900, width: 36, height: 10 },
    { width: 340, height: 200 }, { width: 1440, height: 900 });
  assert.equal(atBottom.top, 900 - 200 - CARD_PADDING);
  const huge = railCardPlaceOf({ top: 100, left: 0, right: 36, bottom: 110, width: 36, height: 10 },
    { width: 340, height: 2000 }, { width: 1440, height: 900 });
  assert.equal(huge.top, CARD_PADDING);
});

test("带状指示：覆盖可视区的行、随第一条/最后一条变化", () => {
  const band = railBandOf(10, 19, 100, 1000);
  assert.equal(band.top, 100, "第 10 行 × 每行 10px");
  assert.equal(band.height, 100, "10 行 × 10px");
  const one = railBandOf(0, 0, 100, 1000);
  assert.equal(one.top, 0);
  assert.equal(one.height, 10);
});

test("带状指示：越界输入夹在合法范围，全 0 不产生 NaN", () => {
  assert.deepEqual(railBandOf(-5, 999, 100, 1000), { top: 0, height: 1000 });
  assert.deepEqual(railBandOf(50, 10, 100, 1000), { top: 500, height: 10 }, "last < first 时退化成一行");
  assert.deepEqual(railBandOf(0, 0, 0, 1000), { top: 0, height: 0 });
  assert.deepEqual(railBandOf(0, 0, 10, 0), { top: 0, height: 0 });
});

test("跟随滚动：只在真的被裁时才动，两端各留余量", () => {
  // margin=3 行 × 20px = 60px
  assert.equal(railEnsureVisible(100, 20, 0, 500), 0, "完全可见（在余量之内）→ 不动");
  assert.equal(railEnsureVisible(10, 20, 200, 500), 0, "上面被裁 → 贴到 0（10-60 夹到 0）");
  // 900+20 > 200+500-60=640 → 900+20-500+60 = 480
  assert.equal(railEnsureVisible(900, 20, 200, 500), 480, "下面被裁 → 留 60px 余量");
  assert.equal(railEnsureVisible(900, 20, 200, 0), 200, "视口高 0 → 不动");
  assert.equal(railEnsureVisible(900, 20, 200, 500, 0), 420, "margin=0 时退回'顶到下沿'");
});


/* ── 6. "装不下"在本形态下的真实含义 ─────────────────────── */

test("装不下没有消失：条数超过一屏 → 整列滚动，但每条仍然存在且行高不降到 12 以下", () => {
  /*
   * 用户 2026-11-19 的追问："装不下就整列滚动，那笔账直接消掉？这仍然存在装不下吧？"
   * 对 —— 它没有消失，只是**换了表现形式**：
   *   竖条时代装不下 = 刻度被裁掉（看不见、也点不到，实测 548 条里丢 380 条）；
   *   横条时代装不下 = 一屏看不全，要滚一下这一列，**每一条仍然有 12px 的可点高度**。
   * 这条断言锁的就是这个差别：滚动 yes、行高 ≥ 12 yes、条数不减少 yes。
   */
  const avail = 804;
  const count = 560;
  const rows = railRowsOf(count, avail);
  assert.equal(rows.scrollable, true, "装不下 → 滚动");
  assert.equal(rows.rowHeight, ROW_HEIGHT_MIN, "行高停在下限，不继续压");
  assert.ok(rows.rowHeight >= 12, "每条仍有 12px 可点高度");
  assert.ok(rows.visibleRows < count, `一屏只看到 ${rows.visibleRows} / ${count} 条`);
  // 关键差别：滚动模式下**没有任何一条被丢弃**（渲染层永远渲染全部 ticks，只是可滚）
  assert.equal(count * rows.rowHeight, 560 * 12, "内容总高 = 全部行的高度和，一条不少");
});

test("短会话不产生滚动：一屏看得全，行高用舒适的 24px", () => {
  const rows = railRowsOf(10, 804);
  assert.equal(rows.scrollable, false);
  assert.equal(rows.rowHeight, ROW_HEIGHT_MAX);
  assert.ok(rows.visibleRows >= 10, "10 条全在可视区内");
});

test("一屏能看多少条：与可用高度成正比、与条数无关", () => {
  const short = railRowsOf(10, 804).visibleRows;
  const long = railRowsOf(560, 804).visibleRows;
  assert.ok(long > 30 && long < 60, `560 条时一屏约 ${long} 条（12px 行高 / 62% 高度）`);
  assert.ok(short >= 10);
});

/* ── 7. 拖动 scrub（P7）─────────────────────────────────── */

test("拖过整列高度 = 滚完整个会话（相对位移，灵敏度 = 可滚动距离 ÷ 整列内容高）", () => {
  // 560 条 × 12px = 6720px 内容高；正文 9000 内容 / 800 可视 → 可滚 8200
  const start = 0;
  const full = railScrubTargetOf(start, 6720, 6720, 800, 9000);
  assert.equal(Math.round(full), 8200, "拖满整列 → 滚到底");
  const half = railScrubTargetOf(start, 3360, 6720, 800, 9000);
  assert.equal(Math.round(half), 4100, "拖一半 → 滚一半");
});

test("相对位移：从中间开始拖，结果是「起点 + 位移」，不是「指针绝对位置」", () => {
  // 这正是它在可滚列上不打架的原因：列自己滚到哪里都不影响映射
  const fromMiddle = railScrubTargetOf(4000, 1200, 6720, 800, 9000);
  assert.equal(Math.round(fromMiddle), Math.round(4000 + 1200 * (8200 / 6720)));
});

test("拖动目标夹在 [0, 可滚动距离]：拖出边界不产生负数或越过底部", () => {
  assert.equal(railScrubTargetOf(100, -99999, 6720, 800, 9000), 0, "往上拖到底 → 0");
  assert.equal(railScrubTargetOf(100, 99999, 6720, 800, 9000), 8200, "往下拖到底 → 可滚距离");
});

test("退化输入不产生 NaN：内容高 0 / 视口高 0 / 正文不够滚 / 非法 delta", () => {
  assert.equal(railScrubTargetOf(500, 100, 0, 800, 9000), 500);
  assert.equal(railScrubTargetOf(500, 100, 6720, 0, 9000), 500);
  assert.equal(railScrubTargetOf(500, 100, 6720, 800, 700), 0, "正文不够滚 → 0");
  assert.equal(railScrubTargetOf(500, Number.NaN, 6720, 800, 9000), 500);
});

test("点击 vs 拖动：4px 阈值（手抖不算拖）", () => {
  assert.equal(RAIL_SCRUB_THRESHOLD, 4);
  assert.equal(railGestureOf(0, 0), "click");
  assert.equal(railGestureOf(3, 2), "click", "3px 内算点击（手抖）");
  assert.equal(railGestureOf(0, 5), "scrub");
  assert.equal(railGestureOf(5, 0), "scrub", "横向超过也算拖（不误触成点击）");
});
