/**
 * 批注的定位地基（Task 0003 · P1）。
 *
 * 一个块（`.md-body`）里的文字，被当成**一条扁平字符串**来看：
 * 把所有文本节点按文档顺序拼起来，记下每个节点占哪一段 [start, end)。
 * 于是"哪段文字"就只是一对数字 (start, end)，跨加粗/列表/表格都一样。
 *
 * 为什么能用偏移而不是 DOM 路径：
 *   Agent 的回复只写一次、永不改写（779 条 assistant 消息重复 id 为 0，
 *   `session-manager.ts:1191` 是追加），所以落盘后同一条消息的文本永远不变。
 *
 * 为什么不能存 Range：
 *   实测 `innerHTML` 同文本替换后，旧 Range 的 `toString()` 全返回空串，
 *   但 `startContainer.isConnected` 仍是 `true`（不可靠）。所以每次渲染都要按偏移重算 Range。
 *
 * 本文件只放纯函数：不读全局 document、不持有状态，方便单测。
 */

/** 一个块内文字 ↔ 偏移的双向映射。 */
export type BlockIndex = {
  /** 按文档顺序排列的文本节点，及其在扁平串里的区间（左闭右开）。 */
  nodes: Array<{ node: Text; start: number; end: number }>;
  /** 扁平串总长度。 */
  total: number;
  /** 所有文本节点按顺序拼接的结果。 */
  text: string;
};

/** 建索引：遍历 `root` 下所有文本节点，拼成一条扁平串并记录每段的区间。
 *
 *  - 只走 `NodeFilter.SHOW_TEXT`，不碰元素节点；
 *  - 不裁剪空白（`\n` 与缩进都计入偏移）——裁剪会让偏移与实际 DOM 对不上；
 *  - 空文本节点也计入（length 0，区间 [n, n)），保证节点顺序不丢。 */
export function buildIndex(root: HTMLElement): BlockIndex {
  const walker = root.ownerDocument.createTreeWalker(root, 0x4 /* NodeFilter.SHOW_TEXT */);
  const nodes: BlockIndex["nodes"] = [];
  let node: Node | null;
  let acc = 0;
  while ((node = walker.nextNode()) !== null) {
    const text = node as Text;
    const len = text.data.length;
    nodes.push({ node: text, start: acc, end: acc + len });
    acc += len;
  }
  return { nodes, total: acc, text: nodes.map((it) => it.node.data).join("") };
}

/** 偏移 → Range。无法定位时返回 null（不抛异常）。
 *
 *  区间语义：`[start, end)`。
 *  - 起点归属：节点满足 `start ∈ [it.start, it.end)`；
 *  - 终点归属：节点满足 `end ∈ (it.start, it.end]`（终点落在节点右边界时归到本节点，
 *    否则「整段恰好以一个节点结尾」会落到下一个节点的 0 位，Range 仍能建但语义别扭）。
 *  - `end <= start` 或越界 → null。 */
export function toRange(index: BlockIndex, start: number, end: number): Range | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end <= start || end > index.total) return null;

  const doc = index.nodes[0]?.node.ownerDocument;
  if (doc === undefined) return null;

  const range = doc.createRange();
  let startSet = false;
  let endSet = false;
  for (const it of index.nodes) {
    const len = it.node.data.length;
    if (len === 0) continue;
    if (!startSet && start >= it.start && start < it.end) {
      range.setStart(it.node, start - it.start);
      startSet = true;
    }
    if (!endSet && end > it.start && end <= it.end) {
      range.setEnd(it.node, end - it.start);
      endSet = true;
    }
    if (startSet && endSet) break;
  }
  if (!startSet || !endSet) return null;
  return range;
}

/** 取一段偏移对应的**原文**。
 *
 * 为什么不用 `selection.toString()`：
 *   浏览器在跨元素时会在 toString 里塞自己的分隔符——实测跨两个表格单元格时是 `\t`，
 *   而本索引的扁平串是 `\n`。两者不一致会让「保存的 quote」与「按偏移取出的文本」对不上，
 *   将来用 quote 兜底重定位就永远搜不到。
 *   → 所以 quote 一律取自扁平串切片，保证与偏移同源。 */
export function quoteOf(index: BlockIndex, start: number, end: number): string {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return "";
  return index.text.slice(start, end);
}

/** Range → 偏移。节点不在索引里时返回 { start: -1, end: -1 }。
 *
 *  注意：起点/终点必须在同一棵树内（跨块选区不属于单块换算，由调用方按块拆开）。 */
export function toOffset(index: BlockIndex, range: Range): { start: number; end: number } {
  const offsetOf = (node: Node, offset: number): number => {
    for (const it of index.nodes) {
      if (it.node === node) return it.start + offset;
    }
    return -1;
  };
  return {
    start: offsetOf(range.startContainer, range.startOffset),
    end: offsetOf(range.endContainer, range.endOffset),
  };
}

/* ============================================================
   以下是 P2 新增：批注的状态形状、上色、命中检测
   ============================================================ */

import { MARK_ID_PATTERN, MARKS } from "./marks.ts";

