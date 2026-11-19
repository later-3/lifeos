/**
 * 导航竖条的几何（Task 0020 · P2）。
 *
 * 断言分四组，每组对应一个真实会算错的地方：
 *  1. **sqrt 压缩**：极端值的中位数不能贴底（线性映射的真实后果是 2.5%）；
 *  2. **两侧各自归一化**：用户与 Agent 的字数量级差一个数量级，混算会让用户刻度全部贴底；
 *  3. **缩放与窗口的边界**：装得下不缩、装不下切窗口、锚点靠头/靠尾时贴边；
 *  4. **可用空白（`railSlotOf`）**：按容器宽度判，不按视口。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  RAIL_GAP, RAIL_HIT_MAX, RAIL_HIT_MIN, RAIL_MAX_AGENT, RAIL_MAX_USER, RAIL_MIN, RAIL_MIN_PITCH,
  RAIL_CARD_GAP, RAIL_CARD_PADDING,
  needsRailWindow, railAnchorByFraction, railAnchorWithLoadedTail, railCapacityOf, railCardPlaceOf, railHeightsOf, RAIL_TICK_FLOOR, railScaleOf,
  railSlotFromGutter, railSlotOf, railWindowOf, zipHeightOf,
} from "../frontend/src/api/rail-geometry.ts";

/* ── 1. sqrt 压缩 ───────────────────────────────────────── */

test("原型文档的 15.9% 无法用它的四个分位数复现（如实记录，不硬凑）", () => {
  /*
   * 原型 `tools/nav-demo/AGENTS.md` 的实测表给的是 tokens 的 min=0 / median=5703 /
   * p90=102545 / max=226206，结论"sqrt → 中位数落在 15.9%"。
   * 但 `zip()` 的 min 取的是**正数里的最小值**，而文档只给了 0 —— 真实的正数下限没记下来，
   * 所以那个 15.9% 复现不出来（用 median 当最小值算出来是 0%，见下）。
   *
   * 这条用例的作用不是"通过"，而是**把这个证据缺口钉在测试里**：将来谁要核对 15.9%，
   * 得先补齐那组数据的正数最小值。在此之前，我们只断言"sqrt 明显优于线性"这个不依赖具体 min 的关系。
   */
  const values = [5703, 102545, 226206];
  const medianWhenMinIsMedian = zipHeightOf(values, 5703, RAIL_MAX_AGENT);
  assert.equal(medianWhenMinIsMedian, RAIL_MIN, "把中位数当最小值 → 它自然落到下限，可见 15.9% 依赖真实的 min");
});

test("本项目实测数据（字符 1/300/1300/3000/17000）：sqrt 27.1% vs 线性 7.6%", () => {
  // 字符分布（2026-11-19 实测 269 条轮末回复）：p50=1314 / p90=2992 / max=17185。
  // 同一组数据下 sqrt 把中位数托到 27%，线性只有 7.6% —— 这是"必须用 sqrt"的量化理由。
  const values = [1, 300, 1300, 3000, 17000];
  const median = zipHeightOf(values, 1300, RAIL_MAX_AGENT);
  const sqrtRatio = (median - RAIL_MIN) / (RAIL_MAX_AGENT - RAIL_MIN);
  const linearRatio = (1300 - 1) / (17000 - 1);
  assert.ok(sqrtRatio > linearRatio * 3, `sqrt ${(sqrtRatio * 100).toFixed(1)}% 应远高于线性 ${(linearRatio * 100).toFixed(1)}%`);
  assert.ok(linearRatio < 0.1, "线性映射把中位数压到 10% 以下 = 其余轮次全被压平");
});

test("单调：字数多的不会比字数少的短", () => {
  const values = [10, 100, 1000, 10000];
  const heights = values.map((value) => zipHeightOf(values, value, RAIL_MAX_USER));
  for (let i = 1; i < heights.length; i += 1) assert.ok(heights[i] >= heights[i - 1]);
});

