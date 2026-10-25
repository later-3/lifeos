// 进入会话时的回合提示（任务 0006 B2）：最近一轮是 lost（被后端中断、从未完成）时，给出原因与下一步。
// 只有一个按钮 = 用户无从判断"后端没响应"还是"发送失败"，这正是 2026-10-25 的事故。
export type TurnSummary = { state: string } | null | undefined;

export function lostNoticeFor(turn: TurnSummary): { text: string } | undefined {
  if (turn === null || turn === undefined) return undefined;
  if (turn.state !== "lost") return undefined;
  return { text: "上一轮没有完成：后端在回复前中断（例如服务重启或开发热重载）。你的消息已保留，可以点「重新发送」。" };
}
