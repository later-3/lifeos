// 检视批注的范围选区（S3·A2b）——纯函数。
//
// 问题：用户在 diff 上按住拖过多行，或者先点行号再 Shift+点另一行，要表达"第 3–5 行"。
//
// 依据（三家实现 + 官方文档）：
//  - **GitHub**（`docs.github.com` 原文）："To select a range of lines, click the line number of
//    the first line you want to comment on, then either **drag down to the final line**, or
//    **hold down Shift and click** on the last line number." → **拖选 + Shift+点两种都要有**。
//  - **difit**（`DiffChunk.tsx:85-220`）：`selectionAnchor` + `dragSide` + 全局 mouseup 提交；
//    `getCommentLineFromAnchor` 用 `Math.min/max` 归一（`startLine > endLine` 时不崩）。
//    关键约束：**`selectionAnchor.side !== selection.side` 时退化为单行**（不跨侧）。
//  - **opencode**（`session-review.tsx:709-713`）：`enableLineSelection` + `onLineSelected` /
//    `onLineSelectionEnd`，范围由组件的 `SelectedLineRange {start, end}` 表达。
//
// 纪律：不读全局、不碰 React——可穷举单测（architecture 2.5）。

import type { AnchorSide } from "./review-outdated";

/** 单点锚（一次点击）。 */
export type LinePoint = { side: AnchorSide; line: number };

/** 一段锚定：`start <= end`，同侧。 */
export type LineRange = { side: AnchorSide; start: number; end: number };

/**
 * 拖选/Shift+点 时，把"起点 + 当前点"归一成一段。
 *
 * 规则（每条对应一个真实场景）：
 *  1. **只有第一次点击**（anchor 为空）→ 单行；
 *  2. **两侧不同**（在一行新增行上按下、拖到删除行）→ **退化为当前点单行**
 *     （difit `getCommentLineFromAnchor` 的 `selectionAnchor.side !== selection.side` 分支）；
 *     理由：diff 的 old/new 是两套行号，跨侧的范围无法用一对 `(start,end)` 表达；
 *  3. 同侧反向拖（从第 5 行拖到第 2 行）→ `min..max` 归一；
 *  4. 同一点 → 单行（`start === end`）。
 */
export function rangeOf(anchor: LinePoint | undefined, current: LinePoint): LineRange {
  if (anchor === undefined || anchor.side !== current.side) {
    return { side: current.side, start: current.line, end: current.line };
  }
  return {
    side: current.side,
    start: Math.min(anchor.line, current.line),
    end: Math.max(anchor.line, current.line),
  };
}

/**
 * Shift+点：把"上一次的锚"与"这次点的行"合成一段。
 *
 * 与 `rangeOf` 的唯一差别：**跨侧时保留锚侧而不是当前侧**。
 * 为什么：Shift+点的语义是"从我上次点的地方，扩展到这里"；如果两侧不同，
 * 用户的心智仍是"从原来那侧算起"，所以退化成**锚点的单行**（而不是跳到对面去）。
 */
export function shiftRangeOf(anchor: LinePoint | undefined, current: LinePoint): LineRange {
  if (anchor === undefined) return { side: current.side, start: current.line, end: current.line };
  if (anchor.side !== current.side) return { side: anchor.side, start: anchor.line, end: anchor.line };
  return {
    side: anchor.side,
    start: Math.min(anchor.line, current.line),
    end: Math.max(anchor.line, current.line),
  };
}

/** 某个行号是否落在这一段内（渲染高亮用）。 */
export function inRange(range: LineRange | undefined, side: AnchorSide, line: number): boolean {
  if (range === undefined) return false;
  return range.side === side && line >= range.start && line <= range.end;
}

/** 段内行数（批注文案「第 3–5 行」/ 位置头 `L3-L5` 用）。 */
export function rangeLength(range: LineRange): number {
  return range.end - range.start + 1;
}

/**
 * 该侧的行是否**可批注**。
 *
 * 规则（S3·A3）：
 *  - `added` 行只能锚 new 侧；`removed` 行只能锚 old 侧；`context` 行两侧都有 → 默认 new。
 *  - 因此"能不能锚"由**该行在这一侧有没有行号**决定，不看 diff 行的类型名。
 *    difit/opencode 都不允许在"另一侧的空白位"上批注（那里没有行号可锚）。
 *
 * 返回 `undefined` = 这一行在这一侧没有行号，不能锚。
 */
export function anchorLineOf(
  line: { type: "context" | "added" | "removed"; oldNo: number | null; newNo: number | null },
  preferred: AnchorSide = "new",
): { side: AnchorSide; line: number } | undefined {
  const primary = preferred === "new" ? line.newNo : line.oldNo;
  if (primary !== null) return { side: preferred, line: primary };
  const other: AnchorSide = preferred === "new" ? "old" : "new";
  const fallback = other === "new" ? line.newNo : line.oldNo;
  if (fallback !== null) return { side: other, line: fallback };
  return undefined;
}

/**
 * 范围的人话标签：「第 5 行」/「第 3–5 行」。
 * 用半角-ish 的「–」而不是"-"：与 Microsoft/Apple 对区间排版的建议一致，且不会与负数混淆。
 */
