import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, IconButton, Segmented, Spinner } from "./design/ui";
import { IconChevronsDown, IconChevronsUp, IconRefresh, IconX } from "@tabler/icons-react";
import {
  buildSegments, canCollapse, expandActions, expandStep, expansionOf, sliceHiddenLines, type ExpansionAction,
  type Segment, type SegmentLine,
} from "./review-segments";
import { buildFileLineIndex, isAnchorOutdated, snapshotOf, type AnchorSide } from "./review-outdated";
import {
  anchorLineOf, blockEdgesOf, inRange, locationHeader, rangeFromSelection, rangeLabel, rangeOf, shiftRangeOf,
  type LinePoint, type LineRange, type RowLike,
} from "./review-selection";
import {
  draftsOfTask, findDraft, removeDraft, upsertDraft,
  type DraftAuthor, type ReviewDraft,
} from "./review-drafts";
import { AgentAvatar, avatarTone } from "./agent-avatar";
import { Markdown } from "./message-markdown";
import { MARKS } from "./marks";
import { placePopover } from "./design/popover";
import { createHttpStore, createHttpViewedStore, hasLocalOnlyComments, type CommentStore, type ReviewComment, type ViewedRecordWire } from "./review-comment-store";
import { commentToLine, commentsToText } from "./review-comment-copy";
import {
  actionOfKey, firstFileRow, lastFileRow, shouldIgnoreNav, stepChunk, stepFile, stepLine, KEY_BINDINGS, type NavRow,
} from "./review-keynav";
import {
  fileBodyOf, initialMountedFiles, LAZY_PLACEHOLDER_HEIGHT_PX, LAZY_ROOT_MARGIN, LARGE_FILE_PREVIEW_LINES,
  MAX_CHANGED_LINES_BEFORE_COLLAPSE, mountFile, needsLargeFileNotice, type FileBodyKind,
} from "./review-lazy";
import {
  buildFileTree, diffContentHash, filesUnder, viewedStatesOf, viewedSummaryOf, type FileViewedState, type TreeNode, type ViewedStatus,
} from "./review-viewed";
import { languageOf, tokenSideOf, tokensAtLine, type Token } from "./review-highlight";
import { ensureGrammar, grammarReady, tokenizeFileCached, type FileTokens } from "./review-highlight-prism";
import { tokenClassName } from "./review-highlight-style";
import { blockChanged, buildPreviewBlocks, buildRenderBlocks, isPlainBlock, type PreviewBlock, type PreviewBlockType } from "./review-md-blocks";
import { pairForSplit, splitAnchorOf, type SplitRow } from "./review-split";
import type { WordDiff, WordSegment } from "./review-word-diff";
import { ensureWordDiffLib, wordDiffOf } from "./review-word-diff-lib";
import { awaitingOfComment, canCloseCommentBy, isClosedComment } from "./review-comment-state";
import { LAYER_CLASS, SCRIM_CLASS, surfaceClass, surfaceStyle } from "./design/surface";

/**
 * 检视面板（Task 0010 · P2）。
 *
 * 数据流（02-design §2）：进入检视 → POST /api/review/diff { taskDir } → 两组源
 * （worktree + lifeos 文档）→ 文件列表（D8 三类徽标）→ 单列 diff（默认，B2）
 * → 手动刷新（⑧ 一期不做自动）。批注在 P3 接入（本阶段预留 diff 行容器）。
 *
 * 视觉（evidence/DESIGN-FUSION §2）：sunken 底 + 白卡；diff 两对 token；
 * 徽标 = 文字色 + soft 底胶囊；无新主色。
 */

export type ReviewSourceKind = "worktree" | "lifeos";

export type DiffLine = { type: "context" | "added" | "removed"; oldNo: number | null; newNo: number | null; text: string };
export type DiffHunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] };
export type ReviewFile = {
  path: string;
  kind: "code" | "doc" | "other";
  status: "added" | "modified" | "deleted" | "renamed";
  oldPath?: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  truncated?: boolean;
};
export type ReviewSourceDiff = {
  source: { kind: ReviewSourceKind; path: string; exists: boolean; branch?: string; head?: string };
  files: ReviewFile[];
  truncated: boolean;
  base?: { commit: string; at?: string };
  degraded?: "no_vcs";
};

export type ReviewData = { items: ReviewSourceDiff[] };

const STATUS_LABEL: Record<ReviewFile["status"], string> = { added: "A", modified: "M", deleted: "D", renamed: "R" };
const KIND_LABEL: Record<ReviewFile["kind"], string> = { code: "代码", doc: "文档", other: "文件" };

function StatBadge({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-micro tabular-nums">
      {additions > 0 && <span className="text-success" aria-label={`新增 ${additions} 行`}>+{additions}</span>}
      {deletions > 0 && <span className="text-danger" aria-label={`删除 ${deletions} 行`}>−{deletions}</span>}
    </span>
  );
}

/** 单个文件的 diff 体（折叠态只显示文件行）。 */
/**
 * 占位元素的 IntersectionObserver 回调。
 *
 * 为什么不用内联 ref 箭头函数：React 每次渲染都会用**新的**回调去 reset ref（旧 node 传 null、新 node 传元素），
 * 内联创建 observer 会在每次渲染时重建/断开，滚动一下就被取消——实测"滚到占位仍不挂载"。
 * 这里用 `useRef` 持有 observer 表，回调本身用 `useCallback` 固定。
 */
function usePlaceholderObserver(onMount: ((path: string) => void) | undefined, path: string) {
  const observers = useRef<Map<string, IntersectionObserver>>(new Map());
  const callback = useCallback((node: HTMLDivElement | null) => {
    const existing = observers.current.get(path);
    if (existing !== undefined) { existing.disconnect(); observers.current.delete(path); }
    if (node === null || onMount === undefined) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onMount(path);
        observer.disconnect();
        observers.current.delete(path);
      }
    }, { rootMargin: LAZY_ROOT_MARGIN });
    observer.observe(node);
    observers.current.set(path, observer);
  }, [onMount, path]);
  useEffect(() => () => {
    for (const observer of observers.current.values()) observer.disconnect();
    observers.current.clear();
  }, []);
  return callback;
}

