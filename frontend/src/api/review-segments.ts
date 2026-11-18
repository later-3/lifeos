// 检视模式 S1·G1b：把 hunk 切成「可见行」与「隐藏段」的纯函数。
//
// 为什么要这一层（依据）：
//  - git 的 patch 只带 `--unified=3` 的上下文；hunk 之间、文件头尾的行根本不在 patch 里。
//    "折叠未改行"就必须同时表达三类隐藏：hunk 内的远端上下文、hunk 之间的 gap、文件头/尾。
//  - 参考实现：
//    · opencode `expandMode: "expand" | "collapse"`（`session-review-v2.tsx:139-158`，两段全局段控）
//    · difit `ExpandButton`（`hiddenLines` + 上/下/全部三向；`DEFAULT_EXPAND_COUNT=20`，
//      `showOnlyExpandAll = hiddenLines <= 20`，`ExpandButton.tsx:4,29`）
//    · pi-web 只有固定 `CONTEXT = 3`（`FileViewer.tsx:304`）
//  三者都只做"段"这一层抽象；我们取 difit 的段模型（能表达 gap 与头尾），
//  全局段控取 opencode 的两段——两者组合，两种形态都支持。
//
// 纪律：纯函数，不读文件系统、不碰 React——可穷举单测（architecture 2.5）。

export type SegmentLineType = "context" | "added" | "removed";

export type SegmentLine = {
  type: SegmentLineType;
  oldNo: number | null;
  newNo: number | null;
  text: string;
};

export type HunkLike = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: readonly SegmentLine[];
};

/** 隐藏区域的位置：hunk 内远端上下文 / hunk 之间的空档 / 文件头 / 文件尾。 */
export type HiddenRegion = "hunk" | "gap" | "head" | "tail";

export type Segment =
  | { kind: "lines"; lines: SegmentLine[] }
  /** 一个 hunk 开始的标记（可选输出；渲染层据此画 `@@ … @@` 头）。 */
  | { kind: "hunk"; index: number; oldStart: number; oldLines: number; newStart: number; newLines: number }
  | {
      kind: "hidden";
      region: HiddenRegion;
      /** 隐藏行数（gap / head / tail 的 old 与 new 行数相等，取该值）。 */
      count: number;
      /** 该段第一行的 old 侧行号（1 起；0 表示这一段在 old 侧不存在，如纯新增文件的头部）。 */
      oldFrom: number;
      newFrom: number;
      /**
       * hunk 内的隐藏段自带全文（它们在 patch 里，只是被 mask 掉了）——展开是纯前端行为，不必请求。
       * gap / head / tail 不在 patch 里，只能靠 blob 接口取（见 readReviewBlob）。
       */
      lines?: SegmentLine[];
    };

export type BuildSegmentsOptions = {
  /** "all" = 显示全部行（hunk 内的上下文全展开）；"diff" = 只留改动行附近 context 行。 */
  mode: "all" | "diff";
  /** mode="diff" 时每处改动保留的上下文行数（git 默认 3）。 */
  context: number;
  /**
   * 太短的隐藏区不折（否则会出现「1 行未修改」这种很傻的折叠条）。
   * 值照抄 VS Code `hideUnchangedRegions.minimumLineCount = 3`
   * （`src/vs/editor/common/config/diffEditor.ts:29-34`，commit 5a2773d）：
   * 短于它的空档直接当可见行显示，不产生折叠条。
   */
  minimumLineCount?: number;
  /** 文件 old 侧总行数（未知则不给尾段——不假装知道文件有多长）。 */
  totalOld?: number;
  /** 文件 new 侧总行数。 */
  totalNew?: number;
  /** 是否输出 hunk 边界标记（渲染层需要画 `@@ … @@`；纯算术测试不需要）。 */
  emitHunkHeaders?: boolean;
  /**
   * 是否给文件头/尾也出折叠条。**默认 false**，两个参考都这么做：
   *  - GitHub Files changed：第一个 hunk 之前、最后一个 hunk 之后**什么都不显示**；
   *  - difit：它按 chunk 渲染，head/tail 不在 chunk 里，也就没有折叠条。
   * 我们一开始默认 true，结果 README 第一条就是「1 行未修改」（文件第 1 行没改），用户看着很傻。
   * 打开它只在需要"知道文件还有多长"的场景（例如单文件聚焦视图）。
   */
  emitHeadTail?: boolean;
};

/**
 * 切段。规则：
 * 1. 文件头（第一个 hunk 之前）与文件尾（最后一个 hunk 之后）只要有行就出隐藏段；
 * 2. hunk 之间按 hunk 头算术出 gap 段（old/new 行数必然相等，取较大者防御）；
 * 3. hunk 内按 mode 决定上下文：`all` 全显；`diff` 只留改动行 ± context；
 * 4. 相邻的 lines 段不合并（段是折叠的单位，合并会丢掉"这里能展开"的信息）。
 */
