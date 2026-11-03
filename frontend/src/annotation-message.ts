/**
 * 批注 → 发给 Agent 的消息文本（Task 0003 · P4）。
 *
 * 转换规则（用户 2026-11-03 定，**不润色、不加客套**）：
 *     「被批注的原文」 -> 用户写的话 （语气）
 *
 * 多语气用 `、` 连接，包在中文括号里；多个批注按消息顺序 + 段内偏移排成多行，
 * **合成一条消息**（不是多条）。
 *
 * 为什么合成一条（而不是 demo 里的"N 条批注 = N 条消息"）：
 *   真实实现里每次发送 POST 都走 `runTurn()` → `session.prompt()`，
 *   是**一次真实模型调用**。N 条批注发 N 次 = N 次调用，慢且贵；
 *   而且批注本质是"对同一段回复的一批意见"，一次回应更自然。
 *
 * 纪律：**绝不出现颜色值、markId、CSS 变量名**——用户看到的颜色是我们内部的表示，
 * Agent 只需要"用户对哪句话有什么看法"（D10）。
 */

import type { Annotation } from "./annotations.ts";
import { labelsOf } from "./marks.ts";

/** 一条批注 → 一行文本。 */
export function annotationLine(anno: Annotation, labels: (ids: readonly string[]) => string = labelsOf): string {
  const tone = labels(anno.marks);
  const note = anno.note.trim();
  // 箭头前后各一个空格；没写话时箭头后直接是括号
  return note === ""
    ? `「${anno.quote}」 -> （${tone}）`
    : `「${anno.quote}」 -> ${note} （${tone}）`;
}

/**
 * N 条批注 → 一条消息的完整文本。
 *
 * @param order 消息 id 的顺序（用于排序）；不传则保持传入顺序。
 *              批注在表格与消息里都该按"先看的在前"排——即消息顺序 + 段内偏移。
 */
export function annotationsMessage(
  annos: readonly Annotation[],
  options: { labels?: (ids: readonly string[]) => string; order?: readonly string[] } = {},
): string {
  const labels = options.labels ?? labelsOf;
  const order = options.order;
  const rank = (id: string): number => {
    if (order === undefined) return 0;
    const at = order.indexOf(id);
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  const sorted = [...annos].sort((a, b) => {
    const byMessage = rank(a.messageId) - rank(b.messageId);
    if (byMessage !== 0) return byMessage;
    if (a.blockIndex !== b.blockIndex) return a.blockIndex - b.blockIndex;
    return a.start - b.start;
  });
  return sorted.map((anno) => annotationLine(anno, labels)).join("\n");
}
