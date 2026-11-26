/**
 * Pi 会话事件 → 我们 SSE 的"流事件"（纯映射，供 agent-host 发布、单测断言）。
 *
 * 为什么要单独一层：Pi 的 `AgentSessionEvent` 有 30+ 种（生命周期、重试、压缩、队列……），
 * 会话区真正要"实时画出来"的只有四件事：思考增量、文本增量、工具调用、工具结果。
 * 未知类型一律忽略——不报错、不猜、不造事件。
 *
 * 事实源仍然是会话 JSONL：run 结束后前端会 `loadMessages` 全量刷新，
 * 这里的流事件只负责"跑的时候看得见"，允许有截断（见 MAX_RESULT_CHARS）。
 */

/** 工具结果预览上限：SSE 是长连接，一次工具结果可能几 MB（read 大文件），只推前 8KB 给界面。 */
export const MAX_RESULT_CHARS = 8000;

export type StreamEvent =
  // 一条 assistant message 的开始/结束：contentIndex 只在本段内有效，绝不跨段共用槽位。
  | { type: "message_start"; segment: string }
  | { type: "message_end"; segment: string }
  | { type: "thinking"; index: number; text: string; segment?: string }
  | { type: "thinking_end"; index: number; segment?: string }
  | { type: "delta"; index: number; text: string; segment?: string }
  | { type: "tool_call"; index: number; id: string; name: string; arguments: unknown; segment?: string }
  // 工具的 running/done 由 tool_execution_* 驱动，不再用整轮 busy 推断。
  | { type: "tool_start"; id: string; name: string; arguments: unknown }
  | { type: "tool_update"; id: string }
  | { type: "tool_result"; id: string; isError: boolean; text: string; truncated: boolean; durationMs?: number; images?: Array<{ data: string; mimeType: string }> }
  // Pi 的自动重试：让界面能显示"失败原因 + 第几次/共几次"（否则失败时界面一片空白）
  | { type: "retrying"; attempt: number; maxAttempts: number; delayMs: number; message: string }
  /**
   * 重试结束。`attempt` / `finalError` 是 Pi 的 `auto_retry_end` 本来就带的字段
   * （pi/packages/coding-agent/src/core/agent-session.ts:1966-1969）。
   * Pi CLI 用它说 "Retry failed after N attempts: <原因>"（interactive-mode.ts:3768），
   * 我们此前丢掉这两个字段，于是失败时无法告诉用户"已经自动试过几次"。
   */
  | { type: "retry_end"; success: boolean; attempt?: number; finalError?: string }
  /**
   * 上下文压缩（Task 0041 · P2）。
   *
   * 为什么需要它：Pi 会发 `compaction_start` / `compaction_end`（`agent-session.d.ts:62-82`），
   * 但我们此前**完全没接**——压缩对用户是不可见的：界面只看到“回复卡住”或“被截断”。
   * 实测代价（01-background §2）：一个会话因为该压不压，连续 6 轮回复被截断，用户完全不知道原因。
   *
   * `phase: "start"` 时只有 `reason`；`"end"` 时带结果（`ok` / `aborted` / `errorMessage`）。
   * `reason` 直接用 Pi 的类型：`manual`（用户 /compact）/ `threshold`（达阈值）/ `overflow`（溢出恢复）。
   */
  | {
    type: "compaction";
    phase: "start" | "end";
    reason: "manual" | "threshold" | "overflow";
    /** 仅 start 有：这次是不是因为溢出（= 前面已经出过问题） */
    overflow?: boolean;
    /** 仅 end 有：是否成功 */
    ok?: boolean;
    /** 仅 end 有：被用户 / 系统打断 */
    aborted?: boolean;
    /** 仅 end 且失败时有：可读的失败原因 */
    errorMessage?: string;
    /** 仅 end 且成功时有：压缩前的 token 数（用于界面说“从 X 降到 Y”） */
    tokensBefore?: number;
  };

/** 工具结果里的图片上限：单张字节数与张数（实测 read 出来的图片 13KB–382KB，见 image-input.md）。 */
export const MAX_TOOL_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TOOL_IMAGES = 4;

