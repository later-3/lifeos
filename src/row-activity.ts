// 会话行的**四态判定**：纯函数，无任何 IO 与 node 内置模块依赖。
//
// 为什么单独一个文件（而不是放在 `session-rows.ts`）：
// 前端要实时更新（SSE 事件驱动），不可能每次事件都回后端取一趟；但"四态互斥 + 优先级"
// **只能有一份实现**，否则后端行对象与前端实时更新会说两套话。
// 所以这个文件由**前后端共用**——因此它必须零依赖（不能 import node:fs 之类，
// 否则会被打进前端 bundle）。前端已有先例：`frontend/src/App.tsx` 直接 import `src/session-title.ts`。
//
// 优先级（任务 0005；2026-11-04 用户重定）：
//   running > failure > unread > idle
// 在跑的会话先报"在跑"；失败比未读更需要处理。
//
// **失败也看已读**（2026-11-04 用户裁决）：一次回合结束 = 一条未读，
// 未读只有两种 —— 正常结束（绿点）与异常结束（红点），两者都是**看过就消失**。
// 所以 `failure` 与 `unread` 共用同一个"已读窗口"：`unreadSince` 为空（= 已看过）时，
// 失败不再显示。不持久记录：看过后就是没有了，不会因为刷新页面又冒出来。
import { shortTitleOf } from "./session-title.ts";
import type { FailureKind } from "./failure.ts";
//
// 优先级（任务 0005；2026-11-04 用户重定）：
//   running > failure > unread > idle
// 在跑的会话先报"在跑"；失败比未读更需要处理。
//
// **失败也看已读**（2026-11-04 用户裁决）：一次回合结束 = 一条未读，
// 未读只有两种 —— 正常结束（绿点）与异常结束（红点），两者都是**看过就消失**。
// 所以 `failure` 与 `unread` 共用同一个"已读窗口"：`unreadSince` 为空（= 已看过）时，
// 失败不再显示。不持久记录：看过后就是没有了，不会因为刷新页面又冒出来。

export type RowPhase = "waiting" | "thinking" | "tool" | "text";

/**
 * 失败种类**不另抄一份**，直接用 `src/failure.ts` 的 `FailureKind`。
 *
 * 为什么（2026-11-03 合并时实测到）：这里原本手抄了一份 10 个值的联合类型，
 * 而 main 上 Task 0007/0017 给 `FAILURE_KINDS` 加了 `quota` 与 `model_not_configured` →
 * 两份定义漂移，`typecheck` 直接报 TS2379（赋值不兼容）。
 * 手抄类型的代价不是"多写几行"，而是**它不会跟着源头变**。
 *
 * `failure.ts` 零 node 依赖（实测 `grep -c "node:" = 0`），所以前后端共用安全，
 * 与本文件已有的 `session-title.ts` 同一机制。
 */
export type RowFailureKind = FailureKind;

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
  // "这次结束还没被看过" —— 失败与正常完成共用这个窗口（用户 2026-11-04 裁决）。
  const unseen = input.unreadSince !== undefined && input.unreadSince !== "";
  // 失败也看已读：看过了就不再显示红点（与绿点同一规则，不持久记录）
  if (input.failure !== undefined && unseen) return { state: "failure", failure: input.failure };
  if (unseen) return { state: "unread", unread: { since: input.unreadSince! } };
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