/** 一条批注（与 `02-design.md` §2.1 一致）。 */
export type Annotation = {
  id: string;
  messageId: string;
  blockIndex: number;
  start: number;
  end: number;
  quote: string;
  /** 语气 id 数组，可叠加，**至少 1 个**。 */
  marks: string[];
  /** 用户写的话，可为空串。 */
  note: string;
  /** 只影响展示，不影响定位。 */
  ui: {
    /** open=框展开 / hidden=框收起（收起不删数据）。 */
    mode: "open" | "hidden";
    /** 是否钉住：**只控制"移开鼠标收不收"**，不控制能否拖动（两者是不同逻辑）。 */
    pinned: boolean;
    /** 用户拖动过的相对偏移（相对首次自动位置）。 */
    dx: number;
    dy: number;
    /**
     * 是否被拖动过。
     * 不能只看 `dx/dy !== 0` 判断：用户可能把它拖回原点（dx=dy=0），
     * 那时若按"没拖过"处理，框会被自动位置重算覆盖回原处。
     */
    moved?: boolean;
  };
};

/** 上色用的样式表（模块级单例）。
 *
 *  为什么运行时生成而不用静态 CSS：
 *  「加一个标记 = 加一行数据」要求 CSS 里**不预写任何标记名**。
 *  `replaceSync` 可以整表替换，新增标记时只要重跑一次 `rebuildHighlightStyles()`。 */
let highlightSheet: CSSStyleSheet | null = null;

/** 按当前标记表重建 `::highlight()` 规则。
 *
 *  - 只接受白名单 id（否则选择器可被注入）；
 *  - 颜色走 CSS 变量，不写色值（tokens.css 是唯一色值来源）；
 *  - 背景透明度 26%（与 demo 一致）：淡，但一眼能看出这段被标过。 */
export function rebuildHighlightStyles(): void {
  const doc = typeof document === "undefined" ? undefined : document;
  if (doc === undefined) return;
  if (highlightSheet === null) {
    highlightSheet = new CSSStyleSheet();
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, highlightSheet];
  }
  const rules = MARKS
    .filter((mark) => MARK_ID_PATTERN.test(mark.id))
    .map((mark) => `::highlight(anno-${mark.id}){background-color:color-mix(in srgb, var(--color-anno-${mark.tone}) 26%, transparent);}`)
    .join("\n");
  highlightSheet.replaceSync(rules);
}

/** 某条消息某个块的批注集合（调用方保证已按 messageId/blockIndex 过滤好）。 */
export type BlockAnnotations = readonly Annotation[];

/** 把批注画成高亮：**按标记分组**，同一标记的所有区间装进一个 Highlight。
 *
 *  为什么按标记分组而不是按批注：`::highlight` 的名字决定样式，同标记必然同样式，
 *  分组后一次 `set` 处理多个 Range，也避免同名反复覆盖。
 *
 *  ⚠️ 每次渲染后都要重跑本函数：整块重渲染会让旧 Range 失效
 *  （实测：`innerHTML` 同文本替换后 `Range.toString()` 全空，但 `isConnected` 仍是 true）。 */
export function paintAnnotations(
  index: BlockIndex,
  annotations: BlockAnnotations,
  registry: HighlightRegistry | undefined = typeof CSS === "undefined" ? undefined : CSS.highlights,
): void {
  if (registry === undefined) return;

  const perMark = new Map<string, Range[]>();
  for (const anno of annotations) {
    const range = toRange(index, anno.start, anno.end);
    if (range === null) continue;          // 偏移失效：跳过（不静默改数据，见 02-design §3.5）
    for (const markId of anno.marks) {
      if (!MARK_ID_PATTERN.test(markId)) continue;
      const list = perMark.get(markId);
      if (list === undefined) perMark.set(markId, [range]);
      else list.push(range);
    }
  }

  for (const mark of MARKS) {
    if (!MARK_ID_PATTERN.test(mark.id)) continue;
    const name = `anno-${mark.id}`;
    const ranges = perMark.get(mark.id);
    if (ranges !== undefined && ranges.length > 0) {
      registry.set(name, new Highlight(...ranges));
    } else if (registry.has(name)) {
      registry.delete(name);
    }
  }
}

/** 清掉本模块给某个块画的所有高亮（切会话/卸载时用）。 */
export function clearAnnotations(
  registry: HighlightRegistry | undefined = typeof CSS === "undefined" ? undefined : CSS.highlights,
): void {
  if (registry === undefined) return;
  for (const mark of MARKS) registry.delete(`anno-${mark.id}`);
}

/** 几何命中：某个坐标落在哪些批注上。
 *
 *  CSS Highlight API **不提供**"点到哪条高亮"，只能自己用 `getClientRects()` 比对。
 *  实测三处：段内命中 1 个、两段重叠命中 2 个、空白命中 0 个。
 *
 *  @param slack 容差（px）：高亮区的边界差一点也算命中，默认 1。
 */
export function annotationsAt(
  index: BlockIndex,
  annotations: BlockAnnotations,
  point: { x: number; y: number },
  slack = 1,
): Annotation[] {
  const hit: Annotation[] = [];
  for (const anno of annotations) {
    const range = toRange(index, anno.start, anno.end);
    if (range === null) continue;
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i += 1) {
      const rect = rects[i];
      if (rect === undefined) continue;
      if (point.x >= rect.left - slack && point.x <= rect.right + slack
        && point.y >= rect.top - slack && point.y <= rect.bottom + slack) {
        hit.push(anno);
        break;
      }
    }
  }
  return hit;
}
