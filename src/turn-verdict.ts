// 回合对账（协议 P1·1.2 / FR-13）：从会话 JSONL 尾条判定"最后一回合完成了吗"。
// 兜底路径：服务端内存账本 miss（进程重启/事件丢失）时，账本以它为准。
//
// 判定必须看**终态**，不能只看"有没有 assistant"（2026-10-24 会话 01a16bd9 事故）：
// - Pi 的 stopReason 分两类（pi/packages/ai/src/types.ts:474）：
//     终态：stop / length / error / aborted
//     中间态：pending / toolUse / deferred
// - 只有终态才代表这一轮结束；中间态意味着"还要继续"，若文件停在这里就是被中断。
// - aborted（用户打断）归入"未正常完成"，对应 FR-13 的"中断"分支，不冒充"已完成"。
import { readFile } from "node:fs/promises";
import type { StopReason } from "@earendil-works/pi-ai";

export type TurnVerdict = { turnId: string; state: "done" | "lost" } | null;

/** 终态且"正常结束"的集合（aborted 单独处理为 lost）。 */
const COMPLETED_REASONS = new Set<StopReason>(["stop", "length", "error"]);

type EntryLike = {
  type?: string;
  message?: { role?: string; stopReason?: StopReason };
};

/** 与 Pi 条目字段对齐：type:"message" 的 message.role = user/assistant/toolResult/system。 */
async function lastUserTurnVerdict(path: string): Promise<TurnVerdict> {
  const text = await readFile(path, "utf8").catch(() => "");
  if (text.trim() === "") return null;
  const lines = text.split("\n");
  let lastUser = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    try {
      const entry = JSON.parse(line) as EntryLike;
      if (entry.type === "message" && entry.message?.role === "user") { lastUser = i; break; }
    } catch { /* 坏行不计入判定（append-only 有崩溃残行时也只跳过） */ }
  }
  if (lastUser === -1) return null;
  const turnId = `jsonl-${lastUser + 1}`;   // 尾读没有生成时 id：以"该 user 条目所在行号"为准（可回查文件）

  // 扫完最后一条 user 之后的全部条目，取**最后一条 assistant 的终态**。
  let lastAssistantStop: StopReason | undefined;
  let sawAssistant = false;
  for (let i = lastUser + 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    try {
      const entry = JSON.parse(line) as EntryLike;
      if (entry.type !== "message") continue;          // custom/model_change 等不作为收尾信号
      if (entry.message?.role !== "assistant") continue;
      sawAssistant = true;
      lastAssistantStop = entry.message.stopReason;
    } catch { /* skip */ }
  }
  if (!sawAssistant) return { turnId, state: "lost" };          // 只有 user → 没跑起来/被掐断
  if (lastAssistantStop === undefined) return { turnId, state: "done" };  // 老条目无字段：保守视为完成（兼容）
  if (lastAssistantStop === "aborted") return { turnId, state: "lost" };  // 用户打断 = 中断，不是完成
  return { turnId, state: COMPLETED_REASONS.has(lastAssistantStop) ? "done" : "lost" };
}

/** 对账入口：文件不存在/空 → null；能读就按终态判定。 */
export async function readTurnVerdict(path: string): Promise<TurnVerdict> {
  return await lastUserTurnVerdict(path);
}
