// 任务（用户下达任务）：把交互 harness 的模板落成可检查的目录结构（2026-10-19 用户定）。
//
// - 落点：`agents/<agent>/projects/<project>/tasks/<NNNN>-<标题>/`（编号 per-project 连续；中文目录名允许——用户会翻文件系统）
// - `task.md` 是唯一状态源：类型 / 类别 / 状态 / 负责人 / 目标 / 必需文档 / 当前指针 / 本任务遵守的规范 + 引用案例
// - 类型：development（开发/协作/结论，A/B/C 三类）/ general（普通任务：背景 + 步骤，只两份文档）
// - 默认 Task：每 Agent × Project × 日期一个（daily-YYYY-MM-DD，general/G）；会话用 activeTaskId 引用，可共享/切换
// - 模板：四层选一份（Agent×项目 → 项目共享 → Agent workspace → 协议默认），机器读 template.json
// - 类别（照 task-types/<type>/template.json）：A 改产品行为（01-background·02-design·03-phase·04-plan·phases/）
//   / B 改协作规范（01-background·02-plan）/ C 只出结论（01-background）/ G 普通任务（01-background·02-plan）
// - 业务动作只在这里；Pi 工具（src/agent-tools.ts）与将来的 HTTP 都调它。
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveHome } from "./home.ts";
import { readProjectManifest, sanitizeSegment } from "./projects.ts";

export type TaskType = "development" | "general";
export type TaskCategory = "A" | "B" | "C" | "G";

export type TaskContext = { agentId: string; projectId: string };
export type TaskSummary = {
  id: string;            // 目录名：0001-标题
  number: number;
  title: string;
  type: string;
  category: string;
  status: string;
  goal: string;
  path: string;
  /** 任务日期（YYYY-MM-DD；平铺目录 + 字段，不建日期目录；协议 §16.4） */
  date?: string;
  /** 当天该 Agent × Project 的默认 Task */
  isDefault?: boolean;
  /** 本任务生成/必需的文档（工具回执用） */
  docs?: string[];
};

export type TaskError = { code: string; message: string };

/** 任务模板的机器可读部分（`task-types/<type>/template.json`）；TEMPLATE.md 是给人读的说明。 */
type TaskDocTemplate = { file: string; title: string; sections: string[] };
type TaskCategoryTemplate = { label: string; docs: TaskDocTemplate[]; extraDirs?: string[] };
type TaskTemplate = { schemaVersion: 1; type: string; categories: Record<string, TaskCategoryTemplate> };

const tasksRoot = (ctx: TaskContext) => join(resolveHome(), "agents", ctx.agentId, "projects", ctx.projectId, "tasks");
const projectDir = (ctx: TaskContext) => join(resolveHome(), "agents", ctx.agentId, "projects", ctx.projectId);

const isDoc = (value: unknown): value is TaskDocTemplate => {
  if (typeof value !== "object" || value === null) return false;
  const doc = value as Partial<TaskDocTemplate>;
  return typeof doc.file === "string" && doc.file !== ""
    && typeof doc.title === "string" && doc.title !== ""
    && Array.isArray(doc.sections) && doc.sections.every((section) => typeof section === "string");
};

const parseTemplate = (raw: string): TaskTemplate | undefined => {
  try {
    const data = JSON.parse(raw) as Partial<TaskTemplate>;
    if (data.schemaVersion !== 1 || typeof data.type !== "string" || typeof data.categories !== "object" || data.categories === null) return undefined;
    const categories: Record<string, TaskCategoryTemplate> = {};
    for (const [key, value] of Object.entries(data.categories as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) return undefined;
      const category = value as Partial<TaskCategoryTemplate>;
      if (typeof category.label !== "string" || !Array.isArray(category.docs) || !category.docs.every(isDoc)) return undefined;
      const extraDirs = Array.isArray(category.extraDirs) ? category.extraDirs.filter((dir): dir is string => typeof dir === "string" && dir !== "" && !dir.includes("/") && !dir.includes("..")) : [];
      categories[key] = { label: category.label, docs: category.docs, ...(extraDirs.length > 0 ? { extraDirs } : {}) };
    }
    return { schemaVersion: 1, type: data.type, categories };
  } catch { return undefined; }
};

/** 模板四层候选（协议 §16.4）：Agent×项目 → 项目共享 → Agent workspace → 协议默认。 */
function templateCandidates(ctx: TaskContext, type: string): string[] {
  const home = resolveHome();
  const paths = [
    join(home, "agents", ctx.agentId, "projects", ctx.projectId, "task-types", type),
    join(home, "projects", ctx.projectId, "task-types", type),
    join(home, "agents", ctx.agentId, "projects", "workspace", "task-types", type),
    join(home, "interaction-harness", "task-types", type),
  ];
  return [...new Set(paths)];
}

