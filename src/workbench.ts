// 全局工作台（S1）的三个只读查询：全局任务、全局项目、日期索引。
//
// 为什么单独一个模块：这三条查询都要**跨 Agent × Project 聚合**，而现有模块各自只回答"某一个
// Agent × 某一个项目"。把聚合写在 HTTP 层会让形状在路由里散开（`specs/code/api/api.md` 2.7），
// 而它们各自复用的底层都是既有唯一实现：
//   · 任务 → `listTasks()`（含 `taskDocPathOf` 的工作区穿透，协议 §3.7）
//   · 绑定 → `scanProjectDirs()`（结构即事实：目录在就是绑定）
//   · 项目身份 → `readGlobalProject()`（`projects/<pid>/project.json` 是唯一身份）
//   · 会话 → `scanProject()`（一遍 IO + `size:mtime` 指纹缓存）
// 本模块**不新增任何事实来源**，只做"列举口径"与"归日口径"。
//
// 形状全部照 `phases/S1-contract.md`（冻结）；形状变了要先改契约。
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { listAgents } from "./agents.ts";
import { resolveHome } from "./home.ts";
import { log } from "./logging.ts";
import { scanProjectDirs } from "./projects.ts";
import { readGlobalProject } from "./project-registry.ts";
import { scanProject } from "./session-rows.ts";
import { displayTitleOf } from "./row-activity.ts";
import { listTasks, localDate, type TaskSummary } from "./tasks.ts";
import { normalizeTaskState, type TaskState } from "./task-state.ts";

export type { TaskState } from "./task-state.ts";

// ——————————————————————————————————————————————————————————————
// 1 全局任务
// ——————————————————————————————————————————————————————————————

/** 一个 Task + 它属于谁 + 归一后的状态（契约 §1）。 */
export type GlobalTask = TaskSummary & {
  agentId: string;
  projectId: string;
  state: TaskState;
};
// 注意：TaskSummary 的 `path` / `docPath` 是**服务器内部定位的绝对路径**，会随本对象到前端——
// 前端**不得显示、不得当 id 用**（id/dirName 才是稳定标识；工作区形态下同一 Task 两次请求的
// path 不同）。S2/S3 若确无消费则裁剪这两个字段（reviewer S1 检视 Q4，2026-11-22）。

/** 可见的绑定：该 Agent 有目录（结构即事实）且没被"从列表移除"。 */
async function visibleProjectsOf(agent: { id: string; hiddenProjectIds?: string[] }): Promise<string[]> {
  const hidden = new Set(agent.hiddenProjectIds ?? []);
  return (await scanProjectDirs(agent.id)).filter((pid) => !hidden.has(pid));
}

/** 遍历所有可见的 Agent × Project。 */
async function eachScope(): Promise<Array<{ agentId: string; projectId: string }>> {
  const out: Array<{ agentId: string; projectId: string }> = [];
  for (const agent of await listAgents()) {
    for (const projectId of await visibleProjectsOf(agent)) out.push({ agentId: agent.id, projectId });
  }
  return out;
}

/**
 * 全局任务列表（契约 §1）。
 *
 * **必须**走 `listTasks()`：它内含工作区穿透（协议 §3.7 读侧能穿透）。自己 `readdir(tasks/)`
 * 会**安静地**漏掉"工作区里新建、还没合并"的 Task——实测 108 vs 132，且不报错。
 *
 * 不替前端筛 `type=daily`：排除 daily 是呈现层的决定（看板不显示永不变的默认 Task）。
 */
