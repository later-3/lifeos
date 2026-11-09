// md 渲染态 diff（G15）：把 diff 行聚成"块"，供渲染后按块标色。
//
// 参考（2026-11-08 逐个读源码）：
//  - **difit** `src/client/viewers/MarkdownDiffViewer.tsx`：`buildPreviewBlocks`（`:90-121`）把 diff 行
//    聚成 `delete / add / change / context` 四种块；渲染时每块左加一条色边（`getBlockStyle` `:335-346`：
//    add/change → 绿边，delete → 红边）；代码围栏单独成 `fenced-code` 块、**段内逐行标色**
//    （`buildRenderBlocks`）；`delete` 块**也渲染**（不是删掉），只是带红边。
//  - **VS Code** 官方文档 `code.visualstudio.com/docs/languages/markdown`：
//    "Markdown preview **can also render diffs**, showing the rendered document with **changes highlighted**
//    instead of the raw Markdown source. This behavior is **opt-in**."（可切，且默认不启用）
//  - **opencode** 没有（`pierre/media.ts#mediaKindFromPath` 只认 svg/image/audio，md 走纯文本 diff）。
//
// **我们没有照抄的部分（差异都是有依据的）**：
//  1. **不实现 frontmatter 表格 diff**：difit 为此写了 ~60 行 `stripFrontmatterBlocks` + `frontmatterDiff`。
//     实测本项目：lifeos 仓库 **167 个 md，0 个**以 `---` 开头；`~/.lifeos` 全库 8573 个里 891 个有，
//     但抽样全部落在 `evidence/` 下的**第三方仓库拷贝**（不是 Task 文档）。我们的 Task 文档不用 frontmatter，
//     所以不写这套逻辑（不装"我们不会验证"的能力）。
//  2. **不做 Mermaid**：difit 装了 `mermaid`（11.13.0，体积大）渲染图。我们的 md 里没有 mermaid 图；
//     将来真有时再按需加载（与 G8/G12 的"动态 import"同一纪律）。
//  3. **块内代码围栏保留逐行标色**（difit 同做法）：这是唯一需要"渲染 + 行级"混合的地方。
//
// 纪律：纯函数，不碰 DOM、不碰 marked/DOMPurify。

import type { SegmentLine } from "./review-segments";

/** 一个块的类型：新增 / 删除 / 变更（删+增同处）/ 未改。 */
export type PreviewBlockType = "add" | "delete" | "change" | "context";

/** 渲染块：普通 markdown 块（整块渲染）或代码围栏（逐行标色）。 */
export type PreviewBlock =
  | { kind: "markdown"; type: PreviewBlockType; lines: string[] }
  | { kind: "fenced-code"; lines: { type: PreviewBlockType; content: string }[] };

/**
 * 把 diff 行聚成块（difit `buildPreviewBlocks` 的同构实现）。
 *
 * 规则（与 difit `:90-121` 逐条对应）：
 *  1. `removed` 行先**挂起**（`pendingDeletes`），不立刻成块——因为后面可能紧跟 `added`，
 *     那属于"同一处改动"，要合成 `change`；
 *  2. 遇到 `added` 且有待挂删除 → 先把删除行刷成 `delete` 块，然后本行及后续新增记为 `change`；
 *  3. 遇到 `context` → 先刷待挂删除，本行记为 `context`；
 *  4. 一段结束（hunk 边界）也要刷一次（否则末尾的删除行会丢）；
 *  5. 相邻同类型行合并进同一块（`appendBlockLine`）——渲染时一块 = 一段连续内容，
 *     块级色边才不会变成"每行一条边"（这与 A22 的整块高亮是同一个道理）。
 */
export function buildPreviewBlocks(lines: readonly SegmentLine[]): { type: PreviewBlockType; lines: string[] }[] {
  const blocks: { type: PreviewBlockType; lines: string[] }[] = [];
  const pendingDeletes: string[] = [];
  let inChange = false;

  const append = (type: PreviewBlockType, line: string): void => {
    const last = blocks[blocks.length - 1];
    if (last !== undefined && last.type === type) { last.lines.push(line); return; }
    blocks.push({ type, lines: [line] });
  };
  const flushDeletes = (): void => {
    for (const line of pendingDeletes) append("delete", line);
    pendingDeletes.length = 0;
  };

  for (const line of lines) {
    if (line.type === "removed") { pendingDeletes.push(line.text); continue; }
    if (line.type === "added") {
      if (pendingDeletes.length > 0) { flushDeletes(); inChange = true; }
      append(inChange ? "change" : "add", line.text);
      continue;
    }
    flushDeletes();
    inChange = false;
    append("context", line.text);
  }
  flushDeletes();
  return blocks;
}

