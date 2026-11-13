/**
 * 选中即复制（Task 0013 · copy-on-select）的**纯函数层**。
 *
 * 抽成 .ts 而不是留在 .tsx 里：Node 不能直接加载 .tsx，纯函数要能离线单测
 *（与 annotation-position.ts 同一套理由）。
 *
 * 这里只放"看事实、出结论"的部分：
 *  1. 该不该复制（选区在不在对话区、是不是空选区、有没有落在表单控件里）；
 *  2. 复制成功的文案（含字数）；
 *  3. 提示胶囊摆在哪（选区上方居中，放不下翻到下方，夹进视口）。
 *
 * **不在这里做的事**：读写剪贴板、挂事件、渲染。那些在 copy-toast.tsx / App 的挂载点。
 *
 * 数字来源（不靠直觉，见任务 02-references.md）：
 *  - 间距 8px、边缘 16px、上方优先 → LibreChat `QuoteButton.tsx:16,18,286-302`；
 *  - 停留 1000ms → Zulip `copied_tooltip.ts:60`、Pi `alt-screen-flash.ts:5`；
 *    （用户 2026-11-07 拍板选 1000ms，不用我们动作条的 1500ms）
 */

/** 选区与提示胶囊之间的间距（px）。来源：LibreChat `POPUP_OFFSET = 8`。 */
export const COPY_GAP = 8;
/** 胶囊距视口边缘的最小距离（px）。来源：LibreChat `EDGE_MARGIN = 16`。 */
export const COPY_EDGE_MARGIN = 16;
/** 胶囊停留时长（ms）。用户 2026-11-07 拍板 1000ms（Zulip / Pi 同值）。 */
export const COPY_FEEDBACK_MS = 1000;

/** 一个问题：这次松手要不要复制。参数全是"已经查好的事实"，便于穷举。 */
export type CopyDecisionFacts = {
  /** 选区在不在对话区（`<main>`）里。 */
  insideZone: boolean;
  /** 选区是不是空（`selection.isCollapsed`）。 */
  collapsed: boolean;
  /** 选中文字（已 `trim()` 过或没 trim 都行，这里自己判）。 */
  text: string;
  /** 选区是否落在 input / textarea / contenteditable 里。 */
  inFormField: boolean;
};

/**
 * 是否复制。四条都必须过：
 *  1. 在对话区里（左三列、输入框、抽屉都不算）；
 *  2. 不是空选区（单击不复制）；
 *  3. 有实际内容（排除纯空白）；
 *  4. 不在表单控件里（在备注框里选字是为了替换，不是要复制）。
 */
export function shouldCopy(facts: CopyDecisionFacts): boolean {
  if (!facts.insideZone) return false;
  if (facts.collapsed) return false;
  if (facts.inFormField) return false;
  return facts.text.trim() !== "";
}

/* ── 选中功能条（Task 0018）─────────────────────────────────────────────────────
 *
 * 松手后的动作组合由**设置 + 选区事实**决定（02-design D7–D16）：
 *  - copyOnSelect 开：松手即复制（Task 0013 现状）+ 功能条**不含复制按钮**；
 *  - copyOnSelect 关：松手只弹条，点「复制」才复制（反馈同一个胶囊）。
 *  - 批注只在“选区起止都在同一个非流式 assistant 文本块”时可选（D12）；
 *  - 引用对任何选区都可用（D14/D15）。
 */

/** 功能条上各入口是否出现（渲染层只执行，不再判断）。 */
export type ToolbarButtons = { copy: boolean; annotate: boolean; quote: boolean };

/** 松手动作组合：复制与否 + 弹条与否 + 条上按钮。 */
export type SelectionAction = {
  copyNow: boolean;
  showToolbar: boolean;
  toolbar: ToolbarButtons;
};

export type SelectionPrefsShape = { copyOnSelect: boolean };

export type SelectionActionFacts = CopyDecisionFacts & {
  /** 选区起止是否都落在同一个**非流式** assistant 文本块内（handler 已查好 DOM 事实）。 */
  annotatable: boolean;
  /** 选区是否落在**流式生成中**的块内（文字每帧在变）。 */
  inStreamingBlock: boolean;
};

