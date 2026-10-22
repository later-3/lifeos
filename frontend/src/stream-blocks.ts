import type { Block } from "./Message.tsx";

/**
 * 流式块归并（纯函数，供 App 的 SSE 处理与单测使用）。
 *
 * 2026-10-22 修正：Pi 的一次 turn 可以有多条 assistant message；`contentIndex` 是**消息内**序号。
 * 因此状态按 assistant message 分段：段内按 contentIndex 排块，段间按到达顺序；禁止跨段共用槽位。
 * 事实源仍是会话 JSONL：run 结束后 App 用 loadMessages 全量刷新，这里只管"跑的时候看得见"。
 */

export type StreamEvent =
  | { type: "message_start"; segment: string }
  | { type: "message_end"; segment: string }
  | { type: "thinking"; index: number; text: string; segment?: string }
  | { type: "thinking_end"; index: number; segment?: string }
  | { type: "delta"; index: number; text: string; segment?: string }
  | { type: "tool_call"; index: number; id: string; name: string; arguments: unknown; segment?: string }
  | { type: "tool_start"; id: string; name: string; arguments: unknown }
  | { type: "tool_update"; id: string }
  | { type: "tool_result"; id: string; isError: boolean; text: string; truncated: boolean; durationMs?: number }
  | { type: "retrying"; attempt: number; maxAttempts: number; delayMs: number; message: string }
  | { type: "retry_end"; success: boolean };

/** 界面上的"正在干什么"阶段（工作指示文案由 Message.tsx 决定）。 */
export type Phase = "waiting" | "thinking" | "tool" | "text";

export type StreamSlot = { index: number; block: Block };
export type StreamSegment = { key: string; slots: StreamSlot[]; live: boolean };
export type StreamState = { segments: StreamSegment[]; phase: Phase; activeTool?: string };

export function createStreamState(): StreamState {
  return { segments: [], phase: "waiting" };
}

