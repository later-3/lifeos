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

/** 建索引：遍历 `root` 下所有文本节点，拼成一条扁平串并记录每段的区间。
 *
 *  - 只走 `NodeFilter.SHOW_TEXT`，不碰元素节点；
 *  - 不裁剪空白（`\n` 与缩进都计入偏移）——裁剪会让偏移与实际 DOM 对不上；
 *  - 空文本节点也计入（length 0，区间 [n, n)），保证节点顺序不丢；
 *  - **`<br>` 记为一个虚拟字符**（见下）。
 *
 *  为什么 `<br>` 要有虚拟字符（2026-11-03 对标 hypothesis/client 发现）：
 *    `textContent` 里 `<br>` 不贡献任何字符，于是 "第一行<br>第二行" 的扁平串是
 *    "第一行第二行"——**和屏幕上看到的两行不一致**。用户圈选跨行的文字时，
 *    存下来的 quote 会丢掉换行，将来按 quote 兜底重定位就可能匹配到别处。
 *    Hypothesis 的做法是把 `<br>` 替换成一个空格（`rendered-text.ts` 的
 *    `substituteBrs`），我们沿用同一口径：**`<br>` → 一个 `\n`**。
 *
 *    这里用 `\n` 而不是空格：我们希望 quote 里保留"这里是换行"这个事实。
 *
 *  实现方式：`nodes` 里除了真实文本节点，还可以有 **合成节点**（`node` 为 null，
 *  只占一个字符），由 `toRange` 在边界落在它上面时折到相邻的真实节点。 */
export type IndexChar =
  | { node: Text; start: number; end: number; synthetic?: undefined }
  /** `<br>` 之类的换行占位：只占 1 个字符，没有对应文本节点。 */
  | { node: null; start: number; end: number; synthetic: true };

export type BlockIndex = {
  /** 按文档顺序排列的片段（真实文本节点 + `<br>` 占位）。 */
  nodes: IndexChar[];
  /** 扁平串总长度。 */
  total: number;
  /** 所有片段按顺序拼接的结果（`<br>` 以 `\n` 出现）。 */
  text: string;
};

export function buildIndex(root: HTMLElement): BlockIndex {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 0x1 /* NodeFilter.SHOW_ELEMENT */ | 0x4 /* SHOW_TEXT */);
  const nodes: BlockIndex["nodes"] = [];
  const parts: string[] = [];
  let acc = 0;
  let node: Node | null = walker.currentNode === root ? null : walker.currentNode;
  const push = (piece: IndexChar, text: string): void => {
    nodes.push({ ...piece, start: acc, end: acc + text.length } as IndexChar);
    parts.push(text);
    acc += text.length;
  };
  while ((node = walker.nextNode()) !== null) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const text = node as Text;
      push({ node: text, start: 0, end: 0 }, text.data);
      continue;
    }
    // 元素：只有 <br> 需要占位（块级元素之间的换行由源里的 \n 文本节点承担）
    if (node.nodeName === "BR") {
      push({ node: null, start: 0, end: 0, synthetic: true }, "\n");
    }
  }
  return { nodes, total: acc, text: parts.join("") };
}

/** 偏移 → Range。无法定位时返回 null（不抛异常）。
 *
 *  区间语义：`[start, end)`。
 *  - 起点归属：片段满足 `start ∈ [it.start, it.end)`；
 *  - 终点归属：片段满足 `end ∈ (it.start, it.end]`（终点落在片段右边界时归到本片段，
 *    否则「整段恰好以一个片段结尾」会落到下一个片段的 0 位，Range 仍能建但语义别扭）。
 *  - **边界落在 `<br>` 占位上时**：折到相邻的真实文本节点（起点往后找、终点往前找），
 *    因为 Range 的端点必须落在文本节点里。折不到（整个块只有 `<br>`）→ null。
 *  - `end <= start` 或越界 → null。 */
