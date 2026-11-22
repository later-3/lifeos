/**
 * 工作台数据层（Task 0023 · S1）——**页面组件只消费这里的函数与类型**。
 *
 * 形状来源：`0003/phases/S1-contract.md`（**冻结**）。coder 交付的三个只读接口（`/api/tasks` /
 * `/api/projects` / `/api/days`）照契约形状写；内容流（feed）S1 无接口，走桩。
 *
 * 桩纪律（S1 任务书 §3）：
 * - 假数据**只允许**住在 `workbench-fixtures.ts`；
 * - 桩函数体只从 fixtures 取数（剩余假数据量的度量见 workbench-fixtures.ts 头注释；S4 归零）;
 * - **桩函数签名 = 未来真函数签名**（含 `LoadResult` 四结局）——接真数据时只改函数体，页面零改动。
 *
 * 可见性（归档 Agent / hidden 项目）由后端统一判（S1-contract §6-R2）；前端不重复过滤（api 2.7）。
 */
import type { LoadResult } from "./fetch-timeout";
import type { RowAvatar } from "../../../src/session-rows.ts";
import { fetchJsonWithTimeout } from "./fetch-timeout";

/* ══════════════════ 契约形状（照 S1-contract 抄，不改一字）══════════════════ */

/** 全局任务（S1-contract §1）：TaskSummary + 三个字段。 */
export type GlobalTask = {
  id: string;
  dirName: string;
  number: number;
  title: string;
  type: string;
  category: string;
  status: string;           // 原文（41 种可能；「其他」列才显示）
  goal: string;
  path: string;
  docPath: string;
  date?: string;
  isDefault?: boolean;
  participants?: string[];
  docs?: string[];
  /** 归属（跨 Agent 列表必须带，否则前端无法按项目分组） */
  agentId: string;
  projectId: string;
  /** 归一状态：后端纯函数的唯一产物；前端不再写第二份（S1-contract §0-2）。 */
  state: "进行中" | "已完成" | "已移交" | "其他";
};

/** 全局项目（S1-contract §2）：ProjectItem + agentIds。 */
export type GlobalProject = {
  id: string;
  name: string;
  path?: string;
  icon?: string;
  /** 绑定这个项目的 Agent（前端做头像堆叠与「N 位助手」）。 */
  agentIds: string[];
};

/** 日期索引条目（S1-contract §3）。S1 里 documents/todos 恒为空数组（不是省略字段）。 */
export type Day = {
  date: string;
  documents: unknown[];
  todos: unknown[];
  activity: ActivityRef[];
};

export type ActivityRef =
  | { kind: "session"; agentId: string; projectId: string; sessionId: string; title: string; at: string }
  | { kind: "log"; agentId: string; projectId: string; taskId: string; taskTitle: string; heading: string; at: string };

/** 内容流条目（S2 才有真接口；S1 走桩，形状现在定死）。 */
export type FeedItem = {
  id: string;
  day: string;
  author: { kind: "user" | "agent"; id: string; name: string; avatar?: RowAvatar };
  title?: string;
  text: string;
  tags: string[];
  media?: { kind: "image" | "video"; url: string; caption?: string; w?: number; h?: number }[];
  projectId?: string;
  task?: { id: string; title: string };
  likes: number;
  comments: number;
  mine: boolean;
  /** 8 种卡型（0009 契约）。**必须能处理缺失**：缺失时 fallback 纯文本卡（architect S1 回应③）。 */
  kind?: "dev" | "demo" | "knowledge" | "case" | "review" | "mood" | "study" | "media";
};

/* ══════════════════ 内部小工具 ══════════════════ */

/** 从 `{items:[…]}` 包裹里取数组；形状不对给可行动的失败（api 2.1）。 */
function itemsOf<T>(data: unknown, label: string): T[] {
  if (data !== null && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  throw new Error(`${label} 响应缺少 items 数组`);
}

/* ══════════════════ 真接口（coder 已交付，等合并 main 后生效）══════════════════ */

const TIMEOUT_MS = 15_000;

/** 全局任务（跨 Agent × Project，136+ 条含 daily；排除 daily 是呈现层的决定，见 S1-contract §1）。 */
export async function fetchGlobalTasks(): Promise<LoadResult<GlobalTask[]>> {
  const r = await fetchJsonWithTimeout<{ items: GlobalTask[] }>("/api/tasks", TIMEOUT_MS, "工作台任务列表");
  if (!r.ok) return r;
  try {
    return { ok: true, value: itemsOf<GlobalTask>(r.value, "/api/tasks") };
  } catch (cause) {
    return { ok: false, failure: { kind: "http", status: 200, label: "工作台任务列表", ms: 0, detail: String(cause) } };
  }
}

/** 全局项目（跨 Agent 合并；agentIds 用于头像堆叠）。 */
export async function fetchGlobalProjects(): Promise<LoadResult<GlobalProject[]>> {
  const r = await fetchJsonWithTimeout<{ items: GlobalProject[] }>("/api/projects", TIMEOUT_MS, "工作台项目列表");
  if (!r.ok) return r;
  try {
    return { ok: true, value: itemsOf<GlobalProject>(r.value, "/api/projects") };
  } catch (cause) {
    return { ok: false, failure: { kind: "http", status: 200, label: "工作台项目列表", ms: 0, detail: String(cause) } };
  }
}

/** 日期索引（稀疏：只含有事的日子）。S1 只消费 activity 的长度与内容。 */
export async function fetchDays(range: { from: string; to: string }): Promise<LoadResult<Day[]>> {
  const q = new URLSearchParams({ from: range.from, to: range.to });
  const r = await fetchJsonWithTimeout<{ items: Day[] }>(`/api/days?${q}`, TIMEOUT_MS, "工作台日期索引");
  if (!r.ok) return r;
  try {
    return { ok: true, value: itemsOf<Day>(r.value, "/api/days") };
  } catch (cause) {
    return { ok: false, failure: { kind: "http", status: 200, label: "工作台日期索引", ms: 0, detail: String(cause) } };
  }
}

/* ══════════════════ 桩（S1 唯一的假数据）══════════════════ */

/**
 * 内容流（S1 桩）。
 *
 * 桩：等 GET /api/feed（S2）；替换时只改本函数体（签名不变）。桩数据在 workbench-fixtures.ts。
 * 桩条目在界面上显式标「示例」（fixtures 里的 `_stub: true` 标记 → 渲染层出徽标）。
 */
export async function fetchFeed(range: { from: string; to: string }): Promise<LoadResult<FeedItem[]>> {
  const { STUB_FEED } = await import("./workbench-fixtures");
  void range; // S2 才按日期过滤
  return { ok: true, value: STUB_FEED };
}