test("全部同值 / 单样本 → 取中值，不假装有差别", () => {
  assert.equal(zipHeightOf([500, 500, 500], 500, 40), (RAIL_MIN + 40) / 2);
  assert.equal(zipHeightOf([500], 500, 40), (RAIL_MIN + 40) / 2);
});

test("0 与非法值 → 下限，不产生 NaN", () => {
  assert.equal(zipHeightOf([0, 100], 0, 40), RAIL_MIN);
  assert.equal(zipHeightOf([0, 100], Number.NaN, 40), RAIL_MIN);
  assert.equal(zipHeightOf([], 100, 40), RAIL_MIN);
  assert.equal(zipHeightOf([0, 0], 0, 40), RAIL_MIN, "全 0 时不该算出中值（那是给'有值但都一样'的）");
});

/* ── 2. 两侧各自归一化 ──────────────────────────────────── */

test("用户与 Agent 各自归一化：用户那句不会被 Agent 的长文压到底", () => {
  // 用户话短（10–50 字），Agent 回复长（1000–5000 字）
  const ticks = [
    { role: "user", chars: 50 }, { role: "assistant", chars: 5000 },
    { role: "user", chars: 10 }, { role: "assistant", chars: 1000 },
  ];
  const heights = railHeightsOf(ticks);
  // 混算的话用户 50 字会被压到接近下限；分开算后它该是用户侧的最高值
  assert.equal(heights[0], RAIL_MAX_USER, "最长的用户消息 = 用户侧峰值");
  assert.equal(heights[2], RAIL_MIN, "最短的用户消息 = 用户侧下限");
  assert.equal(heights[1], RAIL_MAX_AGENT, "最长的回复 = Agent 侧峰值");
  assert.equal(heights[3], RAIL_MIN, "最短的回复 = Agent 侧下限");
});

test("只有用户消息（还没回复）→ 不崩，且不产生 Agent 刻度", () => {
  const heights = railHeightsOf([{ role: "user", chars: 20 }]);
  assert.deepEqual(heights, [(RAIL_MIN + RAIL_MAX_USER) / 2], "单样本取中值");
});

/* ── 3. 缩放与窗口 ──────────────────────────────────────── */

test("装得下 → scale = 1，总高等于自然高度", () => {
  const heights = [10, 10, 10];
  const { scale, total } = railScaleOf(heights, 1000);
  assert.equal(scale, 1);
  assert.equal(total, 30 + 2 * RAIL_GAP);
});

test("装不下 → 按比例缩，总高不超过可用高度（因为 2px 抬底，通常略小于）", () => {
  const heights = [40, 40, 40, 40, 40];
  const avail = 100;
  const { scale, total } = railScaleOf(heights, avail);
  assert.ok(scale < 1);
  assert.ok(total <= avail + 0.001, `总高 ${total} 不能超过 ${avail}`);
  assert.ok(total > avail * 0.9, "也不该缩得过分（利用率应接近可用高度）");
});

test("可用高度为 0 → scale = 0（不产生 NaN / 负数）", () => {
  const { scale } = railScaleOf([10, 20], 0);
  assert.equal(scale, 0);
});

test("空刻度 → 不渲染任何东西", () => {
  assert.deepEqual(railScaleOf([], 500), { scale: 1, total: 0 });
});

test("窗口容量 = floor(可用高度 / 最小间距)，且至少 1", () => {
  assert.equal(railCapacityOf(660), Math.floor(660 / RAIL_MIN_PITCH));
  assert.equal(railCapacityOf(3), 1, "算出来是 0 时兜到 1，不让整条空掉");
  assert.equal(railCapacityOf(0), 1);
});

test("刻度数 ≤ 容量 → 不需要窗口", () => {
  assert.equal(needsRailWindow(railCapacityOf(660), 660), false);
  assert.equal(needsRailWindow(railCapacityOf(660) + 1, 660), true);
});

