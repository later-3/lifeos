// 会话标题规则（会话维护，提交 a08a21e）：标题 = 第一条用户消息压成一行，过长截断。
// 纯函数：会话列表展示（落盘后的文件）与首发即生效（内存中的会话名）必须用同一套规则，避免两个时刻标题不一致。
export const TITLE_MAX_CHARS = 60;

export function titleFromFirstMessage(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > TITLE_MAX_CHARS ? oneLine.slice(0, TITLE_MAX_CHARS) : oneLine;
}
