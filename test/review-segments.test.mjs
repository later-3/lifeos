// 检视模式 S1·G1b：段切分与展开的穷举单测（纯函数，先红后绿）。
//
// 参考的测试场景：
//  - difit `useExpandedLines.test.ts`：revision 变清空展开态、diff identity 变清空、stdin 不请求 blob
//    （我们的对应物：buildSegments 每次按新数据重算，展开态由面板持有并随 data 重置）
//  - difit `ExpandButton`：`hiddenLines <= DEFAULT_EXPAND_COUNT` 时只给「全部」
//  - 行终止符纪律（DSH ADR）：空文本 = 0 行、末尾换行不产生幻影行、内部空行保留
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSegments, expandActions, expansionOf, expandStep, canCollapse, sliceHiddenLines, DEFAULT_EXPAND_COUNT,
} from "../frontend/src/review-segments.ts";

const line = (type, oldNo, newNo, text) => ({ type, oldNo, newNo, text });

/** 单 hunk：3 行上下文 + 1 改 + 3 行上下文（git --unified=3 的典型形状）。 */
const single = [
  {
    oldStart: 5, oldLines: 7, newStart: 5, newLines: 7,
    lines: [
      line("context", 5, 5, "a"), line("context", 6, 6, "b"), line("context", 7, 7, "c"),
      line("removed", 8, null, "old"), line("added", null, 8, "new"),
      line("context", 9, 9, "d"), line("context", 10, 10, "e"), line("context", 11, 11, "f"),
    ],
  },
];

test("G1b·1 mode=all：hunk 内无隐藏段，只有文件头隐藏（oldStart=5 → 前 4 行）", () => {
  const segments = buildSegments(single, { mode: "all", context: 3, emitHeadTail: true });
  assert.equal(segments.length, 2, `段数=${segments.length}`);
  assert.deepEqual(segments[0], { kind: "hidden", region: "head", count: 4, oldFrom: 1, newFrom: 1 });
  assert.equal(segments[1].kind, "lines");
  assert.equal(segments[1].lines.length, 8);
});

test("G1b·2 mode=diff context=3：hunk 内远端上下文被折（此例 3 行足距，故无 hunk 内隐藏）", () => {
  const segments = buildSegments(single, { mode: "diff", context: 3, emitHeadTail: true });
  const hiddenInHunk = segments.filter((s) => s.kind === "hidden" && s.region === "hunk");
  assert.equal(hiddenInHunk.length, 0, "距离 ≤3 的上下文都可见");
  const visible = segments.filter((s) => s.kind === "lines").flatMap((s) => s.lines);
  assert.equal(visible.length, 8);
});

test("G1b·3 mode=diff context=0：只剩改动行，上下文全折（前后两段各自独立，被改动行隔开）", () => {
  const segments = buildSegments(single, { mode: "diff", context: 0, emitHeadTail: true });
  const visible = segments.filter((s) => s.kind === "lines").flatMap((s) => s.lines);
  assert.deepEqual(visible.map((l) => l.type), ["removed", "added"]);
  // 改动行把前后两块上下文隔开，**不应**被合并；文件头与前面的上下文是同一块，会被合并
  const hunkHidden = segments.filter((s) => s.kind === "hidden");
  assert.equal(hunkHidden.length, 2, `改动前（含文件头）与改动后各一段，实际 ${hunkHidden.length}：${hunkHidden.map(h=>h.region+":"+h.count)}`);
  assert.deepEqual(hunkHidden.map((s) => s.count), [7, 3], "前段 = 文件头 4 行 + 上下文 3 行（同一块未改动区域）");
  assert.equal(hunkHidden[0].oldFrom, 1, "前段从 old 1 起（含文件头）");
  assert.equal(hunkHidden[1].oldFrom, 9, "后段从 old 9 起");
});

