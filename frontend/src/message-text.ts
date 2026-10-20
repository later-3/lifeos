import type { Block } from "./Message.tsx";

/**
 * 一条消息里"可复制"的文本：只取文本块，按出现顺序换行拼接。
 * 不含思考过程与工具输出（那是过程细节，不是消息内容）；流式期由界面决定不显示复制。
 */
export function copyTextOf(blocks: Block[]): string {
  return blocks
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
