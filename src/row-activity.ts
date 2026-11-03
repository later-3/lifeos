// 会话行的**四态判定**：纯函数，无任何 IO 与 node 内置模块依赖。
//
// 为什么单独一个文件（而不是放在 `session-rows.ts`）：
// 前端要实时更新（SSE 事件驱动），不可能每次事件都回后端取一趟；但"四态互斥 + 优先级"
// **只能有一份实现**，否则后端行对象与前端实时更新会说两套话。
// 所以这个文件由**前后端共用**——因此它必须零依赖（不能 import node:fs 之类，
// 否则会被打进前端 bundle）。前端已有先例：`frontend/src/App.tsx` 直接 import `src/session-title.ts`。
//
// 优先级（任务 0005 · 用户 2026-11-03 拍板）：
//   running > failure > unread > idle
// 在跑的会话先报"在跑"；失败比未读更需要处理。
import { shortTitleOf } from "./session-title.ts";
//
// 优先级（任务 0005 · 用户 2026-11-03 拍板）：
//   running > failure > unread > idle
// 在跑的会话先报"在跑"；失败比未读更需要处理。

export type RowPhase = "waiting" | "thinking" | "tool" | "text";

export type RowFailureKind =
  | "aborted" | "truncated" | "empty" | "timeout" | "network" | "auth" | "rate_limit" | "server"
  | "payload_too_large" | "unknown";

export type RowActivity = {
  /** 四态互斥，优先级 `running > failure > unread > idle`（只在 `rowActivityOf()` 一处）。 */
  state: "running" | "unread" | "failure" | "idle";
  running?: { since: string; elapsedMs: number; phase?: RowPhase; tool?: string };
  unread?: { since: string };
  failure?: { kind: RowFailureKind; detail: string; at?: string };
};

/** `rowActivityOf()` 的输入：全部可选，缺失即"没有这一项事实"。 */
export type ActivityInput = {
  runningSince?: string;
  phase?: RowPhase;
  tool?: string;
  unreadSince?: string;
  failure?: { kind: RowFailureKind; detail: string; at?: string };
  now: number;
};

export function rowActivityOf(input: ActivityInput): RowActivity {
  if (input.runningSince !== undefined && input.runningSince !== "") {
    const since = Date.parse(input.runningSince);
    const elapsedMs = Number.isNaN(since) ? 0 : Math.max(0, input.now - since);
    return {
      state: "running",
      running: {
        since: input.runningSince,
        elapsedMs,
        ...(input.phase !== undefined ? { phase: input.phase } : {}),
        ...(input.tool !== undefined ? { tool: input.tool } : {}),
      },
    };
  }
  if (input.failure !== undefined) return { state: "failure", failure: input.failure };
  if (input.unreadSince !== undefined && input.unreadSince !== "") return { state: "unread", unread: { since: input.unreadSince } };
  return { state: "idle" };
}

/**
 * 显示用标题：**规则本身在 `src/session-title.ts`**，这里不重写一份。
 * 先去掉没有区分度的引导语（`shortTitleOf`），再按显示宽度限长。
 *
 * 为什么不在后端另写规则：现状前端 `App.tsx:1663` 自己 `shortTitleOf(title).slice(0,50)`，
 * 后端给 60 字原句 —— 同一条会话在列表与头部可能显示成两个不同的名字（01 §3 第 5 条）。
 * 现在两端都调这一个函数。
 */
export const DISPLAY_TITLE_MAX_CHARS = 50;

export function displayTitleOf(raw: string): string {
  const shortened = shortTitleOf(raw);
  return shortened.length > DISPLAY_TITLE_MAX_CHARS ? shortened.slice(0, DISPLAY_TITLE_MAX_CHARS) : shortened;
}
