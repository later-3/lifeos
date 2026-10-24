// 回合对账（协议 P1·1.2）：从会话 JSONL 尾条判定"最后一回合完成了吗"。
// 兜底路径：服务端内存账本 miss（进程重启/事件丢失）时，账本以它为准。
// 判定三分支：完成（最后一条 user 之上有 assistant 收尾）/ 丢失（仅 user 无收尾）/ 无回合。
import { readFile } from "node:fs/promises";

export type TurnVerdict = { turnId: string; state: "done" | "lost" } | null;

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
      const entry = JSON.parse(line) as { type?: string; message?: { role?: string } };
      if (entry.type === "message" && entry.message?.role === "user") { lastUser = i; break; }
    } catch { /* 坏行不计入判定（append-only 有崩溃残行时也只跳过） */ }
  }
  if (lastUser === -1) return null;
  let turnId = `jsonl-${lastUser + 1}`;   // 尾读没有生成时 id：以"该 user 条目所在行号"为准（可回查文件）
  for (let i = lastUser + 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    try {
      const entry = JSON.parse(line) as { type?: string; message?: { role?: string; stopReason?: string } };
      if (entry.type !== "message") continue;          // custom/model_change 等不作为收尾信号
      if (entry.message?.role === "assistant") return { turnId, state: "done" };
    } catch { /* skip */ }
  }
  return { turnId, state: "lost" };
}

/** 对账入口：文件不存在/空 → null；能读就三分支判定。 */
export async function readTurnVerdict(path: string): Promise<TurnVerdict> {
  return await lastUserTurnVerdict(path);
}
