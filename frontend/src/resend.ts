import type { Message } from "./Message.tsx";

/**
 * "这一轮没跑出结果"的判定（渲染决策，纯函数）。
 *
 * 三种形态都算失败：
 * - 尾部是 assistant 且带 error（模型调用失败）；
 * - 尾部是 assistant 且没有文本（进程被杀/断线，Pi 只写了空 assistant）；
 * - 尾部是 user（连 assistant 条目都没写出来）。
 * 动作挂在**那一轮的消息上**（不是消息列表末尾单独一行）：失败属于这一轮，不属于"整页"。
 */
export type ResendPlan = { index: number; text: string; note?: string };

export function resendPlan(messages: Message[], busy: boolean): ResendPlan | undefined {
  if (busy) return undefined;                       // 生成中不给"重发"（与动作条规则一致）
  const index = messages.length - 1;
  const tail = messages[index];
  if (tail === undefined) return undefined;
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (lastUser === undefined || lastUser.text.trim() === "") return undefined;

  if (tail.role === "assistant") {
    const failed = tail.text === "" || tail.error !== undefined;
    if (!failed) return undefined;                  // 正常完成的一轮
    // 有 error 时气泡里已经写了原因，不再重复；空回复才需要解释一句
    return { index, text: lastUser.text, ...(tail.error === undefined ? { note: "本轮没有回复（可能被中断）。" } : {}) };
  }
  // 尾部是 user：整轮没有落结果（如后端重启），动作挂在用户这条消息上
  return { index, text: tail.text, note: "本轮没有回复（可能被中断）。" };
}