export function toRange(index: BlockIndex, start: number, end: number): Range | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end <= start || end > index.total) return null;

  const firstReal = index.nodes.find((it) => it.node !== null);
  const doc = firstReal?.node?.ownerDocument;
  if (doc === undefined) return null;

  /** 找覆盖 `offset` 的真实文本节点（含方向偏好）。 */
  const locate = (offset: number, isStart: boolean): { node: Text; inNode: number } | null => {
    const inRange = (it: IndexChar): boolean => (
      isStart ? offset >= it.start && offset < it.end : offset > it.start && offset <= it.end
    );
    const hit = index.nodes.find((it) => it.node !== null && inRange(it));
    if (hit !== undefined && hit.node !== null) return { node: hit.node, inNode: offset - hit.start };
    // 边界落在合成节点上：起点向后找、终点向前找最近的真实文本节点
    const list = isStart ? index.nodes : [...index.nodes].reverse();
    for (const it of list) {
      if (it.node === null) continue;
      if (isStart ? it.start >= offset : it.end <= offset) {
        return { node: it.node, inNode: isStart ? 0 : it.node.data.length };
      }
    }
    return null;
  };

  const s = locate(start, true);
  const e = locate(end, false);
  if (s === null || e === null) return null;

  const range = doc.createRange();
  range.setStart(s.node, s.inNode);
  range.setEnd(e.node, e.inNode);
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
      if (it.node !== null && it.node === node) return it.start + offset;
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
/**
 * 批注作者（2026-11-03 用户定，为"双向标注"留位）。
 *
 * 用户与 Agent 都是**实体**，都有稳定 id：
 * - 用户：`users/<id>/user.json`（`src/profile.ts` 的 `readProfile`），实际值如 `xu-later`；
 * - Agent：`agents/<id>/agent.json`，如 `coder`。
 *
 * 现在只写 `kind: "user"`；Agent 也能标注是待办 C4 的事，
 * 但字段现在就加——一并补比将来迁移已存的批注便宜得多。
 */
export type AnnotationAuthor = {
  kind: "user" | "agent";
  /** 用户 id（`users/<id>`）或 Agent id（`agents/<id>`）。 */
  id: string;
};

export type Annotation = {
  id: string;
  /** 谁写的这条批注。 */
  author: AnnotationAuthor;
  messageId: string;
  blockIndex: number;
  start: number;
  end: number;
  quote: string;
  /** 语气 id 数组，可叠加，**至少 1 个**。 */
  marks: string[];
  /** 用户写的话，可为空串。 */
  note: string;
  /**
   * 已被哪一轮消费（= 该轮用户消息 id）。`undefined` = 待发送。
   *
   * **状态跟记录走、不跟内容走**：用户重新编辑会产生一条**新记录**，
   * 即使文字与旧记录一模一样，它也是待发送、必须能再发（用户 2026-11-04 定）。
   */
  consumedBy?: string;
  /** 被哪条新记录取代。`undefined` = 它是最新版本（旧版本留作历史）。 */
  supersededBy?: string;
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
/** 已经写入样式表的 registry 名字 → 它的 css 规则（名字按 owner 隔离后是动态的，规则跟着补）。 */
const highlightRules = new Map<string, string>();

/** 补一条 `::highlight(name)` 规则（已存在则跳过）。颜色仍走 token 变量。 */
function ensureHighlightRule(name: string, markId: string): void {
  if (highlightRules.has(name)) return;
  const mark = MARKS.find((m) => m.id === markId);
  if (mark === undefined) return;   // 白名单外：不生成规则（与 MARK_ID_PATTERN 同一防线）
  highlightRules.set(name, `::highlight(${name}){background-color:color-mix(in srgb, var(--color-anno-${mark.tone}) 26%, transparent);}`);
  highlightSheet?.replaceSync([...highlightRules.values()].join("\n"));
}

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
  // 基础规则：只为白名单标记生成（名字按 owner 隔离后，具体名字由 paint 时按需补）。
  // 这里重放全量（含 paint 时补过的），保证 sheet 与 highlightRules 一致。
  const base = MARKS
    .filter((mark) => MARK_ID_PATTERN.test(mark.id))
    .map((mark) => `::highlight(anno-${mark.id}){background-color:color-mix(in srgb, var(--color-anno-${mark.tone}) 26%, transparent);}`);
  highlightSheet.replaceSync([...base, ...highlightRules.values()].join("\n"));
}

