// 状态映射：会话 → 项目 → 助手 的数量聚合。
//
// ## 这个文件为什么重写（Task 0005）
//
// 改之前：`Status = { running: boolean; unread: number }`，数据来自 `run-facts`（SSE 实时事实）。
// 于是同一个"会话处于什么状态"有**三份表达**：
//   ① 后端 SessionRow.activity.state（四态互斥，`src/row-activity.ts`，前后端共用）
//   ② frontend/run-facts.ts（SSE 事件自己算一套 running/unread）
//   ③ frontend/status-map.ts（又把 ② 聚合成 boolean + number）
// 三份必然有一天对不上 —— 这正是本任务要消灭的问题。
//
// 改之后：**只认 ①**。聚合 = "数一下每种状态各有几个会话"。
//
// ## 参考实现（逐条核实，见 06-references.md §4）
//
// - pi-web `lib/project-groups.ts:41-59`：`Map<key, {running: number, unread: number}>`，
//   逐会话 `if (runningSessionIds.has(id)) entry.running++` —— **数量聚合，与本次目标同构**。
// - Mattermost `server/public/model/channel_member.go:31-40` + `selectors/entities/channels.ts:386`：
//   未读的**权威在服务端**（`ChannelUnread.msg_count`），前端只做减法。
//   → 我们的 `activity.unread` 来自服务端 `session-views.json`，方向一致。
// - Zulip `docs/subsystems/unread_messages.md:3-9`：原文说明"前端数未读要下载无限消息，不可行"，
//   所以服务端下发未读事实。同理我们不让前端自己数。
// - Rocket.Chat `IRoom.unread?: number` + `RoomListItem.stories.tsx:55`：徽标 `role="status"`
//   + `aria-label="3 unread messages"`（门禁按 aria 断言比按 class 稳）。
//
// **failure 维度是自研**：pi-web / Mattermost / Rocket.Chat 的聚合层都没有"错误数"，
// 全仓 grep `failureCount|errorCount|failedCount` 零命中。语义由我们自己定义（见下）。

import type { RowActivity } from "../../src/row-activity.ts";

export type StatusMeta = { agentId: string; projectId?: string | undefined };

/**
 * 聚合的输入：**只吃会话的四态**（`activity.state`）。
 *
 * 为什么不再传 `running: string[]` / `unread: string[]` 两个 Set（pi-web 的做法）：
 * 那样调用方要先自己把 activity 拆成两个集合，等于在聚合之外又理解了一遍四态。
 * 直接吃四态，聚合就退化成"数数"——零决策，不可能和行上的点不一致。
 *
 * ## 为什么输入是"全部 Agent 的会话"而不是"当前 Agent 的会话"（2026-11-04 修）
 *
 * 左侧助手列要给**每个** Agent 显示数字。此前调用方只喂了当前选中 Agent 的 `groups`，
 * 于是没点进去的 Agent 永远没有数字 —— 实际现象是"切到哪个 Agent 才有数字"，
 * 助手列失去"一眼看出谁有动静"的用途。
 * 现在调用方把三个来源合起来喂（见 App 里的 `statusFacts`）：
 *   ① 当前 Agent 的会话列表（有完整 activity）
 *   ② SSE 快照的跨 Agent `running` / `unread`（服务端全量事实）
 *   ③ SSE `error` 事件（跨 Agent 的失败，事件里带 projectId）
 * 聚合本身不关心来源，只数四态 —— 所以它不需要改，改的是"喂什么"。
 */
export type StatusFacts = {
  /** 全部 Agent 的会话：归属 + 该会话当前的四态。缺归属的会话不参与聚合（不臆造项目）。 */
  sessions: Record<string, { meta: StatusMeta; activity: RowActivity } | undefined>;
};

export type StatusFocus = { agentId?: string | undefined; sessionId?: string | undefined; visible: boolean };

/**
 * 一个层（项目 / 助手）的状态：三个数量。
 *
 * 零值不渲染（照 pi-web `SessionSidebar.tsx:2009`：`running === 0 && unread === 0` → `null`）。
 */
export type Status = {
  /** 正在工作的会话数（呼吸数字）。 */
  running: number;
  /** 已完成待查看的会话数（固定绿底数字）。 */
  unread: number;
  /** 失败的会话数（固定红底数字）。 */
  failure: number;
};

export type DerivedStatus = {
  sessions: Record<string, { running: boolean; unread: boolean; failure: boolean }>;
  /** 键 = projectKey(agentId, projectId) */
  projects: Record<string, Status>;
  agents: Record<string, Status>;
};

export const projectKey = (agentId: string, projectId: string): string => `${agentId}\u0000${projectId}`;

const emptyStatus = (): Status => ({ running: 0, unread: 0, failure: 0 });

export function deriveStatus(facts: StatusFacts, focus: StatusFocus): DerivedStatus {
  const sessions: DerivedStatus["sessions"] = {};
  const projects: Record<string, Status> = {};
  const agents: Record<string, Status> = {};

  const bump = (bucket: Record<string, Status>, key: string, state: RowActivity["state"], watching: boolean): void => {
    const entry = bucket[key] ?? emptyStatus();
    if (state === "running") entry.running += 1;
    // 正在看的会话不算未读：用户已经看到它了（与服务端 focus 上报、前端 markViewed 同一语义）
    else if (state === "unread" && !watching) entry.unread += 1;
    else if (state === "failure") entry.failure += 1;
    bucket[key] = entry;
  };

  for (const [sessionId, row] of Object.entries(facts.sessions)) {
    if (row === undefined) continue;
    const { meta, activity } = row;
    const watching = focus.visible && focus.sessionId === sessionId && focus.agentId === meta.agentId;
    const state = activity.state;
    sessions[sessionId] = {
      running: state === "running",
      unread: state === "unread" && !watching,
      failure: state === "failure",
    };
    // 助手层**累加会话数**（用户 2026-11-03 裁决）：旧实现是"有未读的项目个数"，
    // 两层单位不同会让"助手显示 1、点进去看到 6 个未读"这种没法解释的现象。
    bump(agents, meta.agentId, state, watching);
    if (meta.projectId !== undefined) bump(projects, projectKey(meta.agentId, meta.projectId), state, watching);
  }
  return { sessions, projects, agents };
}