test("G1b·4 两个 hunk 之间：gap 段行数 = next.oldStart − (oldStart+oldLines)", () => {
  const hunks = [
    { oldStart: 2, oldLines: 3, newStart: 2, newLines: 3, lines: [line("context", 2, 2, "x"), line("removed", 3, null, "y"), line("added", null, 3, "Y")] },
    { oldStart: 40, oldLines: 3, newStart: 40, newLines: 3, lines: [line("context", 40, 40, "p"), line("removed", 41, null, "q"), line("added", null, 41, "Q")] },
  ];
  const segments = buildSegments(hunks, { mode: "all", context: 3, emitHeadTail: true });
  const gap = segments.find((s) => s.kind === "hidden" && s.region === "gap");
  assert.ok(gap, "有 gap 段");
  assert.equal(gap.count, 40 - (2 + 3), `gap = 35，实际 ${gap.count}`);
  assert.equal(gap.oldFrom, 5);
  assert.equal(gap.newFrom, 5);
});

test("G1b·5 文件尾：已知总行数才给尾段；未知不给（不假装知道）", () => {
  const withTotal = buildSegments(single, { mode: "all", context: 3, totalOld: 20, totalNew: 20, emitHeadTail: true });
  const tail = withTotal.find((s) => s.kind === "hidden" && s.region === "tail");
  assert.ok(tail, "已知总行数 → 有尾段");
  assert.equal(tail.count, 20 - 11, `尾段 = 9，实际 ${tail.count}`);

  const withoutTotal = buildSegments(single, { mode: "all", context: 3, emitHeadTail: true });
  assert.equal(withoutTotal.some((s) => s.kind === "hidden" && s.region === "tail"), false, "未知总行数 → 无尾段");
});

test("G1b·6 文件从第 1 行开始改：无头段", () => {
  const hunks = [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [line("removed", 1, null, "a"), line("added", null, 1, "A"), line("context", 2, 2, "b")] }];
  const segments = buildSegments(hunks, { mode: "all", context: 3, emitHeadTail: true });
  assert.equal(segments.some((s) => s.kind === "hidden" && s.region === "head"), false);
});

test("G1b·7 空 hunks：返回空数组（不抛）", () => {
  assert.deepEqual(buildSegments([], { mode: "all", context: 3, emitHeadTail: true }), []);
  assert.deepEqual(buildSegments([], { mode: "diff", context: 0, emitHeadTail: true }), []);
});

test("G1b·8 纯新增文件（无 old 侧）：行全为 added，无 hunk 内隐藏段", () => {
  const hunks = [{
    oldStart: 0, oldLines: 0, newStart: 1, newLines: 3,
    lines: [line("added", null, 1, "a"), line("added", null, 2, "b"), line("added", null, 3, "c")],
  }];
  const segments = buildSegments(hunks, { mode: "diff", context: 3, emitHeadTail: true });
  const visible = segments.filter((s) => s.kind === "lines").flatMap((s) => s.lines);
  assert.equal(visible.length, 3);
  assert.equal(segments.some((s) => s.kind === "hidden" && s.region === "hunk"), false);
});

test("G1b·9 expansionOf：up/down 超量被钳，合计 ≥ count 即整段展开", () => {
  assert.deepEqual(expansionOf(10, 3, 0), { up: 3, down: 0, fullyOpen: false });
  assert.deepEqual(expansionOf(10, 100, 0), { up: 10, down: 0, fullyOpen: true });
  assert.deepEqual(expansionOf(10, 8, 5), { up: 8, down: 2, fullyOpen: true }, "down 被钳到剩余 2");
  assert.deepEqual(expansionOf(0, 5, 5), { up: 0, down: 0, fullyOpen: true });
});

test(`G1b·10 expandActions：≤${DEFAULT_EXPAND_COUNT} 行只给「全部」，超过给上/下/全部（difit 同判）`, () => {
  assert.deepEqual(expandActions(DEFAULT_EXPAND_COUNT), { all: DEFAULT_EXPAND_COUNT });
  assert.deepEqual(expandActions(1), { all: 1 });
  assert.deepEqual(expandActions(DEFAULT_EXPAND_COUNT + 1), { up: DEFAULT_EXPAND_COUNT, down: DEFAULT_EXPAND_COUNT, all: DEFAULT_EXPAND_COUNT + 1 });
});