export function buildSegments(hunks: readonly HunkLike[], options: BuildSegmentsOptions): Segment[] {
  if (hunks.length === 0) return [];
  const { mode, context } = options;
  const segments: Segment[] = [];

  /**
   * 侧缺失的判定：git 对纯新增文件给 `@@ -0,0 +1,N @@`（oldStart=0 且 oldLines=0），
   * 纯删除反之。**注意**：普通 hunk 里 oldLines=0（只插不删）仍然有有效的 old 插入点
   * （oldStart 是“插在第几行之前”），不能当缺失——这是 G1b·14 锁住的边界。
   */
  const oldAbsent = (hunk: HunkLike): boolean => hunk.oldStart === 0 && hunk.oldLines === 0;
  const newAbsent = (hunk: HunkLike): boolean => hunk.newStart === 0 && hunk.newLines === 0;

  const first = hunks[0];
  if (options.emitHeadTail === true && first !== undefined) {
    const headCount = oldAbsent(first) ? first.newStart - 1 : first.oldStart - 1;
    if (headCount > 0) {
      const oldFrom = oldAbsent(first) ? 0 : 1;
      segments.push({ kind: "hidden", region: "head", count: headCount, oldFrom, newFrom: first.newStart - headCount });
    }
  }

  hunks.forEach((hunk, index) => {
    if (options.emitHunkHeaders === true) {
      segments.push({
        kind: "hunk", index,
        oldStart: hunk.oldStart, oldLines: hunk.oldLines,
        newStart: hunk.newStart, newLines: hunk.newLines,
      });
    }
    const visible = mode === "all" ? hunk.lines.map(() => true) : visibleMask(hunk.lines, context);
    pushHunkSegments(segments, hunk, visible);

    const next = hunks[index + 1];
    if (next !== undefined) {
      const oldEnd = hunk.oldStart + hunk.oldLines; // 该 hunk 之后的第一行 old 号
      const newEnd = hunk.newStart + hunk.newLines;
      const gapOld = oldAbsent(hunk) || newAbsent(next) ? 0 : next.oldStart - oldEnd;
      const gapNew = newAbsent(hunk) || oldAbsent(next) ? 0 : next.newStart - newEnd;
      const count = Math.max(gapOld, gapNew);
      if (count > 0) {
        segments.push({
          kind: "hidden", region: "gap", count,
          oldFrom: gapOld > 0 ? oldEnd : 0,
          newFrom: gapNew > 0 ? newEnd : 0,
        });
      }
      return;
    }

    // 最后一个 hunk：文件尾（同 head：默认不出折叠条）
    const tailOld = options.emitHeadTail !== true || oldAbsent(hunk) ? 0 : (options.totalOld === undefined ? 0 : options.totalOld - (hunk.oldStart + hunk.oldLines - 1));
    const tailNew = options.emitHeadTail !== true || newAbsent(hunk) ? 0 : (options.totalNew === undefined ? 0 : options.totalNew - (hunk.newStart + hunk.newLines - 1));
    const count = Math.max(tailOld, tailNew);
    if (count > 0) {
      segments.push({
        kind: "hidden", region: "tail", count,
        oldFrom: tailOld > 0 ? hunk.oldStart + hunk.oldLines : 0,
        newFrom: tailNew > 0 ? hunk.newStart + hunk.newLines : 0,
      });
    }
  });

  return expandShortHidden(mergeAdjacentHidden(segments), options.minimumLineCount ?? DEFAULT_MINIMUM_HIDDEN_LINES);
}

/**
 * 太短的隐藏区直接展开成可见行（不产生折叠条）。
 * 依据：VS Code `hideUnchangedRegions.minimumLineCount = 3`。
 *
 * gap / head / tail 不在 patch 里、没有行内容，展开时只能保留折叠条
 * （否则会显示空白行——比折叠条更糟）。只有 hunk 内自带内容的段可以真的化开。
 */
function expandShortHidden(segments: Segment[], minimumLineCount: number): Segment[] {
  if (minimumLineCount <= 0) return segments;
  const out: Segment[] = [];
  for (const segment of segments) {
    const tooShort = segment.kind === "hidden"
      && segment.count < minimumLineCount
      && segment.lines !== undefined;
    if (!tooShort) { out.push(segment); continue; }
    const hidden = segment as Extract<Segment, { kind: "hidden" }>;
    out.push({ kind: "lines", lines: [...(hidden.lines ?? [])] });
  }
  // 化开之后可能与相邻 lines 段连在一起，合并（保证渲染层相邻可见行不断开）
  const merged: Segment[] = [];
  for (const segment of out) {
    const last = merged[merged.length - 1];
    if (segment.kind === "lines" && last !== undefined && last.kind === "lines") {
      merged[merged.length - 1] = { kind: "lines", lines: [...last.lines, ...segment.lines] };
      continue;
    }
    merged.push(segment);
  }
  return merged;
}