test("窗口居中、贴边不溢出（锚点分别靠头/中/尾）", () => {
  const count = 548, avail = 660;
  const capacity = railCapacityOf(avail);
  const head = railWindowOf(count, avail, 0);
  assert.equal(head.from, 0, "锚点在头 → 窗口贴头，不出现负下标");
  assert.equal(head.to, capacity);

  const tail = railWindowOf(count, avail, count - 1);
  assert.equal(tail.to, count, "锚点在尾 → 窗口贴尾，不越界");
  assert.equal(tail.from, count - capacity);

  const middle = railWindowOf(count, avail, Math.floor(count / 2));
  assert.equal(middle.to - middle.from, capacity, "窗口大小恒定");
  assert.ok(middle.from > 0 && middle.to < count);

  for (const anchor of [0, 1, 100, 273, 546, 547]) {
    const window = railWindowOf(count, avail, anchor);
    assert.ok(window.from >= 0 && window.to <= count, `anchor=${anchor} 越界`);
    assert.ok(window.to - window.from <= capacity, `anchor=${anchor} 超容量`);
    assert.ok(anchor >= window.from && anchor < window.to, `anchor=${anchor} 不在自己的窗口里`);
  }
});

test("刻度数少于容量 → 窗口是整个列表", () => {
  assert.deepEqual(railWindowOf(5, 660, 2), { from: 0, to: 5 });
  assert.deepEqual(railWindowOf(0, 660, 0), { from: 0, to: 0 });
});

/* ── 4. 可用空白（按容器宽度，不按视口）────────────────── */

test("railSlotOf 复现真实 layout() 的十种组合（2026-11-19 实测值）", () => {
  // chat 宽度来自 `layout()`，pad = sm:px-6 = 24，reading = 860
  const cases = [
    { chat: 704, expect: 24, visible: true, note: "1280 左两列展开" },
    { chat: 1236, expect: 72, visible: true, note: "1280 左两列收起" },
    { chat: 864, expect: 24, visible: true, note: "1440 左两列展开" },
    { chat: 1396, expect: 72, visible: true, note: "1440 左两列收起" },
    { chat: 960, expect: 50, visible: true, note: "1536 左两列展开" },
    { chat: 1492, expect: 72, visible: true, note: "1536 左两列收起" },
    { chat: 1024, expect: 72, visible: true, note: "1600 左两列展开" },
    { chat: 1556, expect: 72, visible: true, note: "1600 左两列收起" },
    { chat: 1344, expect: 72, visible: true, note: "1920 左两列展开" },
    { chat: 1876, expect: 72, visible: true, note: "1920 左两列收起" },
  ];
  for (const item of cases) {
    const slot = railSlotOf(item.chat, 860, 24);
    assert.equal(slot.visible, item.visible, `${item.note}: 该显示`);
    assert.equal(slot.hit, item.expect, `${item.note}: 命中区应为 ${item.expect}px`);
  }
});

test("空白不足 24px → 不渲染（手机走这条：内距只有 px-4 = 16）", () => {
  assert.equal(railSlotOf(560, 860, 16).visible, false, "手机：内容列占满，只剩 16px 内距");
  assert.equal(railSlotOf(0, 860, 24).visible, false, "对话区宽 0（未挂载）");
});

test("桌面内距本身就是 24：内容列再宽，空白也不会低于 24 → 命中区收到 24 而不是整条消失", () => {
  // 这一条是设计上的有意取舍：`main` 是 `px-4 sm:px-6`，桌面内距 24 = WCAG 下限，
  // 所以桌面永不隐藏；手机上内距只有 16 < 24，于是判据自然把它藏起来（不需要额外断点）。
  assert.deepEqual(railSlotOf(1280, 5000, 24), { visible: true, hit: 24, gutter: 24 });
  assert.deepEqual(railSlotOf(1280, 5000, 16), { visible: false, hit: 0, gutter: 16 });
});

test("内容列比可用宽度窄时，空白按剩余的一半算（居中列）", () => {
  const slot = railSlotOf(1600, 600, 24);
  assert.equal(slot.gutter, 24 + (1600 - 48 - 600) / 2);
  assert.equal(slot.hit, RAIL_HIT_MAX, "空白很宽时命中区封顶 72");
});