/** 选第一份存在的模板；不合并四层。模板损坏时明确失败，不静默降级到“看起来差不多”的层。 */
async function resolveTaskTemplate(ctx: TaskContext, type: TaskType): Promise<{ template: TaskTemplate; source: string } | TaskError> {
  for (const dir of templateCandidates(ctx, type)) {
    const raw = await readFile(join(dir, "template.json"), "utf8").catch(() => undefined);
    if (raw === undefined) continue;
    const template = parseTemplate(raw);
    if (template === undefined) return { code: "invalid_template", message: `任务模板损坏：${join(dir, "template.json")}` };
    if (template.type !== type) return { code: "invalid_template", message: `任务模板类型不匹配：${join(dir, "template.json")}（应为 ${type}）` };
    return { template, source: dir };
  }
  return { code: "template_not_found", message: `找不到 ${type} 的任务模板` };
}

const docSkeleton = (title: string, sections: string[]): string =>
  [`# ${title}`, "", ...sections.flatMap((section) => [`## ${section}`, "", "（待填）", ""]),].join("\n");

/** 本地日期 YYYY-MM-DD（用户看到的那一天；不用 UTC 切日）。 */
export function localDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 现有任务目录 → 下一个编号（per-project 连续；0001 起）。 */
export async function nextTaskNumber(ctx: TaskContext): Promise<number> {
  const entries = await readdir(tasksRoot(ctx), { withFileTypes: true }).catch(() => []);
  let max = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = /^(\d{4})-/.exec(entry.name);
    if (match !== null) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

/** 本任务遵守的规范与案例引用（路径真实存在才写；案例由模型后续补）。 */
async function referenceBlock(ctx: TaskContext, type: TaskType): Promise<string[]> {
  const home = resolveHome();
  const lines = [
    "## 本任务遵守",
    "",
    `- 协议：${join(home, "interaction-harness", "protocol.md")}`,
    `- 本层指引：${join(home, "interaction-harness", "AGENTS.md")}`,
    `- 任务类型细则：${join(home, "interaction-harness", "task-types", type, "TEMPLATE.md")}`,
    `- 本项目指引：${join(projectDir(ctx), "AGENTS.md")}`,
    `- 共享规范：${join(home, "projects", "workspace", "specs")}/`,
    `- 项目共享规范：${join(home, "projects", ctx.projectId, "specs")}/`,
    `- Agent workspace 规范：${join(home, "agents", ctx.agentId, "projects", "workspace", "specs")}/`,
    `- Agent × 项目规范：${join(projectDir(ctx), "specs")}/`,
  ];
  const manifest = await readProjectManifest(ctx.agentId, ctx.projectId);
  if (manifest !== undefined) {
    const repoGuide = join(manifest.path, "AGENTS.md");
    if (await readFile(repoGuide, "utf8").then(() => true, () => false)) lines.push(`- 项目仓库约定：${repoGuide}`);
  }
  lines.push("", "## 引用的案例", "", "- （待补：与本次任务类型相关的正例/反例，写 `cases/<日期>.md#Cxxx`）", "");
  return lines;
}

export async function createTask(ctx: TaskContext, input: {
  title: string; type?: TaskType; category: TaskCategory; goal?: string;
  date?: string; isDefault?: boolean;
}): Promise<{ task: TaskSummary } | TaskError> {
  const title = (input.title ?? "").trim();
  if (title === "") return { code: "invalid_title", message: "title 不能为空" };
  const type: TaskType = input.type ?? "development";
  if (type !== "development" && type !== "general") {
    return { code: "invalid_type", message: "type 必须是 development（开发/协作/结论）或 general（普通任务）" };
  }
  const category = input.category;
  const resolvedTemplate = await resolveTaskTemplate(ctx, type);
  if ("code" in resolvedTemplate) return resolvedTemplate;
  const categoryTemplate = resolvedTemplate.template.categories[category];
  if (categoryTemplate === undefined) {
    const allowed = Object.keys(resolvedTemplate.template.categories).join(" / ");
    return {
      code: "invalid_category",
      message: type === "general"
        ? `普通任务（general）的 category 必须是 G（模板 ${resolvedTemplate.source} 只允许 ${allowed}）`
        : `开发任务（development）的 category 必须是 A / B / C（模板 ${resolvedTemplate.source} 只允许 ${allowed}）`,
    };
  }
  const manifest = await readProjectManifest(ctx.agentId, ctx.projectId);
  if (manifest === undefined && ctx.projectId !== "workspace") {
    // 内置/内部项目可以没有 manifest（目录存在即可）；外部项目才必须有清单。
    const info = await stat(projectDir(ctx)).catch(() => undefined);
    if (info === undefined || !info.isDirectory()) return { code: "project_not_found", message: `找不到项目 ${ctx.projectId}` };
  }

  const number = await nextTaskNumber(ctx);
  const id = `${String(number).padStart(4, "0")}-${sanitizeSegment(title)}`;
  const dir = join(tasksRoot(ctx), id);
  const goalInput = (input.goal ?? "").trim();
  const goal = goalInput === "" ? title : goalInput;
  const docs = categoryTemplate.docs;
  const date = input.date ?? localDate();
  const isDefault = input.isDefault === true;

  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const extra of categoryTemplate.extraDirs ?? []) {
    await mkdir(join(dir, extra), { recursive: true, mode: 0o700 });
  }
  const taskMd = [
    `# ${title}`,
    "",
    `类型：${type}`,
    `类别：${categoryTemplate.label}`,
    "状态：进行中",
    `负责人：${ctx.agentId} ｜ 记录者：${ctx.agentId}`,
    `日期：${date}`,
    `默认：${isDefault ? "是" : "否"}`,
    `目标：${goal}`,
    `必需文档：${docs.map((doc) => doc.file).join(" · ")}${(categoryTemplate.extraDirs ?? []).map((extra) => ` · ${extra}/`).join("")}`,
    "当前指针：（下一步做什么 / 卡在哪——状态只写在这里）",
    "",
    ...(await referenceBlock(ctx, type)),
  ].join("\n");
  await writeFile(join(dir, "task.md"), taskMd, { encoding: "utf8", mode: 0o600 });
  for (const doc of docs) {
    await writeFile(join(dir, doc.file), docSkeleton(doc.title, doc.sections), { encoding: "utf8", mode: 0o600 });
  }
  return { task: { id, number, title, type, category: categoryTemplate.label, status: "进行中", goal, path: dir, date, isDefault, docs: docs.map((doc) => doc.file) } };
}