/** 文本块拼接（App 用它同步 Message.text；只取 text 块，不掺思考/工具）。 */
export function textOfBlocks(blocks: Block[]): string {
  return blocks
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** 最终回答 = 最后一段 text；过程文本仍保留在 blocks 里，不伪装成最终答案。 */
export function finalTextOfStream(state: StreamState): string {
  for (let i = state.segments.length - 1; i >= 0; i -= 1) {
    const text = textOfBlocks(state.segments[i]?.slots.map((slot) => slot.block) ?? []);
    if (text.trim() !== "") return text;
  }
  return "";
}

export function blocksOfStream(state: StreamState): Block[] {
  return state.segments.flatMap((segment) => segment.slots.map((slot) => slot.block));
}

function insertAt(slots: StreamSlot[], index: number, block: Block): StreamSlot[] {
  let at = slots.findIndex((slot) => slot.index > index);
  if (at < 0) at = slots.length;
  return [...slots.slice(0, at), { index, block }, ...slots.slice(at)];
}

const makeBlock = (kind: "text" | "thinking", text: string): Block =>
  kind === "text" ? { type: "text", text } : { type: "thinking", text, live: true };

function closeSegment(segment: StreamSegment): StreamSegment {
  return {
    ...segment,
    live: false,
    slots: segment.slots.map((slot) => ({
      ...slot,
      block: slot.block.type === "thinking" && slot.block.live === true ? { ...slot.block, live: false } : slot.block,
    })),
  };
}

/** 找到/创建事件所属段。有 segment 键就按它找；没有就用当前最后一段（兼容旧测试/旧事件）。 */
function withSegment(state: StreamState, key?: string): { state: StreamState; index: number } {
  if (key !== undefined) {
    const existing = state.segments.findIndex((segment) => segment.key === key);
    if (existing >= 0) return { state, index: existing };
    const segments = [...state.segments.map(closeSegment), { key, slots: [], live: true }];
    return { state: { ...state, segments }, index: segments.length - 1 };
  }
  if (state.segments.length > 0) return { state, index: state.segments.length - 1 };
  const segments: StreamSegment[] = [{ key: "segment-0", slots: [], live: true }];
  return { state: { ...state, segments }, index: 0 };
}

function runningToolName(state: StreamState): string | undefined {
  for (const segment of state.segments) {
    for (const slot of segment.slots) {
      if (slot.block.type === "toolCall" && slot.block.running === true) return slot.block.name;
    }
  }
  return undefined;
}

function findTool(state: StreamState, id: string): { segment: number; slot: number } | undefined {
  for (let segment = 0; segment < state.segments.length; segment += 1) {
    const slot = state.segments[segment]!.slots.findIndex((item) => item.block.type === "toolCall" && item.block.id === id);
    if (slot >= 0) return { segment, slot };
  }
  return undefined;
}

function updateBlock(state: StreamState, segmentIndex: number, slotIndex: number, update: (block: Block) => Block): StreamState {
  const segment = state.segments[segmentIndex];
  if (segment === undefined || segment.slots[slotIndex] === undefined) return state;
  const slots = [...segment.slots];
  slots[slotIndex] = { ...slots[slotIndex]!, block: update(slots[slotIndex]!.block) };
  const segments = [...state.segments];
  segments[segmentIndex] = { ...segment, slots };
  return { ...state, segments };
}

export function applyStreamEvent(state: StreamState, event: StreamEvent): StreamState {
  if (event.type === "message_start") {
    // 新 assistant message：旧段先收口；段内 contentIndex 从 0 重新开始，绝不与旧段共用槽位。
    const segments = state.segments.map(closeSegment);
    return { ...state, segments: [...segments, { key: event.segment, slots: [], live: true }], phase: "waiting", activeTool: undefined };
  }

  if (event.type === "message_end") {
    const index = state.segments.findIndex((segment) => segment.key === event.segment);
    const target = index >= 0 ? index : state.segments.length - 1;
    if (target < 0) return state;
    const segments = [...state.segments];
    segments[target] = closeSegment(segments[target]!);
    const running = runningToolName({ ...state, segments });
    return { ...state, segments, phase: running === undefined ? "waiting" : "tool", ...(running === undefined ? { activeTool: undefined } : { activeTool: running }) };
  }

  if (event.type === "thinking" || event.type === "delta") {
    const kind = event.type === "delta" ? "text" : "thinking";
    const phase: Phase = kind === "text" ? "text" : "thinking";
    const scoped = withSegment(state, event.segment);
    const segment = scoped.state.segments[scoped.index]!;
    const at = segment.slots.findIndex((slot) => slot.index === event.index);
    let slots: StreamSlot[];
    if (at < 0) {
      slots = insertAt(segment.slots, event.index, makeBlock(kind, event.text));
    } else {
      const current = segment.slots[at]!.block;
      const text = current.type === kind ? current.text + event.text : event.text;
      slots = [...segment.slots];
      slots[at] = { index: event.index, block: makeBlock(kind, text) };
    }
    const segments = [...scoped.state.segments];
    segments[scoped.index] = { ...segment, live: true, slots };
    return { ...scoped.state, segments, phase };
  }

  if (event.type === "thinking_end") {
    const scoped = withSegment(state, event.segment);
    const segment = scoped.state.segments[scoped.index]!;
    const at = segment.slots.findIndex((slot) => slot.index === event.index && slot.block.type === "thinking");
    if (at < 0) return scoped.state;
    return updateBlock(scoped.state, scoped.index, at, (block) => block.type === "thinking" ? { ...block, live: false } : block);
  }

  if (event.type === "tool_call") {
    const scoped = withSegment(state, event.segment);
    const segment = scoped.state.segments[scoped.index]!;
    const existing = segment.slots.findIndex((slot) => slot.block.type === "toolCall" && slot.block.id === event.id);
    const slots = existing >= 0
      ? segment.slots.map((slot, index) => index === existing && slot.block.type === "toolCall"
        ? { ...slot, block: { ...slot.block, name: event.name, arguments: event.arguments, running: true } }
        : slot)
      : insertAt(segment.slots, event.index, { type: "toolCall", id: event.id, name: event.name, arguments: event.arguments, running: true });
    const segments = [...scoped.state.segments];
    segments[scoped.index] = { ...segment, live: true, slots };
    return { ...scoped.state, segments, phase: "tool", activeTool: event.name };
  }

  if (event.type === "tool_start") {
    const found = findTool(state, event.id);
    if (found !== undefined) {
      return {
        ...updateBlock(state, found.segment, found.slot, (block) => block.type === "toolCall" ? { ...block, name: event.name, arguments: event.arguments, running: true } : block),
        phase: "tool", activeTool: event.name,
      };
    }
    // toolcall_end 没到/丢失时，工具执行事件本身也要能画出块；放在当前段末尾。
    const scoped = withSegment(state);
    const segment = scoped.state.segments[scoped.index]!;
    const nextIndex = Math.max(-1, ...segment.slots.map((slot) => slot.index)) + 1;
    const segments = [...scoped.state.segments];
    segments[scoped.index] = {
      ...segment, live: true,
      slots: [...segment.slots, { index: nextIndex, block: { type: "toolCall", id: event.id, name: event.name, arguments: event.arguments, running: true } }],
    };
    return { ...scoped.state, segments, phase: "tool", activeTool: event.name };
  }

  if (event.type === "tool_update") {
    const found = findTool(state, event.id);
    if (found === undefined) return state;
    return {
      ...updateBlock(state, found.segment, found.slot, (block) => block.type === "toolCall" ? { ...block, running: true } : block),
      phase: "tool",
    };
  }

  if (event.type === "tool_result") {
    const found = findTool(state, event.id);
    if (found === undefined) return state;
    const updated = updateBlock(state, found.segment, found.slot, (block) => block.type === "toolCall"
      ? {
          ...block, running: false, result: event.text, isError: event.isError,
          ...(event.truncated ? { truncated: true } : {}),
          ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
        }
      : block);
    const running = runningToolName(updated);
    return { ...updated, phase: running === undefined ? "waiting" : "tool", ...(running === undefined ? { activeTool: undefined } : { activeTool: running }) };
  }

  return state;   // retrying/retry_end：由状态条单独处理
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
