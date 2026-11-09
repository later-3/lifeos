import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_WIDTHS, HANDLE, MIN_CHAT, MIN_PANEL, MIN_VIEWER, RAIL,
  clampWidth, dragWidth, layout, maxWidthOf,
} from "../frontend/src/design/layout.ts";

/**
 * 布局不变量测试（前端开发路径 · 闸 3 的离线部分，不需要浏览器）。
 * 这些断言来自 2026-10-18 真实事故：三列全收时 rails 实占 108px、宽度数学按 20px 计，
 * 面板上限多算 48px，聊天列被压到 252px（代码却自称 MIN_CHAT=300）。
 */

const VIEWPORTS = [1024, 1280, 1440, 1600, 1920];
// Task 0015 · T15 合并后：折叠态从 8 种降到 4 种（P-02 §5.2 / §6：图标栏 3→2）
const FOLD_COMBOS = [
  { nav: false, groups: false },
  { nav: true, groups: false },
  { nav: false, groups: true },
  { nav: true, groups: true },
];

function total(box) {
  // 浮层模式下列不占聊天宽度（只占图标轨）
  const openCols = [box.c1, box.c2].filter((width) => width > 0).length;
  const columns = box.overlayLeft ? 0 : box.c1 + box.c2 + openCols * HANDLE;
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
        const openCols = [box.c1, box.c2].filter((width) => width > 0).length;
        // 浮层模式下左列不占聊天宽度（只占图标轨）
        const leftCost = box.overlayLeft ? box.rail : box.rail + box.c1 + box.c2 + openCols * HANDLE;
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
  const requested = { nav: false, groups: false };
  const narrow = layout({ viewport: 1024, widths: DEFAULT_WIDTHS, requested, panelOpen: true });
  assert.deepEqual(narrow.folded, requested, "用户的收展状态必须原样生效（旧规则会强制收项目列）");
  // Task 0015 · T15：合并后 1024 宽**并列放得下**（旧版是 1202 才够）。
  // 这正是合并的硬理由：13 寸笔记本上不再整体退化成抽屉。
  // Task 0006 后阈值降到 996（把手不占宽），1024 仍并列。
  assert.equal(narrow.overlayLeft, false, "合并后 1024 宽可以直接并列（阈值 996）");
  assert.ok(narrow.chat >= MIN_CHAT, `浮层模式下聊天仍要保底，实际 ${narrow.chat}`);
  assert.equal(total(narrow), 1024, "宽度仍然守恒（浮层不占聊天宽度）");

  const tiny = layout({ viewport: 960, widths: DEFAULT_WIDTHS, requested, panelOpen: false });
  assert.deepEqual(tiny.folded, requested, "960 也不强制收起对话列");
  assert.equal(tiny.overlayLeft, true, "960 < 1008 → 转浮层");
  assert.equal(total(tiny), 960);
});

test("宽窗口并列、窄窗口浮层：分界由「并列 + 聊天保底」决定", () => {
  const requested = { nav: false, groups: false };
  const wide = layout({ viewport: 1600, widths: DEFAULT_WIDTHS, requested, panelOpen: false });
  assert.equal(wide.overlayLeft, false, "1600 够放 → 并列");
  // 把手不再占布局宽度（Task 0006）→ 分界 = rail(44) + c1(232) + c2(300) + MIN_CHAT(420) = 996
  const threshold = RAIL + DEFAULT_WIDTHS.c1 + DEFAULT_WIDTHS.c2 + MIN_CHAT;
  const border = layout({ viewport: threshold, widths: DEFAULT_WIDTHS, requested, panelOpen: false });
  assert.equal(border.overlayLeft, false, `${threshold} 刚好够放 → 仍并列`);
  assert.ok(border.chat >= MIN_CHAT);
  const over = layout({ viewport: threshold - 1, widths: DEFAULT_WIDTHS, requested, panelOpen: false });
  assert.equal(over.overlayLeft, true, `${threshold - 1} 差 1px → 转浮层`);
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
  assert.equal(clampWidth("c4", 1), 320);
  assert.equal(clampWidth("c4t", 9999), 560);
  // c1 / c2 的常量表上限都是**技术兜底**，不是真实可视上限（Task 0006 + 2026-11-09）：
  // 真实值看 maxWidthOf。两列必须同一套规则，否则拖动时一列撞常量墙、另一列不撞，
  // 手感不同（用户 2026-11-09 报的就是这个）。
  assert.equal(clampWidth("c1", 99999), 4096, "c1 只有技术兜底，没有任务上限");
  assert.equal(clampWidth("c2", 99999), 4096, "c2 只有技术兜底，没有任务上限");
});

