/**
 * 工作台数据装载（Task 0023 · S1）。
 *
 * 四个列表各一份状态（tasks / projects / days / feed），各自的**就绪与失败分开记**
 * ——规范 2.32 的"慢的对象不许被快的那个代言"：四个请求快慢不一，
 * 一个全局 loading 布尔会让先到的列表被后到的卡成骨架。
 *
 * - **内容优先**：失败不清已到的数据（刷新失败时保留旧内容，`listSurfaceOf` 只在
 *   "没内容且没就绪"时才画骨架）——`count>0 → ready`，failure 只影响空态时的呈现。
 * - **失败必留痕**（frontend 2.33）：每次失败一条 `logger.warn("load", …)`，带 kind/status/ms。
 * - days 按**月份**装载与作废（切月重取；用 monthKey 防过期回写，frontend 2.12 同思路）。
 * - tasks/projects/feed 装载一次（表面每次打开重新挂载 = 天然重新装载，取的就是当时的最新事实）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { failureLogOf, type LoadFailure } from "../api/fetch-timeout";
import { logger } from "../api/logger";
import {
  fetchDays, fetchFeed, fetchGlobalProjects, fetchGlobalTasks, monthRangeOf,
  type Day, type FeedItem, type GlobalProject, type GlobalTask,
} from "../api/workbench";

/** 单个列表的装载状态：ready=服务端已确认；failure 只在 count=0 时影响表面。 */
type ListState<T> = { ready: boolean; value?: T; failure?: LoadFailure };

const initial = <T,>(): ListState<T> => ({ ready: false });

export type WorkbenchMonth = { year: number; month: number };

export function useWorkbench(month: WorkbenchMonth) {
  const [tasks, setTasks] = useState<ListState<GlobalTask[]>>(initial);
  const [projects, setProjects] = useState<ListState<GlobalProject[]>>(initial);
  const [days, setDays] = useState<ListState<Day[]>>(initial);
  const [feed, setFeed] = useState<ListState<FeedItem[]>>(initial);

  const loadTasks = useCallback(async () => {
    const result = await fetchGlobalTasks();
    if (result.ok) setTasks({ ready: true, value: result.value });
    else {
      setTasks((prev) => ({ ready: prev.ready, ...(prev.value !== undefined ? { value: prev.value } : {}), failure: result.failure }));
      logger.warn("load", `工作台任务列表加载失败：${result.failure.label}`, failureLogOf(result.failure));
    }
  }, []);

  const loadProjects = useCallback(async () => {
    const result = await fetchGlobalProjects();
    if (result.ok) setProjects({ ready: true, value: result.value });
    else {
      setProjects((prev) => ({ ready: prev.ready, ...(prev.value !== undefined ? { value: prev.value } : {}), failure: result.failure }));
      logger.warn("load", `工作台项目列表加载失败：${result.failure.label}`, failureLogOf(result.failure));
    }
  }, []);

  const loadFeed = useCallback(async () => {
    const result = await fetchFeed(monthRangeOf(month.year, month.month));
    if (result.ok) setFeed({ ready: true, value: result.value });
    else {
      setFeed((prev) => ({ ready: prev.ready, ...(prev.value !== undefined ? { value: prev.value } : {}), failure: result.failure }));
      logger.warn("load", `工作台内容流加载失败：${result.failure.label}`, failureLogOf(result.failure));
    }
  }, [month.year, month.month]);

  /** days：按月装载。monthKey 变化时旧响应作废（2.12 的作用域守卫：过期不回写）。 */
  const monthKey = `${month.year}-${month.month}`;
  const monthKeyRef = useRef(monthKey);
  monthKeyRef.current = monthKey;
  const loadDays = useCallback(async () => {
    const key = monthKeyRef.current;
    const range = monthRangeOf(month.year, month.month);
    const result = await fetchDays(range);
    if (monthKeyRef.current !== key) return;   // 已切月：丢弃旧响应
    if (result.ok) setDays({ ready: true, value: result.value });
    else {
      setDays((prev) => ({ ready: prev.ready, ...(prev.value !== undefined ? { value: prev.value } : {}), failure: result.failure }));
      logger.warn("load", `工作台日期索引加载失败：${result.failure.label}`, failureLogOf(result.failure));
    }
  }, [month.year, month.month]);

  // 装载一次（挂载即取；月变化由下面的 effect 管 days）
  useEffect(() => { void loadTasks(); }, [loadTasks]);
  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { void loadFeed(); }, [loadFeed]);
  useEffect(() => { void loadDays(); }, [loadDays]);

  return {
    tasks, projects, days, feed,
    reloadTasks: loadTasks, reloadProjects: loadProjects, reloadDays: loadDays, reloadFeed: loadFeed,
  };
}