test("G1b·11 sliceHiddenLines：行终止符纪律（空文本 0 行 / 末尾换行不产生幻影行 / 内部空行保留）", () => {
  assert.deepEqual(sliceHiddenLines("", 1, 5), [], "空文本 = 0 行");
  const one = sliceHiddenLines("only\n", 1, 5);
  assert.equal(one.length, 1, "末尾换行只终止最后一行");
  assert.equal(one[0].text, "only");
  const inner = sliceHiddenLines("a\n\nb\n", 1, 5);
  assert.equal(inner.length, 3, "内部空行保留");
  assert.deepEqual(inner.map((l) => l.text), ["a", "", "b"]);
});

test("G1b·12 sliceHiddenLines：按 1 起行号取，越界即停（不造空行）", () => {
  const content = "l1\nl2\nl3\n";
  assert.deepEqual(sliceHiddenLines(content, 2, 2).map((l) => l.text), ["l2", "l3"]);
  assert.deepEqual(sliceHiddenLines(content, 3, 5).map((l) => l.text), ["l3"], "超出文件长度就停");
  assert.deepEqual(sliceHiddenLines(content, 9, 2), [], "起点越界 → 空");
});

test("G1b·13 纯新增文件 oldStart=0：头段按 new 侧算，oldFrom=0（该段只能从 new 取原文）", () => {
  // git 对纯新增文件给 `@@ -0,0 +1,N @@`；oldStart=0 若按 old 算会得 -1（垃圾）
  const hunks = [{
    oldStart: 0, oldLines: 0, newStart: 1, newLines: 3,
    lines: [line("added", null, 1, "a"), line("added", null, 2, "b"), line("added", null, 3, "c")],
  }];
  const segments = buildSegments(hunks, { mode: "diff", context: 0, emitHeadTail: true });
  assert.equal(segments.some((s) => s.kind === "hidden" && s.region === "head"), false, "从第 1 行起，无头段");
  const all = segments.filter((s) => s.kind === "lines").flatMap((s) => s.lines);
  assert.deepEqual(all.map((l) => l.text), ["a", "b", "c"]);
});

test("G1b·14 两个 hunk 且其中一个 oldLines=0：gap 不许因 oldStart 差算出负数", () => {
  const hunks = [
    { oldStart: 5, oldLines: 0, newStart: 5, newLines: 2, lines: [line("added", null, 5, "x"), line("added", null, 6, "y")] },
    { oldStart: 20, oldLines: 2, newStart: 22, newLines: 2, lines: [line("context", 20, 22, "p"), line("removed", 21, null, "q")] },
  ];
  const segments = buildSegments(hunks, { mode: "all", context: 3, emitHeadTail: true });
  const gaps = segments.filter((s) => s.kind === "hidden" && s.region === "gap");
  for (const gap of gaps) assert.ok(gap.count > 0, `gap.count 必须为正，实际 ${gap.count}`);
  const gap = gaps[0];
  assert.ok(gap, "有 gap");
  assert.equal(gap.oldFrom, 5, "old 侧从 hunk 之后第一行起");
  assert.equal(gap.newFrom, 7);
});

test("G1b·15 纯新增文件的尾段：side 上 old 侧无行 → oldFrom=0", () => {
  const hunks = [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 10, lines: Array.from({ length: 10 }, (_, i) => line("added", null, i + 1, `l${i + 1}`)) }];
  const segments = buildSegments(hunks, { mode: "all", context: 3, totalOld: 0, totalNew: 30, emitHeadTail: true });
  const tail = segments.find((s) => s.kind === "hidden" && s.region === "tail");
  assert.ok(tail, "有尾段（new 侧还有 20 行）");
  assert.equal(tail.count, 20);
  assert.equal(tail.oldFrom, 0, "old 侧不存在");
  assert.equal(tail.newFrom, 11);
});

