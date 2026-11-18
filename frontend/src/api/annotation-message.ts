/**
 * 批注 → 发给 Agent 的消息文本（Task 0003 · P4，2026-11-03 用户第二次改格式）。
 *
 * **格式（用户 2026-11-03 定稿）**：
 *
 *     1、你说的：「147 条」
 *       -> 这个数怎么来的 （我是批评的语气！）
 *     2、你说的：「数据1」（我是待办的语气！）
 *
 * 四条细则都是用户逐条裁决的：
 *   - 序号在最前，用**中文顿号**「1、」；
 *   - 「你说的：」——第二人称称呼 Agent（不是"你说过的"）；
 *   - **没写话就不出箭头**（没话时箭头没有存在意义，且 `-> ` 后面会空一格很难看）；
 *   - 引号保持 `「」`。原文里若本来带 `「」` 会嵌套，用户明确接受：
 *     "用户自己在选择文字的时候，用户自己避开就可以了，哪怕不避开也没啥问题"。
 *
 * **只有语气类标记会出现在括号里**（用户 2026-11-03 纠正）：
 * 标记分两类——语气（疑问/批评/鼓励/同意）发给 Agent；功能（存档/待办）
 * 是用户自己的分类，**不发**。一条批注可以同时有两者，但括号里只取语气。
 *
 * **只有功能、没有语气的批注整条不进消息**——它没有要对 Agent 说的话。
 * 这意味着 N 条批注可能产出少于 N 行；序号按**实际发出的行**重排，保持连续。
 *
 * 多条批注按消息顺序 + 段内偏移排成多行，**合成一条消息**（不是多条）：
 *   真实实现里每次发送 POST 都走 `runTurn()` → `session.prompt()`，
 *   是**一次真实模型调用**。N 条批注发 N 次 = N 次调用，慢且贵。
 *
 * 纪律：**绝不出现颜色值、markId、CSS 变量名**——用户看到的颜色是我们内部的表示，
 * Agent 只需要"用户对哪句话有什么看法"（D10）。
 */

import type { Annotation } from "./annotations.ts";
import { sayOf, toneIdsOf } from "./marks.ts";

/**
 * 一条批注 → 一行文本。
 *
 * @param ordinal 这条批注是第几条（1 起）。序号按**实际发出的行**排，
 *                所以调用方要先滤掉"只有功能标记"的批注。
 * @returns 没有语气标记时返回 `null`（这条不该发出去）。
 */
export function annotationLine(
  anno: Annotation,
  ordinal: number,
  say: (ids: readonly string[]) => string = sayOf,
): string | null {
  if (toneIdsOf(anno.marks).length === 0) return null;   // 只有功能标记 → 不发
  const words = say(anno.marks);
  const note = anno.note.trim();
  const head = `${ordinal}、你说的：「${anno.quote}」`;
  // 没写话就不出箭头（用户 2026-11-03）
  return note === "" ? `${head}（${words}）` : `${head}\n  -> ${note} （${words}）`;
}

/**
 * N 条批注 → 一条消息的完整文本。
 *
 * @param order 消息 id 的顺序（用于排序）；不传则保持传入顺序。
 *              批注在表格与消息里都该按"先看的在前"排——即消息顺序 + 段内偏移。
 */
export function annotationsMessage(
  annos: readonly Annotation[],
  options: { say?: (ids: readonly string[]) => string; order?: readonly string[] } = {},
): string {
  const say = options.say ?? sayOf;
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
  const lines: string[] = [];
  for (const anno of sorted) {
    const line = annotationLine(anno, lines.length + 1, say);
    if (line !== null) lines.push(line);   // 只有功能标记的批注整条跳过，序号因此保持连续
  }
  return lines.join("\n");
}

/** 有没有至少一条"该发给 Agent"的批注（只有功能标记的不算）。 */
export function hasSendableAnnotation(annos: readonly Annotation[]): boolean {
  return annos.some((anno) => toneIdsOf(anno.marks).length > 0);
}