function FileCard({ file, body, onForceRender, onFileMount, viewedStatus, onToggleViewed, open, onToggle, expandMode, viewMode, renderAs, sourceKind, taskDir, hiddenOf, onHiddenExpand, drafts, onAddDraft, onChangeDraft, onRemoveDraft, authorNameOf, foldedOf, onToggleFold, onChangeMarks, onPinHover, onRevealComments, commentActions, drag, onDragStart, onDragExtend, viewedControls }: {
  file: ReviewFile;
  /** G5/G6 形态（见 `review-lazy.ts#fileBodyOf`）：collapsed / placeholder / large / mounted */
  body: FileBodyKind;
  onForceRender: () => void;
  /** 占位进入预取区时调用（挂载这个文件） */
  onFileMount?: () => void;
  /** G10：这个文件的已看状态（三态） */
  viewedStatus: ViewedStatus;
  onToggleViewed: () => void;
  /** G10：标记按钮（由面板注入，便于在 FileCard 之外也复用同一份实现——暂未使用） */
  viewedControls?: never;
  open: boolean;
  onToggle: () => void;
  expandMode: "all" | "diff";
  /** G11：`unified`（单列）或 `split`（并排两列） */
  viewMode: ReviewViewMode;
  /** G15：渲染档位（`source` 源码行级 / `md-preview` md 渲染态）。只对 doc 文件有意义 */
  renderAs: ReviewRenderMode;
  sourceKind: ReviewSourceKind;
  taskDir: string;
  /** 这个文件上的草稿（S2·A5：来自 localStorage，按 task+source+path 过滤） */
  drafts: readonly ReviewDraft[];
  onAddDraft: (side: AnchorSide, start: number, end: number, snapshot: string | undefined) => void;
  onChangeDraft: (id: string, note: string) => void;
  onRemoveDraft: (id: string) => void;
  /** 作者 id → 展示名（用户走 /api/profile，Agent 走 /api/agents） */
  authorNameOf: (author: DraftAuthor) => string;
  /** 评论折叠态（面板级持有，与 openMap 同层：批量与逐个必须读写同一份） */
  foldedOf: (draftId: string) => boolean;
  onToggleFold: (draftId: string) => void;
  onChangeMarks: (draftId: string, marks: string[]) => void;
  /** 悬停头像 → 预览气泡（面板级持有：同一时刻只显示一个气泡） */
  onPinHover: (pin: CommentPin | undefined, rect?: DOMRect) => void;
  /** 点评论徽标 → 展开该文件的全部隐藏段并滚到第一条评论（隐藏区里的评论否则不可达） */
  onRevealComments: (filePath: string) => void;
  /** 评论的三个动作（关闭/复制/发送）+ 当前用户 id */
  commentActions: CommentActions;
  /** A2b：拖选状态（面板级持有：同一时刻只能有一个正在进行的选区） */
  drag: { anchor: LinePoint | undefined; range: LineRange | undefined };
  /** A2b：按下开始 / 更新终点 / 结束提交 */
  onDragStart: (filePath: string, sourceKind: ReviewSourceKind, point: LinePoint, extend: boolean) => void;
  onDragExtend: (filePath: string, point: LinePoint, extend?: boolean) => void;
  /** 该文件某一隐藏段的当前展开状态（面板统一持有）；key = "hunkIndex:segmentIndex" */
  hiddenOf: (path: string, key: string) => HiddenState | undefined;
  onHiddenExpand: (path: string, key: string, action: ExpansionAction, segment: Extract<Segment, { kind: "hidden" }>, sourceKind: ReviewSourceKind) => void;
}) {
  /** R6：文档折行、代码不折（DSH/difit/opencode 三处同判；md 的行是段落）。 */
  const observePlaceholder = usePlaceholderObserver(onFileMount, file.path);
  const wrap = file.kind === "doc";

  /**
   * G8 语法高亮：给这个文件取 old/new 两侧的**整篇 token**（按需，只对展开且 ≤2000 行的文件）。
   *
   * 为什么要整篇而不是逐行（difit `useFileLevelTokens.ts` 同判）：
   *  Prism 的 grammar 有跨行状态（多行注释、模板字符串），逐行分词会把它们切错。
   * 为什么先取 blob：diff 只有 3 行上下文，被折叠的行也在界面里（展开后要显示），
   *  所以必须按行号覆盖**全文**，不能只给可见行。
   *
   * 与 difit 差异：他们按 `baseCommitish/targetCommitish` 取 blob；
   *  我们的 blob 接口只接受 `side=old|new`（本来就按侧取全文），语义等价且少一个参数。
   */
  const [oldTokens, setOldTokens] = useState<FileTokens | null>(null);
  const [newTokens, setNewTokens] = useState<FileTokens | null>(null);
  const language = languageOf(file.path);
  useEffect(() => {
    setOldTokens(null);
    setNewTokens(null);
    if (!open || file.kind !== "code" || language === undefined) return;
    let cancelled = false;
    void (async () => {
      /**
       * Prism 与 grammar 都是**动态加载**的（首屏不背 27.8kB gzip）：
       * 先确保库本身，再确保 grammar；两者都就绪才分词。
       */
      const ready = grammarReady(language) ? true : await ensureGrammar(language);
      if (!ready || cancelled) return;
      const sides: Array<"old" | "new"> = ["old", "new"];
      for (const side of sides) {
        const response = await fetch(`/api/review/blob?${new URLSearchParams({ taskDir, source: sourceKind, path: file.path, side })}`);
        if (!response.ok) continue;   // 那一侧不存在（新增/删除）是正常情况
        const body = await response.json() as { content?: string };
        if (body.content === undefined) continue;
        const tokens = tokenizeFileCached(body.content, language);
        if (cancelled || tokens === null) continue;
        if (side === "old") setOldTokens(tokens); else setNewTokens(tokens);
      }
    })();
    return () => { cancelled = true; };
  }, [open, file.kind, file.path, language, taskDir, sourceKind]);

  /**
   * G12 词级 diff：**只对成对的增删行**算（配对规则与并排同源 `pairForSplit`，避免两套）。
   *
   * 键 = `oldNo:newNo`（行号组合，稳定）；值 = 两侧段序列。
   * 计算放在渲染期（`wordDiffOf` 是同步的，且已经有 `MAX_WORD_DIFF_LINE_LENGTH` 与
   * `worthHighlighting` 两道闸）；库未加载时返回空表，加载完由 state 触发重算。
   */
  const [wordDiffs, setWordDiffs] = useState<Record<string, WordDiff>>({});
  useEffect(() => {
    if (!open || file.kind !== "code") { setWordDiffs({}); return; }
    let cancelled = false;
    void (async () => {
      // 没有任何成对增删行时不必加载库（614KB 源码 / ~35KB gzip，能省则省）
      const hasPairs = file.hunks.some((hunk) => {
        const rows = pairForSplit(hunk.lines);
        return rows.some((row) => row.old !== undefined && row.new !== undefined);
      });
      if (!hasPairs) { if (!cancelled) setWordDiffs({}); return; }
      const lib = await ensureWordDiffLib();
      if (lib === undefined || cancelled) return;
      const next: Record<string, WordDiff> = {};
      for (const hunk of file.hunks) {
        for (const row of pairForSplit(hunk.lines)) {
          if (row.old === undefined || row.new === undefined) continue;
          const oldNo = row.old.oldNo;
          const newNo = row.new.newNo;
          if (oldNo === null || newNo === null) continue;
          const diff = wordDiffOf(row.old.text, row.new.text);
          if (diff !== null) next[`${oldNo}:${newNo}`] = diff;
        }
      }
      if (!cancelled) setWordDiffs(next);
    })();
    return () => { cancelled = true; };
  }, [open, file.hunks, file.kind]);

  /** 按**旧行号**找它的词级段（unified 里一行只知道自己，配对关系由 `pairForSplit` 的键给出） */
  const wordDiffAtPairOld = (line: SegmentLine): readonly WordSegment[] | undefined => {
    if (line.oldNo === null) return undefined;
    for (const [key, diff] of Object.entries(wordDiffs)) {
      if (key.startsWith(`${line.oldNo}:`)) return diff.oldSegments;
    }
    return undefined;
  };

  /** 按**新行号**找它的词级段 */
  const wordDiffAtPairNew = (line: SegmentLine): readonly WordSegment[] | undefined => {
    if (line.newNo === null) return undefined;
    for (const [key, diff] of Object.entries(wordDiffs)) {
      if (key.endsWith(`:${line.newNo}`)) return diff.newSegments;
    }
    return undefined;
  };

  /** 取某一段配对的词级结果（没有则 undefined → 走普通渲染） */
  const wordDiffAt = (oldNo: number | null, newNo: number | null): WordDiff | undefined => {
    if (oldNo === null || newNo === null) return undefined;
    return wordDiffs[`${oldNo}:${newNo}`];
  };

  /** 按行取 token（`tokenSideOf` 决定用哪一侧；取不到返回 null → DiffRow 退回纯文本） */
  const tokensFor = (line: SegmentLine): readonly Token[] | null => {
    if (oldTokens === null && newTokens === null) return null;
    const side = tokenSideOf(line);
    if (side === null) return null;
    return tokensAtLine(side === "old" ? oldTokens : newTokens, side === "old" ? line.oldNo : line.newNo)
      ?? tokensAtLine(oldTokens, line.oldNo);
  };

  /** A6：两侧行号→原文索引，供过期判定与快照抓取（同一份 hunk 数据只建一次）。 */
  const lineIndex = useMemo(() => buildFileLineIndex(file.hunks), [file.hunks]);
  /**
   * 行号 → 该行覆盖到的草稿列表。
   *
   * **必须是一对多**（用户 2026-11-05："同一行多个 agent 和用户评论呢？"）：
   * 同一段代码上用户和 N 个 Agent 可以各写一条，键里带作者，落盘是独立记录；
   * 渲染时一行要能看到所有卡片，不能"后写覆盖先写"。
   */
  const draftsByLine = useMemo(() => {
    const map = new Map<string, ReviewDraft[]>();
    // G7 的"已关闭默认隐藏"在面板层过滤（`draftsForFile` 只给出要渲染的），这里拿到的就是可见集
    for (const draft of drafts) {
      for (let no = draft.start; no <= draft.end; no++) {
        const key = `${draft.side}:${no}`;
        const list = map.get(key);
        if (list === undefined) map.set(key, [draft]);
        else list.push(draft);
      }
    }
    return map;
  }, [drafts]);
  /**
   * 某一行的草稿展示态（hunk 内行与「展开出来的行」共用同一份判定）。
   * 展开出来的行在 patch 之外，但**有行号**，所以能像 context 行一样批注
   * （difit 同判：`useExpandedLines.ts:536-542` 把展开行标 `type:'normal'` + oldLineNumber/newLineNumber，
   *  `DiffLineRow.tsx:62-63` 据此显示行内操作）。
   */
  /** A22：拖选范围的首/末行（整块高亮只在这两行画上/下边） */
  const dragEdgesOf = (side: AnchorSide, no: number | null | undefined) => {
    if (no === null || no === undefined) return { dragBlockStart: false, dragBlockEnd: false };
    const edges = blockEdgesOf(drag.range, side, no);
    return { dragBlockStart: edges.start, dragBlockEnd: edges.end };
  };

  const draftStateOf = (side: AnchorSide, no: number | null | undefined) => {
    if (no === null || no === undefined) return undefined;
    const list = draftsByLine.get(`${side}:${no}`) ?? [];
    if (list.length === 0) return { has: false, isStart: false, outdated: false };
    // 卡片挂在**结束行**（与上面的行内渲染一致）；任一草稿在此结束就显示卡片
    return {
      has: true,
      isStart: list.some((draft) => draft.end === no),
      outdated: list.some((draft) => outdated.has(draft.id)),
      // A22 整块高亮：首行/末行各只画一侧的边（difit `drag-selected-first/last` 同构）
      blockStart: list.some((draft) => Math.min(draft.start, draft.end) === no),
      blockEnd: list.some((draft) => Math.max(draft.start, draft.end) === no),
    };
  };

  /**
   * 某行的评论针（折叠态头像，按作者去重）。
   * hunk 内行与「展开出来的行」共用——展开行同样可能挂评论（用户会点开隐藏区再评论）。
   */
  const pinsOf = (side: AnchorSide, no: number | null | undefined): CommentPin[] => {
    if (no === null || no === undefined) return [];
    // 只取**结束行在此**的草稿：范围评论不在中间行重复出头像（否则 6..10 会在 5 行上各出现一次）
    const list = (draftsByLine.get(`${side}:${no}`) ?? []).filter((draft) => draft.end === no);
    const pins: CommentPin[] = [];
    const seen = new Set<string>();
    for (const draft of list) {
      const author = draft.author ?? { kind: "user" as const, id: "user" };
      const key = `${author.kind}:${author.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pins.push({
        id: draft.id, author, authorName: authorNameOf(author),
        preview: draft.note === "" ? "（还没写内容）" : draft.note.split("\n")[0],
        marks: draft.marks ?? [],
        location: locationHeader(draft.filePath, { side: draft.side, start: draft.start, end: draft.end }),
        range: rangeLabel({ side: draft.side, start: draft.start, end: draft.end }),
      });
    }
    return pins;
  };

  /** 结束于该行的草稿（卡片渲染用；折叠的不渲染） */
  /** 该草稿的完整评论（状态/权限用；找不到就按"未关闭、可关闭"的乐观默认） */
  const commentOf = (draft: ReviewDraft): ReviewDraft => draft;

  const endingCardsOf = (side: AnchorSide, no: number | null | undefined) => {
    if (no === null || no === undefined) return [];
    return (draftsByLine.get(`${side}:${no}`) ?? []).filter((draft) => draft.end === no && !foldedOf(draft.id));
  };

  /** 过期的草稿 id（A6）：内容比对判定，见 review-outdated.ts */
  const outdated = useMemo(() => {
    const set = new Set<string>();
    for (const draft of drafts) {
      if (isAnchorOutdated({ side: draft.side, start: draft.start, end: draft.end, snapshot: draft.snapshot }, lineIndex)) {
        set.add(draft.id);
      }
    }
    return set;
  }, [drafts, lineIndex]);
  /**
   * 整份文件只切一次段（含 hunk 边界标记）。
   * **不能按 hunk 分别切**：分别切会让"第二个 hunk 之前的空档"被误算成文件头
   * （实测：3 个 hunk 的 README 出现 head:96 / head:156 两个假头段）。
   */
  /**
   * G5：`large` 态只渲染前 `LARGE_FILE_PREVIEW_LINES` 行。
   *
   * 做法是**截断 hunks 再走同一套 `buildSegments`**，而不是另写一条渲染路径——
   * 否则折叠/展开/批注/锚点在这条路径上全部要重做一遍（这正是"两套实现必漂移"的来源）。
   * 截断按**行数**，不按 hunk 数：一个 900 行的单 hunk 必须也能截。
   */
  const visibleHunks = useMemo(() => {
    if (body !== "large") return file.hunks;
    const out: typeof file.hunks = [];
    let budget = LARGE_FILE_PREVIEW_LINES;
    for (const hunk of file.hunks) {
      if (budget <= 0) break;
      const lines = hunk.lines.slice(0, budget);
      budget -= lines.length;
      out.push({ ...hunk, lines });
    }
    return out;
  }, [file.hunks, body]);

  const segments = useMemo(
    // 标准档：hunk 内全显（mode "all" 不 mask）；仅改动行档：上下文 0 行（只剩 +/- 行）
    () => buildSegments(visibleHunks, { mode: expandMode, context: expandMode === "diff" ? 0 : 3, emitHunkHeaders: true }),
    [visibleHunks, expandMode],
  );

  return (
    <div className="overflow-hidden rounded-panel bg-surface ring-1 ring-line" data-review-file={file.path}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex h-11 w-full items-center gap-2 px-3 text-left hover:bg-hover">
        <span aria-hidden="true" className={`shrink-0 text-micro font-semibold ${open ? "text-ink-500" : "text-ink-300"}`}>{open ? "▾" : "▸"}</span>
        <span className={`shrink-0 rounded-inner px-1.5 py-0.5 text-micro font-semibold ${
          file.status === "added" ? "bg-success-soft text-success"
          : file.status === "deleted" ? "bg-danger-soft text-danger"
          : "bg-diff-mod-soft text-diff-mod"}`}>
          {STATUS_LABEL[file.status]}
        </span>
        <span className="min-w-0 flex-1 truncate text-body text-ink-900" title={file.oldPath !== undefined ? `${file.oldPath} → ${file.path}` : file.path}>
          {/* 文件头主显 basename（0018）：家目录文档源是四级嵌套路径，整行显示全路径时
              truncate 把文件名截在行尾之外，用户认不出哪个文件（实测："看不到 design.md"）。
              目录只显尾段（前面加 …），窄面板 truncate 从右端吃 —— 先截掉目录，保住文件名。 */}
          {filePathParts(file.path).name}
          {dirLabelOf(file.path) !== "" && (
            <span className="ml-1.5 text-micro text-ink-500">{dirLabelOf(file.path)}</span>
          )}
        </span>
        <span className="shrink-0 rounded-inner bg-hover px-1.5 py-0.5 text-micro text-ink-500">{KIND_LABEL[file.kind]}</span>
        {/*
          检视意见数（用户 2026-11-05）：**折叠时必须可见**——"我可能对多个文档评论"，
          若只在展开的 diff 体里显示，一折叠就以为评论没了。
          图标用 SVG 气泡（不打字形，依据 C185）；数字取该文件的草稿数。
        */}
        {drafts.length > 0 ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              /**
               * 点击 → 展开该文件并滚到第一条评论（VS Code `commentGlyphWidget` / GitHub 文件行同判）。
               *
               * **必须先展开隐藏段**（2026-11-05 用户报"点了不跳转"的根因）：
               * 注释所在行可能落在折叠的 gap/head/tail 里，那样 DOM 里根本没有目标元素，
               * `querySelector` 返回 null → 什么都不发生，徽标却显示有 N 条。
               */
              event.stopPropagation();
              if (!open) onToggle();
              onRevealComments(file.path);
            }}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onToggle(); } }}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-inner bg-anno-query-soft px-1.5 py-0.5 text-micro text-anno-query hover:ring-1 hover:ring-anno-query"
            data-review-comment-count={drafts.length}
            title={`${drafts.length} 条检视意见 · 点击定位`}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M1.5 2.5h9v6h-5l-2.5 2v-2h-1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
            </svg>
            {drafts.length}
          </span>
        ) : null}
        <StatBadge additions={file.additions} deletions={file.deletions} />
        {/*
          G10「已看」复选框（GitHub Files changed / VS Code / difit 同款位置：文件头右侧）。
          点它**不展开文件**（`stopPropagation`）；三态用图标区分：
          ○ 未看 / ✓ 已看 / ↻ 看过但内容变了（difit 的 `changedSinceViewed`）。
        */}
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onToggleViewed(); }}
          aria-pressed={viewedStatus === "viewed"}
          aria-label={viewedStatus === "viewed" ? `取消标记「已看」：${file.path}` : viewedStatus === "changed" ? `内容已变，标记为「已看」：${file.path}` : `标记为「已看」：${file.path}`}
          title={viewedStatus === "viewed" ? "已看（点击取消）" : viewedStatus === "changed" ? "看过之后内容又变了，需要重看（点击重新标记已看）" : "标记为已看"}
          data-review-viewed-toggle={file.path}
          data-review-viewed-status={viewedStatus}
          className={`shrink-0 rounded-inner px-1 py-0.5 text-micro ring-1 transition-colors ${
            viewedStatus === "viewed"
              ? "bg-success-soft text-success ring-success-soft hover:bg-hover"
              : viewedStatus === "changed"
              ? "bg-diff-mod-soft text-diff-mod ring-diff-mod-soft hover:bg-hover"
              : "text-ink-500 ring-line hover:bg-hover hover:text-ink-900"}`}
        >{viewedStatus === "viewed" ? "✓ 已看" : viewedStatus === "changed" ? "↻ 已变" : "○ 未看"}</button>
      </button>
      {/* G6：占位（滚到 1200px 内自动挂载；difit `LAZY_RENDER_ROOT_MARGIN`） */}
      {open && body === "placeholder" && (
        <div
          className="border-t border-line"
          data-review-placeholder={file.path}
          style={{ height: LAZY_PLACEHOLDER_HEIGHT_PX }}
          /* 稳定的 ref 回调（见 `usePlaceholderObserver` 的注释：内联函数每次渲染都会重建 observer） */
          ref={observePlaceholder}
        >
          <div className="flex h-full items-center justify-center text-micro text-ink-500">正在准备这个文件的 diff…</div>
        </div>
      )}
      {open && body !== "placeholder" && needsLargeFileNotice({ expanded: open, changedLines: file.additions + file.deletions, forced: body === "mounted" }) && (
        /*
          G5：大文件**仍然渲染**，但先给提示与「全部展开」。
          opencode 在 >500 行时直接不渲染（`too-large` + "render anyway"）；我们要"能看"，
          所以只提示 + 默认只显示前若干行（用户点一下就能全看）。
        */
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-sunken px-3 py-1.5 text-micro text-ink-700" data-review-large-diff={file.path}>
          <span>改动 {file.additions + file.deletions} 行（超过 {MAX_CHANGED_LINES_BEFORE_COLLAPSE} 行），已默认只展开前 {LARGE_FILE_PREVIEW_LINES} 行</span>
          <button type="button" onClick={onForceRender} className="rounded-inner bg-surface px-1.5 py-0.5 text-accent ring-1 ring-line hover:bg-hover" data-review-large-force>
            全部展开
          </button>
        </div>
      )}
      {/* G15：md 渲染态（第三档）——只对 doc 文件、且只在这个档位生效 */}
      {open && body !== "placeholder" && renderAs === "md-preview" && file.kind === "doc" ? (
        <div className="border-t border-line" data-review-md-diff={file.path}>
          <MarkdownPreviewDiff blocks={buildRenderBlocks(buildPreviewBlocks(file.hunks.flatMap((hunk) => hunk.lines)))} />
        </div>
      ) : null}
      {open && body !== "placeholder" && (
        <div className="border-t border-line" data-review-diff={file.path} data-review-wrap={wrap ? "wrap" : "scroll"}
          hidden={renderAs === "md-preview" && file.kind === "doc"}>
          {file.hunks.length === 0 ? (
            <div className="px-3 py-2 text-micro text-ink-500">（无内容变更）</div>
          ) : segments.map((segment, si) => {
            if (segment.kind === "hunk") {
              return (
                <div key={`hunk-${si}`} className="bg-sunken px-3 py-0.5 font-mono text-micro text-ink-500" data-hunk>
                  @@ −{segment.oldStart},{segment.oldLines} +{segment.newStart},{segment.newLines} @@
                </div>
              );
            }
            if (segment.kind === "lines") {
              /**
               * G11 并排：`lines` 段整体换成配对行渲染（配对规则在 `review-split.ts`，纯函数 + 穷举测试）。
               * **不给 unified 与 split 各写一套行渲染**：两者共用 `DiffRow`/`SplitDiffRow` 的**同一份交互参数**
               * （锚点、拖选、评论针、整块高亮），差异只在"一行摆几格"。
               */
              if (viewMode === "split") {
                return (
                  <div key={`split-${si}`} data-review-split-block>
                    {pairForSplit(segment.lines).map((row, ri) => (
                      <SplitDiffRow
                        key={`sp-${si}-${ri}`}
                        row={row}
                        wrap={wrap}
                        viewMode={viewMode}
                        oldTokens={row.old === undefined ? null : tokensFor(row.old)}
                        newTokens={row.new === undefined ? null : tokensFor(row.new)}
                        oldWords={row.old === undefined || row.new === undefined ? undefined : wordDiffAt(row.old.oldNo, row.new.newNo)?.oldSegments}
                        newWords={row.old === undefined || row.new === undefined ? undefined : wordDiffAt(row.old.oldNo, row.new.newNo)?.newSegments}
                        draftStateOf={(side, no) => draftStateOf(side, no)}
                        pinsOf={(side, no) => pinsOf(side, no)}
                        pinPreviewable={(pin) => foldedOf(pin.id)}
                        dragRangeOf={(side, no) => inRange(drag.range, side, no)}
                        onAddDraft={(side, no, text) => onAddDraft(side, no, no, text)}
                        onDragStart={(side, no, event) => {
                          if (event.button !== 0) return;
                          if ((event.target as HTMLElement).closest("[data-review-add-draft]") !== null) return;
                          onDragStart(file.path, sourceKind, { side, line: no }, event.shiftKey);
                        }}
                        onSelectExtend={(side, no) => onDragExtend(file.path, { side, line: no })}
                        onPinHover={onPinHover}
                        onPinOpen={(pin) => { onToggleFold(pin.id); onPinHover(undefined); }}
                      />
                    ))}
                  </div>
                );
              }
              return segment.lines.map((line, li) => {
                // 锚点侧：新增行只能锚 new，删除行只能锚 old，context 优先 new（与 diff 阅读方向一致）
                const side: AnchorSide | undefined =
                  line.type === "added" ? "new" : line.type === "removed" ? "old" : line.newNo !== null ? "new" : "old";
                const anchorNo = side === undefined ? null : side === "new" ? line.newNo : line.oldNo;
                if (side === undefined || anchorNo === null) {
                  return <DiffRow key={`${si}-${li}`} line={line} wrap={wrap} tokens={tokensFor(line)} />;
                }
                const lineDrafts = draftsByLine.get(`${side}:${anchorNo}`) ?? [];
                // 卡片挂在**结束行**（用户 2026-11-05：拖 3~7 行，框应该在第 7 行下面）
                const endingHere = lineDrafts.filter((draft) => draft.end === anchorNo);
                /**
                 * A22：**必须走 `draftStateOf`**（不要在这里另算一份）。
                 * 这里早先是内联拼的 `{has,isStart,outdated}`，漏了 `blockStart/blockEnd`，
                 * 结果整块高亮永远只画成 "middle"（上/下边都不画）——正是用户报的"没有框"的另一种形态。
                 */
                const state = draftStateOf(side, anchorNo) ?? { has: false, isStart: false, outdated: false };
                /**
                 * 折叠态的针（行末头像）：**按作者去重**——同一个 Agent 在一行有多条评论时，
                 * 那一行只出现一个它的头像（用户："多个评论就是那一行多个头像"，指不同作者）。
                 */
                // 用统一的 pinsOf（按结束行归属 + 按作者去重），避免两处逻辑漂移
                const pins = pinsOf(side, anchorNo);
                return (
                  <div key={`${si}-${li}`}>
                    <DiffRow
                      line={line}
                      wrap={wrap}
                      tokens={tokensFor(line)}
                      words={line.type === "removed" ? wordDiffAtPairOld(line) : line.type === "added" ? wordDiffAtPairNew(line) : undefined}
                      anchorSide={side}
                      anchorNo={anchorNo}
                      draftState={state}
                      inDragRange={inRange(drag.range, side, anchorNo)}
                      {...dragEdgesOf(side, anchorNo)}
                      onAddDraft={() => onAddDraft(side, anchorNo, anchorNo, line.text)}
                      onSelectStart={(event) => {
                        // 点在行号或「＋」上时交给它们自己（已 stopPropagation / 由 onClick 处理）
                        if (event.button !== 0) return;
                        // 只挡「＋」按钮（它自己处理点击）；**行号不禁**——行号是 A2c 的拖选起点
                        if ((event.target as HTMLElement).closest("[data-review-add-draft]") !== null) return;
                        onDragStart(file.path, sourceKind, { side, line: anchorNo }, event.shiftKey);
                      }}
                      onSelectExtend={() => onDragExtend(file.path, { side, line: anchorNo })}
                      commentPins={pins}
                      pinPreviewable={(pin) => foldedOf(pin.id)}
                      onPinHover={onPinHover}
                      onPinOpen={(pin) => { onToggleFold(pin.id); onPinHover(undefined); }}
                    />
                    {/*
                      一行可以有多条评论（不同作者/不同范围），逐条渲染（difit `DiffChunk.tsx:505` 同判）。
                      **但折叠态不渲染卡片**（用户 2026-11-05）：行末已有头像针，卡片默认收起——
                      否则每条评论仍占一整行，"折叠"没意义。
                    */}
                    {endingHere.filter((draft) => !foldedOf(draft.id)).map((draft) => (
                      <DraftCard
                        key={draft.id}
                        draft={draft}
                        outdated={outdated.has(draft.id)}
                        authorName={authorNameOf(draft.author ?? { kind: "user", id: "user" })}
                        folded={foldedOf(draft.id)}
                        onToggleFold={() => onToggleFold(draft.id)}
                        onChange={(note) => onChangeDraft(draft.id, note)}
                        onRemove={() => onRemoveDraft(draft.id)}
                        onChangeMarks={(marks) => onChangeMarks(draft.id, marks)}
                        closed={isClosedComment({ state: draft.state ?? "draft" })}
                        awaiting={awaitingOfComment({ state: draft.state ?? "draft", awaiting: draft.awaiting ?? null })}
                        canClose={canCloseCommentBy(
                          { author: draft.author ?? { kind: "user", id: "user" }, canClose: draft.canClose ?? "author-or-user" },
                          { kind: "user", id: commentActions.userId },
                        )}
                        onClose={() => commentActions.close(draft.id)}
                      onReopen={() => commentActions.reopen(draft.id)}
                        onCopy={() => commentActions.copy(draft)}
                        onSend={() => commentActions.send(draft)}
                        commentActions={commentActions}
                        authorNameOf={authorNameOf}
                        onSetAwaiting={(next) => commentActions.setAwaiting(draft.id, next)}
                      />
                    ))}
                  </div>
                );
              });
            }

            const state = hiddenOf(file.path, String(si));
            const shownUp = state?.up ?? 0;
            const shownDown = state?.down ?? 0;
            const remaining = segment.count - shownUp - shownDown;
            // 段内自带内容（hunk 内）→ 直接切；gap/head/tail 不在 patch 里 → 用 blob 取到的内容
            const pool: SegmentLine[] = segment.lines ?? state?.lines ?? [];
            const headSlice = pool.slice(0, shownUp);
            const tailSlice = shownDown > 0 ? pool.slice(pool.length - shownDown) : [];

            return (
              <div key={`hidden-${si}`}>
                {headSlice.map((line, li) => (
                  <div key={`u-wrap-${li}`}>
                  <DiffRow
                    key={`u-${li}`}
                    line={line}
                    wrap={wrap}
                    tokens={tokensFor(line)}
                    anchorSide="new"
                    anchorNo={line.newNo ?? line.oldNo}
                    draftState={draftStateOf("new", line.newNo ?? line.oldNo)}
                    inDragRange={inRange(drag.range, "new", line.newNo ?? line.oldNo ?? -1)}
                    {...dragEdgesOf("new", line.newNo ?? line.oldNo ?? -1)}
                    onAddDraft={() => {
                      const no = line.newNo ?? line.oldNo;
                      if (no !== null) onAddDraft("new", no, no, line.text);
                    }}
                    onSelectStart={(event) => {
                      const no = line.newNo ?? line.oldNo;
                      if (no === null || event.button !== 0) return;
                      if ((event.target as HTMLElement).closest("[data-review-add-draft],[data-review-line-anchor]") !== null) return;
                      onDragStart(file.path, sourceKind, { side: "new", line: no }, event.shiftKey);
                    }}
                    onSelectExtend={() => {
                      const no = line.newNo ?? line.oldNo;
                      if (no !== null) onDragExtend(file.path, { side: "new", line: no });
                    }}
                    commentPins={pinsOf("new", line.newNo ?? line.oldNo)}
                    pinPreviewable={(pin) => foldedOf(pin.id)}
                    onPinHover={onPinHover}
                    onPinOpen={(pin) => { onToggleFold(pin.id); onPinHover(undefined); }}
                  />
                  {endingCardsOf("new", line.newNo ?? line.oldNo).map((draft) => (
                    <DraftCard
                      key={draft.id}
                      draft={draft}
                      outdated={outdated.has(draft.id)}
                      authorName={authorNameOf(draft.author ?? { kind: "user", id: "user" })}
                      folded={false}
                      onToggleFold={() => onToggleFold(draft.id)}
                      onChange={(note) => onChangeDraft(draft.id, note)}
                      onRemove={() => onRemoveDraft(draft.id)}
                      onChangeMarks={(marks) => onChangeMarks(draft.id, marks)}
                      closed={isClosedComment({ state: draft.state ?? "draft" })}
                      awaiting={awaitingOfComment({ state: draft.state ?? "draft", awaiting: draft.awaiting ?? null })}
                      canClose={canCloseCommentBy(
                        { author: draft.author ?? { kind: "user", id: "user" }, canClose: draft.canClose ?? "author-or-user" },
                        { kind: "user", id: commentActions.userId },
                      )}
                      onClose={() => commentActions.close(draft.id)}
                      onReopen={() => commentActions.reopen(draft.id)}
                      onCopy={() => commentActions.copy(draft)}
                      onSend={() => commentActions.send(draft)}
                      commentActions={commentActions}
                      authorNameOf={authorNameOf}
                      onSetAwaiting={(next) => commentActions.setAwaiting(draft.id, next)}
                    />
                  ))}
                  </div>
                ))}
                {/*
                  全展开（remaining === 0）时**仍然渲染**折叠条：
                  否则用户点完「全部」之后就再也折不回去了（VS Code `:438-441` 在全展开时
                  把控制条变成 fold 按钮，就是为这个）。这也是用户 2026-11-08 明确指出的缺口：
                  "之前是只有展开没有折叠"。
                */}
                {remaining > 0 || canCollapse({ up: shownUp, down: shownDown }) ? (
                  <HiddenBar
                    count={remaining}
                    region={segment.region}
                    loading={state?.loading === true}
                    canCollapseRows={canCollapse({ up: shownUp, down: shownDown })}
                    onExpandUp={() => onHiddenExpand(file.path, String(si), "up", segment, sourceKind)}
                    onExpandDown={() => onHiddenExpand(file.path, String(si), "down", segment, sourceKind)}
                    onExpandAll={() => onHiddenExpand(file.path, String(si), "all", segment, sourceKind)}
                    onCollapse={() => onHiddenExpand(file.path, String(si), "collapse", segment, sourceKind)}
                  />
                ) : null}
                {state?.failed !== undefined ? (
                  <div className="px-3 py-1 text-micro text-danger" data-review-expand-error>展开失败：{state.failed}</div>
                ) : null}
                {tailSlice.map((line, li) => (
                  <DiffRow
                    key={`d-${li}`}
                    line={line}
                    wrap={wrap}
                    tokens={tokensFor(line)}
                    anchorSide="new"
                    anchorNo={line.newNo ?? line.oldNo}
                    draftState={draftStateOf("new", line.newNo ?? line.oldNo)}
                    inDragRange={inRange(drag.range, "new", line.newNo ?? line.oldNo ?? -1)}
                    {...dragEdgesOf("new", line.newNo ?? line.oldNo ?? -1)}
                    onAddDraft={() => {
                      const no = line.newNo ?? line.oldNo;
                      if (no !== null) onAddDraft("new", no, no, line.text);
                    }}
                    onSelectStart={(event) => {
                      const no = line.newNo ?? line.oldNo;
                      if (no === null || event.button !== 0) return;
                      if ((event.target as HTMLElement).closest("[data-review-add-draft],[data-review-line-anchor]") !== null) return;
                      onDragStart(file.path, sourceKind, { side: "new", line: no }, event.shiftKey);
                    }}
                    onSelectExtend={() => {
                      const no = line.newNo ?? line.oldNo;
                      if (no !== null) onDragExtend(file.path, { side: "new", line: no });
                    }}
                  />
                ))}
              </div>
            );
          })}
          {file.truncated === true && (
            <div className="border-t border-line px-3 py-1.5 text-micro text-ink-500">
              改动过大，只显示部分行（上限见 02-design §1.2）
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<ReviewSourceKind, string> = { worktree: "项目代码（repo/）", lifeos: "家目录文档（~/.lifeos）" };

/** 文件行显示拆分：主显文件名（basename），目录尾段次显（0018）。 */
function filePathParts(path: string): { dir: string; name: string } {
  const index = path.lastIndexOf("/");
  return index < 0 ? { dir: "", name: path } : { dir: path.slice(0, index), name: path.slice(index + 1) };
}

/** 目录尾段标签：dir 还有更上层时前缀 …；只有一段就不加（src/demo.ts → "src/"）。 */
function dirLabelOf(path: string): string {
  const { dir } = filePathParts(path);
  if (dir === "") return "";
  return (dir.includes("/") ? "…" : "") + `${dir.split("/").pop()}/`;
}

/**
 * 一段隐藏区域的展开状态（S1·G1b）。
 * 按 `文件路径 + 段序号` 记，**面板统一持有**（同 openMap 的理由：批量与逐个必须读写同一份）。
 */
type HiddenState = { up: number; down: number; lines?: SegmentLine[]; loading?: boolean; failed?: string };

/**
 * 折叠态的"评论针"（行末头像）。
 *
 * 用户 2026-11-05 方案：折叠只保留头像在**那一行的行末**；悬停出预览框、移开消失；点击展开完整卡。
 * 参考：Figma / Google Docs 的协作者头像标记（悬停预览 + 点开），代码检视工具（VS Code glyph / GitHub 蓝点）
 * 只做了"点击展开"没有悬停预览 —— 我们取前者的交互、后者的位置（行内而非侧边）。
 */
/**
 * 评论的三个动作（A19 关闭 / A20 复制 / A21 发送到输入框）。
 *
 * 为什么打包成一个对象往下穿：FileCard → DraftCard 嵌了两层，
 * 逐个传 5 个回调会让签名膨胀；打包后 FileCard 只多一个 prop（frontend 规范 2.3 的"容器 + 注册项"同理）。
 */
type CommentActions = {
  /** 关闭（已解决）；权限已由面板层判定过 */
  close: (id: string) => void;
  /** 重开（撤销关闭）；作者或用户 */
  reopen: (id: string) => void;
  /** 复制到剪贴板 */
  copy: (draft: ReviewDraft) => void;
  /** 放进输入框（不自动发） */
  send: (draft: ReviewDraft) => void;
  /** 当前用户 id（判定 canClose 用） */
  userId: string;
  /**
   * 线程动作（S4-h）：
   *  - `reply` 追加一条回复（服务端会把 awaiting 交棒给对方）；
   *  - `removeReply` 删一条回复（作者或用户）；`editReply` 改正文；
   *  - `setAwaiting` 手动改"现在等谁"（G1 的界面入口）。
   */
  reply: (id: string, body: string) => void;
  editReply: (id: string, replyId: string, body: string) => void;
  removeReply: (id: string, replyId: string) => void;
  setAwaiting: (id: string, awaiting: "user" | "agent" | null) => void;
  /** 服务端是否可达（false 时禁用回复/关闭：离线不能假装成功） */
  online: boolean;
};

type CommentPin = {
  id: string;
  author: DraftAuthor;
  authorName: string;
  /** 预览气泡显示的内容 */
  preview: string;
  marks: readonly string[];
  location: string;
  range: string;
};

/**
 * 渲染层 `ReviewDraft` → 后端 `ReviewComment`（复制/发送时把当前编辑态转回去）。
 *
 * 为什么需要：用户在输入框里改了正文但还没落盘（或刚落盘）时，"复制/发送"应该用**屏幕上的内容**，
 * 而不是上一次服务端快照——否则用户会复制到旧文字。
 */
function draftToComment(draft: ReviewDraft, taskId: string): ReviewComment {
  return {
    id: draft.id,
    taskId,
    author: draft.author ?? { kind: "user", id: "user" },
    anchor: {
      source: draft.source, path: draft.filePath, side: draft.side, start: draft.start, end: draft.end,
      ...(draft.snapshot !== undefined ? { snapshot: draft.snapshot } : {}),
    },
    body: draft.note,
    marks: draft.marks ?? [],
    state: draft.state ?? "draft",
    awaiting: draft.awaiting ?? null,
    canClose: draft.canClose ?? "author-or-user",
    // 复制/发送要用**屏幕上的**回复（服务端快照可能更旧）；不回填就会把回复丢掉
    replies: draft.replies ?? [],
    createdAt: draft.createdAt,
    updatedAt: draft.createdAt,
  };
}

/**
 * 后端 `ReviewComment` → 渲染层 `ReviewDraft`（形状未变，UI 代码零改动）。
 *
 * 两者字段名不同的原因：draft 是 S2 的浏览器本地结构（`filePath/note`），
 * comment 是 S4-b 的服务端结构（`anchor.path/body`）。转换只在这一处，别处不重复映射。
 */
function commentToDraft(comment: ReviewComment): ReviewDraft {
  return {
    id: comment.id,
    taskDir: "",
    source: comment.anchor.source,
    filePath: comment.anchor.path,
    side: comment.anchor.side,
    start: comment.anchor.start,
    end: comment.anchor.end,
    ...(comment.anchor.snapshot !== undefined ? { snapshot: comment.anchor.snapshot } : {}),
    note: comment.body,
    marks: comment.marks,
    author: comment.author,
    createdAt: comment.createdAt,
    // S4-e：状态与权限随草稿一起带给渲染层（避免渲染层再查一次表）
    state: comment.state,
    awaiting: comment.awaiting,
    canClose: comment.canClose,
    // S4-h：回复也一起带过来（渲染层不再单独查一次）
    replies: comment.replies ?? [],
  };
}

/** 路径太长时中间省略（`…/tasks/0010-检视模式/evidence/worktree`），完整路径在 title 里。 */
function shortenPath(path: string): string {
  const parts = path.split("/").filter((part) => part !== "");
  if (parts.length <= 4) return path;
  return `…/${parts.slice(-3).join("/")}`;
}

/**
 * 复制"检视对象"文本（用户 2026-11-05："检视了哪个 worktree 的哪个文件，要很方便地复制"）。
 *
 * 格式刻意**机器友好**（Agent 直接能读），一行一个源：
 *   检视对象：<taskDir>
 *   - worktree：<绝对路径>（分支 dev/x @ abc1234）
 *   - Task 文档：<绝对路径>
 */
function copyTargetText(data: ReviewData | null, taskDir: string): string {
  const lines = [`检视对象：${taskDir}`];
  for (const group of data?.items ?? []) {
    const label = group.source.kind === "worktree" ? "项目代码" : "家目录文档";
    const meta = [
      group.source.branch !== undefined ? `分支 ${group.source.branch}` : undefined,
      group.source.head !== undefined ? `@ ${group.source.head}` : undefined,
    ].filter((part): part is string => part !== undefined).join(" ");
    lines.push(`- ${label}：${group.source.path}${meta === "" ? "" : `（${meta}）`}`);
  }
  const text = lines.join("\n");
  void navigator.clipboard?.writeText(text).catch(() => undefined);
  return text;
}

/**
 * 折叠条（difit `ExpandButton.tsx:8-32` 的同构实现）：
 * - `hiddenLines <= DEFAULT_EXPAND_COUNT(20)` → 只给「展开全部 N 行」（difit 同判）；
 * - 超过 → 给「↑ 20 行」「↓ 20 行」「全部 N 行」三向（opencode 只有全局两段，difit 才有三向）。
 * - 文案带数字（difit `ariaLabel: 'Expand N hidden lines above'`）；D"并带 region 标识供测试断言。
 */
function HiddenBar({ count, region, canCollapseRows, onExpandUp, onExpandDown, onExpandAll, onCollapse, loading }: {
  count: number;
  region: string;
  /** 这一段已经有展开出来的行 → 给「折叠」（折回 0）；依据 VS Code `:438-441` 的 fold 语义 */
  canCollapseRows: boolean;
  onExpandUp: () => void;
  onExpandDown: () => void;
  onExpandAll: () => void;
  onCollapse: () => void;
  loading: boolean;
}) {
  const actions = expandActions(count);
  /**
   * 文案分两态（VS Code `:384` / `:504` 同判：全展开时标签变成 "Collapse unchanged lines"）：
   *  - 还有隐藏行 → 「N 行未修改」+ 展开按钮；
   *  - 已全展开（count === 0）→ 「已全部展开」+ 只留「折叠」。
   */
  const label = count === 0 ? "已全部展开" : `${count} 行未修改`;
  const btn = "rounded-inner px-2 py-0.5 text-micro text-ink-500 hover:bg-hover hover:text-ink-900 disabled:opacity-50";
  return (
    <div className="flex items-center gap-1 bg-sunken px-3 py-0.5 font-mono text-micro" data-review-hidden={region} data-hidden-count={count}>
      <span className="text-ink-500">{label}</span>
      <span className="ml-auto flex items-center gap-1">
        {loading ? <Spinner size={12} /> : null}
        {/*
          折叠（G14）：**部分展开也给**，不只在全展开时给。
          用户点了「↑ 20 行」后想反悔，否则只能一路点到「全部」再把整段毁掉。
          参考：VS Code `hideUnchangedRegionsFeature.ts:438-441`（全展开时触发 collapseAll）+
          `:258/271` 的 `collapseAll`；difit 只有展开、没有折回（`ExpandButton.tsx`）。
        */}
        {canCollapseRows ? (
          <button type="button" className={btn} onClick={onCollapse} disabled={loading} data-review-expand="collapse">折叠</button>
        ) : null}
        {count > 0 && "up" in actions ? (
          <>
            <button type="button" className={btn} onClick={onExpandUp} disabled={loading} data-review-expand="up">↑ {actions.up} 行</button>
            <button type="button" className={btn} onClick={onExpandDown} disabled={loading} data-review-expand="down">↓ {actions.down} 行</button>
          </>
        ) : null}
        {count > 0 ? (
          <button type="button" className={btn} onClick={onExpandAll} disabled={loading} data-review-expand="all">全部 {actions.all} 行</button>
        ) : null}
      </span>
    </div>
  );
}

/**
 * 一行 diff（R6：折行按文件类型分）。
 * - 代码/其他 → `whitespace-pre`（不折，横向可滚）：DSH ADR "源码行靠缩进阅读" + difit `DiffCodeLine` 用 `pre`
 *   + opencode `overflow: "scroll"` 三处同判；
 * - 文档（.md）→ `whitespace-pre-wrap break-words`：md 的行是段落，折行才能读。
 */
/**
 * 一行 diff。
 *
 * - `anchorNo`：这一行在锚点侧的行号（null = 这一行没有该侧行号，不能批注）；
 * - `draftState`：这一行已被草稿覆盖（`draft` 有值）/ 是草稿的起始行（`isStart`）/ 是否过期；
 * - `onAddDraft`：悬停时出现的「＋」入口（S2·A5）。
 *
 * 悬停按钮用 opacity（不是 display:none）——frontend 规范 2.4，避免布局跳动。
 */
/** md 渲染态里一个块的左边色边与底色（difit `getBlockStyle` `:335-346` 同构）。 */
function previewBlockClass(type: PreviewBlockType): string {
  if (type === "add") return "border-l-2 border-diff-add bg-diff-add-soft/50";
  if (type === "delete") return "border-l-2 border-diff-del bg-diff-del-soft/50";
  if (type === "change") return "border-l-2 border-diff-add bg-diff-add-soft/50";
  return "border-l-2 border-transparent";
}

/**
 * G15 md 渲染态 diff：把 md 的 diff 渲染成**文档**，按块标出哪一小节被改了。
 *
 * 为什么需要（D4 的补充而不是替代）：源码行级 diff 在"一段话重排"时满屏红绿，
 * 看不出"文档变成什么样了"。difit `MarkdownDiffViewer` 与 VS Code 的 md preview diff 都做这件事。
 *
 * 三条与 difit 的差异（都有依据）：
 *  1. **不实现 frontmatter 表格 diff**：实测本项目 167 个 md 里 0 个以 `---` 开头（那 60 行逻辑我们无从验证）；
 *  2. **不做 Mermaid**：我们的 md 没有 mermaid 图，装 11.x 是"不会验证的能力"；
 *  3. 代码围栏内逐行标色保留（difit 同做法）——否则围栏里的 `# 注释` 会被当标题。
 *
 * 安全：走 `renderMarkdown`（marked → DOMPurify），与消息正文同一条链路，**HTML 不透传**。
 */
function MarkdownPreviewDiff({ blocks }: { blocks: readonly PreviewBlock[] }) {
  return (
    <div className="py-2" data-review-md-preview>
      {blocks.map((block, index) => {
        if (block.kind === "fenced-code") {
          return (
            <div key={`md-code-${index}`} className="mx-2 my-1 overflow-x-auto rounded-inner bg-sunken px-2 py-1 font-mono text-micro ring-1 ring-line">
              {block.lines.map((line, lineIndex) => (
                <div
                  key={`md-code-${index}-${lineIndex}`}
                  data-review-md-code-line={line.type}
                  className={`whitespace-pre ${line.type === "delete" ? "bg-diff-del-soft text-ink-900" : line.type === "context" ? "text-ink-700" : "bg-diff-add-soft text-ink-900"}`}
                >{line.content === "" ? "\u00a0" : line.content}</div>
              ))}
            </div>
          );
        }
        const text = block.lines.join("\n").trim();
        if (text === "") return null;
        const plain = isPlainBlock(block.lines);
        return (
          <div key={`md-block-${index}`} className={`mx-2 my-1 pl-2 ${previewBlockClass(block.type)}`} data-review-md-block={block.type}>
            {plain
              ? <pre className="whitespace-pre-wrap break-words font-mono text-micro text-ink-700">{text}</pre>
              : <div className="md-body text-micro"><Markdown text={text} /></div>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * G12 词级高亮：把一行按 `WordSegment[]` 渲染，改动段加深底色。
 *
 * 为什么用底色而不是改文字色：整行已经有 diff 的红/绿底（`bg-diff-add-soft` / `bg-diff-del-soft`），
 * 文字色归语法高亮用（G8）。词级再加一层**同色系更深的底**才不打架——
 * difit 用 `WordLevelDiffHighlighter`（`bg-diff-word-*`），同一取向。
 *
 * 没有词级结果（`null`）时退回普通文本 + 语法 token（调用方决定传什么）。
 */
function WordSegments({ segments }: { segments: readonly WordSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "unchanged") return <span key={index}>{segment.value}</span>;
        /**
         * 改动段：**不透明底色 + `ink-900` 文字**（不用语法色）。
         * 理由见 `tokens.css` 里 `--color-diff-word-*` 的注释：同时满足"与词底 ≥4.5"与"与行底可区分"
         * 在 8 个语法色上无法兼得；词级已经是最强的语义信号，文字统一压深反而更好读。
         */
        const className = segment.type === "added"
          ? "bg-diff-word-add text-ink-900 rounded-inner"
          : "bg-diff-word-del text-ink-900 rounded-inner";
        return <span key={index} data-word-diff={segment.type} className={className}>{segment.value}</span>;
      })}
    </>
  );
}

/**
 * 候选 Task（D31）：App 从 `/review-candidates` 拿到后传进来。
 * 面板只消费，不 fetch——它不知道 agentId/projectId（职责边界）。
 */
export type TaskCandidateView = {
  taskId: string;
  title: string;
  taskDir: string;
  /** 有实质改动（worktree 变了，或文档有非 daily 改动） */
  substantive: boolean;
  /** 文档改动只有 daily（C2 分层） */
  docOnlyDaily: boolean;
  docChangedFiles: number;
  /** D29 用户侧可见化：有多少条评论等我（未关闭 且 等我或没人认领） */
  pendingForUser?: number;
  openComments?: number;
};

/**
 * 合入结果的一个源（与后端 `src/task-merge.ts` 的 `MergeStep` 同形）。
 * `status` 的取值就是后端的词，前端不另造一套。
 */
export type MergeStepView = {
  kind: "project" | "home";
  status: "merged" | "skipped" | "conflict" | "dirty" | "failed";
  message: string;
  conflicts?: string[];
};

type MergeButtonState = {
  phase: "idle" | "confirm" | "running";
  result?: { ok: boolean; message: string; steps: MergeStepView[] };
};

/** G11：视图模式（difit `DiffViewMode` / opencode `SessionReviewDiffStyle` 同取值）。 */
export type ReviewViewMode = "unified" | "split";

/**
 * G15：渲染档位。`source` = 源码行级（现状，默认）；`md-preview` = md 渲染成文档后按块标色。
 *
 * 为什么默认 `source`（与 difit/VS Code 一致）：VS Code 官方文档明确这是 **opt-in**
 * （"This behavior is opt-in"），difit 的 `MarkdownDiffViewer` 默认也是 `diff` 档。
 * 默认改成渲染态会让"精确到行"的检视变难——那才是这个面板的主要用途。
 */
export type ReviewRenderMode = "source" | "md-preview";

/**
 * 并排视图的一行（G11）：左 old / 右 new，两格各自可锚、各自显示行号与语法高亮。
 *
 * 与 unified 的差异（有意）：
 *  - context 行**左右两格都可锚**（左边点 = "原来这行"）——difit `SideBySideDiffChunk.tsx:669-712`
 *    左右各自渲染 `CommentButton` 并带 side；
 *  - 行尾的评论针**只在有该侧行号的那一格**出现，不会左右重复（`splitAnchorOf` 决定）。
 *
 * 布局：`grid-cols-2`，两列等宽（difit 用 `w-1/2`，`SideBySideDiffChunk.tsx:695/723`）。
 * 中间一条竖线是列分隔（`border-r`），与 unified 的行内结构保持一致的行高与字号。
 */
function SplitDiffRow({ row, wrap, oldTokens, newTokens, oldWords, newWords, viewMode: _viewMode, ...handlers }: {
  row: SplitRow;
  wrap: boolean;
  oldTokens?: readonly Token[] | null;
  newTokens?: readonly Token[] | null;
  /** G12：两侧的词级段（成对的增删行才有） */
  oldWords?: readonly WordSegment[];
  newWords?: readonly WordSegment[];
  viewMode: ReviewViewMode;
  draftStateOf: (side: AnchorSide, no: number) => { has: boolean; isStart: boolean; outdated: boolean; blockStart?: boolean; blockEnd?: boolean } | undefined;
  onAddDraft: (side: AnchorSide, no: number, text: string) => void;
  onDragStart: (side: AnchorSide, no: number, event: React.MouseEvent) => void;
  onPinHover?: (pin: CommentPin | undefined, rect?: DOMRect) => void;
  onPinOpen?: (pin: CommentPin) => void;
  pinsOf: (side: AnchorSide, no: number) => CommentPin[];
  pinPreviewable: (pin: CommentPin) => boolean;
  dragRangeOf: (side: AnchorSide, no: number) => boolean;
  onSelectExtend?: (side: AnchorSide, no: number) => void;
}) {
  const cell = (side: AnchorSide, tokens: readonly Token[] | null | undefined, words: readonly WordSegment[] | undefined) => {
    const anchor = splitAnchorOf(row, side);
    const line = side === "old" ? row.old : row.new;
    const bg = line === undefined ? "bg-sunken" : line.type === "removed" ? "bg-diff-del-soft" : line.type === "added" ? "bg-diff-add-soft" : "";
    const block = anchor === null ? undefined : handlers.draftStateOf(side, anchor.no);
    const dragged = anchor === null ? false : handlers.dragRangeOf(side, anchor.no);
    return (
      <div
        data-line={line?.type ?? "empty"}
        data-split-side={side}
        onMouseEnter={anchor === null ? undefined : () => handlers.onSelectExtend?.(side, anchor.no)}
        onMouseMove={anchor === null ? undefined : () => handlers.onSelectExtend?.(side, anchor.no)}
        className={`group/line relative flex min-w-0 font-mono text-micro leading-relaxed ${bg}`}
      >
        {block?.has === true ? (
          <span
            aria-hidden="true"
            data-review-drafted-block={block.blockStart === true ? "first" : block.blockEnd === true ? "last" : "middle"}
            className={`pointer-events-none absolute inset-0 border-l-2 border-anno-query bg-anno-query-soft/40 ${block.blockStart === true ? "border-t-2" : ""} ${block.blockEnd === true ? "border-b-2" : ""}`}
          />
        ) : null}
        {dragged ? (
          <span aria-hidden="true" data-review-drag-selected className="pointer-events-none absolute inset-0 border-l-2 border-accent-line bg-accent-soft/60" />
        ) : null}
        <span className="w-10 shrink-0 select-none px-1 text-right text-ink-500 tabular-nums">{side === "old" ? (line?.oldNo ?? "") : (line?.newNo ?? "")}</span>
        <span
          className="relative min-w-0 flex-1 px-1 pr-2"
          data-review-line-anchor={anchor === null ? undefined : `${side}:${anchor.no}`}
          data-review-line-text
          onMouseDown={anchor === null ? undefined : (event) => handlers.onDragStart(side, anchor.no, event)}
        >
          {line === undefined ? "\u00a0" : words !== undefined
            ? <WordSegments segments={words} />
            : (tokens === undefined || tokens === null
            ? (line.text === "" ? "\u00a0" : line.text)
            : line.text === "" ? "\u00a0" : tokens.map((token, index) => {
              const className = tokenClassName(token.types);
              return className === undefined
                ? <span key={index}>{token.content}</span>
                : <span key={index} className={className} data-syn={token.types[0]}>{token.content}</span>;
            }))}
        </span>
        {/* 行末评论针：只在**有该侧行号**的格子出现（不会左右重复） */}
        {anchor === null ? null : handlers.pinsOf(side, anchor.no).map((pin) => (
          <button
            key={pin.id}
            type="button"
            data-review-pin={pin.id}
            data-review-pin-author={`${pin.author.kind}:${pin.author.id}`}
            aria-label={`${pin.authorName} 的评论：${pin.preview}`}
            onMouseEnter={(event) => handlers.onPinHover?.(handlers.pinPreviewable(pin) ? pin : undefined, event.currentTarget.getBoundingClientRect())}
            onMouseLeave={() => handlers.onPinHover?.(undefined)}
            onClick={(event) => { event.stopPropagation(); handlers.onPinOpen?.(pin); }}
            className="relative mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full self-center"
          >
            {pin.author.kind === "agent"
              ? <AgentAvatar id={pin.author.id} name={pin.authorName} size={14} />
              : <span style={{ width: 14, height: 14, fontSize: 6 }} className="flex items-center justify-center rounded-full bg-ink-700 font-medium leading-none text-white">{pin.authorName.slice(0, 1)}</span>}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className={`grid grid-cols-2 divide-x divide-line ${wrap ? "" : "min-w-0"}`} data-review-split-row>
      {cell("old", oldTokens, oldWords)}
      {cell("new", newTokens, newWords)}
    </div>
  );
}

function DiffRow({ line, wrap, tokens, words, anchorSide, anchorNo, draftState, onAddDraft, onSelectStart, onSelectExtend, inDragRange, dragBlockStart, dragBlockEnd, commentPins, pinPreviewable, onPinHover, onPinOpen }: {
  line: SegmentLine;
  wrap: boolean;
  /**
   * G8：这一行的语法 token（已按行号预分词）。
   * `undefined` = 这个文件不高亮（认不出语言 / 超 2000 行）；`null` = 这一行取不到 token。
   */
  tokens?: readonly Token[] | null;
  /**
   * G12 词级 diff 的**这一侧**段序列（`old` 行传 oldSegments、`add` 行传 newSegments）。
   * 有值时**优先于 tokens**：词级已经是最强语义，再叠语法色会同时破坏对比度与可读性。
   */
  words?: readonly WordSegment[];
  /** 锚点落在哪一侧（null = 这一行不可批注）；按钮的 data 属性带上它，避免 old/new 同号撞车 */
  anchorSide?: AnchorSide | null;
  anchorNo?: number | null;
  /** `blockStart/blockEnd`：这段草稿范围的**首行/末行**（A22 整块高亮用） */
  draftState?: { has: boolean; isStart: boolean; outdated: boolean; blockStart?: boolean; blockEnd?: boolean };
  onAddDraft?: () => void;
  /** A2b：按下开始选区（drag 起点）；Shift 按下时由调用方转成"扩展" */
  onSelectStart?: (event: React.MouseEvent) => void;
  /** A2b：拖进这一行（鼠标 enter 时更新终点） */
  onSelectExtend?: () => void;
  /** A2b：这一行正处于拖选高亮中 */
  inDragRange?: boolean;
  /** A22：这一行是拖选范围的**首行/末行**（决定整块覆盖层画不画上/下边） */
  dragBlockStart?: boolean;
  dragBlockEnd?: boolean;
  /** 这一行上的评论（折叠态显示为行末头像组） */
  commentPins?: readonly CommentPin[];
  /**
   * 某个 pin 是否允许出预览气泡。
   * **卡片已展开的 pin 不出预览**（用户 2026-11-05 截图：点开卡片后气泡仍挂着，两层浮层重叠）——
   * 预览的意义是"不用点就能看一眼"，卡片都开了就不需要它了。
   */
  pinPreviewable?: (pin: CommentPin) => boolean;
  onPinHover?: (pin: CommentPin | undefined, rect?: DOMRect) => void;
  onPinOpen?: (pin: CommentPin) => void;
}) {
  const bg = line.type === "added" ? "bg-diff-add-soft" : line.type === "removed" ? "bg-diff-del-soft" : "";
  const bar = line.type === "added" ? "bg-diff-add" : line.type === "removed" ? "bg-diff-del" : "";
  const sign = line.type === "added" ? "text-diff-add" : line.type === "removed" ? "text-diff-del" : "text-ink-500";
  const drafted = draftState?.has === true;
  const blockStart = draftState?.blockStart === true;
  const blockEnd = draftState?.blockEnd === true;
  return (
    <div
      data-line={line.type}
      data-review-anchored={drafted ? "" : undefined}
      data-review-outdated={draftState?.outdated === true ? "" : undefined}
      data-review-drag-selected={inDragRange === true ? "" : undefined}
      onMouseEnter={onSelectExtend}
      onMouseMove={onSelectExtend}
      className={`group/line relative flex font-mono text-micro leading-relaxed ${bg} ${line.type === "context" ? "text-ink-700" : "text-ink-900"}`}
    >
      {/*
        A22 整块高亮（用户 2026-11-05 报的"几条黄色线框"）：原先每行各画一圈 `ring-1 ring-inset`，
        相邻两行的边贴在一起就成了一串小方框，看不出"这几行是**一个**范围"。
        改法照 difit `src/client/styles/global.css:185-210`：一个绝对定位覆盖层画整块——
        左边竖条 + 首行上边 + 末行下边，中间不画横线（`drag-selected-first/last` 同构）。
        用绝对定位（inset-0）而不是给行加 border：border 会改行高，滚动时文字会跳 2px。
      */}
      {drafted ? (
        <span
          aria-hidden="true"
          data-review-drafted-block={blockStart === true ? "first" : blockEnd === true ? "last" : "middle"}
          className={`pointer-events-none absolute inset-0 border-l-2 border-anno-query bg-anno-query-soft/40 ${blockStart === true ? "border-t-2" : ""} ${blockEnd === true ? "border-b-2" : ""}`}
        />
      ) : null}
      {inDragRange === true ? (
        <span
          aria-hidden="true"
          data-review-drag-block={dragBlockStart === true ? "first" : dragBlockEnd === true ? "last" : "middle"}
          className={`pointer-events-none absolute inset-0 border-l-2 border-accent-line bg-accent-soft/60 ${dragBlockStart === true ? "border-t-2" : ""} ${dragBlockEnd === true ? "border-b-2" : ""}`}
        />
      ) : null}
      <span aria-hidden="true" className={`w-0.5 shrink-0 ${bar}`} />
      <span className="w-10 shrink-0 select-none px-1 text-right text-ink-500 tabular-nums">{line.oldNo ?? ""}</span>
      <span
        className={`relative w-10 shrink-0 select-none px-1 text-right tabular-nums ${anchorNo !== null && anchorNo !== undefined && onAddDraft !== undefined ? "cursor-ns-resize text-ink-500 hover:text-accent" : "text-ink-300"}`}
        onMouseDown={onSelectStart}
        data-review-line-anchor={anchorNo !== null && anchorNo !== undefined ? `${anchorSide}:${anchorNo}` : undefined}
        title={anchorNo !== null && anchorNo !== undefined && onAddDraft !== undefined ? "点行号加批注 · 按住拖出范围" : undefined}
      >
        {line.newNo ?? ""}
        {anchorNo !== null && anchorNo !== undefined && onAddDraft !== undefined ? (
          <button
            type="button"
            aria-label={`在第 ${anchorNo} 行加批注`}
            title="加批注"
            data-review-add-draft={`${anchorSide}:${anchorNo}`}
            onClick={(event) => { event.stopPropagation(); onAddDraft(); }}
            onMouseDown={(event) => {
              // difit 路径（`DiffChunk.tsx:468-476`）：从批注按钮按下并拖动 = 选范围
              event.stopPropagation();
              if (onSelectStart !== undefined) onSelectStart(event);
            }}
            className={`absolute -right-1 top-1/2 ${LAYER_CLASS.rail} flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-control bg-surface text-ink-500 ring-1 ring-line transition-all hover:text-accent hover:ring-accent ${
              draftState?.isStart === true ? "opacity-100" : "opacity-0 group-hover/line:opacity-100 focus-visible:opacity-100"
            }`}
          >
            {/* 画出来的十字（不是「＋」字形）：字形在不同字体下不对齐（opencode `comment-hover.ts:31` 同判） */}
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        ) : null}
      </span>
      <span aria-hidden="true" className={`w-4 shrink-0 select-none text-center font-semibold ${sign}`}>{line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}</span>
      <span className={`min-w-0 pr-3 ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`} data-review-line-text>
        {line.text === "" ? "\u00a0" : words !== undefined
          ? <WordSegments segments={words} />
          : tokens === null || tokens === undefined
          ? line.text
          : tokens.map((token, index) => {
            const className = tokenClassName(token.types);
            return className === undefined
              ? <span key={index}>{token.content}</span>
              : <span key={index} className={className} data-syn={token.types[0]}>{token.content}</span>;
          })}
      </span>
      {/* 行末头像组（折叠态）：一个头像 = 一条评论；悬停预览、点击展开（用户 2026-11-05 方案） */}
      {commentPins !== undefined && commentPins.length > 0 ? (
        <span className="ml-auto flex shrink-0 items-center gap-0.5 pr-1">
          {commentPins.map((pin) => (
            <button
              key={pin.id}
              type="button"
              data-review-pin={pin.id}
              data-review-pin-author={`${pin.author.kind}:${pin.author.id}`}
              aria-label={`${pin.authorName} 的评论：${pin.preview}`}
              onMouseEnter={(event) => onPinHover?.(pinPreviewable?.(pin) === false ? undefined : pin, event.currentTarget.getBoundingClientRect())}
              onMouseLeave={() => onPinHover?.(undefined)}
              onFocus={(event) => onPinHover?.(pinPreviewable?.(pin) === false ? undefined : pin, event.currentTarget.getBoundingClientRect())}
              onBlur={() => onPinHover?.(undefined)}
              onClick={(event) => { event.stopPropagation(); onPinOpen?.(pin); }}
              className="relative flex h-4 w-4 items-center justify-center rounded-full"
            >
              {pin.author.kind === "agent" ? (
                <AgentAvatar id={pin.author.id} name={pin.authorName} size={14} />
              ) : (
                <span
                  style={{ width: 14, height: 14, fontSize: 6 }}
                  className="flex items-center justify-center rounded-full bg-ink-700 font-medium leading-none text-white"
                >{pin.authorName.slice(0, 1)}</span>
              )}
            </button>
          ))}
        </span>
      ) : null}
    </div>
  );
}

/**
 * 草稿卡片（S2·A5）：贴在锚定行下面。
 *
 * 为什么要"边打边存"而不是"点保存"：草稿的意义就是"我随时会离开"；
 * 一个需要显式保存的草稿，在崩溃/误刷新时一样会丢（difit 的 useLocalComments 同样即时落盘）。
 */
/**
 * 作者色条（用户 2026-11-05 拍板：头像 + **左侧色条**，不整卡染色）。
 *
 * 依据：`knowledge/reference-comment-display.md` §3.3 —— 四家参考都用"头像图片"而非底色
 * （底色只能表达"不是同一个人"）；而我们的 `avatarTone(id)` 只有 3 个色，整卡染色会撞。
 * 色条与头像**同源**（都来自 `avatarTone`），保证"色条说的"和"头像说的"一致。
 * 用户自己用中性色条（不抢眼，突出 Agent 的彩色）。
 */
function authorAccent(author: { kind: "user" | "agent"; id: string }): string {
  return author.kind === "agent" ? avatarTone(author.id) : "bg-ink-300";
}

function DraftCard({ draft, outdated, authorName, authorNameOf, folded, onToggleFold, onChange, onRemove, onChangeMarks, canClose, onClose, onReopen, onCopy, onSend, closed, awaiting, commentActions, onSetAwaiting }: {
  draft: ReviewDraft;
  outdated: boolean;
  /** 作者展示名（由 id 反查得到；查不到时退回 id） */
  authorName: string;
  /** 折叠态（VS Code `collapsibleState` / difit `toggleCollapsed` 同款；面板级持有） */
  folded: boolean;
  onToggleFold: () => void;
  onChange: (note: string) => void;
  onRemove: () => void;
  /** 语气标记（复用 `marks.ts`，不新增 severity 字段） */
  onChangeMarks: (marks: string[]) => void;
  /** 关闭权限（A19：只有提出者或用户本人；纯函数判定，不在这里拼条件） */
  canClose: boolean;
  onClose: () => void;
  /** 重开一条已关闭的评论（误关的退路；作者或用户） */
  onReopen: () => void;
  /** 复制这条（A20：剪贴板） */
  onCopy: () => void;
  /** 发送到输入框（A21：opencode `composer.attach` 同款——放进输入框，不自动发） */
  onSend: () => void;
  /** 已关闭（A18：三态 open/resolved） */
  closed: boolean;
  /** 等谁处理（A18 的 awaiting：不是状态，是责任方） */
  awaiting: "user" | "agent" | null;
  /** 线程动作（回复/改等待方/在线状态）：往下穿两层用 */
  commentActions: CommentActions;
  onSetAwaiting?: (awaiting: "user" | "agent" | null) => void;
  /** 作者 id → 展示名（回复列表里每个人都要） */
  authorNameOf: (author: DraftAuthor) => string;
}) {
  // A7 位置头：`path:L5` / `path:L5-L7`（difit `utils/commentFormatting.ts` 同构）。
  // 卡片上同时给"人话"标签，因为位置头是给 Agent 的、人话是给用户的（两者都要）。
  const range = rangeLabel({ side: draft.side, start: draft.start, end: draft.end });
  const header = locationHeader(draft.filePath, { side: draft.side, start: draft.start, end: draft.end });
  const author = draft.author ?? { kind: "user" as const, id: "user" };
  return (
    <div className="mx-2 my-1 flex gap-0 overflow-hidden rounded-panel bg-surface ring-1 ring-line" data-review-draft={draft.id} data-review-draft-author={`${author.kind}:${author.id}`}>
      {/* 作者色条：与头像同源（`avatarTone`），一眼看出是谁 */}
      <span aria-hidden="true" className={`w-0.5 shrink-0 ${authorAccent(author)}`} data-review-draft-accent={author.id} />
      <div className="min-w-0 flex-1 p-2">
      {/* 作者信息：头像 + 名字 + 范围（difit `CommentThreadCard` 的 author badge 同构；
          但**存 id 不存名字** —— 名字会改，id 不会） */}
      <div className="mb-1.5 flex items-center gap-2 text-micro">
        {author.kind === "agent" ? (
          <AgentAvatar id={author.id} name={authorName} size={16} />
        ) : (
          <span
            style={{ width: 16, height: 16, fontSize: 7 }}
            className="flex shrink-0 items-center justify-center rounded-full bg-ink-700 font-medium leading-none text-white"
            aria-hidden="true"
            data-review-draft-avatar="user"
          >{authorName.slice(0, 1)}</span>
        )}
        <span className="truncate text-ink-900" data-review-draft-author-name>{authorName}</span>
        <span className="shrink-0 text-ink-300">·</span>
        <span className="shrink-0 font-mono text-micro text-ink-500" data-review-draft-header title={header}>{header}</span>
        <span className="shrink-0 text-ink-300">·</span>
        <span className="shrink-0 text-ink-500">{range}</span>
        {/* 状态（A18）：已关闭 / 等谁处理 —— 两件事分开显示，不混成一个词 */}
        {closed ? (
          <span className="shrink-0 rounded-inner bg-success-soft px-1.5 py-0.5 text-success" data-review-comment-state="resolved">已关闭</span>
        ) : (
          /*
            G1「等谁」的界面入口：以前这里只是只读徽标，服务端与渲染都支持 awaiting，
            但用户在界面上没有任何办法设置它——字段是死的。
            参考 VS Code `CommentThread.canReply` 是**数据字段**（`languages.ts:2283`）、
            Gitea 的 `resolve conversation` 按钮也是显式动作（`conversation.tmpl:130-140`）：
            状态由人显式表达，而不是猜。
          */
          <button
            type="button"
            onClick={() => onSetAwaiting?.(awaiting === null ? "agent" : awaiting === "agent" ? "user" : null)}
            disabled={commentActions.online !== true}
            title={commentActions.online === true ? "点一下切换：不指定 → 等 Agent → 等用户" : "离线时不能改（服务端不可达）"}
            aria-label={`现在等谁：${awaiting === null ? "不指定" : awaiting === "agent" ? "等 Agent" : "等你回复"}（点击切换）`}
            data-review-comment-awaiting={awaiting ?? "none"}
            data-review-awaiting-toggle
            className={`shrink-0 rounded-inner px-1.5 py-0.5 disabled:opacity-50 ${
              awaiting === null ? "text-ink-500 hover:bg-hover hover:text-ink-900" : "bg-accent-soft text-accent hover:bg-hover"
            }`}
          >{awaiting === "agent" ? "等 Agent" : awaiting === "user" ? "等你回复" : "等谁？"}</button>
        )}
        {outdated ? (
          <span className="shrink-0 rounded-inner bg-diff-mod-soft px-1.5 py-0.5 text-diff-mod" data-review-draft-outdated>
            代码已变
          </span>
        ) : null}
        {/* 复制（A20）与发送到输入框（A21）：两个动作分开，发送不自动发 */}
        <button
          type="button"
          onClick={onCopy}
          className="ml-auto shrink-0 rounded-inner px-1.5 py-0.5 text-ink-500 hover:bg-hover hover:text-ink-900"
          aria-label="复制这条评论"
          data-review-copy
        >复制</button>
        <button
          type="button"
          onClick={onSend}
          className="shrink-0 rounded-inner px-1.5 py-0.5 text-ink-500 hover:bg-hover hover:text-accent"
          aria-label="把这条评论放进输入框"
          data-review-send
        >发送</button>
        {canClose && !closed ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-inner px-1.5 py-0.5 text-ink-500 hover:bg-hover hover:text-success"
            aria-label="关闭这条评论（已解决）"
            data-review-close
          >关闭</button>
        ) : null}
        <button
          type="button"
          onClick={onToggleFold}
          className="shrink-0 rounded-inner px-1.5 py-0.5 text-ink-500 hover:bg-hover hover:text-ink-900"
          aria-label={folded ? "展开这条评论" : "折叠这条评论"}
          aria-expanded={!folded}
          data-review-draft-fold
        >{folded ? "展开" : "折叠"}</button>
        {/* 丢弃只对"根本没落到服务端的草稿"有意义；已打开的线程不该出现它（GitHub/Gitea 也没有"删除意见"，只有 resolve） */}
        {closed || (draft.state ?? "draft") !== "draft" ? null : (
        <button type="button" onClick={onRemove} className="shrink-0 rounded-inner px-1.5 py-0.5 text-ink-500 hover:bg-hover hover:text-danger" aria-label="丢弃这条草稿" data-review-draft-discard>丢弃</button>)}
        {closed ? (
          /* 已关闭的线程可以重开（作者或用户）；没有它，误关就没有退路 */
          <button
            type="button"
            onClick={onReopen}
            className="shrink-0 rounded-inner px-1.5 py-0.5 text-ink-500 hover:bg-hover hover:text-accent"
            aria-label="重新打开这条评论"
            data-review-reopen
          >重开</button>
        ) : null}
      </div>
      {/* 折叠后只显示正文首行（VS Code / difit 同款：折叠不丢信息） */}
      {folded ? (
        <p className="truncate text-micro text-ink-700" data-review-draft-preview>{draft.note === "" ? "（还没写）" : draft.note.split("\n")[0]}</p>
      ) : (
      <>
      <MarksRow selected={draft.marks ?? []} onChange={onChangeMarks} />
      <textarea
        value={draft.note}
        onChange={(event) => onChange(event.target.value)}
        placeholder="写下你的问题或想法…（自动保存，刷新不丢）"
        aria-label="批注内容"
        data-review-draft-note={draft.id}
        rows={2}
        className="w-full resize-y rounded-control bg-sunken px-2 py-1.5 text-micro text-ink-900 ring-1 ring-line placeholder:text-ink-300 focus:outline-none focus:ring-accent"
      />
      {/* 编辑态提示：auto-save 没有"保存"按钮，就必须让用户知道"改了算不算数"；文案按状态分开写 */}
      {(draft.state ?? "draft") === "draft" ? null : (
        <p className="mt-0.5 text-micro text-ink-300" data-review-draft-saved-hint>
          {closed ? "改动自动保存（已关闭的评论仍可改正文；要补充请先重开）" : "改动自动保存（状态不会被编辑改动）"}
        </p>
      )}
      {draft.snapshot !== undefined ? (
        <details className="mt-1 text-micro text-ink-500">
          <summary className="cursor-pointer select-none">锚定的原文（过期判定依据）</summary>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-inner bg-sunken px-2 py-1">{draft.snapshot}</pre>
        </details>
      ) : null}
      <ThreadReplies draft={draft} authorNameOf={authorNameOf} commentActions={commentActions} closed={closed} />
      </>
      )}
      </div>
    </div>
  );
}

/**
 * 线程里的回复列表（S4-h · A4-余）：**Agent 说明"我怎么闭环的"就写在这里**。
 *
 * 参考 difit `CommentThreadCard.tsx:335-382`：回复缩进一层（`ml-4 border-l pl-3`），
 * 底部一个「Write a reply...」框，`Reply` 提交 / `Cancel` 取消。
 * 我们去掉"点一下才变成输入框"这一步：卡片展开时就直接给输入框（我们的卡片本来就默认折叠，
 * 展开是用户主动动作，再套一层点击没有收益）。
 *
 * 三条规则（与后端一致，UI 也要体现）：
 *  1. 已关闭的线程不能回复（显示「重开后可以继续回复」，不做成灰按钮让人猜）；
 *  2. 离线不能回复（`commentActions.online === false`）；
 *  3. 回复的作者是**当前用户**；Agent 的回复从服务端读回来（刷新即见）。
 */
function ThreadReplies({ draft, authorNameOf, commentActions, closed }: {
  draft: ReviewDraft;
  authorNameOf: (author: DraftAuthor) => string;
  commentActions: CommentActions;
  closed: boolean;
}) {
  const [text, setText] = useState("");
  /** 正在编辑的回复 id（内联编辑：改完点「保存」，点「取消」放弃） */
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [editingText, setEditingText] = useState("");
  const replies = draft.replies ?? [];
  if (replies.length === 0 && closed) return null;
  return (
    <div className="mt-2 border-t border-line pt-2" data-review-thread={draft.id}>
      {replies.map((reply) => (
        <div key={reply.id} className="mb-2 ml-2 border-l border-line pl-2" data-review-reply={reply.id} data-review-reply-author={`${reply.author.kind}:${reply.author.id}`}>
          <div className="mb-0.5 flex items-center gap-1.5 text-micro">
            {reply.author.kind === "agent"
              ? <AgentAvatar id={reply.author.id} name={authorNameOf(reply.author)} size={14} />
              : <span style={{ width: 14, height: 14, fontSize: 6 }} className="flex items-center justify-center rounded-full bg-ink-700 leading-none text-white" aria-hidden="true">{authorNameOf(reply.author).slice(0, 1)}</span>}
            <span className="truncate text-ink-700">{authorNameOf(reply.author)}</span>
            {reply.updatedAt !== undefined ? <span className="shrink-0 text-ink-300">已编辑</span> : null}
            {/*
              编辑/删除的可见性（与后端 `assertCanEditReply` 同口径）：
              **回复作者本人 或 用户**。用户 = 这个家目录的所有者，等同 Gitea 的 write 权限
              （`templates/repo/issue/view_content/conversation.tmpl:107`：`$canWrite or $doerIsPoster`
              才给 `data-can-edit`）——所以面板上（查看者恒为用户）两种情况都能改。
              早先这里比的是**线程作者**而不是查看者，导致"用户改不了 Agent 的回复"，与后端不一致。
            */}
            {(commentActions.userId !== "" ? true : reply.author.kind === "user") ? (
              <>
              <button
                type="button"
                onClick={() => { setEditingId(reply.id); setEditingText(reply.body); }}
                disabled={commentActions.online !== true}
                className="ml-auto shrink-0 rounded-inner px-1 py-0.5 text-ink-300 hover:bg-hover hover:text-ink-900 disabled:opacity-50"
                aria-label="编辑这条回复"
                data-review-reply-edit
              >编辑</button>
              <button
                type="button"
                onClick={() => commentActions.removeReply(draft.id, reply.id)}
                disabled={commentActions.online !== true}
                className="shrink-0 rounded-inner px-1 py-0.5 text-ink-300 hover:bg-hover hover:text-danger disabled:opacity-50"
                aria-label="删除这条回复"
                data-review-reply-remove
              >删除</button>
              </>
            ) : null}
          </div>
          {editingId === reply.id ? (
            <div className="flex items-start gap-1">
              <textarea
                value={editingText}
                onChange={(event) => setEditingText(event.target.value)}
                aria-label="编辑这条回复"
                data-review-reply-edit-input={reply.id}
                rows={1}
                className="min-w-0 flex-1 resize-y rounded-control bg-sunken px-2 py-1 text-micro text-ink-900 ring-1 ring-line focus:outline-none focus:ring-accent"
              />
              <button
                type="button"
                disabled={editingText.trim() === "" || commentActions.online !== true}
                onClick={() => { commentActions.editReply(draft.id, reply.id, editingText); setEditingId(undefined); }}
                className="shrink-0 rounded-inner px-1.5 py-0.5 text-micro text-accent hover:bg-hover disabled:opacity-40"
                data-review-reply-edit-save
              >保存</button>
              <button
                type="button"
                onClick={() => setEditingId(undefined)}
                className="shrink-0 rounded-inner px-1.5 py-0.5 text-micro text-ink-500 hover:bg-hover"
                data-review-reply-edit-cancel
              >取消</button>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-micro text-ink-900" data-review-reply-body>{reply.body}</p>
          )}
        </div>
      ))}
      {closed ? (
        <p className="text-micro text-ink-300" data-review-reply-closed>这条评论已关闭；要补充请先重开。</p>
      ) : (
        <div className="flex items-start gap-1">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="回复…（写完点「回复」提交）"
            aria-label="回复内容"
            data-review-reply-input={draft.id}
            rows={1}
            className="min-w-0 flex-1 resize-y rounded-control bg-sunken px-2 py-1 text-micro text-ink-900 ring-1 ring-line placeholder:text-ink-300 focus:outline-none focus:ring-accent"
          />
          <button
            type="button"
            disabled={text.trim() === "" || commentActions.online !== true}
            onClick={() => { commentActions.reply(draft.id, text); setText(""); }}
            className="shrink-0 rounded-inner px-1.5 py-0.5 text-micro text-accent hover:bg-hover disabled:opacity-40"
            aria-label="提交回复"
            data-review-reply-submit
          >回复</button>
        </div>
      )}
    </div>
  );
}

/**
 * 语气标记行（复用 `marks.ts` 的既有体系，不新增 severity）。
 *
 * 依据 `knowledge/reference-comment-display.md` §3.5：四家参考都没有 severity 字段；
 * 我们的映射是 批评≈严重、疑问≈待确认、鼓励≈做得好、同意≈认可。
 * 功能类（存档/待办）不发给人看，只做用户自己的分类 —— 与 message 批注一致。
 */
function MarksRow({ selected, onChange }: { selected: readonly string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1" data-review-draft-marks>
      {MARKS.map((mark) => {
        const on = selected.includes(mark.id);
        return (
          <button
            key={mark.id}
            type="button"
            onClick={() => onChange(on ? selected.filter((id) => id !== mark.id) : [...selected, mark.id])}
            aria-pressed={on}
            data-review-mark={mark.id}
            className={`rounded-inner px-1.5 py-0.5 text-micro transition-colors ${
              on ? "bg-anno-query-soft text-anno-query ring-1 ring-anno-query" : "text-ink-500 hover:bg-hover hover:text-ink-900"
            }`}
          >{mark.label}</button>
        );
      })}
    </div>
  );
}

/**
 * 文件树的一层（G9）：目录可勾选（三态），文件显示已看状态并可点。
 *
 * 为什么用原生 `<details>/<summary>`：面板里已经有大量自绘控件，树再自绘一套键盘/展开逻辑
 * 属于"同类 UI 第二次出现却不复用"（前端规范 2.3）。原生元素自带 Enter/Space 与 aria-expanded。
 */
function TreeNodes({ nodes, depth, onToggleViewed }: {
  nodes: readonly TreeNode[];
  depth: number;
  onToggleViewed: (paths: readonly string[], viewed: boolean) => void;
}) {
  return (
    <ul className="min-w-0" role="tree">
      {nodes.map((node) => {
        if (node.kind === "file") {
          return (
            <li key={`f:${node.path}`} role="treeitem" aria-selected={node.status === "viewed"} className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onToggleViewed([node.path], node.status !== "viewed")}
                data-review-tree-file={node.path}
                data-review-tree-status={node.status}
                aria-label={`${node.status === "viewed" ? "取消已看" : "标记已看"}：${node.path}`}
                className={`flex min-w-0 flex-1 items-center gap-1 rounded-inner px-1 py-0.5 text-left text-micro hover:bg-hover ${
                  node.status === "viewed" ? "text-success" : node.status === "changed" ? "text-diff-mod" : "text-ink-700"
                }`}
                style={{ paddingLeft: `${depth * 10 + 2}px` }}
              >
                <span aria-hidden="true" className="shrink-0">{node.status === "viewed" ? "✓" : node.status === "changed" ? "↻" : "○"}</span>
                <span className="min-w-0 truncate" title={node.path}>{node.name}</span>
              </button>
            </li>
          );
        }
        const dirView = node.state === "all";
        return (
          <li key={`d:${node.path}`} role="treeitem" aria-expanded="true">
            <button
              type="button"
              onClick={() => onToggleViewed(filesUnder([node], node.path), !dirView)}
              data-review-tree-dir={node.path}
              data-review-tree-dir-state={node.state}
              aria-label={`${dirView ? "取消已看" : "标记已看"}：目录 ${node.path}（${node.viewed}/${node.total}）`}
              className="flex w-full min-w-0 items-center gap-1 rounded-inner px-1 py-0.5 text-left text-micro text-ink-700 hover:bg-hover"
              style={{ paddingLeft: `${depth * 10 + 2}px` }}
            >
              <span aria-hidden="true" className="shrink-0 text-ink-300">{node.state === "all" ? "✓" : node.state === "some" ? "◐" : "○"}</span>
              <span className="min-w-0 truncate font-semibold" title={node.path}>{node.name}/</span>
              <span className="shrink-0 text-ink-300 tabular-nums">{node.viewed}/{node.total}</span>
            </button>
            <TreeNodes nodes={node.children} depth={depth + 1} onToggleViewed={onToggleViewed} />
          </li>
        );
      })}
    </ul>
  );
}

function SourceGroup({ group, isOpen, onToggle, filter, expandMode, hiddenOf, onHiddenExpand, draftsOfFile, onAddDraft, onChangeDraft, onRemoveDraft, authorNameOf, foldedOf, onToggleFold, onChangeMarks, onPinHover, onRevealComments, commentActions, drag, onDragStart, onDragExtend, mountedOf, forcedOf, onForceRender, onFileMount, viewedOf, onToggleViewed, viewMode, renderAs, folded, onToggleGroupFold }: {
  group: ReviewSourceDiff;
  /** 组级折叠（Task 0018 用户：两组文件多时列表太长，可收起只留组头）。 */
  folded: boolean;
  onToggleGroupFold: () => void;
  /** 文件 → 是否展开（由面板统一持有：全部展开/折叠与逐个切换必须是同一份状态，
   *  参照 opencode `open()` 单一数组：`packages/session-ui/src/components/session-review.tsx:276-279`） */
  isOpen: (path: string) => boolean;
  onToggle: (path: string) => void;
  filter: string;
  expandMode: "all" | "diff";
  hiddenOf: (path: string, key: string) => HiddenState | undefined;
  onHiddenExpand: (path: string, key: string, action: ExpansionAction, segment: Extract<Segment, { kind: "hidden" }>, sourceKind: ReviewSourceKind) => void;
  draftsOfFile: (path: string, source: ReviewSourceKind) => readonly ReviewDraft[];
  onAddDraft: (filePath: string, sourceKind: ReviewSourceKind, side: AnchorSide, start: number, end: number, snapshot: string | undefined) => void;
  onChangeDraft: (id: string, note: string) => void;
  onRemoveDraft: (id: string) => void;
  authorNameOf: (author: DraftAuthor) => string;
  foldedOf: (draftId: string) => boolean;
  onToggleFold: (draftId: string) => void;
  onChangeMarks: (draftId: string, marks: string[]) => void;
  onPinHover: (pin: CommentPin | undefined, rect?: DOMRect) => void;
  onRevealComments: (filePath: string) => void;
  commentActions: CommentActions;
  drag: { anchor: LinePoint | undefined; range: LineRange | undefined };
  onDragStart: (filePath: string, sourceKind: ReviewSourceKind, point: LinePoint, extend: boolean) => void;
  onDragExtend: (filePath: string, point: LinePoint, extend?: boolean) => void;
  /** G6：这个文件是否已挂载（首屏前 8 个 / 已滚到） */
  mountedOf: (path: string) => boolean;
  /** G5：用户是否点过「仍然全部显示」 */
  forcedOf: (path: string) => boolean;
  onForceRender: (path: string) => void;
  /** 占位元素进入预取区 → 挂载它（由 FileCard 的 IntersectionObserver 触发） */
  onFileMount: (path: string) => void;
  /** G10：已看状态（三态） */
  viewedOf: (path: string) => ViewedStatus;
  onToggleViewed: (path: string) => void;
  /** G11：单列 / 并排 */
  viewMode: ReviewViewMode;
  /** G15：渲染档位 */
  renderAs: ReviewRenderMode;
}) {
  const files = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === "") return group.files;
    return group.files.filter((file) => file.path.toLowerCase().includes(needle));
  }, [group.files, filter]);
  return (
    <section className="min-w-0" data-review-source={group.source.kind}>
      {/* 组头可点收起/展开（Task 0018）：文件计数与增删留在折叠态可见——收着也知道有东西；degraded/缺失提示在列表外，不受折叠影响 */}
      <button type="button" onClick={onToggleGroupFold}
        aria-expanded={!folded} aria-label={`${folded ? "展开" : "折叠"}${SOURCE_LABEL[group.source.kind]}`}
        data-review-group-fold={group.source.kind}
        className="flex w-full items-center gap-2 rounded-control px-1 py-1.5 text-left hover:bg-hover">
        <span aria-hidden="true" className={`shrink-0 text-micro ${folded ? "text-ink-300" : "text-ink-500"}`}>{folded ? "▸" : "▾"}</span>
        <h3 className="text-meta font-semibold text-ink-900">{SOURCE_LABEL[group.source.kind]}</h3>
        {group.source.branch !== undefined && <span className="rounded-inner bg-hover px-1.5 py-0.5 font-mono text-micro text-ink-700">{group.source.branch}</span>}
        <span className="text-micro text-ink-500">{files.length} 个文件</span>
        <StatBadge additions={files.reduce((a, f) => a + f.additions, 0)} deletions={files.reduce((a, f) => a + f.deletions, 0)} />
      </button>
      {group.base !== undefined && (
        <p className="px-1 pb-1 text-micro text-ink-500">
          基线：{group.base.commit.slice(0, 8)}{group.base.at !== undefined ? `（${group.base.at.slice(0, 10)}）` : ""}
          ——早于该基线的改动不在这里
        </p>
      )}
      {group.degraded === "no_vcs" && (
        <div className="rounded-panel bg-surface px-3 py-2 text-micro text-ink-500 ring-1 ring-line">
          这个目录不是 git 仓库：没有可对比的基线，无法显示 diff。
        </div>
      )}
      {group.source.kind === "worktree" && !group.source.exists && (
        <div className="rounded-panel bg-surface px-3 py-2 text-micro text-ink-500 ring-1 ring-line">
          这个 Task 还没有代码工作区（约定位置 repo/；历史 Task 在 evidence/worktree）。建 Task 时应自动建出。
        </div>
      )}
      {folded ? (
        <p className="px-1 py-1 text-micro text-ink-300">已折叠——点组头展开 {files.length} 个文件。</p>
      ) : (
      <div className="flex flex-col gap-1.5">
        {files.map((file) => {
          /**
           * G5/G6 的形态判定（纯函数在 `review-lazy.ts`）：
           * 折叠 → 只显示文件头；未挂载 → 160px 占位；超限 → 渲染但只给前 200 行 + 提示；否则正常挂载。
           */
          const expanded = isOpen(file.path);
          const body = fileBodyOf({
            expanded,
            forced: forcedOf(file.path),
            changedLines: file.additions + file.deletions,
            totalLines: file.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0),
            mounted: mountedOf(file.path),
          });
          return (
          <FileCard key={file.path} file={file}
            body={body}
            onForceRender={() => onForceRender(file.path)}
            onFileMount={() => onFileMount(file.path)}
            viewedStatus={viewedOf(file.path)}
            onToggleViewed={() => onToggleViewed(file.path)}
            viewMode={viewMode}
            renderAs={renderAs}
            open={expanded}
            onToggle={() => onToggle(file.path)}
            expandMode={expandMode}
            sourceKind={group.source.kind}
            taskDir={group.source.path}
            hiddenOf={hiddenOf}
            onHiddenExpand={onHiddenExpand}
            drafts={draftsOfFile(file.path, group.source.kind)}
            onAddDraft={(side, start, end, snapshot) => onAddDraft(file.path, group.source.kind, side, start, end, snapshot)}
            onChangeDraft={onChangeDraft}
            onRemoveDraft={onRemoveDraft}
            authorNameOf={authorNameOf}
            foldedOf={foldedOf} onToggleFold={onToggleFold} onChangeMarks={onChangeMarks}
            onPinHover={onPinHover}
            onRevealComments={onRevealComments}
            commentActions={commentActions}
            drag={drag} onDragStart={onDragStart} onDragExtend={onDragExtend} />
          );
        })}
      </div>
      )}
      {filter.trim() !== "" && files.length === 0 && (
        <p className="px-1 py-2 text-micro text-ink-500" data-review-filter-empty>没有匹配「{filter}」的文件。</p>
      )}
      {group.truncated && (
        <p className="px-1 pt-1.5 text-micro text-ink-500">改动超过上限，只显示部分文件。</p>
      )}
    </section>
  );
}

export function ReviewPanel({ taskDir, data, loading, failed, onReload, onClose, onInsertComment, onAttachComments, onSwitchTask, candidates, candidatesLoading, currentTaskId }: {
  /** 要检视的 Task 目录（进入检视时由调用方给出：D15c 用户指名） */
  taskDir: string;
  data: ReviewData | null;
  loading: boolean;
  failed: string | null;
  onReload: () => void;
  onClose: () => void;
  /**
   * 把评论作为**结构化引用**挂到输入框（A8/G3：chip 可逐条移除，opencode `composer.attach` 同款）。
   * 面板不拼发送文本——由 App 侧在发送时用 `commentsToText()` 合成（同一条实现）。
   * 不自动发送：用户还能补话、最后自己按 Enter（D26）。
   */
  onAttachComments?: (refs: ReviewComment[]) => void;
  /**
   * D31：切换检视对象。`candidates` 由 App 拉（需要 agentId/projectId 上下文，面板不认识）。
   * 只在有内容时显示——面板不自己 fetch 这个列表（职责边界：面板只管"看与评"）。
   */
  onSwitchTask?: (taskDir: string) => void;
  candidates?: readonly TaskCandidateView[];
  candidatesLoading?: boolean;
  /** 当前检视对象的 Task ID（用于在选择器里高亮） */
  currentTaskId?: string;
  /**
   * 兜底：把**合成好的文本**放进输入框（保留给"没有 App 注入"的宿主，如未来的嵌入式面板）。
   * 只在没有 `onAttachComments` 时使用。
   */
  onInsertComment?: (text: string) => void;
}) {
  const totalAdd = data?.items.reduce((a, g) => a + g.files.reduce((x, f) => x + f.additions, 0), 0) ?? 0;
  const totalDel = data?.items.reduce((a, g) => a + g.files.reduce((x, f) => x + f.deletions, 0), 0) ?? 0;
  const totalCount = data?.items.reduce((a, g) => a + g.files.length, 0) ?? 0;
  const hasContent = data !== null && data.items.some((g) => g.files.length > 0);

  /**
   * 展开状态由面板统一持有（不是每个源各存一份）：
   * 全部展开/折叠与逐个切换必须读写同一份，否则会两边各说各话。
   * 首次渲染按"文件少就全展开"开场（≤5 个），用户一动就不再自动决定。
   */
  const [filter, setFilter] = useState("");
  /**
   * 是否显示已关闭的评论（G7）。
   *
   * 默认**不显示**：GitHub 的 resolved conversation 折叠、Gitea 的已解决会话 `tw-hidden`
   * （`templates/repo/issue/view_content/conversation.tmpl:26-44`）都默认收起；
   * VS Code 的 `showResolved` 默认 true（`commentsViewActions.ts:27`）——两家主流相反，我们取"收起"：
   * 已关闭的意见留在数据里（可搜、可复制全部时排除），但不占 diff 的视觉空间。
   * 顶部给显式开关（`显示已关闭 N`），不是把功能藏起来。
   */
  const [showResolved, setShowResolved] = useState(false);
  /** G9：文件树是否展开（`<details>` 的受控状态；默认收起，不挤压 diff 阅读宽度） */
  const [treeOpen, setTreeOpen] = useState(false);
  /**
   * 合入（协议 §3.7：合并只由用户触发）。
   * 三步式而不是 `window.confirm`：先按钮 → 就地二次确认 → 逐源结果
   * （frontend-spec §5「危险操作要有确认，不用 window.confirm」）。
   */
  const [merge, setMerge] = useState<MergeButtonState>({ phase: "idle" });
  const runMerge = useCallback(async () => {
    setMerge({ phase: "running" });
    try {
      const response = await fetch("/api/tasks/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskDir }),
      });
      const payload = await response.json().catch(() => undefined) as
        | { ok?: boolean; steps?: MergeStepView[]; error?: { message?: string } }
        | undefined;
      if (!response.ok || payload === undefined) {
        setMerge({ phase: "idle", result: { ok: false, message: payload?.error?.message ?? `合入请求失败（HTTP ${response.status}）`, steps: [] } });
        return;
      }
      setMerge({
        phase: "idle",
        result: { ok: payload.ok === true, message: payload.ok === true ? "已合入 main" : "没有全部合入，逐源结果在下面", steps: payload.steps ?? [] },
      });
      onReload();
    } catch (error) {
      setMerge({ phase: "idle", result: { ok: false, message: `合入请求失败：${error instanceof Error ? error.message : String(error)}`, steps: [] } });
    }
  }, [taskDir, onReload]);


  /**
   * G11 视图模式：单列 / 并排。默认**单列**（与既有行为一致，不突变）。
   *
   * 参考：opencode `session-review.tsx:397-410` 的 `SegmentedControl`（unified / split）；
   * difit `App.tsx:1266-1280` 的同款两段按钮。
   * 不做"按面板宽度自动切 split"——那是自造阈值（协议 §3.13）；面板窄时用户自己切回来即可。
   */
  const [viewMode, setViewMode] = useState<ReviewViewMode>("unified");
  /** G15：渲染档位（默认源码行级；只有 doc 文件才有意义） */
  const [renderAs, setRenderAs] = useState<ReviewRenderMode>("source");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  /** 组级折叠（Task 0018）：两组独立；key = 源 kind。切换 task 不重置（收着翻别的 task 还想收着）。 */
  const [groupFolded, setGroupFolded] = useState<Record<string, boolean>>({});
  const groupFoldedOf = useCallback((kind: string) => groupFolded[kind] === true, [groupFolded]);
  const toggleGroupFold = useCallback((kind: string) => {
    setGroupFolded((prev) => ({ ...prev, [kind]: !(prev[kind] === true) }));
  }, []);
  /**
   * 首屏默认：文件少就全展开。**显式写进 openMap**（不靠"没记录就当默认"的兜底）——
   * 否则"全部折叠"之后，另一个源里没被点过的文件会跟着变成折叠，出现半开半合的怪状态。
   */
  useEffect(() => {
    if (data === null) { setOpenMap({}); return; }
    const files = data.items.flatMap((group) => group.files);
    const defaultOpen = files.length <= 5;
    setOpenMap(Object.fromEntries(files.map((file) => [file.path, defaultOpen])));
  }, [data]);
  const isOpen = useCallback((path: string) => openMap[path] === true, [openMap]);
  const toggle = useCallback((path: string) => {
    setOpenMap((prev) => ({ ...prev, [path]: !(prev[path] === true) }));
  }, []);
  /** 面板级"全部展开 / 全部折叠"：一次管所有文件（opencode `handleExpandOrCollapseAll` 就是面板级） */
  const allPaths = data === null ? [] : data.items.flatMap((group) => group.files.map((file) => file.path));
  const allOpen = allPaths.length > 0 && allPaths.every((path) => openMap[path] === true);
  const setAll = useCallback((open: boolean) => {
    setOpenMap(Object.fromEntries(allPaths.map((path) => [path, open])));
  }, [allPaths]);

  /**
   * 折叠未改行（S1·G1b）：全局段控取 opencode 的两段（`expandMode: "expand" | "collapse"`，
   * `session-review-v2.tsx:139-158`），默认 "all"（全部行）——与我们 P2 的现状一致，不突变。
   */
  const [expandMode, setExpandMode] = useState<"all" | "diff">("all");
  /**
   * 两档语义（对齐参考实机，不是自造）：
   *  - `all`（默认，**标为「上下文 3 行」**）：每处改动上下各留 3 行上下文，只把更远的未改行折起来
   *    ——这是 difit 实机（`1 line` / `17 lines` / `598 lines`）与 GitHub Files changed 的形态；
   *  - `diff`（标为「仅改动行」）：连 3 行上下文也折，只剩 +/- 行
   *    ——这是 opencode `hideNonDiffLines` 的形态（它的数据是全文 diff，才能这么干）。
   * 命名（用户 2026-11-05 拍板）：默认档**不叫「标准」**，直接叫出数字「上下文 3 行」——
   * "标准"是空词，用户看不出这一档到底显示多少行。
   * 为什么默认不选「仅改动行」：我们的 patch 只有 3 行上下文，"仅改动"会把每处改动周围那 3 行
   * 也变成折叠条，一个 3-hunk 文件立刻出现 7 条折叠条（实测），改动反被噪声淹掉。
   */
  /** 隐藏段展开状态：key = `${filePath}|${hunkIndex}:${segmentIndex}`，面板统一持有。 */
  const [hiddenMap, setHiddenMap] = useState<Record<string, HiddenState>>({});
  /** 数据重算后丢弃旧的展开状态（difit: revision/diff identity 变即清空，`useExpandedLines.test` 同判） */
  useEffect(() => { setHiddenMap({}); }, [data]);
  /**
   * 数据整体重算时重置懒挂载集（difit 用 revision key 做同一件事，`useLazyDiffRendering.ts:51-55`）：
   * 换了 diff 之后旧的"已挂载"没有意义，还会让本该占位的文件被挂上。
   */
  useEffect(() => {
    const files = (data?.items ?? []).flatMap((group) => group.files);
    setMountedFiles(initialMountedFiles(files));
    setForcedFiles(new Set());
  }, [data]);

  const hiddenOf = useCallback((path: string, key: string) => hiddenMap[`${path}|${key}`], [hiddenMap]);

  /**
   * 草稿（S2·A5）：从 localStorage 读，按 taskDir 隔离。
   * 每次变更后重读——storage 是唯一事实源（不做"内存副本 + 定期同步"，那种设计会两边不一致）。
   */
  /**
   * 评论数据源（S4-d）：**后端为主、localStorage 为离线兜底**。
   *
   * 为什么不再直接读 localStorage：
   * 用户 2026-11-05："评论应该是单独存在的，它跟那一次 worktree 绑定……刷新就不见了？服务重启呢？"
   * 只存浏览器 → 换设备/清缓存就丢，而且 **Agent 永远读不到**（D22 要求多 Agent 可见）。
   *
   * 渲染层仍然拿 `ReviewDraft[]`（形状未变），由 `commentToDraft` 转换——这样 UI 代码零改动。
   */
  /** Task 编号（`0010-标题` 目录名的前四位；解析不到就整名） */
  const taskId = useMemo(() => {
    const base = taskDir.replace(/\/+$/, "").split("/").pop() ?? "";
    return /^(\d{4})/.exec(base)?.[1] ?? base;
  }, [taskDir]);
  const store = useMemo<CommentStore>(() => createHttpStore({
    log: (level, msg, details) => {
      // 前端日志（specs/code/frontend 2.11）：只写事实与 ID
      const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
      logger(`[review-store] ${msg}`, details);
    },
  }), []);
  const [drafts, setDrafts] = useState<readonly ReviewDraft[]>([]);
  /**
   * 正在输入的正文（id → 文本）。
   *
   * 为什么必须有这一层（2026-11-08 实测缺陷）：`onChange` 每按一个键就 `store.save` + `reloadDrafts`，
   * 服务端回来的**旧快照**会在用户还在打字时覆盖 textarea——实测连打 `jjj` 后输入框内容仍是旧值，
   * 等于"打的字被吃掉了"。这是"每次按键都往返服务端"的必然结果，不是偶发。
   *
   * 修法两条：
   *  1. 本地文本立即生效（乐观），渲染优先用它（`draftsForFile` 里合并）；
   *  2. 落盘**防抖** 400ms，且只在"这次保存的文本 === 当前本地文本"时才清掉覆盖
   *     （否则会把用户新打的字又盖回去）。
   */
  const [noteEdits, setNoteEdits] = useState<Record<string, string>>({});
  const noteTimers = useRef<Record<string, number>>({});
  /** 服务端是否可达（false = 正在用本地兜底，UI 要提示"离线数据"） */
  const [offline, setOffline] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const reloadDrafts = useCallback(() => {
    let cancelled = false;
    setStoreLoading(true);
    void (async () => {
      try {
        // 先把本地有内容的草稿上送（迁移），再以服务端为准读取
        await store.migrate(taskDir);
        const comments = await store.list(taskDir);
        if (cancelled) return;
        setDrafts(comments.map(commentToDraft));
        setOffline(false);
        setStoreError(null);
        // 本地还有没上送的内容 → 提示离线（不阻断使用）
        if (typeof localStorage !== "undefined" && hasLocalOnlyComments(localStorage, taskDir)) setOffline(true);
      } catch (error) {
        if (cancelled) return;
        // 读失败：降级到本地（store 内部已降级，这里只需把本地渲染出来 + 标记离线）
        setDrafts(typeof localStorage === "undefined" ? [] : draftsOfTask(localStorage, taskDir));
        setOffline(true);
        setStoreError(String(error));
      } finally {
        if (!cancelled) setStoreLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [taskDir, store]);
  useEffect(() => reloadDrafts(), [reloadDrafts]);

  /**
   * 某个文件的评论。**必须带 source**：worktree 与 Task 文档里可能有同名文件
   * （最典型的就是两边都有 `README.md`），只按路径筛会把另一侧的评论挂过来。
   * 这是 S4-h 自检发现的真实缺陷（此前只比 `filePath`）。
   */
  /**
   * 某个文件的评论（渲染用）。
   *
   * **正在输入的正文以本地为准**（`noteEdits`）：否则服务端回来的旧快照会在用户打字时
   * 覆盖 textarea——实测连打 `jjj` 后输入框仍是旧值（打的字被吃掉）。
   * 合并只在这一处做，卡片层不各自判断。
   */
  const draftsForFile = useCallback(
    (path: string, source: ReviewSourceKind) => drafts
      .filter((draft) =>
        draft.filePath === path
        && draft.source === source
        && (showResolved || (draft.state ?? "draft") !== "resolved"))
      .map((draft) => (noteEdits[draft.id] === undefined ? draft : { ...draft, note: noteEdits[draft.id] })),
    [drafts, showResolved, noteEdits],
  );

  /**
   * 作者身份：**存 id，展示时反查**（用户 2026-11-05 要求）。
   * - 用户：`GET /api/profile` → `{id, name, avatar}`（`users/<id>/user.json`，实测 id 形如 `xu-later`）
   * - Agent：`GET /api/agents` → `[{id, name, avatar}]`
   * 反查不到时退回 id 本身（宁显示 id，也不显示"未知"）。
   */
  const [me, setMe] = useState<{ id: string; name: string } | undefined>(undefined);
  const [agentNames, setAgentNames] = useState<ReadonlyMap<string, string>>(() => new Map());
  useEffect(() => {
    void fetch("/api/profile").then((r) => (r.ok ? r.json() : undefined))
      .then((p: { id?: string; name?: string } | undefined) => {
        if (p?.id !== undefined && p.name !== undefined) setMe({ id: p.id, name: p.name });
      }).catch(() => undefined);
    void fetch("/api/agents").then((r) => (r.ok ? r.json() : undefined))
      .then((body: { items?: Array<{ id?: string; name?: string }> } | undefined) => {
        const map = new Map<string, string>();
        for (const agent of body?.items ?? []) {
          if (typeof agent.id === "string" && typeof agent.name === "string") map.set(agent.id, agent.name);
        }
        setAgentNames(map);
      }).catch(() => undefined);
  }, []);
  const authorNameOf = useCallback((author: DraftAuthor): string => {
    if (author.kind === "agent") return agentNames.get(author.id) ?? author.id;
    if (me !== undefined && me.id === author.id) return me.name;
    return me?.name ?? author.id;
  }, [agentNames, me]);
  const onAddDraft = useCallback((
    filePath: string, sourceKind: ReviewSourceKind,
    side: AnchorSide, start: number, end: number, snapshot: string | undefined,
  ) => {
    // 先乐观更新本地（立即可见），再落服务端；写失败由 store 兜底到 localStorage 并抛错
    const author = { kind: "user" as const, id: me?.id ?? "user" };
    void store.save(taskDir, {
      taskId,
      author,
      anchor: { source: sourceKind, path: filePath, side, start, end, ...(snapshot !== undefined ? { snapshot } : {}) },
      body: "",
      marks: [],
      // 新建的就是草稿（还没进入讨论）；只有"编辑已有评论"才需要保留原状态
      state: "draft",
    }).then((saved) => {
      // 刚创建的这条**立即展开**（用户点了＋就是要写）
      setFoldedComments((prev) => ({ ...prev, [saved.id]: false }));
      reloadDrafts();
    }).catch((error: unknown) => {
      setStoreError(String(error));
      setOffline(true);
      reloadDrafts();
    });
  }, [taskDir, taskId, store, reloadDrafts, me?.id]);
  const onChangeDraft = useCallback((id: string, note: string) => {
    const draft = drafts.find((item) => item.id === id);
    if (draft === undefined) return;
    setNoteEdits((prev) => ({ ...prev, [id]: note }));
    const existing = noteTimers.current[id];
    if (existing !== undefined) window.clearTimeout(existing);
    noteTimers.current[id] = window.setTimeout(() => {
      delete noteTimers.current[id];
      void store.save(taskDir, {
      id: draft.id,
      taskId,
      author: draft.author ?? { kind: "user", id: "user" },
      anchor: {
        source: draft.source, path: draft.filePath, side: draft.side, start: draft.start, end: draft.end,
        ...(draft.snapshot !== undefined ? { snapshot: draft.snapshot } : {}),
      },
      body: note,
      marks: draft.marks ?? [],
      /**
       * **必须保留原 state**（原来写死 `"draft"`，是缺陷）：
       * 一条状态已经是 `open` 的线程，用户改一下正文就变回草稿——状态被静默改写，
       * 而且 `pendingFor` / 徽标 / 复制全都会跟着变（数据事实被编辑动作污染）。
       * 编辑只改内容，不改生命周期状态。
       */
      state: draft.state ?? "open",
      }).then(() => {
        // 只有当"落盘的文本"仍是当前本地文本时才清覆盖（否则会把用户新打的字盖回去）
        setNoteEdits((prev) => {
          if (prev[id] !== note) return prev;
          const { [id]: _drop, ...rest } = prev;
          return rest;
        });
        reloadDrafts();
      }).catch((error: unknown) => {
        setStoreError(String(error));
        setOffline(true);
      });
    }, 400);
  }, [drafts, store, taskDir, taskId, reloadDrafts]);

  /** 卸载时清掉所有防抖定时器（否则会在组件消失后写服务端） */
  useEffect(() => () => {
    for (const timer of Object.values(noteTimers.current)) window.clearTimeout(timer);
    noteTimers.current = {};
  }, []);
  const onRemoveDraft = useCallback((id: string) => {
    void store.remove(taskDir, id).then(() => reloadDrafts());
  }, [store, taskDir, reloadDrafts]);

  /**
   * 评论的折叠态（面板级一份，与 openMap 同层）。
   * 依据：VS Code `collapsibleState`（`languages.ts:2278`）+ difit `toggleCollapsed`（`CommentThreadCard.tsx:252-260`）。
   * 默认**不折叠**（刚写完的评论要能立刻看到全文）。
   */
  const [foldedComments, setFoldedComments] = useState<Record<string, boolean>>({});
  /**
   * 悬停预览（用户 2026-11-05）：移上去显示只读气泡，移开消失。
   * 面板级一份：同一时刻只有一个气泡，避免多个重叠。
   */
  const [hoverPin, setHoverPin] = useState<CommentPin | undefined>(undefined);
  const [hoverRect, setHoverRect] = useState<DOMRect | undefined>(undefined);
  /** 视口尺寸（resize/scroll 时重算，等价 difit 的 `autoUpdate`） */
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>(() => ({
    width: typeof window === "undefined" ? 1680 : window.innerWidth,
    height: typeof window === "undefined" ? 1000 : window.innerHeight,
  }));
  useEffect(() => {
    const update = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, []);
  /**
   * 默认**折叠**（用户 2026-11-05）：行末已有头像针，卡片正文默认收起；
   * 点头像 / 点「打开」才展开成完整卡。这样一屏能看到几十条评论而不被卡片挤爆。
   */
  const foldedOf = useCallback((id: string) => foldedComments[id] !== false, [foldedComments]);
  const onToggleFold = useCallback((id: string) => {
    // 显式记录（不靠"没记录就取默认"兜底，C180 的教训）
    setFoldedComments((prev) => ({ ...prev, [id]: !(prev[id] !== false) }));
  }, []);

  /**
   * 展开某文件的全部隐藏段，并滚到它的第一条评论。
   *
   * 为什么需要：评论行可能落在折叠区（gap/head/tail）里 —— 那时 DOM 里没有该行，
   * 徽标有数字而页面空无一物（用户 2026-11-05 报的第一个 bug）。
   * 处理顺序：先展开（必要时请求 blob）→ 等一帧 → 再滚。
   */


  /**
   * 关闭一条评论（A19）：**权限由 `canCloseComment` 判定**（提出者或用户本人）。
   * 服务端也会校验一次——前端判定只决定按钮显不显示，不作为安全边界。
   */
  const onCloseComment = useCallback(async (id: string) => {
    try {
      await store.setCommentState(taskDir, id, "resolved", { kind: "user", id: me?.id ?? "user" });
      reloadDrafts();
    } catch (error) {
      setStoreError(String(error));
    }
  }, [store, taskDir, me?.id, reloadDrafts]);

  /** 重开（A18 三态的开放转移）：误关的退路。服务端同一套权限（作者或用户）。 */
  const onReopenComment = useCallback(async (id: string) => {
    try {
      await store.setCommentState(taskDir, id, "open", { kind: "user", id: me?.id ?? "user" });
      reloadDrafts();
    } catch (error) {
      setStoreError(String(error));
    }
  }, [store, taskDir, me?.id, reloadDrafts]);

  /** 线程动作（S4-h）的实现：回复 / 删回复 / 改等待方。失败一律可见（不静默）。 */
  const onReply = useCallback(async (id: string, body: string) => {
    try {
      await store.reply(taskDir, id, { author: { kind: "user", id: me?.id ?? "user" }, body });
      reloadDrafts();
    } catch (error) {
      setStoreError(String(error));
    }
  }, [store, taskDir, me?.id, reloadDrafts]);

  const onEditReply = useCallback(async (id: string, replyId: string, body: string) => {
    try {
      await store.editReply(taskDir, id, { id: replyId, author: { kind: "user", id: me?.id ?? "user" }, body });
      reloadDrafts();
    } catch (error) {
      setStoreError(String(error));   // 编辑失败要可见（不静默吞掉用户的修改）
    }
  }, [store, taskDir, me?.id, reloadDrafts]);

  const onRemoveReply = useCallback(async (id: string, replyId: string) => {
    try {
      await store.removeReply(taskDir, id, replyId, { kind: "user", id: me?.id ?? "user" });
      reloadDrafts();
    } catch (error) {
      setStoreError(String(error));
    }
  }, [store, taskDir, me?.id, reloadDrafts]);

  const onChangeAwaiting = useCallback(async (id: string, awaiting: "user" | "agent" | null) => {
    try {
      await store.setAwaiting(taskDir, id, awaiting, { kind: "user", id: me?.id ?? "user" });
      reloadDrafts();
    } catch (error) {
      setStoreError(String(error));
    }
  }, [store, taskDir, me?.id, reloadDrafts]);

  /** 复制一条（A20）：把 `1、【path:Lx-Ly】你说的：「…」` 放进剪贴板 */
  const copyOne = useCallback(async (draft: ReviewDraft) => {
    const text = commentsToText([draftToComment(draft, taskId)]);
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      setStoreError(`复制失败：${String(error)}`);   // 错误可见，不静默
    }
  }, [taskId]);

  /** 已关闭的条数（G7 的开关显示它；未关闭的不算） */
  const resolvedCount = useMemo(
    () => drafts.filter((draft) => (draft.state ?? "draft") === "resolved").length,
    [drafts],
  );

  /** 未关闭的评论条数（G2 的"复制全部 N"用它；关闭的不算） */
  const openComments = useMemo(
    () => drafts.filter((draft) => (draft.state ?? "draft") !== "resolved" && draft.note.trim() !== "").length,
    [drafts],
  );

  /**
   * 复制全部未关闭的评论（G2）。排序、序号、排除已关闭都由 `commentsToText` 负责
   * （单一实现，不在 UI 里重排——那样两处会漂移）。
   */
  const copyAll = useCallback(async () => {
    const text = commentsToText(drafts.map((draft) => draftToComment(draft, taskId)));
    if (text === "") { setStoreError("没有可复制的评论（都已关闭或为空）"); return; }
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      setStoreError(`复制失败：${String(error)}`);
    }
  }, [drafts, taskId]);

  /**
   * 发送到输入框（A21）：**只放进输入框，不自动发**（opencode `composer.attach` 同款）。
   * 用户还能改、还能补话，最后自己按 Enter——保留确认机会。
   */
  const sendToComposer = useCallback((draft: ReviewDraft) => {
    const comment = draftToComment(draft, taskId);
    /**
     * 优先走**结构化引用**（A8/G3）：chip 可逐条删、不会被后续输入挤乱；
     * 没有宿主注入时才退回"拼好的文本"（兼容路径）。
     */
    if (onAttachComments !== undefined) { onAttachComments([comment]); return; }
    const text = commentsToText([comment]);
    if (text === "") return;
    onInsertComment?.(text);
  }, [taskId, onAttachComments, onInsertComment]);

  /** 把**全部未关闭**的评论挂到输入框（G2 的第二个用途：不只复制，还能直接发） */
  const sendAllToComposer = useCallback(() => {
    const usable = drafts.filter((draft) => (draft.state ?? "draft") !== "resolved").map((draft) => draftToComment(draft, taskId));
    if (usable.length === 0) return;
    if (onAttachComments !== undefined) { onAttachComments(usable); return; }
    const text = commentsToText(usable);
    if (text !== "") onInsertComment?.(text);
  }, [drafts, taskId, onAttachComments, onInsertComment]);

  /** 评论的三个动作打包（往下穿两层用；见 CommentActions 的注释） */
  const commentActions = useMemo<CommentActions>(() => ({
    userId: me?.id ?? "user",
    close: (id) => { void onCloseComment(id); },
    reopen: (id) => { void onReopenComment(id); },
    copy: (draft) => { void copyOne(draft); },
    send: (draft) => { sendToComposer(draft); },
    reply: (id, body) => { void onReply(id, body); },
    editReply: (id, replyId, body) => { void onEditReply(id, replyId, body); },
    removeReply: (id, replyId) => { void onRemoveReply(id, replyId); },
    setAwaiting: (id, awaiting) => { void onChangeAwaiting(id, awaiting); },
    online: !offline,
  }), [me?.id, onCloseComment, onReopenComment, copyOne, sendToComposer, onReply, onEditReply, onRemoveReply, onChangeAwaiting, offline]);

  /** 改语气标记（复用 marks.ts；空数组也允许——用户可以先不标语气） */
  const onChangeMarks = useCallback((id: string, marks: string[]) => {
    // 走 store（S4-d）：评论存服务端，不能再写 localStorage
    const draft = drafts.find((item) => item.id === id);
    if (draft === undefined) return;
    void store.save(taskDir, {
      id: draft.id,
      taskId,
      author: draft.author ?? { kind: "user", id: "user" },
      anchor: {
        source: draft.source, path: draft.filePath, side: draft.side, start: draft.start, end: draft.end,
        ...(draft.snapshot !== undefined ? { snapshot: draft.snapshot } : {}),
      },
      body: draft.note,
      marks,
      // 同上：改语气不改状态（否则 open 会被降回 draft）
      state: draft.state ?? "open",
    }).then(() => reloadDrafts()).catch((error: unknown) => {
      setStoreError(String(error));
      setOffline(true);
    });
  }, [drafts, store, taskDir, taskId, reloadDrafts]);

  /**
   * A2b 拖选（difit `DiffChunk.tsx:186-220` 同构）：
   *  - `mousedown` 落点 = anchor；鼠标进入其它行 = 更新终点；**全局 mouseup 提交**（不只在某一行上松手才生效）；
   *  - Shift+点 用 `shiftRangeOf`（跨侧退化为锚点单行）；
   *  - 拖选状态**面板级一份**（同一时刻只能有一个选区），与 openMap/drafts 同一处持有。
   */
  const [drag, setDrag] = useState<{ filePath?: string; sourceKind?: ReviewSourceKind; anchor?: LinePoint; current?: LinePoint }>({});
  const dragRange = useMemo(
    () => (drag.anchor !== undefined && drag.current !== undefined ? rangeOf(drag.anchor, drag.current) : undefined),
    [drag.anchor, drag.current],
  );
  const onDragStart = useCallback((filePath: string, sourceKind: ReviewSourceKind, point: LinePoint, extend: boolean) => {
    setDrag((prev) => {
      // Shift+点：以**上一次的锚**为起点；没有锚则等价普通点击
      if (extend) {
        const range = shiftRangeOf(prev.anchor, point);
        return { filePath, sourceKind, anchor: { side: range.side, line: range.start }, current: { side: range.side, line: range.end } };
      }
      return { filePath, sourceKind, anchor: point, current: point };
    });
  }, []);
  const onDragExtend = useCallback((filePath: string, point: LinePoint) => {
    setDrag((prev) => (prev.anchor === undefined || prev.filePath !== filePath ? prev : { ...prev, current: point }));
  }, []);

  /**
   * 文字拖选 → 行范围（opencode 路径，也是用户最自然的心智："我拖一段文字"）。
   *
   * 依据 opencode `pierre/selection-machine.ts:18-23`：鼠标在**代码文字**上拖，选的是行，
   * 而且它**等一帧让浏览器先把文字选区提交**（`selection.frame`）再换算成行范围。
   * 我们照此：mouseup 后读 `window.getSelection()`，用 `rangeFromSelection` 换算；
   * 同时在松手瞬间把浏览器选区**清掉**——否则文字会一直蓝着，和我们的行高亮两套视觉打架。
   */
  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      // 只处理左键；点在面板外（如对话区）不接管
      if (event.button !== 0) return;
      const root = document.querySelector('[data-testid="review-panel"]');
      if (root === null || !(event.target instanceof Node) || !root.contains(event.target)) return;
      const selection = window.getSelection();
      if (selection === null || selection.isCollapsed) return;
      // 端点所在的元素必须都在面板内
      const rows: RowLike[] = [...root.querySelectorAll("[data-review-line-anchor]")].map((el) => ({
        key: el.getAttribute("data-review-line-anchor") ?? "",
        contains: (node: Node) => el.parentElement?.parentElement?.contains(node) === true,
      }));
      // **先取端点**（后面清选区会把 anchorNode 置 null）
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      const range = rangeFromSelection(rows, anchorNode, focusNode);
      if (range === undefined) return;
      /**
       * **只接管"跨行"的文字选区**。单行内拖字最常见的意图是**复制一段文字**，
       * 那时弹批注框会打断复制（用户 2026-11-05 的原话是"选中**多行**"）。
       * 单行要被批注，走行号点击 / 「＋」——两个显式入口。
       */
      if (range.start === range.end) return;
      // 找这个范围属于哪个文件：端点的锚点行所在的文件卡
      const anchorEl = (node: Node | null): HTMLElement | null => {
        if (node === null) return null;
        const el = node instanceof HTMLElement ? node : node.parentElement;
        return el?.closest<HTMLElement>("[data-review-file]") ?? null;
      };
      const card = anchorEl(anchorNode) ?? anchorEl(focusNode);
      const filePath = card?.getAttribute("data-review-file");
      if (filePath === null || filePath === undefined) return;
      const sourceKind: ReviewSourceKind = card?.closest("[data-review-source]")?.getAttribute("data-review-source") === "lifeos" ? "lifeos" : "worktree";
      /**
       * **确定要接管了才清选区**。
       *
       * 原来这行写在最前面（拿到 range 就清），于是"不接管"的三条出口
       *（不在行内 / 单行内 / 找不到文件卡）也把用户的选区清掉了 —— 用户拖选一段文字，
       *松手后选区消失、评论没建、剪贴板也是空的（2026-11-09 实测：拖动中 30 字符 → 松手 0）。
       * 那三条出口必须**原样保留选区**，让「选中即复制」（`use-copy-on-select.ts`）和
       * 浏览器自己的 Cmd+C 还能用。
       */
      selection.removeAllRanges();
      onAddDraft(filePath, sourceKind, range.side, range.start, range.end, undefined);
    };
    // 用捕获阶段：先于其它 mouseup 处理器看到真实选区
    window.addEventListener("mouseup", onMouseUp, true);
    return () => { window.removeEventListener("mouseup", onMouseUp, true); };
  }, [onAddDraft]);

  /** 全局 mouseup：在哪儿松手都算数（difit 的 handleGlobalMouseUp 同判）。 */
  useEffect(() => {
    if (drag.anchor === undefined || drag.filePath === undefined) return;
    const commit = () => {
      const range = drag.anchor !== undefined && drag.current !== undefined ? rangeOf(drag.anchor, drag.current) : undefined;
      if (range !== undefined && drag.filePath !== undefined && drag.sourceKind !== undefined) {
        // 拖出来的范围直接建草稿（单行时与点「＋」等价）
        onAddDraft(drag.filePath, drag.sourceKind, range.side, range.start, range.end, undefined);
      }
      setDrag({});
    };
    window.addEventListener("mouseup", commit, { once: true });
    return () => { window.removeEventListener("mouseup", commit); };
  }, [drag, onAddDraft]);

  /**
   * 展开一个隐藏段。三种区域：
   *  - hunk：内容就在 patch 里（segment.lines），纯前端切；
   *  - gap / head / tail：不在 patch 里，按需调 `/api/review/blob` 取全文后切
   *    （difit `useExpandedLines` 的 `fetch('/api/blob/...')` 同构；我们选按需而非接口直返全文）。
   */
  const onHiddenExpand = useCallback(async (
    path: string, key: string, action: ExpansionAction,
    segment: Extract<Segment, { kind: "hidden" }>,
    sourceKind: ReviewSourceKind,
  ) => {
    const mapKey = `${path}|${key}`;
    const current = hiddenMap[mapKey];
    const count = segment.count;
    /** 算术只有一份（`expandStep`，纯函数、有穷举测试）；这里只负责"要不要取全文"。 */
    const next = expandStep(count, { up: current?.up ?? 0, down: current?.down ?? 0 }, action);

    // 折叠到 0：不需要内容，直接落状态（也把取过的全文留着，下次展开不必再请求）
    if (action === "collapse") {
      setHiddenMap((prev) => ({ ...prev, [mapKey]: { ...next, ...(current?.lines !== undefined ? { lines: current.lines } : {}) } }));
      return;
    }

    // hunk 内：段自带内容
    if (segment.lines !== undefined) {
      setHiddenMap((prev) => ({ ...prev, [mapKey]: { ...next, lines: segment.lines } }));
      return;
    }

    // gap/head/tail：按需取全文（同一文件只取一次，缓存在 state.lines）
    let pool = current?.lines;
    if (pool === undefined) {
      setHiddenMap((prev) => ({ ...prev, [mapKey]: { ...next, loading: true } }));
      try {
        // 隐藏段只含未改动行 → 两侧内容相同，取 old 侧（old 不存在则 new）
        const side = segment.oldFrom > 0 ? "old" : "new";
        const from = segment.oldFrom > 0 ? segment.oldFrom : segment.newFrom;
        const res = await fetch(`/api/review/blob?${new URLSearchParams({ taskDir, source: sourceKind, path, side })}`);
        const body = await res.json() as { content?: string; error?: { message: string } };
        if (body.content === undefined) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
        pool = sliceHiddenLines(body.content, from, count);
      } catch (error) {
        setHiddenMap((prev) => ({ ...prev, [mapKey]: { ...next, failed: error instanceof Error ? error.message : String(error) } }));
        return;
      }
    }

    setHiddenMap((prev) => ({ ...prev, [mapKey]: { ...next, lines: pool } }));
  }, [hiddenMap, taskDir]);

  /** 悬停/离开：同时记录锚点矩形（气泡定位用，C190） */
  const onPinHoverAt = useCallback((pin: CommentPin | undefined, rect?: DOMRect) => {
    setHoverPin(pin);
    setHoverRect(rect);
  }, []);

  const onRevealComments = useCallback((filePath: string) => {
    const found = data?.items
      .flatMap((group) => group.files.map((file) => ({ file, kind: group.source.kind })))
      .find((item) => item.file.path === filePath);
    if (found === undefined) return;
    const { file, kind } = found;

    /**
     * 关键：gap/head/tail 段**没有行内容**（不在 patch 里），只把 hiddenMap 设成"全展开"
     * 是没用的——必须先通过 `onHiddenExpand(..., "all", ...)` 走 blob 取全文。
     * hunk 内的段自带 lines，同一个入口也能处理。
     */
    const segments = buildSegments(file.hunks, {
      mode: expandMode, context: expandMode === "diff" ? 0 : 3, emitHunkHeaders: true,
    });
    segments.forEach((segment, si) => {
      if (segment.kind !== "hidden") return;
      if (hiddenOf(filePath, String(si))?.up === segment.count) return; // 已全展开
      void onHiddenExpand(filePath, String(si), "all", segment, kind);
    });
    // blob 请求是异步的，留足时间再滚（本地数据 120ms 够，网络慢时滚到文件卡也算可接受）
    window.setTimeout(() => {
      const root = document.querySelector(`[data-review-file="${CSS.escape(filePath)}"]`);
      const target = root?.querySelector("[data-review-pin]") ?? root?.querySelector("[data-review-draft]") ?? root;
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 600);
  }, [data, expandMode, hiddenOf, onHiddenExpand]);

  /**
   * 键盘导航（G13）：**行/块/文件**三级 + `c` 建评论 + `?` 帮助。
   *
   * 三条纪律（都有对应测试）：
   *  1. 在输入框/textarea/contenteditable 里**不抢键**（difit `enableOnFormTags:false` 同判）——
   *     用户在写评论时按 j 必须打出一个 j；
   *  2. 焦点行必须有可见标记（`data-review-cursor`），否则键盘用户不知道自己走到哪；
   *  3. 按 `?` 显示的就是代码里那张表（`KEY_BINDINGS`），不手写第二份文案。
   */
  const [cursor, setCursor] = useState<number>(-1);
  const [helpOpen, setHelpOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /**
   * G6 懒挂载：首屏只挂前 8 个文件（difit `INITIAL_RENDERED_FILE_COUNT`），
   * 其余先渲染 160px 占位（opencode `session-review.tsx:660`），滚到 1200px 内再挂
   * （difit `LAZY_RENDER_ROOT_MARGIN`）。
   */
  const [mountedFiles, setMountedFiles] = useState<Set<string>>(new Set());
  /** G5：用户对超限文件点过「仍然全部显示」（opencode 的 `forced` 集合） */
  const [forcedFiles, setForcedFiles] = useState<Set<string>>(new Set());

  /**
   * G10「已看」进度：记录来自服务端（换设备仍保留），状态由**内容哈希**判定
   * （文件改过 → `changed`，需要重看；difit `useViewedFiles.ts:143-160` 同判）。
   */
  const viewedStore = useMemo(() => createHttpViewedStore({
    log: (level, msg, details) => {
      const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
      logger(`[review-viewed] ${msg}`, details);
    },
  }), []);
  const [viewedRecords, setViewedRecords] = useState<readonly ViewedRecordWire[]>([]);

  /** 每个文件的已看状态（含当前哈希）——所有 UI（侧栏/文件卡/进度）都读它 */
  const viewedStates = useMemo<FileViewedState[]>(() => {
    const files = (data?.items ?? []).flatMap((group) => group.files).map((file) => ({
      path: file.path,
      status: file.status,
      hunks: file.hunks.map((hunk) => ({
        oldStart: hunk.oldStart, oldLines: hunk.oldLines, newStart: hunk.newStart, newLines: hunk.newLines,
        lines: hunk.lines.map((line) => ({ type: line.type, text: line.text })),
      })),
    }));
    return viewedStatesOf(files, viewedRecords);
  }, [data, viewedRecords]);

  const viewedByPath = useMemo(() => new Map(viewedStates.map((state) => [state.path, state])), [viewedStates]);
  const viewedSummary = useMemo(() => viewedSummaryOf(viewedStates), [viewedStates]);

  /** 树（G9）：目录在前、带三态 */
  const fileTree = useMemo(() => buildFileTree(viewedStates), [viewedStates]);

  /**
   * 标记/取消「已看」（G10）。单个或批量（勾选目录）走同一个入口。
   * 失败可见（不静默）：进度没存上要让用户知道，否则他以为标好了。
   */
  const setViewed = useCallback((paths: readonly string[], viewed: boolean) => {
    const entries = paths
      .map((path) => ({ path, hash: viewedByPath.get(path)?.hash ?? "" }))
      .filter((entry) => entry.hash !== "");
    if (entries.length === 0) return;
    void viewedStore.set(taskDir, entries, viewed)
      .then((records) => setViewedRecords(records))
      .catch((error: unknown) => setStoreError(`已看进度保存失败：${String(error)}`));
  }, [viewedStore, taskDir, viewedByPath]);

  /** 读已看记录（打开面板 / 标记之后） */
  const reloadViewed = useCallback(() => {
    void viewedStore.list(taskDir).then((records) => setViewedRecords(records)).catch((error: unknown) => {
      setStoreError(`已看进度读取失败：${String(error)}`);
    });
  }, [viewedStore, taskDir]);
  useEffect(() => { reloadViewed(); }, [reloadViewed]);

  /** 视觉顺序的可导航行（只收有侧行号的行——没有行号的行不能建评论，也不该成为光标） */
  const navRows = useMemo<NavRow[]>(() => {
    const rows: NavRow[] = [];
    for (const group of data?.items ?? []) {
      for (const file of group.files) {
        file.hunks.forEach((hunk, hi) => {
          for (const [li, line] of hunk.lines.entries()) {
            if (line.newNo === null && line.oldNo === null) continue;
            // key 与 DOM 的 `data-review-line-anchor` 完全一致 → 光标可以精确定位到一个元素
            const side = line.type === "removed" ? "old" : "new";
            const no = side === "new" ? line.newNo : line.oldNo;
            if (no === null) continue;
            rows.push({ file: file.path, chunk: `${file.path}#${hi}`, key: `${file.path}#${hi}#${li}#${side}:${no}` });
          }
        });
      }
    }
    return rows;
  }, [data]);

  /** 滚到第 index 行（用锚点元素的 `scrollIntoView`，与「定位到评论」同一套） */
  const revealRow = useCallback((index: number) => {
    const row = navRows[index];
    if (row === undefined) return;
    const anchor = row.key?.split("#").pop() ?? "";
    const scope = document.querySelector(`[data-review-file="${CSS.escape(row.file)}"]`);
    if (scope === null) return;
    // 精确到那一行的行号元素（`data-review-line-anchor="side:no"`）
    const line = scope.querySelector(`[data-review-line-anchor="${CSS.escape(anchor)}"]`);
    (line ?? scope).scrollIntoView({ block: "center", behavior: "smooth" });
  }, [navRows]);

  /**
   * 光标可见标记：给当前行加 `data-review-cursor`，其余行清掉。
   *
   * 为什么不把光标当 prop 传进 `DiffRow`：那要求 FileCard → DiffRow 每一层都加参数，
   * 而它们已经各带 15+ 个 props；光标是**单一全局状态**，用属性标记更简单也更不可能漏传。
   * 单一事实源仍是 `cursor` 下标（键盘动作只改它，标记由这里派生）。
   */
  useEffect(() => {
    const marked = document.querySelectorAll("[data-review-cursor]");
    for (const node of marked) node.removeAttribute("data-review-cursor");
    const row = navRows[cursor];
    if (row === undefined) return;
    const anchor = row.key?.split("#").pop() ?? "";
    const scope = document.querySelector(`[data-review-file="${CSS.escape(row.file)}"]`);
    const line = scope?.querySelector(`[data-review-line-anchor="${CSS.escape(anchor)}"]`);
    line?.setAttribute("data-review-cursor", "");
  }, [cursor, navRows]);

  const moveCursor = useCallback((next: number) => {
    if (next < 0) return;
    setCursor(next);
    revealRow(next);
  }, [revealRow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // 守卫：输入类元素里不抢键（写评论时按 j 要打出一个 j）
      if (shouldIgnoreNav(event.target as HTMLElement | null)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const binding = actionOfKey(event.key);
      if (binding === undefined) return;

      switch (binding.keys[0]) {
        case "j": case "arrowdown": event.preventDefault(); moveCursor(stepLine(navRows, cursor, 1)); break;
        case "k": case "arrowup": event.preventDefault(); moveCursor(stepLine(navRows, cursor, -1)); break;
        case "n": event.preventDefault(); moveCursor(stepChunk(navRows, cursor, 1)); break;
        case "p": event.preventDefault(); moveCursor(stepChunk(navRows, cursor, -1)); break;
        case "]": event.preventDefault(); moveCursor(stepFile(navRows, cursor, 1)); break;
        case "[": event.preventDefault(); moveCursor(stepFile(navRows, cursor, -1)); break;
        case "}": event.preventDefault(); moveCursor(lastFileRow(navRows)); break;
        case "{": event.preventDefault(); moveCursor(firstFileRow(navRows)); break;
        case "?": event.preventDefault(); setHelpOpen((prev) => !prev); break;
        case "escape": event.preventDefault(); if (helpOpen) setHelpOpen(false); else onClose(); break;
        case "c": {
          // 在当前行建评论（difit 的 `c` 同义：只在有光标时生效）
          event.preventDefault();
          const row = navRows[cursor];
          if (row === undefined) return;
          const [, , , anchor] = row.key?.split("#") ?? [];
          const [side, noText] = (anchor ?? "").split(":");
          const no = Number(noText);
          if ((side !== "new" && side !== "old") || !Number.isFinite(no) || no < 1) return;
          const group = data?.items.find((item) => item.files.some((item2) => item2.path === row.file));
          if (group === undefined) return;
          const file = group.files.find((item) => item.path === row.file);
          const text = file?.hunks.flatMap((hunk) => hunk.lines)
            .find((line) => (side === "new" ? line.newNo : line.oldNo) === no)?.text;
          onAddDraft(row.file, group.source.kind, side, no, no, text);
          break;
        }
        default: break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navRows, cursor, helpOpen, moveCursor, onClose, onAddDraft, data]);

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col bg-sunken" data-testid="review-panel" role="complementary" aria-label="检视面板">
      {/* 头部：页签 + 总计 + 刷新/关闭 */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-2">
        <span className="shrink-0 whitespace-nowrap text-body font-semibold text-ink-900">检视</span>
        {totalCount > 0 && <span className="rounded-inner bg-hover px-1.5 py-0.5 text-micro text-ink-700" data-review-count>{totalCount}</span>}
        <StatBadge additions={totalAdd} deletions={totalDel} />
        {/*
          G10 进度（GitHub Files changed 的 "N files viewed" 同款心智）：
          只把 `viewed` 计入；`changed`（看过之后改动又变了）不算——进度条不能骗人。
        */}
        {viewedSummary.total > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-micro text-ink-500" data-review-viewed-summary>
            <span className="font-mono tabular-nums text-ink-700" data-review-viewed-count>{viewedSummary.viewed}/{viewedSummary.total}</span>
            <span>已看</span>
            {viewedSummary.changed > 0 && (
              <span className="rounded-inner bg-diff-mod-soft px-1 py-0.5 text-diff-mod" data-review-viewed-changed title="看过之后这些文件的改动又变了，需要重看">
                {viewedSummary.changed} 个已变
              </span>
            )}
            <span aria-hidden="true" className="h-1 w-12 overflow-hidden rounded-full bg-line">
              <span className="block h-full bg-success" style={{ width: `${viewedSummary.percent}%` }} />
            </span>
          </span>
        )}
        {/* 一键复制检视对象（给 Agent 用）：用户原话"不然我们传达起来就很慢" */}
        <button
          type="button"
          onClick={() => void copyTargetText(data, taskDir)}
          className="ml-1 flex shrink-0 items-center gap-1 rounded-inner px-1.5 py-0.5 text-micro text-ink-500 hover:bg-hover hover:text-ink-900"
          aria-label="复制检视对象信息"
          data-review-copy-target
          title="复制检视对象（Task / worktree 路径 / 分支 / 文档目录）"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <rect x="3.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.1" />
            <path d="M1.5 4.5v6h6" stroke="currentColor" strokeWidth="1.1" />
          </svg>
          复制
        </button>
        {/*
          G2「复制全部」（difit `CommentsDropdown.tsx:50-53` 的 `Copy All Prompt (N)`）：
          `commentsToText()` 早就支持多条，但之前只有"复制单条"，多条时用户只能一条条复制。
          这里只复制**未关闭**的（已关闭的意见不该再塞给 Agent——与 `commentsToText` 的默认一致）。
        */}
        {resolvedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((prev) => !prev)}
            aria-pressed={showResolved}
            className={`shrink-0 rounded-inner px-1.5 py-0.5 text-micro ${showResolved ? "bg-success-soft text-success" : "text-ink-500 hover:bg-hover hover:text-ink-900"}`}
            data-review-show-resolved
            title={showResolved ? "隐藏已关闭的评论" : `显示已关闭的评论（${resolvedCount} 条）`}
          >{showResolved ? "隐藏已关闭" : `显示已关闭 ${resolvedCount}`}</button>
        )}
        {openComments > 0 && (
          <button
            type="button"
            onClick={sendAllToComposer}
            className="shrink-0 rounded-inner px-1.5 py-0.5 text-micro text-ink-500 hover:bg-hover hover:text-accent"
            aria-label={`把全部未关闭的评论放进输入框（${openComments} 条）`}
            data-review-send-all
            title={`把全部未关闭的评论放进输入框（${openComments} 条，不自动发送）`}
          >全部发送 {openComments}</button>
        )}
        {openComments > 0 && (
          <button
            type="button"
            onClick={() => { void copyAll(); }}
            className="flex shrink-0 items-center gap-1 rounded-inner px-1.5 py-0.5 text-micro text-ink-500 hover:bg-hover hover:text-ink-900"
            aria-label={`复制全部未关闭的评论（${openComments} 条）`}
            data-review-copy-all
            title={`复制全部未关闭的评论（${openComments} 条）`}
          >复制全部 {openComments}</button>
        )}
        <span className="ml-auto flex items-center">
          {data !== null && data.items.some((group) => group.source.exists) && (
            <button
              type="button"
              onClick={() => setMerge({ phase: merge.phase === "confirm" ? "idle" : "confirm" })}
              disabled={merge.phase === "running"}
              className="mr-1 shrink-0 rounded-inner px-1.5 py-0.5 text-micro text-ink-700 ring-1 ring-line hover:bg-hover hover:text-ink-900 disabled:opacity-50"
              data-review-merge
              title="把两个工作区合入各自的 main，并删除工作区（不可撤销）"
            >{merge.phase === "running" ? "合入中…" : "合入 main"}</button>
          )}
          {hasContent && (
            <IconButton label={allOpen ? "全部折叠" : "全部展开"} data-review-toggle-all aria-pressed={allOpen}
              onClick={() => setAll(!allOpen)}>
              {allOpen ? <IconChevronsUp size={16} /> : <IconChevronsDown size={16} />}
            </IconButton>
          )}
          {/* 刷新 = diff 与评论一起重拉（Task 0018 用户：外部改了评论数，点刷新要能看到）——
              只调 onReload 会漏掉 reloadDrafts（评论只在挂载/taskDir 变化时拉）。 */}
          <IconButton label="重新加载 diff 与评论" onClick={() => { onReload(); reloadDrafts(); }} disabled={loading}><IconRefresh size={16} /></IconButton>
          <IconButton label="关闭检视面板" onClick={onClose}><IconX size={16} /></IconButton>
        </span>
      </header>

      {merge.phase === "confirm" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-2 py-1.5 text-micro text-ink-700" data-review-merge-confirm>
          <span>把两个工作区合入各自的 main，然后删除工作区。这一步不可撤销。</span>
          <span className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => void runMerge()} className="rounded-inner bg-accent px-2 py-0.5 text-micro text-white" data-review-merge-yes>确认合入</button>
            <button type="button" onClick={() => setMerge({ phase: "idle" })} className="rounded-inner px-2 py-0.5 text-micro text-ink-500 hover:bg-hover" data-review-merge-no>取消</button>
          </span>
        </div>
      )}

      {merge.result !== undefined && (
        <div
          className={`shrink-0 border-b border-line px-2 py-1.5 text-micro ${merge.result.ok ? "bg-success-soft text-ink-700" : "bg-message-failure text-ink-700"}`}
          data-review-merge-result={merge.result.ok ? "ok" : "failed"}
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold">{merge.result.message}</span>
            <button type="button" onClick={() => setMerge({ phase: "idle" })} className="ml-auto text-ink-500 hover:text-ink-900" aria-label="关闭合入结果">×</button>
          </div>
          {merge.result.steps.map((step) => (
            <div key={step.kind} className="mt-0.5">
              <span className="font-mono">{step.kind === "project" ? "项目仓" : "家目录仓"}</span>
              {" · "}{step.status}{" · "}{step.message}
              {step.conflicts !== undefined && step.conflicts.length > 0 && (
                <span className="ml-1 font-mono text-ink-500">{step.conflicts.slice(0, 5).join(", ")}{step.conflicts.length > 5 ? " …" : ""}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/*
        G9 文件树侧栏：目录三态（全看 / 部分 / 没看）+ 勾选目录批量标记已看。
        GitHub Files changed 与 VS Code 都把这棵树放在左栏；我们放在面板里的一条可折叠区
        （面板本身是右侧窄栏，独立一列会挤压 diff 阅读宽度）。
      */}
      {hasContent && (
        <details className="shrink-0 border-b border-line px-2 py-1" data-review-tree open={treeOpen} onToggle={(event) => setTreeOpen((event.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer select-none text-micro text-ink-700" data-review-tree-summary>
            文件树（{fileTree.length} 项，{viewedSummary.viewed}/{viewedSummary.total} 已看）
          </summary>
          <div className="mt-1 max-h-56 overflow-auto" data-review-tree-body>
            <TreeNodes nodes={fileTree} depth={0} onToggleViewed={(paths, viewed) => setViewed(paths, viewed)} />
          </div>
        </details>
      )}

      {/* 检视对象（用户 2026-11-05：必须显示清楚"检的是哪个 worktree 的哪个目录"，方便复制） */}
      {data !== null && (
        <div className="shrink-0 border-b border-line px-2 py-1" data-review-target>
          {/*
            D31：换检视对象。**不放工具栏**而放检视对象条旁边——
            用户在这里已经看到"现在检的是谁"，切换就该长在它旁边（对象与动作同一处，frontend-spec §5）。
            A3 的"箭头"也落在这里，两个入口进同一个选择器。
          */}
          {onSwitchTask !== undefined ? (
            <div className="mb-1 flex min-w-0 items-center gap-1.5" data-review-switcher>
              <span className="shrink-0 text-micro text-ink-500">检视对象</span>
              <select
                aria-label="切换要检视的 Task"
                data-review-switcher-select
                value={currentTaskId ?? ""}
                onChange={(event) => { if (event.target.value !== "") onSwitchTask(event.target.value); }}
                className="h-6 min-w-0 flex-1 rounded-control bg-surface px-1 text-micro text-ink-900 ring-1 ring-line focus:outline-none focus:ring-accent"
              >
                {candidatesLoading === true ? <option value="">正在检查哪些 Task 有改动…</option> : null}
                {(candidates ?? []).map((item) => (
                  <option key={item.taskId} value={item.taskDir}>
                    {item.taskId} {item.title}
                    {item.substantive ? " ●" : item.docChangedFiles > 0 ? "（仅日常）" : ""}
                    {(item.pendingForUser ?? 0) > 0 ? ` 　${item.pendingForUser} 条等你` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {data.items.map((group) => (
            <div key={group.source.kind} className="flex min-w-0 items-center gap-1.5 text-micro text-ink-500">
              <span className="shrink-0 font-semibold text-ink-700">{group.source.kind === "worktree" ? "worktree" : "Task 文档"}</span>
              <span className="min-w-0 truncate font-mono" title={group.source.path} data-review-target-path={group.source.kind}>{shortenPath(group.source.path)}</span>
              {group.source.branch !== undefined ? <span className="shrink-0 rounded-inner bg-hover px-1 py-0.5 font-mono text-ink-700">{group.source.branch}</span> : null}
              {group.source.head !== undefined ? <span className="shrink-0 font-mono text-ink-300">@{group.source.head}</span> : null}
            </div>
          ))}
        </div>
      )}

      {/* 源过滤 + 文件搜索（GitHub PR 的 "filter the files"，opencode 的 filter 也在这个位置，且不做持久化） */}
      {hasContent && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
          {/* 视图模式（G11）：单列 / 并排（opencode `diffStyle` / difit `viewMode` 同款两段） */}
          <Segmented
            value={viewMode}
            onChange={(value) => setViewMode(value === "split" ? "split" : "unified")}
            options={[{ value: "unified", label: "单列" }, { value: "split", label: "并排" }]}
          />
          {/* G15：渲染档位（只有存在 doc 文件时才给，避免对纯代码 Task 显示无用开关） */}
          {(data?.items ?? []).some((group) => group.files.some((file) => file.kind === "doc")) ? (
            <Segmented
              value={renderAs}
              onChange={(value) => setRenderAs(value === "md-preview" ? "md-preview" : "source")}
              options={[{ value: "source", label: "源码" }, { value: "md-preview", label: "渲染" }]}
            />
          ) : null}
          {/* 行密度段控（S1·G1b）：opencode `expandMode` 两段同构 —— 全部行 / 仅改动 */}
          <Segmented
            value={expandMode}
            onChange={(value) => setExpandMode(value === "diff" ? "diff" : "all")}
            options={[{ value: "all", label: "上下文 3 行" }, { value: "diff", label: "仅改动行" }]}
          />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="筛选文件"
            aria-label="按路径筛选文件"
            data-review-filter
            className="h-7 min-w-0 flex-1 rounded-control bg-surface px-2 text-micro text-ink-900 ring-1 ring-line placeholder:text-ink-300 focus:outline-none focus:ring-accent"
          />
        </div>
      )}

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2" data-review-scroll>
        {loading && data === null && (
          <div className="flex items-center justify-center gap-2 py-8 text-micro text-ink-500"><Spinner /> 正在计算 diff…</div>
        )}
        {failed !== null && (
          <EmptyState icon="⚠️" title="diff 加载失败" hint={failed} />
        )}
        {!loading && failed === null && data !== null && !hasContent && (
          <EmptyState icon="✓" title="没有可检视的改动" hint="这个 Task 的 worktree 和文档相对基线没有差异。" />
        )}
        {data !== null && data.items.map((group) => (
          <SourceGroup key={group.source.kind} group={group} isOpen={isOpen}
            folded={groupFoldedOf(group.source.kind)} onToggleGroupFold={() => toggleGroupFold(group.source.kind)}
            onToggle={toggle} filter={filter} expandMode={expandMode}
            hiddenOf={hiddenOf} onHiddenExpand={onHiddenExpand}
            draftsOfFile={draftsForFile}
            onAddDraft={onAddDraft} onChangeDraft={onChangeDraft} onRemoveDraft={onRemoveDraft}
            authorNameOf={authorNameOf}
            foldedOf={foldedOf} onToggleFold={onToggleFold} onChangeMarks={onChangeMarks}
            onPinHover={onPinHoverAt}
            onRevealComments={onRevealComments}
            commentActions={commentActions}
            drag={{ anchor: drag.anchor, range: dragRange }}
            onDragStart={onDragStart} onDragExtend={onDragExtend}
            mountedOf={(path) => mountedFiles.has(path)}
            forcedOf={(path) => forcedFiles.has(path)}
            onForceRender={(path) => setForcedFiles((prev) => mountFile(prev, path))}
            onFileMount={(path) => setMountedFiles((prev) => mountFile(prev, path))}
            viewedOf={(path) => viewedByPath.get(path)?.status ?? "unviewed"}
            onToggleViewed={(path) => setViewed([path], viewedByPath.get(path)?.status !== "viewed")}
            viewMode={viewMode}
            renderAs={renderAs} />
        ))}
      </div>

      {/* 悬停预览气泡：**锚定在头像上**（C190 教训：写死 fixed 位置会离锚点 524px） */}
      {hoverPin !== undefined && hoverRect !== undefined && foldedOf(hoverPin.id) ? (() => {
        const size = { width: 288, height: 96 };
        const placed = placePopover(
          { top: hoverRect.top, left: hoverRect.left, right: hoverRect.right, bottom: hoverRect.bottom, width: hoverRect.width, height: hoverRect.height },
          size, viewportSize,
        );
        return (
        <div
          style={{ top: placed.top, left: placed.left }}
          data-review-pin-side={placed.side}
          className={`pointer-events-auto fixed ${LAYER_CLASS.popover} w-72 ${surfaceClass("popover")} p-2`}
          data-review-pin-preview={hoverPin.id}
          onMouseEnter={() => setHoverPin(hoverPin)}
          onMouseLeave={() => setHoverPin(undefined)}
        >
          <div className="mb-1 flex items-center gap-1.5 text-micro">
            {hoverPin.author.kind === "agent"
              ? <AgentAvatar id={hoverPin.author.id} name={hoverPin.authorName} size={14} />
              : <span style={{ width: 14, height: 14, fontSize: 6 }} className="flex items-center justify-center rounded-full bg-ink-700 leading-none text-white">{hoverPin.authorName.slice(0, 1)}</span>}
            <span className="truncate text-ink-900">{hoverPin.authorName}</span>
            <span className="shrink-0 font-mono text-ink-500">{hoverPin.location}</span>
            <button type="button" className="ml-auto shrink-0 rounded-inner px-1 py-0.5 text-ink-500 hover:bg-hover hover:text-ink-900" onClick={() => { onToggleFold(hoverPin.id); setHoverPin(undefined); }}>打开</button>
          </div>
          {hoverPin.marks.length > 0 ? (
            <div className="mb-1 flex gap-1">
              {hoverPin.marks.map((id) => (
                <span key={id} className="rounded-inner bg-anno-query-soft px-1 py-0.5 text-micro text-anno-query">{MARKS.find((m) => m.id === id)?.label ?? id}</span>
              ))}
            </div>
          ) : null}
          <p className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-micro text-ink-700" data-review-pin-preview-body>{hoverPin.preview}</p>
        </div>
        );
      })() : null}

      {/* 快捷键帮助（G13）：内容就是代码里那张 `KEY_BINDINGS`，不手写第二份文案 */}
      {helpOpen && (
        <div className={`absolute inset-0 ${LAYER_CLASS.modal} flex items-center justify-center ${SCRIM_CLASS} p-4`} role="dialog" aria-modal="true" aria-label="检视面板快捷键" data-review-help
          onClick={() => setHelpOpen(false)}>
          <div className={`max-w-sm ${surfaceClass("modal")}`} onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-body font-semibold text-ink-900">快捷键</span>
              <button type="button" className="ml-auto rounded-inner px-1.5 py-0.5 text-micro text-ink-500 hover:bg-hover hover:text-ink-900"
                onClick={() => setHelpOpen(false)} aria-label="关闭快捷键帮助" data-review-help-close>关闭</button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-micro">
              {KEY_BINDINGS.map((binding) => (
                <div key={binding.label} className="contents">
                  <dt className="shrink-0 rounded-inner bg-sunken px-1 py-0.5 text-center font-mono text-ink-700" data-review-help-key>{binding.label}</dt>
                  <dd className="text-ink-700">{binding.description}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-micro text-ink-300">在输入框里打字时快捷键不生效（不会抢走你按下的字母）。</p>
          </div>
        </div>
      )}

      {/* P3 预留：批注汇总条（本阶段不渲染内容，容器与样式先立——frontend 规范 2.3 容器先行） */}
      <div className="shrink-0 border-t border-line" data-review-annotations-bar hidden />
      <input type="hidden" value={taskDir} data-review-task-dir />
    </div>
  );
}