/** 松手动作组合的**唯一判定**（可穷举；handler 只执行返回值）。 */
export function selectionAction(facts: SelectionActionFacts, prefs: SelectionPrefsShape): SelectionAction {
  const none: SelectionAction = { copyNow: false, showToolbar: false, toolbar: { copy: false, annotate: false, quote: false } };
  if (!shouldCopy(facts)) return none;
  // 流式块内**不弹功能条**（0018 用户：复制不受影响，只是别触发条——文字每帧在变，
  // 批注锚点会漂、引用的内容下一秒就不是原文）。复制链照常（开态松手即复制）。
  if (facts.inStreamingBlock) {
    return { copyNow: prefs.copyOnSelect, showToolbar: false, toolbar: { ...none.toolbar } };
  }
  if (prefs.copyOnSelect) {
    return { copyNow: true, showToolbar: true, toolbar: { copy: false, annotate: facts.annotatable, quote: true } };
  }
  return { copyNow: false, showToolbar: true, toolbar: { copy: true, annotate: facts.annotatable, quote: true } };
}

/**
 * 成功文案。用户 2026-11-07 拍板带字数：「已复制 · N 字」。
 *
 * 为什么带字数而不是只写「已复制」：拖选范围经常跨块，用户需要"确实复制了我以为的那段"的确认；
 * 字数是最短的可用凭据（Zulip/Mattermost 只写 Copied，但它们的触发是按钮、范围固定，
 * 我们的触发是任意拖选，范围不固定）。
 */
export function copyLabel(text: string): string {
  const count = [...text.trim()].length;
  return `已复制 · ${count} 字`;
}

/** 可视矩形（只要这四个边，DOMRect 也满足）。 */
export type RectLike = { top: number; bottom: number; left: number; right: number; width?: number };
export type Size = { width: number; height: number };

/**
 * 胶囊位置（视口坐标，配 `position: fixed`）。
 *
 * 规则**逐条照抄** LibreChat `QuoteButton.tsx:286-302` 的 `resolveTop` 与 `:357-358` 的水平夹取：
 *  1. **上方优先**：`above = 选区上边 - 间距 - 胶囊高`；
 *  2. 上方放得下（≥ 边缘 16 且 ≤ 视口底 - 胶囊高 - 16）→ 用它；
 *  3. 否则试**下方** `below = 选区下边 + 间距`，放得下就用它；
 *  4. 两边都放不下（视口装不下 + 选区位置尴尬）→ 把**上方**那个值夹进 [16, 视口底 - 胶囊高 - 16]，
 *     与 LibreChat 完全一致（它也是 `Math.min(Math.max(preferred, EDGE_MARGIN), maxTop)`）；
 *  5. 水平：选区**水平居中**，再夹进 [16, 视口宽 - 胶囊宽 - 16]。
 *
 * 与批注浮框（annotation-position.ts）的区别只在**优先边**：批注默认在下方（它要贴着文字读），
 * 复制提示在上方（它是"copied"确认，不该盖住你刚选的那段的下文）。两者不共用函数是因为
 * 参数语义不同（那个以容器为坐标、这个以视口为坐标），共用会引入一个只用一方的分支参数。
 */
export function copyFeedbackPosition(
  rect: RectLike,
  size: Size,
  viewport: Size,
): { left: number; top: number } {
  const maxLeft = Math.max(COPY_EDGE_MARGIN, viewport.width - size.width - COPY_EDGE_MARGIN);
  const centerX = rect.left + (rect.right - rect.left) / 2;
  const left = Math.min(Math.max(centerX - size.width / 2, COPY_EDGE_MARGIN), maxLeft);

  const above = rect.top - COPY_GAP - size.height;
  const below = rect.bottom + COPY_GAP;
  const maxTop = Math.max(COPY_EDGE_MARGIN, viewport.height - size.height - COPY_EDGE_MARGIN);
  const fits = (value: number) => value >= COPY_EDGE_MARGIN && value <= maxTop;

  const top = fits(above) ? above : fits(below) ? below : Math.min(Math.max(above, COPY_EDGE_MARGIN), maxTop);

  return { left: Math.round(left), top: Math.round(top) };
}
