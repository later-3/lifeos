/**
 * 过程条（ProcessBar）的统计口径 —— 纯函数，不碰 DOM。
 *
 * 背景（2026-11-02 用户拍板）：一轮完成后，把"中间过程"折成**一行统计**，
 * 不做摘要。为什么不做摘要：
 * - 摘要要额外调一次模型（多花钱、多等一轮）；
 * - 摘要会引入"这段过程到底说了什么"的第二套事实，和完整过程可能不一致；
 * - 用户要的只是"这轮干了多少活"，那是**可数的事实**，不是需要概括的内容。
 *
 * 所以这个模块只回答三个问题，全部来自已有数据，零额外成本：
 *   调用了多少次工具 / 花了多长时间 / 消耗了多少 token。
 *
 * 与 TurnStatusBar 的分工（不重复、不互相顶替）：
 * - `TurnStatusBar` = **进行中**的回合状态（4 步 / 阶段 / 速度 / 上下文），滚动区外固定；
 * - `ProcessBar`   = **已完成**回合的统计行，占这条回复的头部位置，可点开看完整过程。
 */

import type { Block } from "./Message";

/** 一轮的统计事实。字段都可缺：老会话没有 durationMs，就没有时长。 */
export type ProcessStats = {
  /** 工具调用次数（含 lifeos_ask / lifeos_send 这类同为 toolCall 的块） */
  tools: number;
  /** 思考段数（Pi 每段 reasoning 一个 thinking 块） */
  thinking: number;
  /** 本轮所有 assistant 段的耗时合计（毫秒）；没有就是 undefined */
  durationMs?: number | undefined;
  /** 本轮 token 合计（input+output，来自每段 usage）；没有就是 undefined */
  tokens?: number | undefined;
};

/** 这一轮"有没有值得折叠的过程"：0 工具且 0 思考 = 纯聊天，不折。 */
export function hasProcess(stats: ProcessStats): boolean {
  return stats.tools > 0 || stats.thinking > 0;
}

/**
 * 从一轮的全部块里数出统计事实。
 *
 * @param blocks 本轮所有 assistant 段摊平后的块（顺序无关）
 * @param extra  时长与 token 由调用方合入（它们不在块里：durationMs 在消息上、usage 在段上）
 */
export function statsOf(blocks: readonly Block[], extra?: Partial<Pick<ProcessStats, "durationMs" | "tokens">>): ProcessStats {
  let tools = 0;
  let thinking = 0;
  for (const block of blocks) {
    if (block.type === "toolCall") tools += 1;
    else if (block.type === "thinking") thinking += 1;
  }
  return {
    tools,
    thinking,
    ...(extra?.durationMs !== undefined ? { durationMs: extra.durationMs } : {}),
    ...(extra?.tokens !== undefined ? { tokens: extra.tokens } : {}),
  };
}

/** 秒 → `2 分 31 秒` / `8 秒` / `1 小时 5 分`。不足 1 秒不显示（避免 "0 秒" 噪音）。 */
export function formatDuration(ms: number): string | undefined {
  if (!Number.isFinite(ms) || ms < 1000) return undefined;
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  if (minutes > 0) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  return `${seconds} 秒`;
}

/** token 紧凑写法：`38.2k` / `1.4M` / `912`。与状态条的 compactTokens 同口径（4 位有效数字以下进 k）。 */
export function formatTokens(tokens: number): string | undefined {
  if (!Number.isFinite(tokens) || tokens <= 0) return undefined;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

/**
 * 过程条上的文字：`14 次工具 · 2 分 31 秒 · 38.2k tokens`
 *
 * 顺序按"用户最想知道"排：先干了多少活，再花多久，最后花多少 token。
 * 没有的项直接省略（不写"未知"、"0 次"）—— 过程条要极短。
 */
export function processSummary(stats: ProcessStats): string {
  const parts: string[] = [];
  if (stats.tools > 0) parts.push(`${stats.tools} 次工具`);
  else if (stats.thinking > 0) parts.push(`${stats.thinking} 段思考`);
  // 工具和思考都有时，思考只在 tooltip 里补，不进正文（否则一行太长）
  const duration = stats.durationMs === undefined ? undefined : formatDuration(stats.durationMs);
  if (duration !== undefined) parts.push(duration);
  const tokens = stats.tokens === undefined ? undefined : formatTokens(stats.tokens);
  if (tokens !== undefined) parts.push(`${tokens} tokens`);
  return parts.join(" · ");
}

/** tooltip 用：把摘要里省掉的项补全（思考段数、精确秒数）。 */
export function processDetail(stats: ProcessStats): string {
  const parts = [`${stats.tools} 次工具调用`];
  if (stats.thinking > 0) parts.push(`${stats.thinking} 段思考`);
  if (stats.durationMs !== undefined) parts.push(`耗时 ${(stats.durationMs / 1000).toFixed(1)} 秒`);
  if (stats.tokens !== undefined) parts.push(`${stats.tokens} tokens`);
  return parts.join(" · ");
}
