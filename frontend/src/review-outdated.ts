// 检视批注的"过期"判定（S2·A6）——纯函数。
//
// 问题：批注锚的是 `{side, start, end}` 行号。代码一改、diff 一重算，行号就漂了；
// 不判过期的话，用户会看到批注指向一段**已经不是当初那段**的代码。
//
// 依据（difit 的完整解，MIT）：
//  - `src/client/utils/outdatedComments.ts:19-60`：`buildFileLineIndex` 建两侧行号→内容索引，
//    `isThreadOutdated` 拿批注里存的 `codeSnapshot.content` 与当前索引**逐行比对**（trim 尾空格）。
//  - 它的 13 条单测（`outdatedComments.test.ts`，202 行）覆盖了全部边界，本文件逐条对齐。
//
// 为什么比对"内容"而不是记"diff 的 hash"：
//  - 记整体 hash 只能回答"文件变了没"，回答不了"我锚的这段还在不在"；
//  - 内容比对能在同一片段只是被挪了行号时**正确地判成未过期**（anchor 按 quote 重找即可）。
//
// 纪律：不读全局、不碰 React——可穷举单测（architecture 2.5）。

export type AnchorSide = "old" | "new";

/** 一条批注锚定的位置（含锚定当时抓的原文快照）。 */
export type AnchorSnapshot = {
  side: AnchorSide;
  /** 1 起；单行时 start === end。 */
  start: number;
  end: number;
  /**
   * 锚定时这些行的原文（多行用 `\n` 连接）。
   * `undefined` = 老数据没存快照 → 永远不判过期（不能拿"没记录"当"过期"）。
   */
  snapshot?: string;
};

/** 一个文件的"行号 → 原文"索引（old / new 两侧各一份）。 */
export type FileLineIndex = {
  old: Map<number, string>;
  new: Map<number, string>;
};

type IndexableLine = {
  type: "context" | "added" | "removed";
  oldNo: number | null;
  newNo: number | null;
  text: string;
};

type IndexableHunk = { lines: readonly IndexableLine[] };

/** 尾空格不计入差异（编辑器自动 trim、git 配置不同都会造成假过期）。 */
function trimTrailing(line: string): string {
  return line.replace(/[ \t]+$/, "");
}

function splitSnapshot(content: string): string[] {
  // 行终止符纪律（DSH ADR）：统一 CRLF，空文本 = 0 行。
  if (content === "") return [];
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map(trimTrailing);
}

/**
 * 从一份文件的 hunk 建两侧索引。
 *
 * 只收**该侧真实存在**的行：context 行两侧都有；added 只有 new；removed 只有 old。
 * 删除行不写 new、新增行不写 old——否则同一行号会被另一个侧的内容覆盖，
 * 拿 old 侧的批注去比 new 侧的内容，必然误判过期。
 */
export function buildFileLineIndex(hunks: readonly IndexableHunk[]): FileLineIndex {
  const oldIndex = new Map<number, string>();
  const newIndex = new Map<number, string>();
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.oldNo !== null) oldIndex.set(line.oldNo, line.text);
      if (line.newNo !== null) newIndex.set(line.newNo, line.text);
    }
  }
  return { old: oldIndex, new: newIndex };
}

/**
 * 判断一条锚点是否已过期。
 *
 * 规则（每条都对应 difit 的一条用例）：
 *  1. 没有快照 → **不**过期（老数据/新锚点都按"信它"处理，不能凭"没记录"就报过期）；
 *  2. 该文件在当前 diff 里**整体消失** → 过期（`index === undefined`）；
 *  3. 目标行在索引里不存在（这段被删了） → **不**过期。理由：删掉不等于"内容变了"，
 *     它更可能是"这段代码没了"，交给上层用别的提示（我们不在这里判"锚点消失"）；
 *  4. 内容逐行比对（尾空格忽略）：任一行不同 → 过期。
 */
export function isAnchorOutdated(anchor: AnchorSnapshot, index: FileLineIndex | undefined): boolean {
  if (anchor.snapshot === undefined) return false;
  if (index === undefined) return true;

  const sideIndex = anchor.side === "old" ? index.old : index.new;
  const start = Math.min(anchor.start, anchor.end);
  const end = Math.max(anchor.start, anchor.end);
  const expected = splitSnapshot(anchor.snapshot);

  for (let i = 0; i <= end - start; i++) {
    const current = sideIndex.get(start + i);
    if (current === undefined) continue;
    const want = expected[i] ?? "";
    if (trimTrailing(current) !== want) return true;
  }
  return false;
}

/**
 * 批量判定（面板渲染时用）：返回"已过期"的 id 集合。
 * 文件不在这次 diff 里、或没有快照，都按上面的规则处理。
 */
export function outdatedIds(
  anchors: readonly { id: string; anchor: AnchorSnapshot }[],
  indexOf: (filePath: string) => FileLineIndex | undefined,
  filePathOf: (id: string) => string,
): Set<string> {
  const out = new Set<string>();
  for (const item of anchors) {
    if (isAnchorOutdated(item.anchor, indexOf(filePathOf(item.id)))) out.add(item.id);
  }
  return out;
}

/**
 * 抓一组行的原文快照（建批注时调用）。
 *
 * `lines` 是选中的行（已按 side 取好），顺序按行号升序；
 * 若目标行不在当前 diff 里（例如锚点是从草稿恢复的、代码已改），返回 `undefined`——
 * 调用方据此决定"存不了快照就不存"，而不是存一个错的快照。
 */
export function snapshotOf(lines: readonly (IndexableLine | undefined)[], side: AnchorSide): string | undefined {
  if (lines.length === 0) return undefined;
  const texts: string[] = [];
  for (const line of lines) {
    if (line === undefined) return undefined;
    const no = side === "old" ? line.oldNo : line.newNo;
    if (no === null || no === undefined) return undefined;
    texts.push(line.text);
  }
  return texts.join("\n");
}