export function rangeLabel(range: LineRange): string {
  return range.start === range.end ? `第 ${range.start} 行` : `第 ${range.start}–${range.end} 行`;
}

/**
 * 位置头（S3·A7）：「src/x.ts:120」/「src/x.ts:120-124」。
 *
 * 依据：
 *  - **difit** `utils/commentFormatting.ts`：`src/x.tsx:L42` / `src/x.tsx:L42-L48`（`L` 前缀）；
 *  - **opencode** 截图 `43-comment-posted.png` 的 chip：`greet.ts:1`（无 `L` 前缀）。
 * 我们取 difit 的 `L` 前缀：行号后面直接跟数字时，`L` 让"这是行号"没有歧义（`file:42` 也可能是端口/ID）。
 * 中文方括号 `【】` 与既有 message 批注的位置头一致（`annotation-message.ts` 的格式纪律）。
 */
export function locationHeader(filePath: string, range: LineRange): string {
  const lines = range.start === range.end ? `L${range.start}` : `L${range.start}-L${range.end}`;
  return `${filePath}:${lines}`;
}


// ── 从浏览器文本选区得到行范围（opencode 的做法）────────────────────────────────
//
// 依据：opencode `pierre/selection-machine.ts:18-23, 116-142`：
//   "A press on the code (`text` column) selects lines from our own mouse handlers: a click toggles
//    one line, a drag selects the lines between its ends, and `finishing` waits one frame for the
//    browser's text selection before it commits."
//   以及 `selection.changed` / `selection.frame`：**它们读的是浏览器的真实文本选区**
//   （`window.getSelection()`），把它换算成 `SelectedLineRange`。
//
// 为什么这条最重要（用户 2026-11-05）：
//   "是不是我直接鼠标选中多行就可以了？"
//   人看代码时，拖鼠标的默认心智就是**选中文字**。所以"拖一段文字 → 变成一段行的批注"
//   是最自然的心智模型；difit 把拖选绑在批注按钮上（`DiffChunk.tsx:468-476`），
//   GitHub 绑在行号上，opencode 两种都支持（文字拖 + 行号拖）。
//   我们跟 opencode：**文字拖 = 选文字并得到行范围**；行号拖 = 纯选行。

/** 一个可锚定行的 DOM 描述（由渲染层提供）。 */
export type RowLike = {
  /** 该行的锚点（`new:12` / `old:5`），取不到表示这一行不可锚。 */
  key: string;
  /** 它包含的文本节点（用于判断选区端点落在哪一行）。 */
  contains: (node: Node) => boolean;
};

/** 解析 `"new:12"` → `{ side, line }`；不合法返回 undefined。 */
export function parseAnchorKey(key: string | null | undefined): LinePoint | undefined {
  if (key === null || key === undefined) return undefined;
  const [side, raw] = key.split(":");
  if (side !== "new" && side !== "old") return undefined;
  const line = Number(raw);
  if (!Number.isFinite(line) || line < 1) return undefined;
  return { side, line };
}

/**
 * 把浏览器文本选区的两个端点映射成行范围。
 *
 * @param rows 当前可见的全部可锚行（按文档顺序）
 * @param startNode / endNode 选区的起止容器（可以是文本节点或元素）
 * @returns 单行/范围；端点不在任何可锚行内 → undefined（不制造假的锚点）
 *
 * 规则：
 *  - 起点所在行与终点所在行相同 → 单行；
 *  - 不同 → `rangeOf` 归一（跨侧时退化为终点单行，与 drag 同一套规则）；
 *  - **起点找不到行就退化为终点单行**，反之亦然（用户可能从空白处拖起）。
 */
export function rangeFromSelection(
  rows: readonly RowLike[],
  startNode: Node | null,
  endNode: Node | null,
): LineRange | undefined {
  const findRow = (node: Node | null): LinePoint | undefined => {
    if (node === null) return undefined;
    for (const row of rows) {
      if (row.contains(node)) {
        const point = parseAnchorKey(row.key);
        if (point !== undefined) return point;
      }
    }
    return undefined;
  };
  const start = findRow(startNode);
  const end = findRow(endNode);
  if (start === undefined && end === undefined) return undefined;
  if (start === undefined) return { side: end!.side, start: end!.line, end: end!.line };
  if (end === undefined) return { side: start.side, start: start.line, end: start.line };
  return rangeOf(start, end);
}

/**
 * 某个行号是否是这个范围的**首行/末行**（A22 整块高亮用）。
 *
 * 为什么需要（用户 2026-11-05 报的"几条黄色线框"）：
 * 每行各画一圈边框时，相邻两行的边会贴成一串小方框。改成"整块"就必须知道
 * 哪一行是块的首/末——只有首行画上边、末行画下边，中间不画横线。
 *
 * 参考：difit `global.css:185-210` 的 `drag-selected-first` / `drag-selected-last`
 * （`border-top-width` 只加在 first、`border-bottom-width` 只加在 last）。
 *
 * 单行范围：既是首行也是末行（上下边都画，才是一个框）。
 */
export function blockEdgesOf(
  range: LineRange | undefined,
  side: AnchorSide,
  lineNo: number,
): { start: boolean; end: boolean } {
  if (range === undefined) return { start: false, end: false };
  if (range.side !== side) return { start: false, end: false };
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  return { start: lineNo === start, end: lineNo === end };
}
