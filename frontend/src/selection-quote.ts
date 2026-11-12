/**
 * 「引用」的格式化纯函数（Task 0018 · D15）：把选中的文字格式化成**直接可编辑**的输入框预填文本。
 *
 * 与"检视评论引用"（composer-comment-refs，chip 结构化条目）是**两种形态**：
 * 引用是用户原话要的——"直接把这段话出现在对话框中，然后用户能够自己去往后面去编辑"，
 * 带一点口语化的格式（前缀 + 引号 + 换行箭头）。所以走**文字预填**，不走 chip。
 *
 * 格式（D15，按选中来源分前缀）：
 *  - 选自 assistant 回复：`Agent 说："…"`；
 *  - 选自用户自己发的：`我说："…"`；
 *  - 其他（思考块 / 工具块展开区）：`"…"`（无前缀）；
 *  - 统一后接换行 + `→ ` —— 箭头是用户的接话位置。
 *
 * 纪律：纯函数（不读 DOM / 不碰 React），可穷举单测。
 */

export type SelectionQuoteSpeaker = "user" | "assistant" | undefined;

/** 前缀。assistant 的回复用"Agent 说"；用户自己的话再引用是"我说"。 */
function speakerPrefix(speaker: SelectionQuoteSpeaker): string {
  if (speaker === "assistant") return "Agent 说：";
  if (speaker === "user") return "我说：";
  return "";
}

/** 完整的输入框预填文本（含箭头，用户在箭头后接话）。 */
export function quoteDraftOf(text: string, speaker: SelectionQuoteSpeaker): string {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  return `${speakerPrefix(speaker)}“${trimmed}”\n→ `;
}

/** 按钮预览（不含箭头与换行——条上只有一行）。 */
export function quotePreviewOf(text: string, speaker: SelectionQuoteSpeaker): string {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  return `${speakerPrefix(speaker)}“${trimmed}”`;
}