/**
 * 工具结果里的图片块（Pi 的 `read` 读到图片时返回 image 内容块）。
 * 之前只取 text，图片被整段丢掉——界面上永远看不到 Agent 读到的图。
 */
export function toolResultImages(result: unknown): Array<{ data: string; mimeType: string }> {
  const content = (result as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return [];
  const images: Array<{ data: string; mimeType: string }> = [];
  for (const block of content) {
    if (images.length >= MAX_TOOL_IMAGES) break;
    const part = block as { type?: unknown; data?: unknown; mimeType?: unknown } | null;
    if (part === null || part.type !== "image") continue;
    if (typeof part.data !== "string" || typeof part.mimeType !== "string") continue;
    if (!part.mimeType.startsWith("image/")) continue;
    if ((part.data.length * 3) / 4 > MAX_TOOL_IMAGE_BYTES) continue;   // 太大就不内联，界面只显示文字摘要
    images.push({ data: part.data, mimeType: part.mimeType });
  }
  return images;
}

/** 工具返回值取文本：与 Pi 自己的 `textOf()` 同义（只取 text 块，用换行连接）。 */
export function toolResultText(result: unknown): { text: string; truncated: boolean } {
  const content = (result as { content?: unknown } | undefined)?.content;
  let text: string;
  if (typeof result === "string") text = result;
  else if (Array.isArray(content)) {
    text = content
      .filter((block): block is { type: string; text: string } => {
        const part = block as { type?: unknown; text?: unknown } | null;
        return part !== null && part.type === "text" && typeof part.text === "string";
      })
      .map((block) => block.text)
      .join("\n");
  } else if (content === undefined && result !== undefined) text = JSON.stringify(result, null, 2) ?? String(result);
  else text = "";
  if (text.length <= MAX_RESULT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_RESULT_CHARS), truncated: true };
}

type PiMessage = { role?: unknown; timestamp?: unknown };

type PiEvent = {
  type?: string;
  message?: PiMessage;
  assistantMessageEvent?: {
    type?: string;
    contentIndex?: number;
    delta?: string;
    toolCall?: { id?: unknown; name?: unknown; arguments?: unknown };
  };
  toolCallId?: unknown;
  toolName?: unknown;
  args?: unknown;
  partialResult?: unknown;
  // finalError 来自 Pi 的 auto_retry_end（agent-session.ts:1969）；Pi CLI 用它渲染失败文案
  attempt?: unknown; maxAttempts?: unknown; delayMs?: unknown; errorMessage?: unknown; success?: unknown; finalError?: unknown;
  result?: unknown;
  isError?: unknown;
  durationMs?: unknown;
  // 压缩事件额外需要的字段（agent-session.d.ts:62-82）；reason/errorMessage 上面已有
  aborted?: unknown;
  willRetry?: unknown;
  reason?: unknown;
};

/** 一条 assistant message 的稳定键（Pi 给 timestamp；同一轮内唯一）。 */
function segmentOf(message: PiMessage | undefined): string | undefined {
  return typeof message?.timestamp === "number" ? `msg-${message.timestamp}` : undefined;
}