/**
 * 合并相邻的隐藏段（中间没有可见行也没有 hunk 头）。
 *
 * 为什么必须合（用户视角）："仅改动"模式下每处改动周围的 3 行上下文各自成为一条折叠条，
 * 一个 3 hunk 的文件会出现 9 条「3 行未修改」，把真正要看的东西淹了。
 * GitHub / difit / opencode 在"隐藏未改动行"时都是一个空档一条折叠条——
 * hunk 内被 mask 的上下文 + hunk 间 gap + 下一个 hunk 的前导上下文，本来就是**同一块**连续未改动区域。
 */
function mergeAdjacentHidden(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    const bothHidden = last !== undefined && last.kind === "hidden" && segment.kind === "hidden";
    if (!bothHidden) { out.push(segment); continue; }
    const prev = last as Extract<Segment, { kind: "hidden" }>;
    const next = segment as Extract<Segment, { kind: "hidden" }>;
    /**
     * 只有**两侧内容都在手**才合并缓存；否则丢弃（让渲染层按 [oldFrom, oldFrom+count) 整段去 blob 取）。
     * 不能只拼一半：count 是合并后的总行数，缓存少几行会让"展开 20 行"只回到 3 行。
     */
    const lines = prev.lines !== undefined && next.lines !== undefined
      ? [...prev.lines, ...next.lines]
      : undefined;
    // 合并后重新编号：两段各自的行号是连续的（同一块未改动区域）
    const merged: Extract<Segment, { kind: "hidden" }> = {
      kind: "hidden",
      // 只要包含 gap 就按 gap 报（它是唯一需要 blob 的类型）；全是 hunk 内就保持 hunk
      region: prev.region === "gap" || next.region === "gap" ? "gap" : prev.region,
      count: prev.count + next.count,
      oldFrom: prev.oldFrom > 0 ? prev.oldFrom : next.oldFrom,
      newFrom: prev.newFrom > 0 ? prev.newFrom : next.newFrom,
      ...(lines !== undefined ? { lines } : {}),
    };
    out[out.length - 1] = merged;
  }
  return out;
}

/** 哪些行可见：改动行本身，以及距离最近改动行 ≤ context 的上下文行。 */
function visibleMask(lines: readonly SegmentLine[], context: number): boolean[] {
  const mask = lines.map((line) => line.type !== "context");
  if (context <= 0) return mask;
  for (let i = 0; i < lines.length; i++) {
    if (mask[i] !== true) continue;
    for (let d = 1; d <= context; d++) {
      const before = i - d;
      const after = i + d;
      if (before >= 0 && lines[before]?.type === "context") mask[before] = true;
      if (after < lines.length && lines[after]?.type === "context") mask[after] = true;
    }
  }
  return mask;
}

/** 把一个 hunk 里连续隐藏的上下文行合成一段（携带行内容：hunk 内的行本就在 patch 里）。 */
function pushHunkSegments(target: Segment[], hunk: HunkLike, visible: boolean[]): void {
  let runStart = -1;
  const flush = (endExclusive: number): void => {
    if (runStart < 0) return;
    const run = hunk.lines.slice(runStart, endExclusive);
    const anchor = run[0];
    if (anchor !== undefined) {
      target.push({
        kind: "hidden",
        region: "hunk",
        count: run.length,
        oldFrom: anchor.oldNo ?? 0,
        newFrom: anchor.newNo ?? 0,
        lines: [...run],
      });
    }
    runStart = -1;
  };

  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i];
    const isVisible = visible[i] === true || line === undefined;
    if (isVisible) {
      flush(i);
      if (line !== undefined) {
        const last = target[target.length - 1];
        if (last !== undefined && last.kind === "lines") last.lines.push(line);
        else target.push({ kind: "lines", lines: [line] });
      }
      continue;
    }
    if (runStart < 0) runStart = i;
  }
  flush(hunk.lines.length);
}

/**
 * 隐藏段展开后的可见范围（difit 的 up/down/all 三向语义）。
 *
 * - `up`：从段首往下露出 `step` 行；`down`：从段尾往上露出 `step` 行；
 * - 已展开的量超过 count 时钳到 count（调用方不必自己夹）；
 * - 返回 [upCount, downCount]，两者之和 ≥ count 表示"整段已展开"，渲染层就该把整段画成可见。
 */
