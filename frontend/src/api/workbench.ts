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
// .ts 后缀：本模块会被 test/*.test.mjs 直接 import（node ESM 不解析无后缀相对路径）
import { fetchJsonWithTimeout } from "./fetch-timeout.ts";

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
 * 桩数据与桩标记都住在 workbench-fixtures.ts（那是 grep 度量的唯一居所，
 * 见该文件头注释与 S1-W1 测试）；本函数体只从 fixtures 取数。
 * 等真接口 GET /api/feed（S2）落地时，只改本函数体，签名与页面零改动。
 * 桩条目带 `_stub: true` → 渲染层据此显式出「示例」徽标，不许看起来像真数据。
 */
export async function fetchFeed(range: { from: string; to: string }): Promise<LoadResult<FeedItem[]>> {
  const { STUB_FEED } = await import("./workbench-fixtures.ts");
  void range; // S2 才按日期过滤
  return { ok: true, value: STUB_FEED };
}

/* ══════════════════ 纯函数（可穷举；页面不写条件）══════════════════ */

/**
 * 本地日期 YYYY-MM-DD。**口径与后端同一条**（`src/tasks.ts:123` 的 localDate：本地时区切日，
 * 不用 UTC）——月历/今日高亮都是“用户看到的那一天”，两边必须同一把尺。
 */
export function todayLocal(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** 某月的 [from,to]（含两端；喂给 GET /api/days）。月的第一天/最后一天都是本地日期。 */
export function monthRangeOf(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const last = new Date(year, month + 1, 0).getDate();
  const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

/** 热力档（Memos 的相对阈值，`ActivityCalendar/utils.ts:14-22`）：count/max 的四档，0 = 无内容。 */
export function dayLevelOf(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

/** 月历的一个格子。date=null = 前后月补位（不渲染数字）。 */
export type CalendarCell = {
  date: string | null;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  isToday: boolean;
};

/**
 * 月历网格（7 列 × 6 行 = 42 格，周一开头；demo 与 Memos 同构）。
 *
 * 归日**只用 Day.date**（后端已按本地日期归好）——不从 `at` 反推日期（契约 R1：
 * log 的 at 是本地零点的 UTC，会落在 UTC 日历前一天，slice(0,10) 整体错一天）。
 */
export function calendarCellsOf(year: number, month: number, days: Day[], today: string): CalendarCell[] {
  const countByDate = new Map<string, number>();
  for (const day of days) countByDate.set(day.date, day.activity.length);
  const max = Math.max(0, ...countByDate.values());
  const first = new Date(year, month, 1);
  // 周一开头（demo 与 Memos 同构）：getDay() 周日=0 → +6 后周—=0
  const lead = (first.getDay() + 6) % 7;
  const cells: CalendarCell[] = [];
  for (let i = 0; i < lead; i += 1) cells.push({ date: null, count: 0, level: 0, isToday: false });
  const last = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= last; d += 1) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const count = countByDate.get(date) ?? 0;
    cells.push({ date, count, level: dayLevelOf(count, max), isToday: date === today });
  }
  // 补齐整行：需要 5 行就 5 行，需要 6 行就 6 行（天数说了算，不硬凑 42）
  const rows = Math.ceil((lead + last) / 7);
  while (cells.length < rows * 7) cells.push({ date: null, count: 0, level: 0, isToday: false });
  return cells;
}

/** feed 按天分组（降序：最新的一天在最上）。day 就是条目自己的 day 字段（桩/真接口同形）。 */
export function groupFeedByDay(feed: FeedItem[]): Array<{ day: string; items: FeedItem[] }> {
  const groups: Array<{ day: string; items: FeedItem[] }> = [];
  let current: { day: string; items: FeedItem[] } | undefined;
  for (const item of feed) {
    if (current === undefined || current.day !== item.day) {
      current = { day: item.day, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}

/** 内容流筛选（作者 × 类型）。类型枚举与 tabs 一一对应；project 是切视图，不进这里。
 *
 * S1 的 feed 里没有待办（S3 接入 users/todo 后在此补待办判据），所以「待办」恒空、
 * 「动态/笔记」= 全部 —— kind 缺失的卡也是动态（渲染层 fallback 纯文本卡），
 * **不得**把它当成待办（architect S1 回应③：kind 缺失只是渲染降级，不是类型）。 */
export function filterFeedOf(feed: FeedItem[], tab: "all" | "post" | "todo", agentId: string | undefined): FeedItem[] {
  let items = feed;
  if (tab === "todo") items = [];   // S1 无待办数据（S3 接入后在此判待办）
  if (agentId !== undefined) {
    items = items.filter((item) => (agentId === "me" ? item.author.kind === "user" : item.author.id === agentId));
  }
  return items;
}

/** 看板的四列（R4）：**排除 daily 只判 type**（契约 §6-R3），在唯一这一处做。 */
export function stateColumnsOf(tasks: GlobalTask[]): {
  run: GlobalTask[]; done: GlobalTask[]; moved: GlobalTask[]; other: GlobalTask[];
} {
  const columns = { run: [] as GlobalTask[], done: [] as GlobalTask[], moved: [] as GlobalTask[], other: [] as GlobalTask[] };
  for (const task of tasks) {
    if (task.type === "daily") continue;
    if (task.state === "进行中") columns.run.push(task);
    else if (task.state === "已完成") columns.done.push(task);
    else if (task.state === "已移交") columns.moved.push(task);
    else columns.other.push(task);   // 归一唯一剩余：后端纯函数的「其他」，不猜
  }
  return columns;
}

/** 每个项目的任务计数（项目区副行「N 进行中 · M 个任务」；只数非 daily，与看板同口径）。 */
export function taskCountsByProject(tasks: GlobalTask[]): Map<string, { total: number; running: number }> {
  const map = new Map<string, { total: number; running: number }>();
  for (const task of tasks) {
    if (task.type === "daily") continue;
    const entry = map.get(task.projectId) ?? { total: 0, running: 0 };
    entry.total += 1;
    if (task.state === "进行中") entry.running += 1;
    map.set(task.projectId, entry);
  }
  return map;
}

/** 日期分隔行的文案（Misskey 同构）：今天/昨天/M月D日，跨年补年份。 */
export function dayLabelOf(day: string, today: string): string {
  const yesterday = (() => {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() - 1);
    return todayLocal(d);
  })();
  if (day === today) return "今天";
  if (day === yesterday) return "昨天";
  const [, m, d] = day.split("-");
  const year = day.slice(0, 4);
  return `${year === today.slice(0, 4) ? "" : `${year}年`}${Number(m)}月${Number(d)}日`;
}
