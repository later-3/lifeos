import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_WIDTHS, HANDLE, MIN_CHAT, MIN_PANEL, RAIL,
  clampWidth, effectiveFolded, layout,
} from "../frontend/src/design/layout.ts";

/**
 * 布局不变量测试（前端开发路径 · 闸 3 的离线部分，不需要浏览器）。
 * 这些断言来自 2026-10-18 真实事故：三列全收时 rails 实占 108px、宽度数学按 20px 计，
 * 面板上限多算 48px，聊天列被压到 252px（代码却自称 MIN_CHAT=300）。
 */

const VIEWPORTS = [1024, 1280, 1440, 1600, 1920];
const FOLD_COMBOS = [
  { nav: false, projects: false, sessions: false },
  { nav: true, projects: false, sessions: false },
  { nav: false, projects: true, sessions: false },
  { nav: false, projects: false, sessions: true },
  { nav: true, projects: true, sessions: false },
  { nav: true, projects: false, sessions: true },
  { nav: false, projects: true, sessions: true },
  { nav: true, projects: true, sessions: true },
];

function total(box) {
  const openCols = [box.c1, box.c2, box.c3].filter((width) => width > 0).length;
  const handles = openCols * HANDLE + (box.panel > 0 ? HANDLE : 0);
  return box.rail + box.c1 + box.c2 + box.c3 + box.panel + box.chat + handles;
}

test("任何视口 × 折叠组合 × 面板开合，聊天列都不低于 MIN_CHAT", () => {
  for (const viewport of VIEWPORTS) {
    for (const requested of FOLD_COMBOS) {
      for (const panelOpen of [false, true]) {
        const box = layout({ viewport, widths: DEFAULT_WIDTHS, requested, panelOpen });
        assert.ok(box.chat >= MIN_CHAT, `viewport=${viewport} folded=${JSON.stringify(requested)} panel=${panelOpen} chat=${box.chat}`);
      }
    }
  }
});

test("宽度守恒：各段之和等于视口（不溢出、不留空）", () => {
  for (const viewport of VIEWPORTS) {
    for (const requested of FOLD_COMBOS) {
      for (const panelOpen of [false, true]) {
        const box = layout({ viewport, widths: DEFAULT_WIDTHS, requested, panelOpen });
        assert.equal(total(box), viewport, `viewport=${viewport} folded=${JSON.stringify(requested)} panel=${panelOpen} total=${total(box)}`);
      }
    }
  }
});

test("折叠成本常数化：收起任何层都只占一条 44px 轨，全展开为 0", () => {
  const none = layout({ viewport: 1600, widths: DEFAULT_WIDTHS, requested: FOLD_COMBOS[0], panelOpen: false });
  assert.equal(none.rail, 0, "全展开时不应有导航轨");
  for (const requested of FOLD_COMBOS.slice(1)) {
    const box = layout({ viewport: 1600, widths: DEFAULT_WIDTHS, requested, panelOpen: false });
    assert.equal(box.rail, RAIL, `收起 ${JSON.stringify(requested)} 的轨宽应为常数 ${RAIL}，实际 ${box.rail}`);
  }
});

test("窄视口自动降级：1024 收起项目列，<1000 再收会话列，聊天保底不破", () => {
  const requested = { nav: false, projects: false, sessions: false };
  const box = layout({ viewport: 1024, widths: DEFAULT_WIDTHS, requested, panelOpen: true });
  assert.equal(box.folded.projects, true, "1024 应自动收起项目列");
  assert.equal(box.folded.sessions, false, "1024 仍容得下会话列，不该替用户多收一列");
  assert.ok(box.chat >= MIN_CHAT);
  assert.equal(box.panel, 0, "1024 下面板放不下，必须自动收起");
  assert.equal(total(box), 1024);

  const tiny = layout({ viewport: 960, widths: DEFAULT_WIDTHS, requested, panelOpen: false });
  assert.equal(tiny.folded.sessions, true, "<1000 应再收会话列");
  assert.ok(tiny.chat >= MIN_CHAT);
});

test("面板宽度：要么收起(0)，要么不小于 MIN_PANEL 且不挤破聊天", () => {
  for (const viewport of VIEWPORTS) {
    const box = layout({ viewport, widths: DEFAULT_WIDTHS, requested: FOLD_COMBOS[0], panelOpen: true });
    assert.ok(box.panel === 0 || box.panel >= MIN_PANEL, `panel=${box.panel}`);
    assert.ok(box.panel === 0 ? box.panelFits === false : box.panelFits === true);
    assert.ok(box.tree <= box.panel);
  }
});

test("拖拽夹紧在声明区间内（c4 上限不再能压到聊天）", () => {
  assert.equal(clampWidth("c1", 10), 180);
  assert.equal(clampWidth("c1", 9999), 440);
  assert.equal(clampWidth("c4", 1), 320);
  assert.equal(clampWidth("c4t", 9999), 560);
});

test("折叠状态与视口无关地可恢复（放宽后不会被悄悄改写）", () => {
  const requested = { nav: false, projects: false, sessions: false };
  assert.deepEqual(effectiveFolded(requested, 1400), requested);
  assert.deepEqual(effectiveFolded(requested, 1100), { nav: false, projects: true, sessions: false });
  assert.deepEqual(effectiveFolded(requested, 960), { nav: false, projects: true, sessions: true });
});
