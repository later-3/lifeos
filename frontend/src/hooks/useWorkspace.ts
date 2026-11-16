/**
 * 工作区（Task 0017 · P5 领域 hook #5）。
 *
 * ## 这个 hook 管什么
 *
 * **"我在哪、有哪些东西"**：助手列表、当前助手、用户档案、项目分组、选中项目、
 * 分组折叠、列表是否已加载。它不关心"某一轮跑到哪了"（那是 `useSessionLifecycle` / `useTurnRuntime`）。
 *
 * ## 纪律（搬自 App.tsx，逐条保留）
 *
 * - **缓存优先**：`agents` 与 `groups` 先读 localStorage 立即渲染（零白闪），接口回来再覆盖。
 * - **空数组不覆盖缓存**：`fetched.length === 0 && cached !== undefined` 时保留缓存 ——
 *   否则"后端挂了"会显示成"项目全没了"（比错误提示更吓人）。
 * - **折叠只存"收起的"那几个**（默认全展开）：项目通常 3–5 个，全展开是常态。
 * - `loaded` 的初值看有没有 agents 缓存（没缓存就显示骨架，而不是空态）。
 */
import { useEffect, useState } from "react";

import { readCollapsedGroups, writeCollapsedGroups } from "../layout-storage";
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
   * 只存**收起的**那几个（默认全展开）——项目通常 3–5 个，全展开是常态。
   */
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(readCollapsedGroups);
  useEffect(() => { writeCollapsedGroups(collapsedGroups); }, [collapsedGroups]);
  const [loaded, setLoaded] = useState(() => {
    try { return localStorage.getItem("lifeos.agents") !== null; } catch { return false; }
  });

  return {
    agents, setAgents,
    agent, setAgent,
    profile, setProfile,
    groups, setGroups,
    selectedProjectId, setSelectedProjectId,
    collapsedGroups, setCollapsedGroups,
    loaded, setLoaded,
  };
}