test("G1b·16 hunk 内隐藏段自带行内容（展开不必请求 blob）", () => {
  const segments = buildSegments(single, { mode: "diff", context: 0, emitHeadTail: true });
  const hunkHidden = segments.filter((s) => s.kind === "hidden" && s.region === "hunk");
  // 只有一个纯 hunk 内的段（后 3 行）；前段与文件头合并后归 head，且因一半没内容而丢掉缓存
  assert.equal(hunkHidden.length, 1, `纯 hunk 内段只剩后一段，实际 ${hunkHidden.length}`);
  assert.deepEqual(hunkHidden[0].lines.map((l) => l.text), ["d", "e", "f"], "被 mask 掉的那 3 行");
  // gap/head/tail 不带 lines（不在 patch 里）
  const head = segments.find((s) => s.kind === "hidden" && s.region === "head");
  assert.equal(head.lines, undefined, "head 段不带内容（要去 blob 取）");
  assert.equal(head.count, 7, "文件头 4 行 + 被 mask 的 3 行上下文合成一条");
});

test("G1b·17 相邻隐藏段合并为一条折叠条（用户视角：不能一堆「3 行未修改」把改动淹了）", () => {
  // "仅改动"模式下一个 hunk 的上下文被 mask + 它与下一个 hunk 之间的 gap → 应合成一条
  const hunks = [
    // old 侧覆盖 5,6,7,8 = 4 行；new 侧同为 5,6,7,8 = 4 行（夹具必须与内容自洽）
    { oldStart: 5, oldLines: 4, newStart: 5, newLines: 4, lines: [
      line("context", 5, 5, "c1"), line("context", 6, 6, "c2"), line("context", 7, 7, "c3"),
      line("removed", 8, null, "o"), line("added", null, 8, "n"),
    ] },
    { oldStart: 30, oldLines: 3, newStart: 30, newLines: 3, lines: [
      line("context", 30, 30, "d1"), line("removed", 31, null, "p"), line("added", null, 31, "P"),
    ] },
  ];
  const segments = buildSegments(hunks, { mode: "diff", context: 0, emitHeadTail: true });
  const hidden = segments.filter((s) => s.kind === "hidden");
  // 头段(4行) + [hunk后 3 行上下文 + gap + 下一 hunk 前 1 行上下文] 合成的一条 + 尾段（无 totalOld 则无）
  assert.equal(hidden.length, 2, `应只有 2 条折叠条（头 + 中间），实际 ${hidden.length}：${hidden.map(h=>h.region+":"+h.count)}`);
  assert.equal(hidden[0].region, "head");
  assert.equal(hidden[1].region, "gap", "合并段含 gap → 报 gap（需要 blob）");
  // 实测推演（buildSegments 的真实输出）：
  //   head:7  = 文件头 4 行 + hunk1 内被 mask 的 3 行上下文（同一块未改动区域，合并）
  //   gap:22  = hunk1 oldEnd(9) → hunk2 oldStart(30) 的 21 行 + hunk2 前导 1 行上下文
  assert.equal(hidden[0].count, 4 + 3, `head 段 = 文件头 4 + 前导上下文 3；实际 ${hidden[0].count}`);
  assert.equal(hidden[1].count, 21 + 1, `gap 段 = 21 + 后随上下文 1；实际 ${hidden[1].count}`);
  assert.equal(hidden[1].oldFrom, 9, "gap 段从 hunk1 的 oldEnd 起（blob 取原文的起点）");
});

