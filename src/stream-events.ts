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
  | { type: "thinking"; index: number; text: string }
  | { type: "thinking_end"; index: number }
  | { type: "delta"; index: number; text: string }
  | { type: "tool_call"; index: number; id: string; name: string; arguments: unknown }
  | { type: "tool_result"; id: string; isError: boolean; text: string; truncated: boolean; durationMs?: number }
  // Pi 的自动重试：让界面能显示"失败原因 + 第几次/共几次"（否则失败时界面一片空白）
  | { type: "retrying"; attempt: number; maxAttempts: number; delayMs: number; message: string }
  | { type: "retry_end"; success: boolean };

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

type PiEvent = {
  type?: string;
  assistantMessageEvent?: {
    type?: string;
    contentIndex?: number;
    delta?: string;
    toolCall?: { id?: unknown; name?: unknown; arguments?: unknown };
  };
  toolCallId?: unknown;
  attempt?: unknown; maxAttempts?: unknown; delayMs?: unknown; errorMessage?: unknown; success?: unknown;
  result?: unknown;
  isError?: unknown;
  durationMs?: unknown;
};

/** 映射一条 Pi 事件；不关心的事件返回 undefined（调用方直接跳过）。 */
export function toStreamEvent(event: unknown): StreamEvent | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const input = event as PiEvent;

  if (input.type === "message_update") {
    const update = input.assistantMessageEvent;
    if (update === undefined) return undefined;
    const index = typeof update.contentIndex === "number" ? update.contentIndex : 0;
    if (update.type === "thinking_start") return { type: "thinking", index, text: "" };
    if (update.type === "thinking_delta") return { type: "thinking", index, text: update.delta ?? "" };
    if (update.type === "thinking_end") return { type: "thinking_end", index };
    if (update.type === "text_delta") return { type: "delta", index, text: update.delta ?? "" };
    if (update.type === "toolcall_end") {
      const call = update.toolCall;
      if (typeof call?.id !== "string" || typeof call.name !== "string") return undefined;
      return { type: "tool_call", index, id: call.id, name: call.name, arguments: call.arguments ?? {} };
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
    return { type: "retry_end", success: input.success === true };
  }

  if (input.type === "tool_execution_end") {
    if (typeof input.toolCallId !== "string") return undefined;
    const { text, truncated } = toolResultText(input.result);
    return {
      type: "tool_result", id: input.toolCallId, isError: input.isError === true, text, truncated,
      ...(typeof input.durationMs === "number" ? { durationMs: input.durationMs } : {}),
    };
  }

  return undefined;
}