/** 某条消息某个块的批注集合（调用方保证已按 messageId/blockIndex 过滤好）。 */
export type BlockAnnotations = readonly Annotation[];

/**
 * 每个 owner（消息块）当前画着的 registry 名字。
 *
 * **为什么必须有 owner（Task 0008 修复）**：`CSS.highlights` 是全局单例，而旧实现
 * 在"本块没有某标记"时 `registry.delete(name)` —— 把**别的块**刚画的同名高亮擦掉了。
 * 实测：a1 画完 critic，a2/a3 的 paint 立刻把它删光 → 高亮只在重渲染的瞬间存在，
 * 用户看到的是"鼠标靠近才高亮、移开就没"。现在名字按 owner 隔离，只删自己的。
 */
const highlightOwners = new Map<string, Set<string>>();

/** owner 的 registry 名字前缀（CSS ident 安全：只留字母数字下划线连字符）。 */
const ownerKey = (owner: string): string => owner.replace(/[^a-zA-Z0-9_-]/g, "-") || "default";

/** 测试专用：清空 owner 表（registry 本体由测试自己清）。生产代码不调用。 */
export function __resetOwnersForTest(): void {
  highlightOwners.clear();
}

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
  owner = "default",
): void {
  if (registry === undefined) return;
  const key = ownerKey(owner);

  const perMark = new Map<string, Range[]>();
  for (const anno of annotations) {
    const range = toRange(index, anno.start, anno.end);
    if (range === null) continue;          // 偏移失效：跳过（不静默改数据，见 02-design §3.5）
    for (const markId of anno.marks) {
      if (!MARK_ID_PATTERN.test(markId)) continue;
      if (!MARKS.some((m) => m.id === markId)) continue;   // 白名单外（如 "nope"）不画：旧实现靠遍历 MARKS 过滤，这里显式拦
      // 名字带 owner：两个块同用 critic 时互不覆盖（Highlight 同名只能存一份）
      const name = `anno-${markId}--${key}`;
      ensureHighlightRule(name, markId);   // 规则按需补（同名只补一次）
      const list = perMark.get(name);
      if (list === undefined) perMark.set(name, [range]);
      else list.push(range);
    }
  }

  // 本 owner 上一轮画过、这一轮没画的 → 清掉（只清自己的，不碰别人的）
  const previous = highlightOwners.get(key);
  if (previous !== undefined) {
    for (const name of previous) {
      if (!perMark.has(name)) registry.delete(name);
    }
  }
  const current = new Set<string>();
  for (const [name, ranges] of perMark) {
    registry.set(name, new Highlight(...ranges));
    current.add(name);
  }
  if (current.size > 0) highlightOwners.set(key, current);
  else highlightOwners.delete(key);
}

/** 清掉本模块给某个块画的所有高亮（切会话/卸载时用）。 */
export function clearAnnotations(
  registry: HighlightRegistry | undefined = typeof CSS === "undefined" ? undefined : CSS.highlights,
  owner?: string,
): void {
  if (registry === undefined) return;
  if (owner === undefined) {
    // 全清：不指定 owner 时按旧语义清理基础名 + 所有 owner 名
    for (const mark of MARKS) registry.delete(`anno-${mark.id}`);
    for (const names of highlightOwners.values()) for (const name of names) registry.delete(name);
    highlightOwners.clear();
    return;
  }
  const key = ownerKey(owner);
  const names = highlightOwners.get(key);
  if (names !== undefined) {
    for (const name of names) registry.delete(name);
    highlightOwners.delete(key);
  }
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