// 同一天并发新建会话时只造一个默认 Task（进程内串行；跨进程不是本版目标）。
const dailyLocks = new Map<string, Promise<TaskSummary>>();

/** 取/建当天该 Agent × Project 的默认 Task；普通会话共享它（协议 §16.4）。 */
export async function ensureDailyTask(ctx: TaskContext, date = localDate()): Promise<TaskSummary> {
  const key = `${ctx.agentId}\u0000${ctx.projectId}\u0000${date}`;
  const running = dailyLocks.get(key);
  if (running !== undefined) return await running;
  const work = (async () => {
    const existing = (await listTasks(ctx)).find((task) => task.date === date && task.isDefault === true);
    if (existing !== undefined) return existing;
    const result = await createTask(ctx, {
      title: `daily-${date}`,
      type: "general",
      category: "G",
      goal: `当天默认 Task（${date}）：普通会话的落点`,
      date,
      isDefault: true,
    });
    if ("code" in result) throw new Error(result.message);
    return result.task;
  })().finally(() => { dailyLocks.delete(key); });
  dailyLocks.set(key, work);
  return await work;
}

/** 列出某项目下的任务（读 task.md 的关键字段；不投影、不猜）。 */
export async function listTasks(ctx: TaskContext): Promise<TaskSummary[]> {
  const entries = await readdir(tasksRoot(ctx), { withFileTypes: true }).catch(() => []);
  const out: TaskSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = /^(\d{4})-(.+)$/.exec(entry.name);
    if (match === null) continue;
    const dir = join(tasksRoot(ctx), entry.name);
    const text = await readFile(join(dir, "task.md"), "utf8").catch(() => undefined);
    if (text === undefined) continue;
    const field = (label: string): string => {
      const line = text.split("\n").find((candidate) => candidate.startsWith(`${label}：`));
      return line === undefined ? "" : line.slice(label.length + 1).trim();
    };
    const date = field("日期");
    out.push({
      id: entry.name,
      number: Number(match[1]),
      title: (text.split("\n")[0] ?? "").replace(/^#\s*/, ""),
      type: field("类型"),
      category: field("类别"),
      status: field("状态"),
      goal: field("目标"),
      path: dir,
      ...(date !== "" ? { date } : {}),
      isDefault: field("默认") === "是",
    });
  }
  return out.sort((a, b) => a.number - b.number);
}
