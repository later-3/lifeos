import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_REVIEW_RATIO, DEFAULT_WIDTHS, HANDLE, MIN_CHAT, MIN_PANEL, MIN_REVIEW, MIN_VIEWER, RAIL, WIDTH_LIMITS,
  clampWidth, dragCascade, dragWidth, layout, maxWidthOf, reviewPxOfRatio, reviewRatioOfPx,
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
  // 1280 宽：44 + 232 + 420 = 696 → 最多可给 c2 584。
  // **不再减 HANDLE_HIT(8)**（2026-11-09 又抓到一次漂移）：`layout()` 的预算里没有它，
  // 多减 8 会让"拖到 576 就停，而面板实际能到 584"—— 同一类缺陷的第二次。
  assert.equal(maxWidthOf("c2", 1280, widths, folded), 1280 - 44 - 232 - 420);
  // 1440 宽：算式同样成立，且大于旧常量上限 440
  assert.equal(maxWidthOf("c2", 1440, widths, folded), 1440 - 44 - 232 - 420);
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

test("c4t（文件树）的上限与 layout 的 panel 同源，不是视口", () => {
  // 2026-11-09 第二次修：旧实现在这里自己又算了一遍 panelLimit，与 layout 的公式差一档
  // → 1440 上树默认 240、这里算出上限 230，一按下去就被夹到 230 然后纹丝不动。
  // 现在上限直接由 layout 的 panel 推出，两处公式不可能再漂移。
  const folded = { nav: false, groups: false };
  for (const viewport of [1440, 1600, 1920]) {
    const widths = { ...DEFAULT_WIDTHS, c4: 600 };
    const box = layout({ viewport, widths, requested: folded, panelOpen: true });
    assert.equal(maxWidthOf("c4t", viewport, widths, folded), Math.max(WIDTH_LIMITS.c4t[0], box.panel - MIN_VIEWER),
      `${viewport}: 上限必须等于 panel − MIN_VIEWER（panel=${box.panel}）`);
    assert.ok(maxWidthOf("c4t", viewport, widths, folded) >= box.tree, `${viewport}: 上限不能低于当前渲染宽（否则拖不动）`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 检视面板（Task 0010 · P2）：比例制宽度 + 并存不互斥（D12 / D10）
//
// 2026-11-05 用户实测报"一左右拖动就有问题"。三个可复现事实（修前）：
//   ① 拖到上限后往回拉 163px 面板不动（死区：比例在涨而像素被 layout 截断）；
//   ② 换视口面板自己跳（666px @1680 → 868px @1920，用户没拖）；
//   ③ 打开文件面板后再开检视，检视宽度直接 0（点了没反应）。
// 本节把三条都锁成断言，红过的断言不许删。
// ─────────────────────────────────────────────────────────────────────────────

test("检视宽度 = 视口 × 比例（换屏严格等比例，不跳变）", () => {
  const requested = { nav: false, groups: false };
  const ratio = DEFAULT_REVIEW_RATIO;
  for (const viewport of [1280, 1440, 1600, 1680, 1920, 2560]) {
    const box = layout({ viewport, widths: DEFAULT_WIDTHS, requested, panelOpen: false, reviewOpen: true, reviewRatio: ratio });
    if (!box.reviewFits) {
      assert.equal(box.review, 0, `viewport=${viewport}：放不下时宽度必须是 0（不偷偷截一半）`);
      continue;
    }
    const expected = Math.min(box.reviewBudget, Math.round(viewport * ratio));
    assert.equal(box.review, expected, `viewport=${viewport}：review 应严格等于 min(预算, 视口×比例)`);
  }
});

test("比例 ↔ 像素往返无损，且限度内 1px 跟手（无死区、无跳变）", () => {
  const viewport = 1680;
  const budget = 666;
  // 往返：px → ratio → px 必须在同预算下回到同一个像素
  for (const px of [360, 420, 529, 600, 666]) {
    const ratio = reviewRatioOfPx(viewport, px, budget);
    assert.equal(reviewPxOfRatio(viewport, ratio), px, `往返丢了像素：${px}px → ratio ${ratio}`);
  }
  // 跟手：拖过头后再往回拉 1px 必须立刻变窄（旧实现这里有 163px 死区）
  let ratio = reviewRatioOfPx(viewport, 666, budget); // 拖到上限
  assert.ok(reviewPxOfRatio(viewport, ratio) === 666);
  ratio = reviewRatioOfPx(viewport, 666 - 1, budget); // 回拉 1px
  assert.equal(reviewPxOfRatio(viewport, ratio), 665, "回拉 1px 面板必须跟着缩 1px");
});

test("拖动区间由 layout 的预算定（不能拖到比预算更宽）", () => {
  const viewport = 1680;
  for (const budget of [360, 500, 666, 900, 1200]) {
    const ratio = reviewRatioOfPx(viewport, 99999, budget); // 拼命往左拖
    assert.ok(reviewPxOfRatio(viewport, ratio) <= budget, `budget=${budget} 被拖破了`);
  }
});

test("检视与文件面板并存：两者同时开时聊天仍 ≥ MIN_CHAT，宽度守恒", () => {
  // 并存的前提是"右侧预算够"（左边列可以收：openReview 在放不下时自动收左列，同 openHistory）。
  for (const viewport of [1680, 1920]) {
    const requested = { nav: true, groups: true }; // 左列收进导航轨
    const box = layout({ viewport, widths: DEFAULT_WIDTHS, requested, panelOpen: true, reviewOpen: true, reviewRatio: DEFAULT_REVIEW_RATIO });
    assert.ok(box.panel > 0 && box.review > 0, `viewport=${viewport}：文件面板与检视必须能同时开（D10）`);
    assert.ok(box.chat >= MIN_CHAT, `viewport=${viewport}：两面板同时开不许压破聊天，实际 ${box.chat}`);
    assert.equal(box.rail + box.panel + HANDLE + box.review + HANDLE + box.chat, viewport,
      `viewport=${viewport}：宽度必须守恒`);
  }
});

test("放不下时 review=0 且 reviewFits=false（调用方据此提示，不许静默消失）", () => {
  const requested = { nav: false, groups: false };
  // 窄窗口 + 文件面板 600：右侧预算不够 MIN_REVIEW
  const box = layout({ viewport: 1366, widths: DEFAULT_WIDTHS, requested, panelOpen: true, reviewOpen: true });
  assert.equal(box.reviewFits, false);
  assert.equal(box.review, 0);
  // 同样视口下收掉左列（openReview 的降级动作）：又能放下了
  const folded = layout({ viewport: 1366, widths: DEFAULT_WIDTHS, requested: { nav: true, groups: true }, panelOpen: false, reviewOpen: true });
  assert.equal(folded.reviewFits, true, "收掉左列后 1366 应能放下检视");
  assert.ok(folded.review >= MIN_REVIEW);
});


test("检视宽度没有绝对像素上限：只受右侧预算约束（2026-11-05 用户拍板）", () => {
  const requested = { nav: false, groups: false };
  /**
   * 预算口径 = 视口 − 左列 − 把手 − 聊天保底。
   *
   * **左边两项用常量算，不写字面量**（2026-11-09 合并 Task 0009 时修）：
   * 原断言把 `588` 与 `6` 写死了，那是 Task 0006 之前的几何（HANDLE=6 占布局宽度、
   * 左列含两道把手）。Task 0006 已把把手改成浮层（`HANDLE = 0`），写死的数字随之过期 ——
   * 断言失败但**实现是对的**。数字一旦写死就会在无关改动里假红，用常量表达才有意义。
   */
  const leftCost = RAIL + DEFAULT_WIDTHS.c1 + DEFAULT_WIDTHS.c2 + 2 * HANDLE;
  const wide = layout({ viewport: 2560, widths: DEFAULT_WIDTHS, requested, panelOpen: false, reviewOpen: true, reviewRatio: 1 });
  assert.equal(wide.reviewBudget, 2560 - leftCost - 420, "预算口径 = 视口 − 左列 − 把手 − 聊天保底");
  assert.equal(wide.review, wide.reviewBudget, "比例拉满时应当拿到整个预算（不再被 1200 截断）");
  assert.ok(wide.review > 1200, `2560 下应能超过旧上限 1200，实际 ${wide.review}`);
  assert.ok(wide.chat >= MIN_CHAT, "任何情况下对话保底不破");
  // 3200 下按比例算出来超过预算时，仍由预算封顶（对话保底是唯一硬约束）
  const wider = layout({ viewport: 3200, widths: DEFAULT_WIDTHS, requested, panelOpen: false, reviewOpen: true, reviewRatio: 0.9 });
  assert.equal(wider.review, Math.min(wider.reviewBudget, Math.round(3200 * 0.9)), "预算与比例的较小者");
  assert.equal(wider.reviewBudget, 3200 - leftCost - 420);
  assert.ok(wider.chat >= MIN_CHAT, "封顶后对话仍保底");
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 嵌套列的拖动（2026-11-09 用户第二次报「文件树区域的拖动很垃圾」）
 *
 * 事实：文件树 c4t 长在文件面板 c4 里面。旧上限是「面板 − 查看器最小宽」，
 * 而面板本身被视口钳住 → 1440 窗口上 c4t 只剩 160–238 的可动范围（默认 240 = 拖不动），
 * 1280 上面板放不下 → 连把手都没有。
 * 用户要的是**一类问题的解法**：内层顶到边界时外层跟着长（VS Code 的 sash 同款），
 * 而不是把 238 改成 300 这种单点修补。
 * ───────────────────────────────────────────────────────────────────────────── */

/*
 * 嵌套拖动（c4t ⊂ c4）—— 2026-11-09 用户第二次报「文件树区域的拖动很垃圾」。
 *
 * 断言的是**用户能看到的结果**（渲染后的 tree / panel / chat），不是内部补丁的形状
 * ——补丁长什么样是实现细节，改实现时不该让这些测试跟着改。
 */
function dragTree(startWidths, deltaX, viewport) {
  const folded = { nav: false, groups: false };
  const patch = dragCascade("c4t", startWidths, deltaX, viewport, folded);
  const widths = { ...startWidths, ...patch };
  return { patch, box: layout({ viewport, widths, requested: folded, panelOpen: true }) };
}

test("嵌套拖动：往回拖只缩内层，外层不动（不回弹）", () => {
  const start = { ...DEFAULT_WIDTHS, c4: 700, c4t: 400 };
  const folded = { nav: false, groups: false };
  // 基准是**渲染宽**（1600 上面板被钳到 604 → 树 398），不是存储的 400
  const rendered = layout({ viewport: 1600, widths: start, requested: folded, panelOpen: true }).tree;
  const { patch } = dragTree(start, -100, 1600);
  assert.equal(patch.c4, undefined, "外层不该缩小（否则表现为「一拖就弹回」）");
  assert.equal(patch.c4t, rendered - 100, `内层从渲染宽 ${rendered} 缩 100`);
});

test("嵌套拖动：内层不低于它的下限", () => {
  const start = { ...DEFAULT_WIDTHS, c4: 600, c4t: 240 };
  const { patch } = dragTree(start, -9999, 1600);
  assert.equal(patch.c4t, WIDTH_LIMITS.c4t[0], "夹到下限 160");
});

test("嵌套拖动：内层变大时一定真的变大（1440 也能拖，不被上限吃掉）", () => {
  // 反例（修前）：1440 + 左两列展开 → 面板 444、树 240，而上限按 444−206=238 算 →
  // 一按下去就夹到 238，拖 400px 宽度取值只有 1 个（用户看到的是"拖不动"）。
  for (const viewport of [1440, 1600, 1920]) {
    const start = { ...DEFAULT_WIDTHS };
    const { box } = dragTree(start, 120, viewport);
    assert.ok(box.tree > 240, `${viewport}: 拖 +120 后树应变宽（实际 ${box.tree}）`);
    assert.ok(box.chat >= MIN_CHAT, `${viewport}: 聊天保底不能破（实际 ${box.chat}）`);
  }
});

test("嵌套拖动：内层顶到边界后，面板跟着长；面板到顶才从左列借宽", () => {
  const start = { ...DEFAULT_WIDTHS };
  // 1920 +80：面板还有余量，左列不该被动
  const wide = dragTree(start, 80, 1920);
  assert.ok(wide.box.panel > 600, "面板应变宽");
  assert.equal(wide.box.c1, start.c1, "空间足够时不该借左列的宽");
  // 1440：面板到顶，从左列借（c2 先借到 240，再借 c1）
  const narrow = dragTree(start, 400, 1440);
  assert.ok(narrow.box.tree > 240, "内层必须真的变宽");
  assert.ok(narrow.box.c2 <= start.c2, "应从会话列借宽");
  assert.equal(narrow.box.chat, MIN_CHAT, "借到底时聊天正好是保底");
  // 借宽不能让任何列低于它的下限
  assert.ok(narrow.box.c1 >= 180 && narrow.box.c2 >= 240, `左列不能低于下限：c1=${narrow.box.c1} c2=${narrow.box.c2}`);
});

test("嵌套拖动：拖到最远后，查看器保底仍成立（内层不会吃掉整个面板）", () => {
  for (const viewport of [1440, 1600, 1920]) {
    const start = { ...DEFAULT_WIDTHS };
    const { box } = dragTree(start, 9999, viewport);
    assert.ok(box.panel - box.tree >= MIN_VIEWER, `${viewport}: 查看器保底 ${MIN_VIEWER}（实际 ${box.panel - box.tree}）`);
    assert.ok(box.chat >= MIN_CHAT, `${viewport}: 聊天保底`);
  }
});

test("嵌套拖动：多帧连续拖（模拟真实手势）时单调变宽、不回跳", () => {
  const folded = { nav: false, groups: false };
  let widths = { ...DEFAULT_WIDTHS };
  const trees = [];
  for (let step = 0; step < 12; step += 1) {
    widths = { ...widths, ...dragCascade("c4t", widths, 20, 1440, folded) };
    trees.push(layout({ viewport: 1440, widths, requested: folded, panelOpen: true }).tree);
  }
  for (let index = 1; index < trees.length; index += 1) {
    assert.ok(trees[index] >= trees[index - 1], `第 ${index} 帧不该变小：${trees.join(",")}`);
  }
  assert.ok(trees[trees.length - 1] > trees[0], `整体必须变宽：${trees.join(",")}`);
});

test("普通列（无嵌套）的拖动结果与 dragWidth 完全一致", () => {
  const folded = { nav: false, groups: false };
  for (const key of ["c1", "c2", "c5"]) {
    const start = { ...DEFAULT_WIDTHS };
    const limit = maxWidthOf(key, 1440, start, folded);
    assert.equal(dragCascade(key, start, 40, 1440, folded)[key], dragWidth(key, start[key], 40, limit),
      `${key} 应与单列拖动一致`);
  }
});
