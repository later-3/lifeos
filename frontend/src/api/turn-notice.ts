// 进入会话时的回合提示（任务 0006 B2）：最近一轮没正常完成时，给出原因与下一步。
//
// 2026-11-03 改（Task 0007）：**判据与动作条同源**。
// 改前的问题：这个提示由 `turns/last` 的 `state === "lost"` 决定，只设一次、不被 `busy` 清；
// 而"重新发送"按钮由 `resendPlan()` 每次渲染按 `busy` 现算。于是生成中会出现
// "提示条说『可以点重新发送』、按钮却不存在"（用户实测报告）。
//
// ## Task 0040（2026-11-25）：生成中**一句结论都不写**
//
// 旧实现在 `busy` 时给的是「正在生成中…（上一轮曾被中断，本轮结束前不提供重新发送）」。
// 这句有两个独立的毛病，验证见 `evidence/probe-notice.out.txt`：
//
// 1. **主语与数据不是同一轮**：文案说的是「上一轮」，而输入是 `turnOutcomeOfMessages()`
//    —— 那是**正在跑的这一轮**。它的尾段 `stopReason` 是 `toolUse`（Pi 的中间态），
//    `turnOutcomeOf` 把中间态判成 `lost`。于是只要这一轮在跑且用过工具（几乎所有轮次），
//    `outcome` 恒为 `lost`，「上一轮曾被中断」常驻。
//    "刚发出、还没有任何回复"（尾部是 user，`sawAssistant=false`）同样被判 `lost` ——
//    用户每发一句话都会被告知"上一轮曾被中断"。
// 2. **它是"结论"，不是"过程"**：这句话断言的是某一轮的结局。正在跑的时候，
//    这一轮的结局还没产生，上一轮的结局也与"现在"无关。
//
// 所以现在：`busy` 时返回 `undefined`。语义与 pi-web 一致
// （`lib/message-display.ts:20-24`：`options.isStreaming` 时 `getAssistantErrorMessage()` 直接返回 null，
// 生成中不输出回合结论）。生成中的动态状态由 `SessionBar` 的「当前回合」承担
// （用户 2026-11-07 拍板：动态状态只在那一处），这里不重复。
//
// 一致性仍由「提示提按钮 ⇔ 按钮存在」守住：`busy` 时 `resendPlan()` 返回 `undefined`（无按钮），
// 本函数也返回 `undefined`（不提按钮）；空闲 + lost 时两者同时出现。
import type { TurnOutcome } from "../../../src/turn-state.ts";

export type TurnSummary = { state: string } | null | undefined;

/** hint：把后端的 `state` 归一成 outcome（只有 "lost" 与 "done" 两种，其他值一律当作 done）。 */
export function outcomeOfTurn(turn: TurnSummary): TurnOutcome {
  return turn?.state === "lost" ? "lost" : "done";
}

export function turnNoticeOf(input: { outcome: TurnOutcome; busy: boolean }): { text: string } | undefined {
  /*
   * 生成中不写结论（Task 0040）。
   *
   * 这一刻的 `outcome` 不可信：它按"最后一条 assistant 的 stopReason"判，
   * 而正在跑的那一轮尾段停在 `toolUse`（中间态）——与"被中断"是同一个值。
   * 换句话说：生成中说"上一轮曾被中断"时，读的分明是**这一轮还没结束**。
   */
  if (input.busy) return undefined;
  if (input.outcome !== "lost") return undefined;
  return { text: "上一轮没有完成：后端在回复前中断（例如服务重启或开发热重载）。你的消息已保留，可以点「重新发送」。" };
}
