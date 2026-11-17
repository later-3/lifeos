/**
 * 工作区（Task 0017 · P5 领域 hook #5；Task 0019 增补就绪三态）。
 *
 * ## 这个 hook 管什么
 *
 * **"我在哪、有哪些东西"**：助手列表、当前助手、用户档案、项目分组、选中项目、
 * 分组折叠、以及**两列列表各自"就绪了没有"**。它不关心"某一轮跑到哪了"
 * （那是 `useSessionLifecycle` / `useTurnRuntime`）。
 *
 * ## 纪律（搬自 App.tsx，逐条保留）
 *
 * - **缓存优先**：`agents` 与 `groups` 先读 localStorage 立即渲染（零白闪），接口回来再覆盖。
 * - **空数组不覆盖缓存**：`fetched.length === 0 && cached !== undefined` 时保留缓存 ——
 *   否则"后端挂了"会显示成"项目全没了"（比错误提示更吓人）。
 * - **折叠只存"收起的"那几个**（默认全展开）：项目通常 3–5 个，全展开是常态。
 *
 * ## 就绪标志为什么是两个（Task 0019）
 *
 * 改前只有一个 `loaded`，它同时承担两件事：① "有缓存可画"（初值 = 缓存是否存在）
 * ② "服务端已确认"。两者混在一个 boolean 里，渲染层就只能写
 * `!loaded && <骨架/>` + `rows.map(...)` 两条**独立**分支 —— 于是出现了用户截图那一帧：
 * **12 条骨架与 14 个真实助手行同框**。
 *
 * 拆成 `agentsReady` / `groupsReady` 之后，语义只剩"服务端已确认"，而"能不能画"
 * 由 `listSurfaceOf({ ready, count })` 判（内容优先）。两列分别就绪：会话列要等
 * `/projects` + 每个项目的 `/sessions` 都回来，比助手列慢，共用一个标志会让先到的一列被迫等。
 *
 * `resolving` 是第三件事：**有未完成的会话解析**（首屏恢复 / 切助手）。它期间
 * `agent`/`selectedProjectId`/`sessionId` 都还没定，任何"没有会话 → 草稿态"的结论都是猜的。
 */
import { useEffect, useState } from "react";

import { readCollapsedGroups, writeCollapsedGroups } from "../api/layout-storage";
import type { Agent, Group, UserProfile } from "./types";

export type { Agent, Group, UserProfile };

export function useWorkspace() {
  const [agents, setAgents] = useState<Agent[]>(() => {
    // 缓存优先：上次的数据立即渲染（对标 Notion/Linear 的刷新体验——零白闪）
    try { const cached = localStorage.getItem("lifeos.agents"); return cached ? JSON.parse(cached) : []; }
    catch { return []; }
  });
  const [agent, setAgent] = useState<Agent>();
  /** 用户档案（= 你本人，不是 Agent）：名字与头像从 /api/profile 来，缺失时不显示头像。 */
  const [profile, setProfile] = useState<UserProfile | undefined>();
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  /**
   * 分组折叠（Task 0015 · T15）：`{ [projectId]: true }` = 该组收起，**按项目 id 持久化**。
   * 只存**收起的**那几个（默认全展开）：项目通常 3–5 个，全展开是常态。
   */
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(readCollapsedGroups);
  useEffect(() => { writeCollapsedGroups(collapsedGroups); }, [collapsedGroups]);
  /** 助手列：`/api/agents` 已回来（成功，或失败但有缓存）。 */
  const [agentsReady, setAgentsReady] = useState(false);
  /** 会话列：当前 Agent 的 `/projects` + `/sessions` 已回来。 */
  const [groupsReady, setGroupsReady] = useState(false);
  /**
   * 有未完成的**会话解析**：首屏恢复（URL 三键 / 上次会话）或切助手。
   * 此期间不写任何"草稿 / 空"结论 —— 那两件事都会在几百毫秒内把结论推翻（Task 0019）。
   * 初值 true：首屏挂载时一定是"还没解析完"。
   */
  const [resolving, setResolving] = useState(true);

  return {
    agents, setAgents,
    agent, setAgent,
    profile, setProfile,
    groups, setGroups,
    selectedProjectId, setSelectedProjectId,
    collapsedGroups, setCollapsedGroups,
    agentsReady, setAgentsReady,
    groupsReady, setGroupsReady,
    resolving, setResolving,
  };
}