const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

/** 这行是不是围栏开始；是则返回围栏标记（` ``` ` / `~~~`）与长度。 */
export function parseFenceStart(line: string): { marker: string; length: number; raw: string } | null {
  const match = FENCE_PATTERN.exec(line);
  if (match === null) return null;
  const marker = match[1];
  if (marker === undefined || marker === "") return null;
  /**
   * `raw` 必须原样保留这一行：退回 markdown 渲染时如果只按 marker 重建（`` ``` ``），
   * **语言标识会丢**（```js → ```），代码块就没有语法高亮了——自检时实测到这一点
   * （difit 也是用 `currentFence.fence.raw`，`MarkdownDiffViewer.tsx:514`）。
   */
  return { marker: marker[0] as string, length: marker.length, raw: line };
}

const isFenceEnd = (line: string, fence: { marker: string; length: number }): boolean => {
  const trimmed = line.trim();
  if (trimmed.length < fence.length) return false;
  return [...trimmed].every((char) => char === fence.marker);
};

/** 这些行渲染出来没有可见内容（空行、引用定义、脚注定义、HTML 注释）——整块当纯文本渲染。 */
const isNonRenderableLine = (line: string): boolean =>
  line.trim() === ""
  || /^\s*\[[^\]]+\]:\s+\S+/.test(line)
  || /^\s*\[\^[^\]]+\]:\s+/.test(line)
  || /^\s*<!--/.test(line);

/**
 * 把块再切一层：**代码围栏单独成 `fenced-code` 块**（difit `buildRenderBlocks` 同构）。
 *
 * 为什么需要它：围栏里的内容必须**逐行标色**（谁加了哪行代码），不能整块渲染 markdown
 * （否则 `# 注释` 会被当成标题、`---` 会被当成分割线）。
 *
 * 为什么"全是 context 的围栏"要退回 markdown 块（difit `flushFence` 里那段判断）：
 * 一整段没改的代码块，逐行渲染会丢掉语法高亮与可选中性；整块交给 markdown 渲染更自然。
 */
export function buildRenderBlocks(blocks: readonly { type: PreviewBlockType; lines: string[] }[]): PreviewBlock[] {
  const out: PreviewBlock[] = [];
  let currentMarkdown: { kind: "markdown"; type: PreviewBlockType; lines: string[] } | null = null;
  let currentFence: { fence: { marker: string; length: number; raw: string }; lines: { type: PreviewBlockType; content: string }[] } | null = null;

  const flushMarkdown = (): void => {
    if (currentMarkdown !== null) { out.push(currentMarkdown); currentMarkdown = null; }
  };
  const pushMarkdownLine = (type: PreviewBlockType, line: string): void => {
    if (currentMarkdown !== null && currentMarkdown.type === type) { currentMarkdown.lines.push(line); return; }
    flushMarkdown();
    currentMarkdown = { kind: "markdown", type, lines: [line] };
  };
  const flushFence = (closingLine?: string): void => {
    if (currentFence === null) return;
    const onlyContext = currentFence.lines.every((line) => line.type === "context");
    if (closingLine !== undefined && onlyContext) {
      // 未改动的代码块：交回 markdown 渲染（保留语法高亮/选中）
      pushMarkdownLine("context", currentFence.fence.raw);   // 原样放回，保留语言标识
      for (const line of currentFence.lines) pushMarkdownLine("context", line.content);
      pushMarkdownLine("context", closingLine);
    } else {
      flushMarkdown();
      out.push({ kind: "fenced-code", lines: currentFence.lines });
    }
    currentFence = null;
  };

  for (const block of blocks) {
    for (const line of block.lines) {
      if (currentFence !== null) {
        if (isFenceEnd(line, currentFence.fence)) { flushFence(line); continue; }
        currentFence.lines.push({ type: block.type, content: line });
        continue;
      }
      const fence = parseFenceStart(line);
      if (fence !== null) { flushMarkdown(); currentFence = { fence, lines: [] }; continue; }
      pushMarkdownLine(block.type, line);
    }
  }
  flushFence();
  flushMarkdown();
  return out;
}

/** 这一块渲染出来会不会是一片空白（空行/引用定义/HTML 注释）——是就当纯文本画。 */
export function isPlainBlock(lines: readonly string[]): boolean {
  return lines.every(isNonRenderableLine);
}

/** 块的类型 → 是否"有改动"（决定要不要画出色边与底色）。 */
export function blockChanged(type: PreviewBlockType): boolean {
  return type !== "context";
}