test("G1b·18 合并后不丢行号起点（用于 blob 取原文）", () => {
  const hunks = [
    { oldStart: 3, oldLines: 3, newStart: 3, newLines: 3, lines: [
      line("context", 3, 3, "a"), line("removed", 4, null, "b"), line("added", null, 4, "B"),
    ] },
    { oldStart: 50, oldLines: 2, newStart: 50, newLines: 2, lines: [
      line("context", 50, 50, "z"), line("removed", 51, null, "y"),
    ] },
  ];
  const segments = buildSegments(hunks, { mode: "diff", context: 1, emitHeadTail: true });
  const gap = segments.find((s) => s.kind === "hidden" && s.region === "gap");
  assert.ok(gap);
  // hunks[0]: old 3..5（3 行）→ oldEnd = 6；context=1 时 3 行上下文全部可见，故 gap 起点 = 6
  assert.equal(gap.oldFrom, 6, "gap old 起点 = 前一个 hunk 的 oldEnd（前缀若被 mask 则是那段的首行）");
  assert.equal(gap.count, 50 - 6, "gap = 44 行");
});

test("G1b·19 太短的隐藏区不折（VS Code minimumLineCount=3）：1 行文件头直接显示，不出折叠条", () => {
  // 单 hunk oldStart=2 → 文件头 1 行 < 3 → 不折
  const hunks = [{ oldStart: 2, oldLines: 3, newStart: 2, newLines: 3, lines: [
    line("context", 2, 2, "a"), line("removed", 3, null, "b"), line("added", null, 3, "B"),
  ] }];
  const segments = buildSegments(hunks, { mode: "all", context: 3, emitHeadTail: true });
  // 文件头只有 1 行且不在 patch 里（没有行内容）→ 折叠条保留，但只有 1 行，文案如实说"1 行未修改"
  const head = segments.find((s) => s.kind === "hidden" && s.region === "head");
  assert.ok(head, "头段保留（无行内容可化开）");
  assert.equal(head.count, 1);
  // 对照：hunk 内 1 行上下文（有内容）会被化开成可见行
  const inner = [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [
    line("context", 1, 1, "c1"), line("removed", 2, null, "c2"), line("added", null, 2, "C2"), line("context", 3, 3, "c3"),
  ] }];
  const seg2 = buildSegments(inner, { mode: "diff", context: 0, emitHeadTail: true });
  assert.equal(seg2.filter((s) => s.kind === "hidden").length, 0, "hunk 内 1 行上下文被化开为可见行（<3）");
});

test("G1b·20 minimumLineCount 可调为 0（关闭该规则，用于对照）", () => {
  const hunks = [{ oldStart: 2, oldLines: 3, newStart: 2, newLines: 3, lines: [
    line("context", 2, 2, "a"), line("removed", 3, null, "b"), line("added", null, 3, "B"),
  ] }];
  const segments = buildSegments(hunks, { mode: "all", context: 3, minimumLineCount: 0, emitHeadTail: true });
  const head = segments.find((s) => s.kind === "hidden" && s.region === "head");
  assert.ok(head, "关闭后 1 行文件头仍是折叠条");
  assert.equal(head.count, 1);
});

test("G1b·21 gap/head/tail 即使很短也保留折叠条（没有行内容，化开会显示空白）", () => {
  const hunks = [
    { oldStart: 3, oldLines: 3, newStart: 3, newLines: 3, lines: [line("removed", 3, null, "a"), line("added", null, 3, "A"), line("context", 4, 4, "b")] },
    { oldStart: 7, oldLines: 2, newStart: 7, newLines: 2, lines: [line("removed", 7, null, "c"), line("added", null, 7, "C")] },
  ];
  // gap = 7 − (3+3) = 1 行 → 短，但没有内容 → 仍是折叠条
  const segments = buildSegments(hunks, { mode: "all", context: 3, emitHeadTail: true });
  const gap = segments.find((s) => s.kind === "hidden" && s.region === "gap");
  assert.ok(gap, "1 行 gap 仍保留折叠条（不能伪造空白行）");
  assert.equal(gap.count, 1);
});

