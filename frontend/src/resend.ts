import type { Message } from "./Message.tsx";

/**
 * "这一轮没跑出结果"的判定（渲染决策，纯函数）。
 *
 * 三种形态都算失败：
 * - 尾部是 assistant 且带 error（模型调用失败）；
 * - 尾部是 assistant 且没有文本（进程被杀/断线，Pi 只写了空 assistant）；
 * - 尾部是 user（连 assistant 条目都没写出来）。
 *
 * **动作挂在最后一条用户消息上**（要重发的是这条消息；挂在助手的错误提示下面，会让人以为
 * 要重发"错误文本"）。助手的失败原因留在助手消息里，不搬走。
 */
export type ResendPlan = { index: number; text: string };


export function resendPlan(messages: Message[], busy: boolean): ResendPlan | undefined {
  if (busy) return undefined;                       // 生成中不给"重发"（与动作条规则一致）
  const tail = messages[messages.length - 1];
  if (tail === undefined) return undefined;
  const index = messages.map((message) => message.role).lastIndexOf("user");
  const lastUser = messages[index];
  if (lastUser === undefined || lastUser.role !== "user" || lastUser.text.trim() === "") return undefined;

  // 最后一轮是否失败（tail=user 说明连 assistant 条目都没写出来）
  const failed = tail.role === "assistant" ? (tail.text === "" || tail.error !== undefined) : true;
  if (!failed) return undefined;
  // 只给"重发哪条消息"；失败说明属于左侧本轮槽（不属于用户消息）
  return { index, text: lastUser.text };
}