export async function globalTasks(): Promise<GlobalTask[]> {
  const items: GlobalTask[] = [];
  for (const { agentId, projectId } of await eachScope()) {
    for (const task of await listTasks({ agentId, projectId })) {
      items.push({ ...task, agentId, projectId, state: normalizeTaskState(task.status) });
    }
  }
  // 契约 §1：`projectId` 升序 → `number` 升序。同项目同号（不同 Agent）再按 agentId 兜底，
  // 保证同一份数据两次请求顺序一致（前端不再排序，顺序抖动会让卡片跳）。
  const key = (item: GlobalTask) => `${item.projectId}\u0000${String(item.number).padStart(6, "0")}\u0000${item.agentId}`;
  return items.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

// ——————————————————————————————————————————————————————————————
// 2 全局项目
// ——————————————————————————————————————————————————————————————

/** 一个全局项目 + 绑定它的 Agent（契约 §2）。 */
export type GlobalProject = {
  id: string;
  name: string;
  path?: string;
  icon?: string;
  agentIds: string[];
};

/**
 * 全局项目列表（契约 §2）。
 *
 * - 合并键 = 全局 pid（`projects/<pid>/project.json`），**不是** `basename(path)`
 *   ——后者在 worktree 场景会显示成 `worktree`（Task 0005 实测的项目名漂移）。
 * - 只列**有 project.json 的目录**：只有 `projects/registry.json` 条目的（如 `longagentshare`）不出现。
 * - **不返回任务计数**：同一个数字不能有第二个来源（前端从 `/api/tasks` 算）。
 *
 * 为什么不用 `listGlobalProjects()`：那个函数对每个项目调 `ensureSharedLayer`（create-only 骨架）。
 * 读接口不写盘，所以这里直接 `readdir + readGlobalProject`，读到的是同一份 `project.json`。
 */
export async function globalProjects(): Promise<GlobalProject[]> {
  const agents = await listAgents();
  // 绑定关系一次算清：对每个 pid 收集"哪些 Agent 看得见它"。
  const bindings = new Map<string, string[]>();
  for (const agent of agents) {
    for (const pid of await visibleProjectsOf(agent)) {
      const list = bindings.get(pid) ?? [];
      list.push(agent.id);
      bindings.set(pid, list);
    }
  }
  const home = resolveHome();
  const dirs = (await readdir(join(home, "projects"), { withFileTypes: true }).catch((err: unknown) => {
    // ENOENT = 还没有 projects/（家目录没 init 全）是正常分支；其他读失败按 backend 2.9 留痕。
    // 留痕后按空表继续——聚合接口不因单条读失败变 500（宁可少不猜）。
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      void log.debug("workbench", "globalProjects", "读 projects 目录失败，按无全局项目处理", {
        details: { path: join(home, "projects"), message: err instanceof Error ? err.message : String(err) },
      });
    }
    return [];
  }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);

  const items: GlobalProject[] = [];
  for (const id of dirs) {
    // 读失败（含非 ENOENT）的留痕在 `project-registry.ts` 的 readGlobalProject 内部（病根一处修，
    // ENOENT=无 project.json 是正常分支）；它永不抛（parse 全程 try/catch），这里直接用返回值。
    const manifest = await readGlobalProject(id);
    if (manifest === undefined) continue;   // 没有 project.json：不是全局项目（longagentshare）
    // 名字：project.json 的 name 为准；空则 basename(path) 兜底；再空则 id（不编名字）。
    const fallback = (manifest.path ?? "").split(/[\\/]/).filter((part) => part !== "").at(-1) ?? manifest.id;
    const name = manifest.name.trim() !== "" ? manifest.name.trim() : fallback;
    items.push({
      id: manifest.id,
      name,
      ...(manifest.path !== undefined ? { path: manifest.path } : {}),
      ...(manifest.icon !== undefined ? { icon: manifest.icon } : {}),
      agentIds: [...new Set(bindings.get(id) ?? [])].sort(),
    });
  }
  // 顺序在契约里没有规定；按名字排（与 `listAgentProjects` 的非默认项同口径），同名的用 id 兜底。
  return items.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ——————————————————————————————————————————————————————————————
// 3 日期索引
// ——————————————————————————————————————————————————————————————

/**
 * S1 恒为 `[]`：用户文档在 S2、待办在 S3。
 *
 * 元素形状**等那一阶段的契约冻结后再定**，这里不预造一个会被推翻的形状
 * （`Record<string, never>` = 没有任何已知字段，`[]` 是它的合法值）。
 */
export type DocRef = Record<string, never>;
export type TodoRef = Record<string, never>;

export type ActivityRef =
  /** 那天用户在这个会话里说过话。`at` = 那天**第一条**用户消息的时间戳（真实时刻）。 */
  | { kind: "session"; agentId: string; projectId: string; sessionId: string; title: string; at: string }
  /** 那天某个 Task 的 `log.md` 有这么一条日期标题。`at` = 该日**本地零点**换算到与时区确定的同一基准（契约 R1：日志没有时刻，不编时刻，但必须与时区同钟）。 */
  | { kind: "log"; agentId: string; projectId: string; taskId: string; taskTitle: string; heading: string; at: string };

export type Day = {
  date: string;
  documents: DocRef[];
  todos: TodoRef[];
  activity: ActivityRef[];
};

/**
 * `## ` 标题里以 `YYYY-MM-DD` 开头的那类 → `{date, heading}`；不是这类返回 undefined。
 *
 * 模板占位词（`过程记录（按时间追加）` / `重要事项` / `1. 动作`）天然不匹配，因此不需要黑名单。
 * 括号里带日期的自由标题（`## 2026-11 的回顾`、`## 复盘（2026-11-19）`）**这一版不解析**：
 * 契约要求"宁可少，不猜"。
 *
 * `heading` = `## ` 之后去掉开头日期与一个分隔符后的原文（日期已在 `date` 里，不在文案里重复）；
 * 去完为空则回落到日期本身——**不让调用方再去切字符串**（`specs/code/api/api.md` 2.37）。
 */
export function dateHeadingOf(line: string): { date: string; heading: string } | undefined {
  if (!line.startsWith("## ")) return undefined;
  const raw = line.slice(3).trim();
  // 日期后面接什么才算"这是一个日期标题"。
  // 字符集是**实测出来的**（2026-11-22，真实家目录 216 条日期标题统计）：
  //   空格 108 / 全角括号 `（` 49 / `T`（ISO 时刻）30 / 行尾 29。
  // 所以除了分隔符，`T` 必须放行 —— `## 2026-11-05T10:00 …` 是真实存在的写法。
  // 反过来 `2026-11-05x`、`2026-11-051` 这类紧接字母/数字的，不是一个日期。
  const match = /^(\d{4}-\d{2}-\d{2})(?=$|[\sT（(·\-—–:：|，,。；;)])/.exec(raw);
  const date = match?.[1];
  if (date === undefined || !isDateString(date)) return undefined;
  const rest = raw.slice(date.length).replace(/^[\s·\-—–:：|]+/, "").trim();
  return { date, heading: rest === "" ? date : rest };
}

/** 读一个 `log.md`，返回日期标题（围栏代码块里的 `## ` 不算标题）。 */
function dateHeadingsOf(raw: string): Array<{ date: string; heading: string }> {
  const out: Array<{ date: string; heading: string }> = [];
  let inFence = false;
  for (const line of raw.split("\n")) {
    if (/^\s{0,3}(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const parsed = dateHeadingOf(line);
    if (parsed !== undefined) out.push(parsed);  }
  return out;
}

/** `YYYY-MM-DD` 且是真实存在的日期（挡掉 `2026-13-45`）。 */
export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const at = new Date(y, m - 1, d);
  return at.getFullYear() === y && at.getMonth() === m - 1 && at.getDate() === d;
}

/**
 * 该日**本地零点**的 ISO 表示（时区确定的时刻，契约 R1）。
 *
 * 为什么不是 `` `<date>T00:00:00` `` 字面量：那是**本地字面、无时区**，与会话 `at`
 * （UTC ISO）同字段不同钟 —— 「按 `at` 升序」就不再等于时间升序
 * （实测 2026-11-18：6 条本地 07:xx 的会话，时间戳是 `T23:xxZ`，排到了“零点 log”前面）。
 *
 * 两种实现在东八区等价（`new Date(2026,10,22).toISOString()` = `2026-11-21T16:00:00.000Z`），
 * 但**只有**这一种是时区确定的：换个时区跑，两者的换算都从同一个 `Date` 出发，永远同钟。
 * （`date` 已被 `isDateString` 验过是真日期，`new Date(y, m-1, d)` 不会溢出。）
 */
export function localMidnightIsoOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toISOString();
}

/**
 * 日期索引（契约 §3）：稀疏——只含"那天有事"的日期。
 *
 * 口径（三条，都是实测结论，见 `01-background.md` §2.4）：
 *  1. 会话按**消息内 `timestamp` 的本地日期**归日，**不用文件 mtime**
 *     （`model_change` 之类也会写文件，实测 mtime 归日多报 5 倍）；
 *     只算至少有一条 `role=user` 消息的会话。
 *  2. log 按 `## YYYY-MM-DD` 标题归日（模板占位词天然被滤掉）。
 *  3. 提交这一版**不做**（要跨两个仓，口径未定）。
 *
 * 性能：一次全量 `scanProject`（冷 1.7s / 热 31ms，174 个会话 / 322MB）。
 * 复用它的 `size:mtime` 指纹缓存 = 热路径只剩 `stat`；不另加窗口缓存（协议 §3.13：不发明）。
 */
export async function dayIndex(from: string, to: string): Promise<Day[]> {
  const days = new Map<string, ActivityRef[]>();
  const push = (date: string, ref: ActivityRef): void => {
    if (date < from || date > to) return;
    const list = days.get(date) ?? [];
    list.push(ref);
    days.set(date, list);
  };

  for (const { agentId, projectId } of await eachScope()) {
    for (const session of await scanProject(agentId, projectId)) {
      for (const { date, at } of session.userDays) {
        push(date, {
          kind: "session", agentId, projectId, sessionId: session.sessionId,
          // 与列表同一份显示规则（`displayTitleOf`），不给工作台另起一套标题口径。
          title: displayTitleOf(session.rawTitle),
          at,
        });
      }
    }
    for (const task of await listTasks({ agentId, projectId })) {
      const raw = await readFile(join(task.docPath, "log.md"), "utf8").catch((err: unknown) => {
        // 没有 log.md（daily 类、未写日志的 task）是常态，不算失败；
        // 其他失败（权限/IO）按 backend 2.9 留痕，不当"没有 log"。
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          void log.debug("workbench", "dayIndex", "读 log.md 失败，该 task 的 log 段不参与归日", {
            agentId, projectId,
            // path 进 details 只为定位（不是文件正文；2.10 正文零出现）。
            details: { task: task.id, path: join(task.docPath, "log.md"), message: err instanceof Error ? err.message : String(err) },
          });
        }
        return undefined;
      });
      if (raw === undefined) continue;
      for (const { date, heading } of dateHeadingsOf(raw)) {
        push(date, { kind: "log", agentId, projectId, taskId: task.id, taskTitle: task.title, heading, at: localMidnightIsoOf(date) });
      }
    }
  }

  const out: Day[] = [];
  for (const date of [...days.keys()].sort()) {
    const activity = (days.get(date) ?? []).slice().sort((a, b) => {
      if (a.at !== b.at) return a.at < b.at ? -1 : 1;
      if (a.kind !== b.kind) return a.kind === "log" ? -1 : 1;
      const ka = a.kind === "log" ? `${a.agentId}/${a.projectId}/${a.taskId}` : `${a.agentId}/${a.projectId}/${a.sessionId}`;
      const kb = b.kind === "log" ? `${b.agentId}/${b.projectId}/${b.taskId}` : `${b.agentId}/${b.projectId}/${b.sessionId}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    // `documents` / `todos` 在 S1 **恒为空数组**（不是省略字段）：前端要能区分
    // "这类还没接"与"那天确实没有"。
    out.push({ date, documents: [], todos: [], activity });
  }
  return out;
}

/** 今天（本地日期）——`/api/days` 的默认窗口由前端给，这里只导出同口径的日期函数方便调用方。 */
export { localDate };
