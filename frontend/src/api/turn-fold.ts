/**
 * 一轮的"过程折叠"与"回合结论挂点"的**唯一判据**（Task 0040）。
 *
 * ## 为什么要有这个模块
 *
 * 2026-11-25 用户截图：一句「正在生成中…（上一轮曾被中断，本轮结束前不提供重新发送）」
 * 在一轮回复里被重复打印了上百次。根因之一在**挂载**：那句提示是"回合结论"，
 * 却按 `messageLive`（**轮级** live）挂到了这一轮的**每一条**消息上。
 * 平时只出现一次纯属巧合——过程折叠把整轮收成一条，恰好只渲染出一个宿主。
 *
 * 所以两件事必须由同一处判定：
 * 1. **这一轮折不折、折到谁身上**（`foldDecisionOf`）—— 决定哪条回复承载过程条、哪些不再单独渲染；
 * 2. **结论挂在哪一条**（`conclusionHostOf`）—— 一轮恰好一个宿主。
 *
 * 以前折叠这件事只存在于 `App.tsx` 的渲染循环里（`folded.add` 在渲染期就地改集合），
 * 于是"渲染时才存在的状态"无法被提前问一句"结论该挂哪"，只能退回按 `messageLive` 逐条挂。
 *
 * ## 压缩卡为什么不再掐掉整轮折叠（Task 0016 · P7-S9b 的边界修正）
 *
 * 服务端会把**窗口之外**的压缩卡补回窗口首条（`src/server.ts` 的 `markersBeforeWindow`）。
 * 于是当 `?tail=200` 整段落在一轮内部时（实测某轮 292 段），客户端的隐式轮首条就是那张卡。
 * 旧规则 `首条是卡 → 整轮不折叠` 把 200 段全部单独渲染 —— 用户看到的
 * "思考过程 + 工具块 + 中断提示"重复了 200 遍（`evidence/probe-duplication.out.txt`）。
 *
 * 卡片本身必须留在原位（它是"从这里往前被压缩过"的说明，Task 0016 P7-S9b），但它**只是标记、
 * 不是这一轮的回复**：所以宿主改成"第一条不是卡片的回复"，卡片既不隐藏、也不进合并块。
 *
 * 纯函数、无 IO、无 DOM、不 import `.tsx`（`specs/code/frontend/code.md` 2.13）：
 * 判定要能被 node 测试穷举，也要能被 `test/*.test.mjs` 直接加载。
 */
import { groupIntoSpans } from "./turn-group.ts";

/** 判定只需要这几样（结构化解耦，不绑死前端 `Message` 的完整形状）。 */
export type FoldableBlock = { type: string };
export type FoldableMessage = {
  role: string;
  blocks?: readonly FoldableBlock[] | undefined;
  failure?: unknown;
  error?: unknown;
};

export type FoldDecision =
  /** 不折叠：这一轮的每条回复各自渲染（纯聊天、失败轮、整轮只有标记）。 */
  | { kind: "none"; reason: "no-reply" | "only-card" | "no-process" | "failed" }
  /**
   * 折叠：只有 `hostIndex` 渲染（它承载过程条与合并块），`hidden` 里的回复不再单独渲染。
   * `hidden` **永远不含卡片** —— 压缩标记必须留在原位。
   */
  | { kind: "folded"; hostIndex: number; hidden: readonly number[] };

/** 这条消息是不是压缩标记（Pi 把早期历史压成的卡，不是回复）。 */
export function isCardMessage(message: FoldableMessage | undefined): boolean {
  if (message === undefined) return false;
  return (message.blocks ?? []).some((block) => block.type === "compaction");
}

function hasProcessBlock(message: FoldableMessage | undefined): boolean {
  return (message?.blocks ?? []).some((block) => block.type === "toolCall" || block.type === "thinking");
}

/**
 * 这一轮折不折、折到谁身上。
 *
 * 判据与改造前一致（有过程块才折、失败轮不折、无回复不折），唯一的差别是
 * **宿主的选择**：`replies[0]` 是压缩卡时取它后面的第一条回复，而不是整轮放弃折叠。
 *
 * @param messages 会话消息（与 `span.replyIndexes` 同一坐标系）
 * @param span     一轮（`groupIntoSpans` 的产物）
 */
export function foldDecisionOf(messages: readonly FoldableMessage[], span: { replyIndexes: readonly number[] }): FoldDecision {
  const replies = span.replyIndexes;
  if (replies.length === 0) return { kind: "none", reason: "no-reply" };
  const hostIndex = replies.find((index) => !isCardMessage(messages[index]));
  // 整轮只有压缩标记（异常数据）：没有可承载过程条的回复，也就不折。
  if (hostIndex === undefined) return { kind: "none", reason: "only-card" };

  const replyMessages = replies.map((index) => messages[index]);
  if (!replyMessages.some((message) => hasProcessBlock(message))) return { kind: "none", reason: "no-process" };
  // 失败/中断的轮次保持展开：用户要能看到它做过什么（沿用 `forceOpen` 语义）。
  if (replyMessages.some((message) => message?.failure !== undefined || message?.error !== undefined)) {
    return { kind: "none", reason: "failed" };
  }
  return {
    kind: "folded",
    hostIndex,
    hidden: replies.filter((index) => index !== hostIndex && !isCardMessage(messages[index])),
  };
}

/**
 * 一轮里**承载结论 / 合并块**的那条回复：折叠时是宿主，不折叠时是最后一条非卡片回复。
 *
 * 返回 `undefined` = 这一轮没有可承载的回复（还没回、或整轮只有标记），此时调用方**不渲染结论**，
 * 而不是退回"挂到每条上"（那正是 Task 0040 的缺陷）。
 */
export function hostReplyOf(messages: readonly FoldableMessage[], span: { replyIndexes: readonly number[] }): number | undefined {
  const decision = foldDecisionOf(messages, span);
  if (decision.kind === "folded") return decision.hostIndex;
  const reply = [...span.replyIndexes].reverse().find((index) => !isCardMessage(messages[index]));
  return reply;
}

/**
 * 回合结论（"这一轮完成/失败/被中断"这类**一句话结论**）该挂在哪一条消息上。
 *
 * 结论属于**这一轮**，不轮询到每一条消息上：一轮恰好一个宿主，全对话只有最新一轮持有它
 * （`specs/code/frontend/code.md` 2.41）。
 */
export function conclusionHostOf(messages: readonly FoldableMessage[]): number | undefined {
  const spans = groupIntoSpans(messages);
  const last = spans[spans.length - 1];
  if (last === undefined) return undefined;
  return hostReplyOf(messages, last);
}
