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
