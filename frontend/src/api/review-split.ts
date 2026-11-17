// G11 并排视图（split）：**行配对**的纯函数（不含 DOM、不含 React）。
//
// 这是并排视图唯一真正复杂的部分：左列是 old、右列是 new，一行"对齐"是两边的哪两行放在同一横排。
// 配对规则错了，整个并排视图就是错位的——所以这一层必须是纯函数 + 穷举测试。
//
// 参考（2026-11-08 逐个读源码）：
//  - **difit** `src/client/components/SideBySideDiffChunk.tsx:414-490` `convertToSideBySide`：
//    · `normal`（context）→ 左右同一行，两侧行号各 +1；
//    · `delete` 连跑 → 先收集这一段 delete，再看紧随其后的 `add` 连跑，
//      按 `Math.max(deleteLines.length, addLines.length)` 逐对配对（多出的一侧该格留空）；
//    · 只有 `add`（前面没有 delete）→ 只占右列；
//    · 两侧都存在时计算词级 diff（我们暂不做词级，见 §不做）。
//  - **opencode** `session-review.tsx:397-410`：`SegmentedControl` 两段 `unified` / `split`，
//    状态由外部传入（`onDiffStyleChange`）；它把渲染交给 `@pierre/diffs` 的 `diffStyle`。
//  - **difit** `App.tsx:770-772`：**移动端强制 unified**（`isMobile && diffMode !== 'unified'`）。
//    我们本期不做手机（D17a），桌面端不按宽度禁用（不做自造阈值）。
//
// 纪律：纯函数。

import type { SegmentLine } from "./review-segments";

/** 并排视图的一行：左（old）/ 右（new），任一侧可以为空。 */
export type SplitRow = {
  /** 左列的行（`type === "removed"` 或 context） */
  old?: SegmentLine;
  /** 右列的行（`type === "added"` 或 context） */
  new?: SegmentLine;
};

/**
 * 把一段 unified 行序列配对成并排行。
 *
 * 规则（与 difit `convertToSideBySide` 同构，逐条对应）：
 *  1. **context** → 两侧同一行（同一个 `SegmentLine`，字段各自取 oldNo/newNo）；
 *  2. **removed 连跑 + 紧随的 added 连跑** → 逐对配对，行数取两边最大值，多出的一侧留空；
 *  3. **只有 added**（前面不是 removed）→ 只占右列；
 *  4. **只有 removed**（后面没有 added）→ 只占左列。
 *
 * 为什么按"连跑"而不是"按行号"配对：
 *  行号在两侧本来就不同（中间可能增删过），按行号配会把无关的两行对齐；
 *  difftool 的通行做法是"同一次改动的删与增放在一起"（git 的 hunk 已经是这个语义）。
 */
export function pairForSplit(lines: readonly SegmentLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) { i += 1; continue; }

    if (line.type === "context") {
      rows.push({ old: line, new: line });
      i += 1;
      continue;
    }

    if (line.type === "removed") {
      // 收集这一段连续的 removed
      let end = i;
      while (end < lines.length && lines[end]?.type === "removed") end += 1;
      const removedRun = lines.slice(i, end);
      // 再看紧随其后的连续 added
      let addEnd = end;
      while (addEnd < lines.length && lines[addEnd]?.type === "added") addEnd += 1;
      const addedRun = lines.slice(end, addEnd);

      const pairs = Math.max(removedRun.length, addedRun.length);
      for (let k = 0; k < pairs; k += 1) {
        rows.push({
          ...(removedRun[k] !== undefined ? { old: removedRun[k] } : {}),
          ...(addedRun[k] !== undefined ? { new: addedRun[k] } : {}),
        });
      }
      i = addEnd;
      continue;
    }

    // 只有 added（前面不是 removed）
    rows.push({ new: line });
    i += 1;
  }
  return rows;
}

/**
 * 这一行在某侧的锚点信息（并排视图每个单元格各自可锚）。
 *
 * - 左列只可能锚 `old` 侧（`oldNo`），右列只可能锚 `new` 侧（`newNo`）；
 * - 该侧没有行号 → `null`（这一格不可批注，渲染成空白格）。
 *
 * 与 unified 的差别（有意）：unified 里 context 行**只锚 new**（`anchorSide` 计算逻辑），
 * 并排里 context 行左右各有一格，**两侧都可锚**——用户在左边点就是在说"原来这行"。
 * 依据：difit `SideBySideDiffChunk.tsx:669-712` 左右两格各自渲染 `CommentButton` 并带 `side`。
 */
export function splitAnchorOf(row: SplitRow, side: "old" | "new"): { no: number; text: string } | null {
  const line = side === "old" ? row.old : row.new;
  if (line === undefined) return null;
  const no = side === "old" ? line.oldNo : line.newNo;
  if (no === null) return null;
  return { no, text: line.text };
}