test("G1b·22 默认不给文件头/尾出折叠条（GitHub/difit 两家同判：第一个 hunk 之前什么都不显示）", () => {
  const hunks = [{ oldStart: 30, oldLines: 3, newStart: 30, newLines: 3, lines: [
    line("context", 30, 30, "a"), line("removed", 31, null, "b"), line("added", null, 31, "B"),
  ] }];
  const seg = buildSegments(hunks, { mode: "all", context: 3, totalOld: 100 });
  assert.equal(seg.some((s) => s.kind === "hidden" && (s.region === "head" || s.region === "tail")), false,
    "默认不出 head/tail 折叠条（否则第一条就是「29 行未修改」，用户看不到改动）");
  // 显式打开才有
  const withHeadTail = buildSegments(hunks, { mode: "all", context: 3, totalOld: 100, emitHeadTail: true });
  assert.ok(withHeadTail.some((s) => s.kind === "hidden" && s.region === "head"));
  assert.ok(withHeadTail.some((s) => s.kind === "hidden" && s.region === "tail"));
});

// ── 展开/折叠的**实际算术**（2026-11-08 补：原先这段算术在组件里写了两遍且没有测试）─────
//
// 对照：VS Code `hideUnchangedRegionsFeature.ts:320`（showAll）/ `:438-441`（全展开时点 fold → collapseAll）；
//      difit `ExpandButton.tsx`（↑20 / ↓20 / 全部 N，但**没有**折回）。

test("G14·1 ↑ 每点一次走 20 行；点够了「全部」消失并进入可折叠态", () => {
  let state = { up: 0, down: 0 };
  const count = 94;
  state = expandStep(count, state, "up");
  assert.deepEqual(state, { up: 20, down: 0 });
  state = expandStep(count, state, "up");
  assert.deepEqual(state, { up: 40, down: 0 });
});

test("G14·2 ↑ 与 ↓ 相加**永不超过** count（否则头尾切片会重叠渲染同一行）", () => {
  const count = 94;
  let state = { up: 0, down: 0 };
  state = expandStep(count, state, "down");
  state = expandStep(count, state, "down");
  state = expandStep(count, state, "up");
  state = expandStep(count, state, "up");
  state = expandStep(count, state, "up");
  assert.deepEqual(state, { up: 60, down: 34 }, "down 被钳到剩余（94-60=34）");
  assert.ok(state.up + state.down <= count, `${state.up}+${state.down} > ${count}`);
  // 再点 ↑：已满，不再增加
  const more = expandStep(count, state, "up");
  assert.equal(more.up + more.down, count);
});

test("G14·3 all → 整段展开（up = count, down = 0）", () => {
  assert.deepEqual(expandStep(94, { up: 20, down: 20 }, "all"), { up: 94, down: 0 });
});

test("G14·4 collapse → 折回 0（VS Code 全展开后点 fold 的语义）", () => {
  assert.deepEqual(expandStep(94, { up: 94, down: 0 }, "collapse"), { up: 0, down: 0 });
  assert.deepEqual(expandStep(94, { up: 20, down: 0 }, "collapse"), { up: 0, down: 0 }, "部分展开也能折回");
});

test("G14·5 canCollapse：展开过任何行就该给「折叠」按钮（包括部分展开）", () => {
  assert.equal(canCollapse({ up: 0, down: 0 }), false);
  assert.equal(canCollapse({ up: 20, down: 0 }), true, "部分展开也要能折回——否则点错了只能点到底");
  assert.equal(canCollapse({ up: 94, down: 0 }), true);
});

test("G14·6 全展开 → 折叠 → 再展开，状态能回到原样（不会越点越乱）", () => {
  const count = 94;
  let state = { up: 0, down: 0 };
  state = expandStep(count, state, "all");
  assert.deepEqual(state, { up: 94, down: 0 });
  state = expandStep(count, state, "collapse");
  assert.deepEqual(state, { up: 0, down: 0 });
  state = expandStep(count, state, "up");
  assert.deepEqual(state, { up: 20, down: 0 }, "折叠后重新点 ↑ 应回到 20 行，而不是继承上次的 94");
});