test("命中区永远夹在 [24, 72] 之间", () => {
  for (const chat of [600, 800, 1000, 1200, 1600, 2400, 4000]) {
    const slot = railSlotOf(chat, 860, 24);
    if (!slot.visible) continue;
    assert.ok(slot.hit >= RAIL_HIT_MIN && slot.hit <= RAIL_HIT_MAX, `chat=${chat} 命中区 ${slot.hit} 越界`);
  }
});

test("用户把阅读列拖宽 → 命中区跟着收窄，收窄过程连续、不跳变", () => {
  const widths = [860, 900, 1000, 1100, 1200, 1232];
  const hits = widths.map((reading) => railSlotOf(1280, reading, 24).hit);
  for (const hit of hits) assert.ok(hit >= RAIL_HIT_MIN && hit <= RAIL_HIT_MAX, `命中区 ${hit} 越界`);
  // 单调不增：阅读列越宽，空白越小
  for (let i = 1; i < hits.length; i += 1) assert.ok(hits[i] <= hits[i - 1], "阅读列变宽后命中区反而变大");
});

/* ── 5. 预览卡片定位（P3）──────────────────────────────── */

test("卡片在竖条右侧、与该刻度垂直居中", () => {
  const tick = { top: 400, left: 0, right: 72, bottom: 410, width: 72, height: 10 };
  const place = railCardPlaceOf(tick, { width: 340, height: 140 }, { width: 1440, height: 900 });
  assert.equal(place.left, 72 + RAIL_CARD_GAP, "右侧 20px");
  assert.equal(place.top, 400 + 5 - 70, "垂直居中：刻度中线 - 卡片半高");
});

test("卡片夹在视口内：贴顶/贴底都不溢出", () => {
  const atTop = railCardPlaceOf({ top: 0, left: 0, right: 72, bottom: 8, width: 72, height: 8 },
    { width: 340, height: 200 }, { width: 1440, height: 900 });
  assert.equal(atTop.top, RAIL_CARD_PADDING, "贴顶时不越界");

  const atBottom = railCardPlaceOf({ top: 890, left: 0, right: 72, bottom: 900, width: 72, height: 10 },
    { width: 340, height: 200 }, { width: 1440, height: 900 });
  assert.equal(atBottom.top, 900 - 200 - RAIL_CARD_PADDING, "贴底时不越界");
});

test("卡片比视口还高 → 贴顶，不产生负坐标", () => {
  const place = railCardPlaceOf({ top: 100, left: 0, right: 72, bottom: 110, width: 72, height: 10 },
    { width: 340, height: 2000 }, { width: 1440, height: 900 });
  assert.equal(place.top, RAIL_CARD_PADDING);
  assert.ok(place.left >= RAIL_CARD_PADDING);
});

test("窗口很窄时卡片被推回视口（不向右溢出）", () => {
  const place = railCardPlaceOf({ top: 100, left: 0, right: 72, bottom: 110, width: 72, height: 10 },
    { width: 340, height: 140 }, { width: 360, height: 900 });
  assert.ok(place.left + 340 <= 360 - RAIL_CARD_PADDING + 0.001, "右缘不越界");
});

/* ── 6. 实测 gutter 与比例锚点（运行时用）───────────────── */

test("railSlotFromGutter 与 railSlotOf 共用同一档夹紧（公式与实测不会分歧）", () => {
  for (const chat of [704, 864, 960, 1024, 1236, 1600]) {
    const byFormula = railSlotOf(chat, 860, 24);
    const byGutter = railSlotFromGutter(byFormula.gutter);
    assert.deepEqual(byGutter, byFormula, `chat=${chat} 两条路径结果必须一致`);
  }
});

test("railSlotFromGutter：16px（手机内距）→ 不渲染；24 与 72 是两端", () => {
  assert.deepEqual(railSlotFromGutter(16), { visible: false, hit: 0, gutter: 16 });
  assert.deepEqual(railSlotFromGutter(24), { visible: true, hit: 24, gutter: 24 });
  assert.deepEqual(railSlotFromGutter(500), { visible: true, hit: RAIL_HIT_MAX, gutter: 500 });
});