/** 映射一条 Pi 事件；不关心的事件返回 undefined（调用方直接跳过）。 */
export function toStreamEvent(event: unknown): StreamEvent | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const input = event as PiEvent;

  if (input.type === "message_start") {
    if (input.message?.role !== "assistant") return undefined;
    return { type: "message_start", segment: segmentOf(input.message) ?? "assistant" };
  }
  if (input.type === "message_end") {
    if (input.message?.role !== "assistant") return undefined;
    return { type: "message_end", segment: segmentOf(input.message) ?? "assistant" };
  }

  if (input.type === "message_update") {
    const update = input.assistantMessageEvent;
    if (update === undefined) return undefined;
    const index = typeof update.contentIndex === "number" ? update.contentIndex : 0;
    const segment = segmentOf(input.message);
    const segmentPart = segment === undefined ? {} : { segment };
    if (update.type === "thinking_start") return { type: "thinking", index, text: "", ...segmentPart };
    if (update.type === "thinking_delta") return { type: "thinking", index, text: update.delta ?? "", ...segmentPart };
    if (update.type === "thinking_end") return { type: "thinking_end", index, ...segmentPart };
    if (update.type === "text_delta") return { type: "delta", index, text: update.delta ?? "", ...segmentPart };
    if (update.type === "toolcall_end") {
      const call = update.toolCall;
      if (typeof call?.id !== "string" || typeof call.name !== "string") return undefined;
      return { type: "tool_call", index, id: call.id, name: call.name, arguments: call.arguments ?? {}, ...segmentPart };
    }
    return undefined;
  }

  if (input.type === "auto_retry_start") {
    return {
      type: "retrying",
      attempt: typeof input.attempt === "number" ? input.attempt : 0,
      maxAttempts: typeof input.maxAttempts === "number" ? input.maxAttempts : 0,
      delayMs: typeof input.delayMs === "number" ? input.delayMs : 0,
      message: typeof input.errorMessage === "string" ? input.errorMessage : "",
    };
  }
  if (input.type === "auto_retry_end") {
    return {
      type: "retry_end",
      success: input.success === true,
      ...(typeof input.attempt === "number" ? { attempt: input.attempt } : {}),
      ...(typeof input.finalError === "string" && input.finalError !== "" ? { finalError: input.finalError } : {}),
    };
  }

  if (input.type === "tool_execution_start") {
    if (typeof input.toolCallId !== "string" || typeof input.toolName !== "string") return undefined;
    return { type: "tool_start", id: input.toolCallId, name: input.toolName, arguments: input.args ?? {} };
  }
  if (input.type === "tool_execution_update") {
    return typeof input.toolCallId === "string" ? { type: "tool_update", id: input.toolCallId } : undefined;
  }

  if (input.type === "tool_execution_end") {
    if (typeof input.toolCallId !== "string") return undefined;
    const { text, truncated } = toolResultText(input.result);
    const images = toolResultImages(input.result);
    return {
      type: "tool_result", id: input.toolCallId, isError: input.isError === true, text, truncated,
      ...(images.length > 0 ? { images } : {}),
      ...(typeof input.durationMs === "number" ? { durationMs: input.durationMs } : {}),
    };
  }

  if (input.type === "compaction_start" || input.type === "compaction_end") {
    const reason = compactionReasonOf(input.reason);
    if (reason === undefined) return undefined;
    if (input.type === "compaction_start") {
      return { type: "compaction", phase: "start", reason, ...(reason === "overflow" ? { overflow: true } : {}) };
    }
    // end：Pi 的契约是 `result` 有值 = 成功；否则看 aborted  / errorMessage
    // （agent-session.d.ts:75-81）。失败时 errorMessage 可能缺（比如被 abort），
    // 所以“失败”的判定是 `result === undefined && aborted !== true`。
    const aborted = input.aborted === true;
    const hasResult = input.result !== undefined && input.result !== null;
    const ok = hasResult && !aborted;
    const errorMessage = typeof input.errorMessage === "string" && input.errorMessage.trim() !== ""
      ? input.errorMessage.trim()
      : undefined;
    const tokensBefore = hasResult ? tokensBeforeOf(input.result) : undefined;
    return {
      type: "compaction",
      phase: "end",
      reason,
      ok,
      aborted,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
      ...(tokensBefore !== undefined ? { tokensBefore } : {}),
    };
  }

  return undefined;
}

/** Pi 的压缩 retry 分类（agent-session.d.ts:64）；未知值不猜。 */
function compactionReasonOf(raw: unknown): "manual" | "threshold" | "overflow" | undefined {
  return raw === "manual" || raw === "threshold" || raw === "overflow" ? raw : undefined;
}

/** `CompactionResult.tokensBefore`（compaction.d.ts）—— 只在成功时有意义。 */
function tokensBeforeOf(result: unknown): number | undefined {
  const value = (result as { tokensBefore?: unknown } | null)?.tokensBefore;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
