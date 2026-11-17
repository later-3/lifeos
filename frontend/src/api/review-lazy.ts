// G5 大 diff 保护 + G6 懒挂载：**纯判定**（不含 DOM，可穷举）。
//
// 参考（2026-11-08 逐个读源码）：
//  - **opencode** `packages/session-ui/src/components/session-review-machine.ts`：
//    - `MAX_DIFF_CHANGED_LINES = 500`（`:1`）——单文件改动行超过它 → `"too-large"`（`:163-165`）；
//    - `selectSessionReviewFileBody()`（`:150-169`）是**纯函数**：`collapsed / too-large / mounted / placeholder` 四态；
//    - `force.requested` 事件（`:33`）→ 写进 `state.forced`（`:672` 的 `prune`）→ 之后该文件走 `mounted`；
//    - 占位高度 **160px**（`session-review.tsx:660`：`style={{height:"160px"}}`）。
//  - **difit** `src/client/hooks/useLazyDiffRendering.ts:6-7`：
//    - `INITIAL_RENDERED_FILE_COUNT = 8`（首屏只挂 8 个文件）；
//    - `LAZY_RENDER_ROOT_MARGIN = "1200px 0px"`（提前 1200px 就开始挂，滚动不白屏）。
//
// 我们与他们的一处**差异**（有意的）：opencode 的 `too-large` 一旦触发就**不渲染**（要用户点
// "render anyway"）；我们的用户要求是「大 diff 也要能看」，所以我们对超限文件**默认渲染但折叠到
// 前 N 行 + 显式提示**，不把内容藏起来当"保护"。判定函数因此返回 `truncated` 而不是 `blocked`。
//
// 纪律：纯函数，不读 DOM。调用方负责 IntersectionObserver 与挂载。

/** 单文件改动行上限（opencode `MAX_DIFF_CHANGED_LINES`，同值同理由）。 */
export const MAX_CHANGED_LINES_BEFORE_COLLAPSE = 500;
/** 首屏直挂的文件数（difit `INITIAL_RENDERED_FILE_COUNT`）。 */
export const INITIAL_RENDERED_FILES = 8;
/** 懒挂载的预取边距（difit `LAZY_RENDER_ROOT_MARGIN`）。 */
export const LAZY_ROOT_MARGIN = "1200px 0px";
/** 占位高度（opencode `session-review.tsx:660`）。 */
export const LAZY_PLACEHOLDER_HEIGHT_PX = 160;
/** 大文件默认展开多少行（超过就不自动展开，用户可点「全部展开」）。 */
export const LARGE_FILE_PREVIEW_LINES = 200;

export type FileBodyKind = "collapsed" | "placeholder" | "large" | "mounted";

export type FileBodyInput = {
  /** 这个文件卡是否展开 */
  expanded: boolean;
  /** 是否已被用户显式强制展开（「仍然全部显示」） */
  forced: boolean;
  /** 改动行长（additions + deletions） */
  changedLines: number;
  /** 文本文件展示的总行数（含上下文）；用于判断"挂了会不会卡" */
  totalLines: number;
  /** 是否已挂载（首屏前 N 个 / 已滚到 / 已显式展开） */
  mounted: boolean;
};

/**
 * 一个文件卡应该渲染成什么形态（opencode `selectSessionReviewFileBody` 的同构）。
 *
 * 四态与他们的差别：我们多一个 `large`（**渲染但只给前 N 行 + 提示**），
 * 因为我们的产品要求是"大 diff 也能看"，不是"挡住不让看"。
 */
export function fileBodyOf(input: FileBodyInput): FileBodyKind {
  if (!input.expanded) return "collapsed";
  if (input.forced || input.mounted) {
    return input.forced ? "mounted" : input.changedLines > MAX_CHANGED_LINES_BEFORE_COLLAPSE ? "large" : "mounted";
  }
  return "placeholder";
}

/**
 * 是否需要"大文件提示"（渲染出来，但只给前 `LARGE_FILE_PREVIEW_LINES` 行）。
 *
 * 与 opencode 的关键差异：他们 `>500` 就**不渲染**（`too-large` + "render anyway" 按钮）；
 * 我们 `>500` 仍然渲染，只是**默认展开前 200 行**并给一条可点的提示。
 * 理由：他们的场景是"每轮都可能上百个文件"，需要挡；我们的场景是"一个 Task 的累积改动"，
 * 挡住等于让用户看不到自己的工作成果。
 */
export function needsLargeFileNotice(input: Pick<FileBodyInput, "expanded" | "changedLines" | "forced">): boolean {
  return input.expanded && !input.forced && input.changedLines > MAX_CHANGED_LINES_BEFORE_COLLAPSE;
}

/**
 * 首屏应该直接挂载哪些文件（difit `INITIAL_RENDERED_FILE_COUNT = 8`）。
 *
 * 返回**路径集合**；不在集合里的先渲染占位，滚到附近再挂（`LAZY_ROOT_MARGIN`）。
 */
export function initialMountedFiles(files: readonly { path: string }[]): Set<string> {
  return new Set(files.slice(0, INITIAL_RENDERED_FILES).map((file) => file.path));
}

/**
 * 追加上已挂载集合（滚到某个文件 → 挂它；幂等）。
 * 与 opencode 的 `mounted` 集合同语义：只增不减（除非数据整体换了，由调用方重置）。
 */
export function mountFile(mounted: ReadonlySet<string>, path: string): Set<string> {
  if (mounted.has(path)) return mounted as Set<string>;
  const next = new Set(mounted);
  next.add(path);
  return next;
}
