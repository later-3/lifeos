// 词级 diff（并排/单列的增删行逐词标注）：**纯函数**。
//
// 这是"并排视图的完成态"：删 2 增 4 时，只看整行红/绿看不出"改的是哪几个词"。
// 问题是"两行里哪些字符变了"——这是 LCS/词级对齐问题，不该自己写（写过的人都知道边界极多：
// 空白处理、中文分词、标点归属、性能）。所以用成熟库。
//
// 参考（2026-11-08 逐个读源码）：
//  - **difit** `src/client/utils/wordLevelDiff.ts`（72 行）：包了 `diff` 库的 `diffWordsWithSpace`，
//    产出 `{ oldSegments, newSegments }`（每段 `unchanged | added | removed`），
//    并用 `shouldComputeWordDiff` 的**相似度 ≥ 20%** 门槛过滤"完全不同的两行"（`:56-72`）。
//    同一套结果同时用于 unified（`DiffChunk.tsx:330-380`）与 split（`SideBySideDiffChunk.tsx:466-479`）。
//  - **opencode** 走 `@pierre/diffs` 的词级高亮（`WordLevelDiffHighlighter` 同族），不自己实现。
//
// 我们的两处差异（都是有意的）：
//  1. **门槛只比"字符数"不比"相似度"**：difit 为了算相似度**又跑了一遍 `diffWords`**（`:63`），
//     等于每对行算两次 diff。我们只在"去掉首尾空白后两行都非空、且不相等"时算一次，
//     再用"改动段占比"判断要不要显示（同一份结果里就能算，不必再跑一次）。
//  2. **按行长度设上限**：超长单行不做词级 diff——LCS 是 O(n·m)，实测病态行 1700 字符单对就要 8ms，
//     一屏几十对会明显卡顿。difit 没有这道闸（他们的 `shouldComputeWordDiff` 只看相似度），
//     这是我们在"性能不能靠运气"上的补强（上限 1000 的取值见 `MAX_WORD_DIFF_LINE_LENGTH`）。
//
// 纪律：纯函数；不读 DOM；库只在 `review-word-diff-lib.ts` 里 import（便于替换）。

/** 一段文字及其相对变化（与 difit `DiffSegment` 同形状）。 */
export type WordSegment = {
  value: string;
  type: "unchanged" | "added" | "removed";
};

export type WordDiff = {
  /** 旧行怎么切成段（`removed` 是旧行独有） */
  oldSegments: WordSegment[];
  /** 新行怎么切成段（`added` 是新行独有） */
  newSegments: WordSegment[];
};

/**
 * 参与词级 diff 的单行最大字符数（超过就整行标色）。
 *
 * **本机实测**（2026-11-08，`diff@9.0.0` 的 `diffWordsWithSpace`，见 §实测）：
 *  普通代码行（63 字符）0.005ms/对；60 万字符级的重复行 0.05–0.15ms/对；
 *  **病态行**（词多且两侧完全不共享任何 token，LCS 退化）：
 *    149 字符/20 词 0.32ms · 309/40 0.44ms · 629/80 1.61ms · **969/120 2.97ms** · 1689/200 8.14ms · 3489/400 32.32ms。
 * 取 **1000**：最坏（病态行）约 3ms/对——一屏几十对也在 100ms 量级；
 * 再往上（1700 字符起）单对就 8ms+，一屏几十对会明显卡顿。
 * difit 没有这道闸（只按相似度过滤），这是我们的补强。
 */
export const MAX_WORD_DIFF_LINE_LENGTH = 1000;

/**
 * 改动段占该侧总长的比例超过它就**整行标色**（不做词级）。
 *
 * 判据：两行几乎完全不同时，逐词高亮反而更吵（满屏小色块），
 * 用户只需要知道"这行换了"。difit 的阈值是相似度 ≥ 0.2（`:70`，等价于改动 ≤ 80%）；
 * 我们取同一量级但**用已算出的结果**判断，不再跑第二遍 diff。
 */
export const MAX_WORD_DIFF_CHANGED_RATIO = 0.8;

/**
 * 要不要给这两行做词级 diff。**纯判定，不做 diff 计算**——
 * 计算在 `wordDiffOf`（需要库），判定在这里（可穷举测试）。
 */
export function shouldComputeWordDiff(oldContent: string, newContent: string): boolean {
  if (oldContent === newContent) return false;
  if (oldContent.trim() === "" || newContent.trim() === "") return false;
  if (oldContent.length > MAX_WORD_DIFF_LINE_LENGTH) return false;
  if (newContent.length > MAX_WORD_DIFF_LINE_LENGTH) return false;
  return true;
}

/** 一侧的"改动字符数"（`added` 或 `removed` 段的长度之和）。 */
export function changedLengthOf(segments: readonly WordSegment[]): number {
  let total = 0;
  for (const segment of segments) {
    if (segment.type !== "unchanged") total += segment.value.length;
  }
  return total;
}

/** 一侧的总长（所有段长度之和，含空白）。 */
export function totalLengthOf(segments: readonly WordSegment[]): number {
  let total = 0;
  for (const segment of segments) total += segment.value.length;
  return total;
}

/**
 * 高亮值不值得显示：**任一侧**的改动占比超过 `MAX_WORD_DIFF_CHANGED_RATIO` 就放弃。
 *
 * 为什么取两侧最大值：一侧几乎全改、另一侧几乎没动时（例如把 `a` 改成 `b` + 追加一大段），
 * 单看"没动的那侧"会通过，但另一侧会变成一整块色，读起来比整行标色更乱。
 */
export function worthHighlighting(diff: WordDiff): boolean {
  const ratios = [changedRatioOf(diff.oldSegments), changedRatioOf(diff.newSegments)];
  return ratios.every((ratio) => ratio <= MAX_WORD_DIFF_CHANGED_RATIO);
}

function changedRatioOf(segments: readonly WordSegment[]): number {
  const total = totalLengthOf(segments);
  if (total === 0) return 0;
  return changedLengthOf(segments) / total;
}

/**
 * 把库返回的"扁平变更序列"拆成两侧的段序列（difit `wordLevelDiff.ts:20-40` 同构）。
 *
 * 输入形状（`diff` 库的 `ChangeObject[]`）：
 *   `{ value, added?, removed? }`——`added` 只在 new、`removed` 只在 old、都没有则两侧都有。
 *
 * 抽成纯函数而不是直接依赖库的原因：**这条拆分逻辑是"两侧一致性"的唯一来源**——
 * `oldSegments.map(s => s.value).join("")` 必须逐字等于旧行，`newSegments` 同理。
 * 那是可以穷举断言的不变量（见测试），而库的返回形状变化不该影响这条不变量。
 */
export function splitChanges(
  changes: readonly { value: string; added?: boolean; removed?: boolean }[],
): WordDiff {
  const oldSegments: WordSegment[] = [];
  const newSegments: WordSegment[] = [];
  for (const change of changes) {
    if (change.added === true) {
      newSegments.push({ value: change.value, type: "added" });
      continue;
    }
    if (change.removed === true) {
      oldSegments.push({ value: change.value, type: "removed" });
      continue;
    }
    oldSegments.push({ value: change.value, type: "unchanged" });
    newSegments.push({ value: change.value, type: "unchanged" });
  }
  return { oldSegments, newSegments };
}
