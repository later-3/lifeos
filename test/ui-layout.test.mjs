import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_WIDTHS, HANDLE, MIN_CHAT, MIN_PANEL, RAIL,
  clampWidth, dragWidth, layout,
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
  // 浮层模式下列不占聊天宽度（只占图标轨）
  const openCols = [box.c1, box.c2, box.c3].filter((width) => width > 0).length;
  const columns = box.overlayLeft ? 0 : box.c1 + box.c2 + box.c3 + openCols * HANDLE;
  const panel = box.panel > 0 ? box.panel + HANDLE : 0;
  return box.rail + columns + box.chat + panel;
}

test("面板/完整历史永不吃掉聊天保底；只有列本身占宽时才可能低于 MIN_CHAT", () => {
  // 2026-10-18 起：图标轨常驻且不再按视口强制收起列（VS Code Activity Bar 范式），
  // 所以"聊天永远 ≥ MIN_CHAT"只在左三列让得出空间时成立；不再成立时面板/历史必须为 0。
  for (const viewport of VIEWPORTS) {
    for (const requested of FOLD_COMBOS) {
      for (const panelOpen of [false, true]) {
        const box = layout({ viewport, widths: DEFAULT_WIDTHS, requested, panelOpen });
        const openCols = [box.c1, box.c2, box.c3].filter((width) => width > 0).length;
        // 浮层模式下左三列不占聊天宽度（只占图标轨）
        const leftCost = box.overlayLeft ? box.rail : box.rail + box.c1 + box.c2 + box.c3 + openCols * HANDLE;
        if (viewport - leftCost >= MIN_CHAT) {
          assert.ok(box.chat >= MIN_CHAT, `有空间时必须保底：viewport=${viewport} folded=${JSON.stringify(requested)} chat=${box.chat}`);
        } else {
          assert.equal(box.panel, 0, `没空间时不许再开面板：viewport=${viewport} folded=${JSON.stringify(requested)}`);
          assert.equal(box.history, 0, `没空间时不许再开完整历史：viewport=${viewport}`);
        }
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

test("图标轨常驻：收起/展开都是同一条 44px（不随折叠数变化）", () => {
  for (const requested of FOLD_COMBOS) {
    const box = layout({ viewport: 1600, widths: DEFAULT_WIDTHS, requested, panelOpen: false });
    assert.equal(box.rail, RAIL, `folded=${JSON.stringify(requested)} 的轨宽应为常数 ${RAIL}，实际 ${box.rail}`);
  }
});

test("窄视口不再替用户收起列（点了不会弹回），改为压缩列/聊天", () => {
  const requested = { nav: false, projects: false, sessions: false };
  const narrow = layout({ viewport: 1024, widths: DEFAULT_WIDTHS, requested, panelOpen: true });
  assert.deepEqual(narrow.folded, requested, "用户的收展状态必须原样生效（旧规则会强制收项目列）");
  assert.equal(narrow.overlayLeft, true, "1024 并列放不下 → 左三列改浮层");
  assert.ok(narrow.chat >= MIN_CHAT, `浮层模式下聊天仍要保底，实际 ${narrow.chat}`);
  assert.equal(total(narrow), 1024, "宽度仍然守恒（浮层不占聊天宽度）");

  const tiny = layout({ viewport: 960, widths: DEFAULT_WIDTHS, requested, panelOpen: false });
  assert.deepEqual(tiny.folded, requested, "960 也不强制收起会话列");
  assert.equal(total(tiny), 960);
});

test("宽窗口并列、窄窗口浮层：分界由「并列 + 聊天保底」决定", () => {
  const requested = { nav: false, projects: false, sessions: false };
  const wide = layout({ viewport: 1600, widths: DEFAULT_WIDTHS, requested, panelOpen: false });
  assert.equal(wide.overlayLeft, false, "1600 够放 → 并列");
  const border = layout({ viewport: 1202, widths: DEFAULT_WIDTHS, requested, panelOpen: false });
  assert.equal(border.overlayLeft, false, "1202 刚好够放（782 + 420）→ 仍并列");
  assert.ok(border.chat >= MIN_CHAT);
  const over = layout({ viewport: 1201, widths: DEFAULT_WIDTHS, requested, panelOpen: false });
  assert.equal(over.overlayLeft, true, "1201 差 1px → 转浮层");
  assert.ok(over.chat > MIN_CHAT, "浮层后聊天反而更宽（不让内容被压扁）");
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

test("把手方向由位置决定，不由 key 名决定（右侧停靠面板反号）", () => {
  // 左列表：把手在右缘 → 右拉变大
  assert.equal(dragWidth("c1", 232, 40), 272);
  assert.equal(dragWidth("c2", 216, -40), 176);
  // 右侧停靠面板：把手在左缘 → 左拉变大、右拉变小
  assert.equal(dragWidth("c4", 600, -60), 660);
  assert.equal(dragWidth("c5", 440, -60), 500);
  assert.equal(dragWidth("c5", 440, 60), 380);
  // 夹紧仍生效
  assert.equal(dragWidth("c5", 440, -9999), 720);
  assert.equal(dragWidth("c5", 440, 9999), 360);
});
