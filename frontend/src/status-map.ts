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
  /**
   * 服务端已算好的聚合（Task 0005 · P8-3）：`[{agentId, projectId?, running, unread, failure}]`。
   *
   * 它覆盖**所有** Agent，是助手列能显示数字的来源；`sessions` 只覆盖"当前打开的 Agent"，
   * 用于把数字进一步细到会话级（例如焦点会话不算未读）。
   *
   * 为什么允许服务端直接给数（而不是坚持"前端数四态"）：四态优先级只能在
   * `rowActivityOf()` 一处实现，前端若要自己数就得把 `running > failure > unread` 重写一遍
   * —— C163 那个反例。服务端调同一个函数算完再发数，是唯一一处实现。
   * 本模块只做**减法**（把焦点会话的未读扣掉），不重做四态判定。
   */
  aggregate?: Array<{ agentId: string; projectId?: string | undefined; running: number; unreadDone: number; unreadError: number }>;
};

/**
 * 前端此刻停在哪。
 *
 * `visible` **保留**（它决定要不要把 token 细节推到这个连接），但**不参与"是否已读"的判定**：
 * 「停在哪个会话」= 看过（用户 2026-11-08 裁决）。见 `src/events.ts` 的 `isOnSession()`。
 */
export type StatusFocus = { agentId?: string | undefined; sessionId?: string | undefined; visible: boolean };

/**
 * 一个层（项目 / 助手）的状态：三个数量。
 *
 * 零值不渲染（照 pi-web `SessionSidebar.tsx:2009`：`running === 0 && unread === 0` → `null`）。
 */
/**
 * 一个层（项目 / 助手）的三个计数 —— **不看已读**。
 *
 * 用户裁决（2026-11-04）：三个徽标 = 正在跑（呼吸绿）/ 已正常结束（固定绿）/ 异常结束（固定红）。
 *
 * 为什么没有 `unread`：徽标回答「发生过什么」，不回答「我看没看」。
 * 早期把"完成"做成 `unread`，用户点开一个完成的会话后数字就从 6 掉到 5 ——
 * 历史事实不该因为读过了而消失。而"失败"一直没看已读，两者不对称更难解释。
 * 「有未读」这个信号由**会话行的绿点**表达（那里才需要已读语义）。
 */
export type Status = {
  /** 正在跑（呼吸数字）。 */
  running: number;
  /** 正常结束**且还没看过**的会话数（固定绿底数字）。 */
  unreadDone: number;
  /** 异常结束**且还没看过**的会话数（固定红底数字）。 */
  unreadError: number;
};

export type DerivedStatus = {
  sessions: Record<string, { running: boolean; unread: boolean; failure: boolean }>;
  /** 键 = projectKey(agentId, projectId) */
  projects: Record<string, Status>;
  agents: Record<string, Status>;
};

export const projectKey = (agentId: string, projectId: string): string => `${agentId}\u0000${projectId}`;

export function deriveStatus(facts: StatusFacts, focus: StatusFocus): DerivedStatus {
  const sessions: DerivedStatus["sessions"] = {};
  const projects: Record<string, Status> = {};
  const agents: Record<string, Status> = {};

  const empty = (): Status => ({ running: 0, unreadDone: 0, unreadError: 0 });
  const bucketOf = (bucket: Record<string, Status>, key: string): Status => {
    const entry = bucket[key] ?? empty();
    bucket[key] = entry;
    return entry;
  };

  /**
   * 第一层：**服务端聚合**（覆盖所有 Agent）。
   *
   * 这是助手列能显示数字的唯一来源 —— 前端只持有"当前打开 Agent"的会话，
   * 别的 Agent 一条都不在手上。
   */
  for (const entry of facts.aggregate ?? []) {
    const agentStatus = bucketOf(agents, entry.agentId);
    agentStatus.running += entry.running;
    agentStatus.unreadDone += entry.unreadDone;
    agentStatus.unreadError += entry.unreadError;
    if (entry.projectId !== undefined) {
      const projectStatus = bucketOf(projects, projectKey(entry.agentId, entry.projectId));
      projectStatus.running += entry.running;
      projectStatus.unreadDone += entry.unreadDone;
      projectStatus.unreadError += entry.unreadError;
    }
  }

  /**
   * 第二层：**当前打开的 Agent 的会话行** —— 只用来把"正在跑"改成实时值。
   *
   * 为什么只改 running：跑/不跑是**此刻**的事实，SSE 的 row 补丁比快照即时；
   * 而 completed/failed 是**历史终态**，快照里的索引值就是准的，用行去覆盖反而会漏
   * （前端手上只有当前项目的会话，别的项目一条都没有 —— 覆盖式实现实测会让 6 变 1）。
   */
  for (const [sessionId, row] of Object.entries(facts.sessions)) {
    if (row === undefined) continue;
    const { meta, activity } = row;
    // **不看 visible**：停在这个会话上就不算未读（否则切标签页会让行上的绿点"复活"）
    const watching = focus.sessionId === sessionId && focus.agentId === meta.agentId;
    sessions[sessionId] = {
      running: activity.state === "running",
      unread: activity.state === "unread" && !watching,
      failure: activity.state === "failure",
    };
  }

  // 注意：**不再用会话行去"替换"聚合的 running**（2026-11-04 删）。
  // 状态机模型下，`running` 的真相在 `sessionSlots`（补丁直接改它，且覆盖所有 Agent）；
  // 而会话行的 `activity.state` 只在"当前 Agent 的行"上更新，用它去覆盖聚合会：
  //   ① 把别的 Agent 的运行数抹成 0；
  //   ② 行上的 state 滞后于补丁时，数字会停在旧值（实测：结束后仍显示 running=1）。
  // 现在聚合只来自 `aggregate`（由 sessionSlots 数出来），会话行只负责"这一行显示什么点"。
  return { sessions, projects, agents };
}
