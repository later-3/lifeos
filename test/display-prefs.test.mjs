// 显示偏好（2026-11-02）：两个滑块 —— 内容宽度 + 字号。
// 断言集锁住：坏输入不抛、滑块与偏好可逆、宽度铺满语义、字号整组等比。
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PREFS, FONT_SCALE_MAX, FONT_SCALE_MIN, READING_MAX_PX, WIDTH_FLOOR_PX,
  avatarSizeOf, focusWidthOf, fontFromSlider, fontLabel, fontVars, parsePrefs,
  readingMaxForViewport, sliderFromFont, sliderFromWidth, widthFromSlider, widthLabel, widthVar,
} from "../frontend/src/display-prefs.ts";

test("默认值 = 现状（限宽 860、字号 100%），不改既有观感", () => {
  assert.equal(DEFAULT_PREFS.width.mode, "limited");
  assert.equal(DEFAULT_PREFS.width.value, READING_MAX_PX);
  assert.equal(DEFAULT_PREFS.font.scale, 1);
});

test("坏输入一律回默认，不抛（localStorage 可能被手改坏）", () => {
  for (const bad of [null, undefined, 0, "", [], "x", {}, { width: 1 }, { width: { value: "a" } }]) {
    const prefs = parsePrefs(bad);
    assert.equal(prefs.width.mode, "limited");
    assert.equal(prefs.font.scale, 1);
  }
});

test("超出范围的存量值被夹紧，不是丢弃", () => {
  const wide = parsePrefs({ width: { mode: "limited", value: 99_999 }, font: { scale: 5 } });
  assert.equal(wide.width.value, 4000, "超上限夹到绝对上限（不是 860：860 只是默认值）");
  assert.equal(wide.font.scale, FONT_SCALE_MAX);
  const narrow = parsePrefs({ width: { mode: "limited", value: 1 }, font: { scale: 0.1 } });
  assert.equal(narrow.width.value, WIDTH_FLOOR_PX, "超下限夹到 360");
  assert.equal(narrow.font.scale, FONT_SCALE_MIN);
});

test("宽度滑块 0% = 专注（视口 1/3），100% = 铺满", () => {
  const focus = widthFromSlider(0, 1920);
  assert.equal(focus.mode, "limited");
  assert.equal(focus.value, 640, "1920 的 1/3");
  const full = widthFromSlider(100, 1920);
  assert.equal(full.mode, "full", "拉到头 = 取消上限");
  assert.equal(widthVar(full), "none");
});

test("专注宽度不低于地板（窄窗口不能压到无法阅读）", () => {
  const focus = widthFromSlider(0, 900);   // 900/3 = 300 < 360
  assert.equal(focus.value, WIDTH_FLOOR_PX);
});

test("滑块与宽度偏好互为反函数（拖动位置能还原）", () => {
  for (const viewport of [1280, 1440, 1920]) {
    for (const percent of [0, 25, 50, 75, 100]) {
      const width = widthFromSlider(percent, viewport);
      const back = sliderFromWidth(width, viewport);
      assert.ok(Math.abs(back - percent) <= 1, `viewport=${viewport} percent=${percent} 往返得到 ${back}`);
    }
  }
});

test("字号滑块两端 = 85% / 200%（上限是用户 2026-11-02 亲定）", () => {
  assert.equal(fontFromSlider(0).scale, FONT_SCALE_MIN);
  assert.equal(fontFromSlider(100).scale, 2, "最大 200%");
  assert.equal(FONT_SCALE_MAX, 2);
  assert.ok(Math.abs(fontFromSlider(50).scale - 1.425) < 0.02);
});

test("字号滑块与偏好互为反函数", () => {
  for (const percent of [0, 30, 60, 100]) {
    const font = fontFromSlider(percent);
    assert.ok(Math.abs(sliderFromFont(font) - percent) <= 1);
  }
});

test("字号落到 CSS 用 calc 乘 tokens 基准，不写第二份 px（tokens.css 改基准时自动跟随）", () => {
  const vars = fontVars({ scale: 1.1 });
  assert.equal(vars["--text-scale"], "1.1");
  assert.equal(vars["--text-body"], "calc(var(--text-body-base) * 1.1)");
  // 关键：不得出现 px 字面量（那是第二份数值）
  for (const value of Object.values(vars)) {
    assert.equal(/px/.test(value), false, `字体变量里不许出现 px：${value}`);
  }
});

test("滑块的可访问名用统一文案（无障碍与测试同一份来源）", () => {
  assert.equal(widthLabel({ mode: "limited", value: 720 }), "内容宽度：720px");
  assert.equal(widthLabel({ mode: "full", value: READING_MAX_PX }), "内容宽度：铺满");
  assert.equal(fontLabel({ scale: 1.1 }), "字号：110%");
});

// ===== 2026-11-02 用户实测反馈的三个修正 =====

test("宽度滑块中间有完整行程：858 之后不会直接跳到铺满（实测 bug 回归锁）", () => {
  const viewport = 1643;
  // 沿滑块从左到右取值，限宽阶段必须单调递增且相邻两档不出现"巨大跳跃"
  const values = [];
  for (let percent = 0; percent <= 99; percent += 1) {
    const width = widthFromSlider(percent, viewport);
    assert.equal(width.mode, "limited", `${percent}% 仍应是限宽（铺满只在最右端）`);
    values.push(width.value);
  }
  const jumps = values.slice(1).map((value, index) => value - values[index]);
  assert.ok(jumps.every((jump) => jump > 0), "限宽阶段必须单调递增");
  // 视口 1643 时，整段行程 = 1643 - 548 ≈ 1095px，均摊到 100 档 ≈ 11px/档
  assert.ok(Math.max(...jumps) <= 20, `相邻档位跳变过大：${Math.max(...jumps)}px（说明行程被压缩了）`);
  // 用户明确点到的那个数字：858 之后还有很长的路才到铺满
  const at858 = sliderFromWidth({ mode: "limited", value: 858 }, viewport);
  assert.ok(at858 < 55, `858px 应位于滑块中段，实际 ${at858}%`);
});

test("滑块右端 = 视口宽（而不是 860），小窗口也不退化", () => {
  assert.equal(readingMaxForViewport(1643), 1643);
  assert.equal(readingMaxForViewport(1280), 1280);
  // 视口极窄时，终点至少比专注宽一档，避免滑块变成一点
  const tiny = readingMaxForViewport(600);
  assert.ok(tiny > focusWidthOf(600), `终点 ${tiny} 必须大于专注 ${focusWidthOf(600)}`);
});

test("头像随字号放大（用户：字号变大而头像不变会畸形）", () => {
  assert.equal(avatarSizeOf(22, 1), 22, "100% 时保持基准");
  assert.equal(avatarSizeOf(22, 0.85), 22, "字号调小时头像不低于基准（保住可识别性）");
  assert.equal(avatarSizeOf(22, 1.3), 29);
  assert.equal(avatarSizeOf(22, 2), 35, "200% 时 22 → 35");
  // 上限 1.6 倍，避免头像在极大字号下吃掉正文宽度
  assert.equal(avatarSizeOf(22, 9), 35);
});

test("字号上限 200% 能真正落到 CSS（不是只改了滑块）", () => {
  const vars = fontVars(fontFromSlider(100));
  assert.equal(vars["--text-scale"], "2");
  assert.equal(vars["--text-body"], "calc(var(--text-body-base) * 2)");
});