test("两列的可用上限都由视口算（同一套规则，不靠各自的常量）", () => {
  const folded = { nav: false, groups: false };
  const widths = { ...DEFAULT_WIDTHS };
  for (const key of ["c1", "c2"]) {
    const limit = maxWidthOf(key, 1440, widths, folded);
    // 常量表里没有能把它们卡在几何上限之前的数
    assert.equal(clampWidth(key, 99999, limit), limit, `${key} 撞到的应该是几何上限，不是常量`);
    assert.ok(limit > 440, `${key} 在 1440 上必须能超过旧的 440（实际 ${limit}）`);
  }
});

test("列宽的真实上限由视口算（Task 0006）：c2 不该停在 440", () => {
  const folded = { nav: false, groups: false };
  const widths = { ...DEFAULT_WIDTHS, c2: 300 };
  // 1280 宽：44 + 232 + 420 + 8 = 704 → 最多可给 c2 576；旧常量 440 会提前卡住
  assert.equal(maxWidthOf("c2", 1280, widths, folded), 1280 - 44 - 232 - 420 - 8);
  // 1440 宽：算式同样成立，且大于旧常量上限 440
  assert.equal(maxWidthOf("c2", 1440, widths, folded), 1440 - 44 - 232 - 420 - 8);
  assert.ok(maxWidthOf("c2", 1440, widths, folded) > 440, "1440 上必须能超过旧的 440");
  // 1024 宽：几何上限比常量更小，夹紧后不会触发 overlay（拖到头也不丢列）
  const limit1024 = maxWidthOf("c2", 1024, widths, folded);
  const afterDrag = dragWidth("c2", 300, 9999, limit1024);
  assert.equal(afterDrag, limit1024);
  const box = layout({ viewport: 1024, widths: { ...DEFAULT_WIDTHS, c2: afterDrag }, requested: folded, panelOpen: false });
  assert.equal(box.overlayLeft, false, "拖到几何上限时不得整块左区变浮层");
  assert.ok(box.chat >= MIN_CHAT, `表面拉开时聊天仍保底：${box.chat}`);
});

test("把手不占布局宽度（Task 0006）：两列之间没有 6px 缝", () => {
  assert.equal(HANDLE, 0, "HANDLE 必须为 0：缝就是“白缝+细线”三明治的根因");
  const box = layout({ viewport: 1440, widths: DEFAULT_WIDTHS, requested: { nav: false, groups: false }, panelOpen: false });
  // 各段相加仍等于视口，且聊天列面积比旧实现（两个 6px 缝）多 12px
  assert.equal(total(box), 1440);
  assert.equal(box.chat, 1440 - box.rail - box.c1 - box.c2);
});

test("把手方向由位置决定，不由 key 名决定（右侧停靠面板反号）", () => {
  // 左列表：把手在右缘 → 右拉变大
  assert.equal(dragWidth("c1", 232, 40), 272);
  // c2 = 合并后的"项目分组 → 会话"列：下限 240，上限由视口给（maxWidthOf）。
  // 从 300 往左拉 40 → 260（在区间内，原样生效）
  assert.equal(dragWidth("c2", 300, -40), 260);
  // 再往左拉会撞下限 240：夹紧生效，不会退化成 176
  assert.equal(dragWidth("c2", 300, -100), 240);
  // 给了视口上限时，上限优先（这是“能一直拖到物理极限”的实现）
  assert.equal(dragWidth("c2", 300, 9999, 520), 520);
  // 右侧停靠面板：把手在左缘 → 左拉变大、右拉变小
  assert.equal(dragWidth("c4", 600, -60), 660);
  assert.equal(dragWidth("c5", 440, -60), 500);
  assert.equal(dragWidth("c5", 440, 60), 380);
  // 夹紧仍生效
  assert.equal(dragWidth("c5", 440, -9999), 720);
  assert.equal(dragWidth("c5", 440, 9999), 360);
});

test("c4t（文件树）的上限是「面板 − 查看器最小宽」，不是视口", () => {
  // 2026-11-09 实测：拖 c4t 到 300，松手回弹到 270 —— 存进去的超出面板能给的，
  // layout() 再钳回来（tree = min(widths.c4t, panel − MIN_VIEWER)）。
  // 拖到哪就该停在哪：上限必须是这条真实可视上限。
  const folded = { nav: false, groups: false };
  const widths = { ...DEFAULT_WIDTHS, c4: 600 };
  const limit = maxWidthOf("c4t", 1600, widths, folded);
  const panel = Math.min(widths.c4, 1600 - RAIL - widths.c1 - widths.c2 - MIN_CHAT - 8);
  assert.equal(clampWidth("c4t", 9999, limit), panel - MIN_VIEWER,
    "c4t 拖到头应停在 panel − MIN_VIEWER，不是更宽的视口上限");
  // 窄面板时同样成立
  const narrow = maxWidthOf("c4t", 1600, { ...widths, c4: MIN_PANEL }, folded);
  assert.equal(clampWidth("c4t", 9999, narrow), Math.max(160, MIN_PANEL - MIN_VIEWER));
});