test("比例锚点：顶 = 0、底 = count-1、单调不降", () => {
  assert.equal(railAnchorByFraction(0, 5000, 600, 100), 0);
  assert.equal(railAnchorByFraction(4400, 5000, 600, 100), 99);
  let previous = -1;
  for (let scrollTop = 0; scrollTop <= 4400; scrollTop += 220) {
    const anchor = railAnchorByFraction(scrollTop, 5000, 600, 100);
    assert.ok(anchor >= previous, "比例锚点必须单调");
    previous = anchor;
  }
});

test("比例锚点：滚不动（内容比视口短）/ 单条 → 0，不产生 NaN", () => {
  assert.equal(railAnchorByFraction(0, 500, 600, 50), 0);
  assert.equal(railAnchorByFraction(0, 5000, 600, 1), 0);
  assert.equal(railAnchorByFraction(Number.NaN, 5000, 600, 50) >= 0, true, "非法输入不产生 NaN");
});

test("抬底（2px）会撑破一步除法：总高必须真的 ≤ 可用高度（本项目实测 80 条 / 804px 溢出 83px）", () => {
  // 80 条 sqrt 高度、可用 804：原型的一步除法 `avail / natural` 会让总高变成 887px。
  const heights = Array.from({ length: 80 }, (_, index) => (index % 5 === 0 ? 4 : 26));
  const avail = 804;
  const { scale, total } = railScaleOf(heights, avail);
  assert.ok(total <= avail + 0.001, `总高 ${total.toFixed(1)} 必须 ≤ ${avail}（否则刻度会钻出容器）`);
  assert.ok(scale > 0 && scale < 1);
  // 逐条按渲染规则复算一遍，确认与实际渲染一致
  const rendered = heights.map((height) => Math.max(RAIL_TICK_FLOOR, height * scale));
  const sum = rendered.reduce((a, b) => a + b, 0) + (heights.length - 1) * RAIL_GAP;
  assert.ok(Math.abs(sum - total) < 0.001, "返回值与渲染规则必须同源");
});

test("二分求得的 scale 是最大值：再放大一点就装不下", () => {
  const heights = Array.from({ length: 50 }, () => 20);
  const avail = 400;
  const { scale } = railScaleOf(heights, avail);
  const at = (candidate) => heights.map((h) => Math.max(RAIL_TICK_FLOOR, h * candidate)).reduce((a, b) => a + b, 0) + 49 * RAIL_GAP;
  assert.ok(at(scale) <= avail + 0.001, "当前 scale 装得下");
  assert.ok(at(scale * 1.02) > avail, "再放大 2% 就装不下（不是随便给了一个更小的值）");
});

test("未全下载：滚到顶 = 已下载部分的第一条，不是刻度 0", () => {
  // 560 条刻度、只下载了最后 100 条（对应刻度 460..559）
  assert.equal(railAnchorWithLoadedTail(0, 9000, 800, 560, 460), 460);
  assert.equal(railAnchorWithLoadedTail(8200, 9000, 800, 560, 460), 559, "滚到底 = 最后一条");
  const middle = railAnchorWithLoadedTail(4100, 9000, 800, 560, 460);
  assert.ok(middle > 460 && middle < 559, "中间落在已下载区间内");
});

test("全下载完时退化成普通比例（loadedFrom=0）", () => {
  for (const scrollTop of [0, 1000, 4000, 8200]) {
    assert.equal(
      railAnchorWithLoadedTail(scrollTop, 9000, 800, 560, 0),
      railAnchorByFraction(scrollTop, 9000, 800, 560),
    );
  }
});

test("滚不动 / 非法输入 → 已下载起点，不产生 NaN", () => {
  assert.equal(railAnchorWithLoadedTail(0, 800, 800, 560, 460), 460);
  assert.equal(railAnchorWithLoadedTail(Number.NaN, 9000, 800, 560, 460), 460);
});
