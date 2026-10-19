import type { Block } from "./Message.tsx";

/**
 * 流式块归并（纯函数，供 App 的 SSE 处理与单测使用）。
 *
 * 为什么不能"只往后追加文本"：一条助手消息里块是有序的——
 * `思考 → 文本 → 工具调用 → 文本 → 工具调用 → 文本`。锁着"往最后一个文本块追加"就会把
 * 工具调用之后的文本拼到工具前的段落里。这里用 Pi 给的 `contentIndex` 当槽位号，
 * 按槽位插入/追加，顺序天然与模型输出一致（Pi Web 同源做法，见 references 基线表）。
 *
 * 事实源不是这里：run 结束后 App 用 `loadMessages` 全量刷新，本模块只管"跑的时候看得见"。
 */

export type StreamEvent =
  | { type: "thinking"; index: number; text: string }
  | { type: "thinking_end"; index: number }
  | { type: "delta"; index: number; text: string }
  | { type: "tool_call"; index: number; id: string; name: string; arguments: unknown }
  | { type: "tool_result"; id: string; isError: boolean; text: string; truncated: boolean; durationMs?: number };

/** 界面上的"正在干什么"阶段（工作指示文案由 Message.tsx 决定）。 */
export type Phase = "waiting" | "thinking" | "tool" | "text";

export type StreamSlot = { index: number; block: Block };
export type StreamState = { slots: StreamSlot[]; phase: Phase; activeTool?: string };

export function createStreamState(): StreamState {
  return { slots: [], phase: "waiting" };
}

/** 文本块拼接（App 用它同步 Message.text；只取 text 块，不掺思考/工具）。 */
export function textOfBlocks(blocks: Block[]): string {
  return blocks
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export function blocksOfStream(state: StreamState): Block[] {
  return state.slots.map((slot) => slot.block);
}

function insertAt(slots: StreamSlot[], index: number, block: Block): StreamSlot[] {
  let at = slots.findIndex((slot) => slot.index > index);
  if (at < 0) at = slots.length;
  return [...slots.slice(0, at), { index, block }, ...slots.slice(at)];
}

const makeBlock = (kind: "text" | "thinking", text: string): Block =>
  kind === "text" ? { type: "text", text } : { type: "thinking", text };

export function applyStreamEvent(state: StreamState, event: StreamEvent): StreamState {
  if (event.type === "delta" || event.type === "thinking") {
    const kind = event.type === "delta" ? "text" : "thinking";
    const phase: Phase = kind === "text" ? "text" : "thinking";
    const at = state.slots.findIndex((slot) => slot.index === event.index);
    if (at < 0) return { ...state, phase, slots: insertAt(state.slots, event.index, makeBlock(kind, event.text)) };
    const current = state.slots[at]!.block;
    const text = current.type === kind ? current.text + event.text : event.text;
    const slots = [...state.slots];
    slots[at] = { index: event.index, block: makeBlock(kind, text) };
    return { ...state, phase, slots };
  }

  if (event.type === "tool_call") {
    return {
      ...state, phase: "tool", activeTool: event.name,
      slots: insertAt(state.slots, event.index, { type: "toolCall", id: event.id, name: event.name, arguments: event.arguments }),
    };
  }

  if (event.type === "tool_result") {
    const at = state.slots.findIndex((slot) => slot.block.type === "toolCall" && slot.block.id === event.id);
    if (at < 0) return state;
    const slot = state.slots[at]!;
    const call = slot.block as Extract<Block, { type: "toolCall" }>;
    const slots = [...state.slots];
    slots[at] = {
      index: slot.index,
      block: {
        ...call, result: event.text, isError: event.isError,
        ...(event.truncated ? { truncated: true } : {}),
        ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
      },
    };
    // 结果回来了 → 又回到"等模型继续"（不是"还在跑工具"）
    return { ...state, phase: "waiting", activeTool: undefined, slots };
  }

  return state;   // thinking_end：增量已经在块里，结束标记不改变展示
}

/** 工具参数里最能说明"这一步在干什么"的字段（键名取自 Pi 各工具的真实参数）。 */
export function argPreview(toolName: string, args: unknown): string {
  const record = (args ?? {}) as Record<string, unknown>;
  const first = (...keys: string[]): string | undefined => {
    for (const key of keys) { const value = record[key]; if (typeof value === "string" && value !== "") return value; }
    return undefined;
  };
  const inline = first("command") ?? first("path", "pattern", "query") ?? first("content") ?? "";
  const extra = first("pattern") !== undefined && first("path") !== undefined ? ` ${String(record.pattern)}` : "";
  if (toolName === "edit") { const edits = record.edits; return `${String(record.path ?? "")}${Array.isArray(edits) ? ` · ${edits.length} 处` : ""}`; }
  if (toolName === "write") return `${String(record.path ?? "")} · ${typeof record.content === "string" ? record.content.length : 0} 字符`;
  if (toolName === "grep" || toolName === "find") return `${String(record.pattern ?? "")}${record.path === undefined ? "" : ` @ ${String(record.path)}`}`;
  return `${inline}${extra}`.trim();
}