export function expansionOf(count: number, up: number, down: number): { up: number; down: number; fullyOpen: boolean } {
  const clampedUp = Math.max(0, Math.min(up, count));
  const clampedDown = Math.max(0, Math.min(down, count - clampedUp));
  return { up: clampedUp, down: clampedDown, fullyOpen: clampedUp + clampedDown >= count };
}

/** 折叠条该给几个按钮：difit `showOnlyExpandAll = hiddenLines <= DEFAULT_EXPAND_COUNT`。 */
export const DEFAULT_EXPAND_COUNT = 20;

/**
 * 太短的隐藏区不折——照抄 VS Code `minimumLineCount = 3`
 * （`src/vs/editor/common/config/diffEditor.ts:29-34`）。
 * 实测依据：不设这一条时，1 行的文件头也出折叠条（用户看到「1 行未修改」）；
 * difit 不折短空档的做法也是同一意图（它只在 `hiddenLines > 0` 时给按钮，靠 hunk 合并自然少碎段）。
 */
export const DEFAULT_MINIMUM_HIDDEN_LINES = 3;

export function expandActions(count: number): { up: number; down: number; all: number } | { all: number } {
  if (count <= DEFAULT_EXPAND_COUNT) return { all: count };
  return { up: Math.min(DEFAULT_EXPAND_COUNT, count), down: Math.min(DEFAULT_EXPAND_COUNT, count), all: count };
}

/** 隐藏段上的一个动作（`collapse` = 折回去）。 */
export type ExpansionAction = "up" | "down" | "all" | "collapse";

/**
 * 一次点击之后的展开状态（**纯函数**，取代组件里内联的两份 `Math.min` 算术）。
 *
 * 为什么要抽出来（2026-11-08 自检发现）：
 *  这段算术原本在 `ReviewPanel` 的 `onHiddenExpand` 里**写了两遍**（hunk 内一段、gap/head/tail 一段），
 *  而 `expansionOf` 这个测试覆盖过的钳制函数**根本没人调用** —— 纯函数躺在那里当摆设，
 *  真正跑的算术没有测试。抽到这里之后：算术只有一份、每一档都有断言。
 *
 * 钳制规则由 `expansionOf` 保证（up 先钳、down 再钳到 `count - up`），所以
 * `up + down` 永不超过 `count`——**头部切片与尾部切片不会重叠渲染同一行**。
 *
 * 动作语义（对照 VS Code `hideUnchangedRegionsFeature.ts`）：
 *  - `up` / `down`：每次走 `step` 行（默认 20，difit `DEFAULT_EXPAND_COUNT` 同值）；
 *  - `all`：一次全展开（等价 difit 的「全部 N 行」/ VS Code 的 `showAll`，`:320`）；
 *  - `collapse`：**折回 0**（VS Code `:438-441` 全展开时点 fold 调 `collapseAll`）。
 *    我们不只在全展开时给这个动作：部分展开（`up+down > 0`）也能折回——
 *    用户点了「↑20」之后想反悔，否则只能一路点到全展开再把整段毁掉。
 */
export function expandStep(
  count: number,
  current: { up: number; down: number },
  action: ExpansionAction,
  step: number = DEFAULT_EXPAND_COUNT,
): { up: number; down: number } {
  if (action === "collapse") return { up: 0, down: 0 };
  if (action === "all") return pickCounts(expansionOf(count, count, 0));
  if (action === "up") return pickCounts(expansionOf(count, current.up + step, current.down));
  return pickCounts(expansionOf(count, current.up, current.down + step));
}

const pickCounts = (state: { up: number; down: number }): { up: number; down: number } => ({ up: state.up, down: state.down });

/** 这一段有没有已经展开出来的行（有 = 该给「折叠」按钮）。 */
export function canCollapse(current: { up: number; down: number }): boolean {
  return current.up + current.down > 0;
}

/**
 * 从一份全文里按行号切出隐藏段要显示的上下文行（hidden 段只含未改动行，
 * 所以 old/new 行号一一对应，两侧原文相同——用哪一侧都行）。
 */
export function sliceHiddenLines(
  content: string,
  from: number,
  count: number,
): SegmentLine[] {
  // 行终止符纪律（DSH ADR）：空文本 = 0 行；末尾换行终止最后一行，不产生幻影空行。
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const out: SegmentLine[] = [];
  for (let i = 0; i < count; i++) {
    const no = from + i;
    const text = lines[no - 1];
    if (text === undefined) break;
    out.push({ type: "context", oldNo: no, newNo: no, text });
  }
  return out;
}
