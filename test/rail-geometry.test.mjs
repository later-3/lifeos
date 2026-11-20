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
  RAIL_SLIDER_MIN, railCardPlaceOf, railGestureOf, railIndexAtBandTop, railProgressModelOf, railRowsOf,
  railSlotOf, railWidthsOf, zipWidthOf,
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

/* ── 一个 resolvedIndex 派生全部（用户 2026-11-19 审核确定的模型）──────── */

/**
 * 真实几何（2026-11-19 实测，560 条刻度、补齐历史后）：
 * 列可视框 508px；正文 71153 内容 / 844 可视；列表内容 6720 / 可视 508。
 */
const VIEW = {
  totalTicks: 560, viewHeight: 508, clientHeight: 844, scrollHeight: 71153,
  listContentHeight: 6720, listViewHeight: 508,
};
const ROW_H = VIEW.listContentHeight / VIEW.totalTicks;   // 12px
const model = (resolvedIndex) => railProgressModelOf({ resolvedIndex, ...VIEW });

test("**滑块始终包裹高亮条**：任何位置（含首尾）行都完整落在滑块矩形内", () => {
  for (const index of [0, 1, 50, 153, 280, 400, 520, 558, 559]) {
    const m = model(index);
    const rowTop = index * ROW_H - m.listScrollTop;
    const rowBottom = rowTop + ROW_H;
    assert.ok(rowTop >= m.bandTop - 1, `idx=${index}: 行顶 ${rowTop.toFixed(1)} 早于滑块顶 ${m.bandTop.toFixed(1)}`);
    assert.ok(rowBottom <= m.bandTop + m.bandHeight + 1,
      `idx=${index}: 行底 ${rowBottom.toFixed(1)} 超出滑块底 ${(m.bandTop + m.bandHeight).toFixed(1)}`);
  }
});

test("百分比：顶部 0%、底部 100%、按行号线性单调", () => {
  assert.equal(model(0).percent, 0);
  assert.equal(model(559).percent, 100);
  assert.equal(model(280).percent, 50);
  let previous = -1;
  for (const index of [0, 100, 200, 300, 400, 500, 559]) {
    const pct = model(index).percent;
    assert.ok(pct >= previous, `百分比必须单调：${index} → ${pct}`);
    previous = pct;
  }
});

test("滑块在可视框内，长度有 20px 下限（VSCode MINIMUM_SLIDER_SIZE）", () => {
  for (const index of [0, 100, 280, 500, 559]) {
    const m = model(index);
    assert.ok(m.bandTop >= 0 && m.bandTop + m.bandHeight <= VIEW.viewHeight + 0.5, `idx=${index} 越界`);
    assert.ok(m.bandHeight >= RAIL_SLIDER_MIN);
  }
  assert.equal(model(0).bandHeight, RAIL_SLIDER_MIN, "508×844/71153=6px → 抬到 20px");
});

test("**拖动是反向换算**：滑块顶边位置 → 行号（拖动时滑块主导）", () => {
  const range = model(0).bandRange;
  assert.equal(railIndexAtBandTop(0, range, VIEW.totalTicks), 0);
  assert.equal(railIndexAtBandTop(range, range, VIEW.totalTicks), VIEW.totalTicks - 1);
  // 单调
  let previous = -1;
  for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
    const index = railIndexAtBandTop(range * ratio, range, VIEW.totalTicks);
    assert.ok(index >= previous, "滑块越靠下，行号必须越大");
    previous = index;
  }
});

test("列表滚动夹在 [0, maxScroll]；中间位置精确居中", () => {
  const max = VIEW.listContentHeight - VIEW.listViewHeight;
  for (const index of [0, 1, 559]) {
    const m = model(index);
    assert.ok(m.listScrollTop >= 0 && m.listScrollTop <= max + 0.5, `idx=${index} 列表滚动越界`);
  }
  const middle = model(280);
  const rowCenter = 280 * ROW_H + ROW_H / 2 - middle.listScrollTop;
  assert.ok(Math.abs(rowCenter - (middle.bandTop + middle.bandHeight / 2)) <= 1, "中间位置应精确居中");
});

test("退化输入不产生 NaN；一屏装得下时滑块占满；越界 index 被夹住", () => {
  const zero = railProgressModelOf({ resolvedIndex: 0, totalTicks: 0, viewHeight: 508, clientHeight: 844, scrollHeight: 71153, listContentHeight: 0, listViewHeight: 0 });
  assert.equal(zero.bandHeight, 0);
  assert.equal(zero.percent, 0);
  const full = railProgressModelOf({ resolvedIndex: 0, totalTicks: 5, viewHeight: 508, clientHeight: 844, scrollHeight: 800, listContentHeight: 60, listViewHeight: 508 });
  assert.equal(full.bandHeight, 508, "一屏装得下全部 → 滑块占满");
  assert.equal(full.bandTop, 0);
  assert.equal(model(-5).bandTop, model(0).bandTop, "负下标被夹到 0");
  assert.equal(model(99999).bandTop, model(559).bandTop, "超界下标被夹到最后一条");
});

/* ── 7. 手势分工（与 VSCode minimap 一致：按滑块=拖、按别处=点）────── */

test("不再有位移阈值：按在滑块上就是拖，按在别处就是点（两者靠命中目标区分）", () => {
  /*
   * 早先用 4px 阈值区分"点击 vs 拖动"，于是"想拖但手没动够"会被判成点击 → 跳到别处。
   * VSCode 的做法（`minimap.ts:1404-1410`）是把拖动绑在 slider 元素上、点击走另一条路径，
   * **没有任何阈值**。我们照此：命中目标决定意图，不靠位移猜。
   */
  assert.equal(railGestureOf(0, 0), "click");
  assert.equal(railGestureOf(0, 100), "scrub");
  assert.equal(railGestureOf(100, 0), "scrub");
});
