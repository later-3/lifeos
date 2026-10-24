// 任务（协议 §3.7 / §6）：把 Task 的结构落成目录，并维护默认 Task 的按天分片。
//
// - 落点：`agents/<agent>/projects/<project>/tasks/<NNNN>-<标题>/`；编号在本层内连续、四位、不复用；
//   标题可改，ID（NNNN）不变；`task.md` 写 `ID: NNNN` 与唯一状态。
// - 类型（`task.md` 的 `类型` 字段，英文取值）：daily（默认 Task，日常对话）/ development（开发）/ general（普通）。
// - 默认 Task：每个 Agent × 项目一个，目录 `NNNN-default`，类型 daily；按天分片写进 `daily/<日期>.md`。
// - 模板选择（协议 §3.7）：Agent × 项目 → 共享项目 → 协议默认；找到第一份就用，不合并。
// - 业务动作只在这里；Pi 工具（src/agent-tools.ts）与 HTTP 都调它。
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveHome } from "./home.ts";
import { readProjectManifest, sanitizeSegment } from "./projects.ts";
import { ensureTaskSkeleton, skeletonText } from "./project-skeleton.ts";

/** 类型是开放集合：由 task-types/<类型>/ 下的模板定义；daily 为系统保留（默认 Task）。 */
export type TaskType = string;
export type TaskCategory = string;

export type TaskContext = { agentId: string; projectId: string };
export type TaskSummary = {
  /** Task ID（四位编号，协议 §3.7）；会话的 activeTaskId 存的就是它。 */
  id: string;
  /** 目录名：NNNN-标题 */
  dirName: string;
  number: number;
  title: string;
  type: string;
  category: string;
  status: string;
  goal: string;
  path: string;
  /** 普通 Task 的创建日期（YYYY-MM-DD，写在 task.md 字段里）。 */
  date?: string;
  /** 默认 Task（类型 daily）。 */
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

/** 模板选择候选（协议 §3.7）：Agent × 项目 → 共享项目 → 协议默认。 */
function templateCandidates(ctx: TaskContext, type: string): string[] {
  const home = resolveHome();
  const paths = [
    join(home, "agents", ctx.agentId, "projects", ctx.projectId, "task-types", type),
    join(home, "projects", ctx.projectId, "task-types", type),
    join(home, "interaction-harness", "task-types", type),
  ];
  return [...new Set(paths)];
}

/** 选第一份存在的模板；不合并。模板损坏时明确失败，不静默降级。 */
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

/** 现有任务目录 → 下一个编号（同一层内连续；0001 起）。 */
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

/** 按 Task ID（NNNN，也接受完整目录名）找到目录；找不到 → undefined。 */
export async function resolveTaskDir(ctx: TaskContext, idOrDirName: string): Promise<string | undefined> {
  const match = /^(\d{4})(?:-|$)/.exec(idOrDirName);
  if (match === null) return undefined;
  const entries = await readdir(tasksRoot(ctx), { withFileTypes: true }).catch(() => []);
  const entry = entries.find((candidate) => candidate.isDirectory() && (candidate.name === idOrDirName || candidate.name.startsWith(`${match[1]}-`)));
  return entry === undefined ? undefined : join(tasksRoot(ctx), entry.name);
}

/** 本 Task 遵守的规范与类型规则路径（只写真实存在的路径；不写死不存在的东西）。 */

/** 开发类 Task 的"本任务遵守"里逐文件点名（仅列当前项目实际存在的那些，不跨项目泄漏路径）。 */
const CODE_SPECS: Array<[string, string]> = [
  ["frontend", "specs/code/frontend/code.md"],
  ["backend", "specs/code/backend/code.md"],
  ["testing", "specs/code/testing/testing.md"],
  ["api", "specs/code/api/api.md"],
  ["architecture", "specs/code/architecture/architecture.md"],
];
const PROJECT_RULES: Array<[string, string]> = [
  ["开发落点", "specs/development-harness/development-harness.md"],
  ["检视流程", "specs/review/review.md"],
  ["参考基线", "knowledge/reference-baseline.md"],
];

async function codeSpecLines(home: string, pid: string, taskType?: string): Promise<string[]> {
  // 涉及代码改动的类型才带 code specs；daily/general 不带（按任务类型过滤）
  const codeTypes = new Set<string>(["development", "troubleshooting"]);
  if (taskType !== undefined && !codeTypes.has(taskType)) return [];
  const projBase = join(home, "projects", pid);
  const files: string[] = [];
  for (const [, rel] of CODE_SPECS) {
    const exists = await stat(join(projBase, rel)).then(() => true, () => false);
    if (exists) files.push(rel);
  }
  if (files.length === 0) return [];
  return [`- 代码规范（按环节逐个对照）：${files.map((rel) => join(projBase, rel)).join(" · ")}`];
}

async function projectRuleLines(home: string, pid: string): Promise<string[]> {
  const projBase = join(home, "projects", pid);
  const found = await Promise.all(PROJECT_RULES.map(async ([label, rel]) => {
    const path = join(projBase, rel);
    return (await stat(path).then(() => true, () => false)) ? { label, path } : undefined;
  }));
  const present = found.filter((x) => x !== undefined);
  if (present.length === 0) return [];
  const labels = present.map((x) => (x as { label: string }).label).join(" / ");
  const paths = present.map((x) => (x as { path: string }).path).join(" · ");
  return [`- 本项目规范与流程（${labels}）：${paths}`];
}

async function referenceBlock(ctx: TaskContext, typeRulesDir: string, type: TaskType): Promise<string[]> {
  const home = resolveHome();
  const lines = [
    "## 本任务遵守",
    "",
    `- 协议：${join(home, "interaction-harness", "protocol.md")}`,
    `- 类型规则：${join(typeRulesDir, "AGENTS.md")}`,
    `- 共享 workspace 规范：${join(home, "projects", "workspace", "specs")}/`,
    ...(await codeSpecLines(home, ctx.projectId, type)),
    ...(await projectRuleLines(home, ctx.projectId)),  ];
  if (ctx.projectId !== "workspace") lines.push(`- 项目共享规范：${join(home, "projects", ctx.projectId, "specs")}/`);
  lines.push(`- Agent × 项目规范：${join(projectDir(ctx), "specs")}/`);
  const manifest = await readProjectManifest(ctx.agentId, ctx.projectId);
  if (manifest !== undefined) {
    const repoGuide = join(manifest.path, "AGENTS.md");
    if (await readFile(repoGuide, "utf8").then(() => true, () => false)) lines.push(`- 项目仓库约定：${repoGuide}`);
  }
  lines.push("");
  return lines;
}

/** 写 task.md + 类型文档 + 额外目录（共同结构由 ensureTaskSkeleton 负责）。 */
async function materialize(ctx: TaskContext, input: {
  number: number; title: string; type: TaskType; categoryLabel: string; goal: string;
  dirName: string; date?: string; requiredDocs: string[]; extraDirs: string[];
  docs: TaskDocTemplate[]; typeRulesDir: string; pointer: string;
}): Promise<TaskSummary> {
  const id = String(input.number).padStart(4, "0");
  const dir = join(tasksRoot(ctx), input.dirName);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await ensureTaskSkeleton(dir);
  for (const extra of input.extraDirs) {
    const sub = join(dir, extra);
    await mkdir(sub, { recursive: true, mode: 0o700 });
    await writeFile(join(sub, "AGENTS.md"), await skeletonText(extra), { encoding: "utf8", mode: 0o600, flag: "wx" })
      .catch(() => { /* 已存在：不覆盖 */ });
  }
  const taskMd = [
    `# ${input.title}`,
    "",
    `ID: ${id}`,
    `类型：${input.type}`,
    `类别：${input.categoryLabel}`,
    "状态：进行中",
    `负责人：${ctx.agentId} ｜ 记录者：${ctx.agentId}`,
    ...(input.date !== undefined ? [`日期：${input.date}`] : []),
    `目标：${input.goal}`,
    `必需文档：${input.requiredDocs.join(" · ")}`,
    `当前指针：${input.pointer}`,
    "",
    ...(await referenceBlock(ctx, input.typeRulesDir, input.type)),
  ].join("\n");
  await writeFile(join(dir, "task.md"), taskMd, { encoding: "utf8", mode: 0o600, flag: "wx" }).catch(() => { /* 已存在：不覆盖 */ });
  for (const doc of input.docs) {
    await writeFile(join(dir, doc.file), docSkeleton(doc.title, doc.sections), { encoding: "utf8", mode: 0o600, flag: "wx" })
      .catch(() => { /* 已存在：不覆盖 */ });
  }
  return {
    id, dirName: input.dirName, number: input.number, title: input.title,
    type: input.type, category: input.categoryLabel, status: "进行中", goal: input.goal, path: dir,
    ...(input.date !== undefined ? { date: input.date } : {}),
    isDefault: input.type === "daily",
    docs: input.requiredDocs,
  };
}

/** 用户下达的普通 Task（development / general）。 */
export async function createTask(ctx: TaskContext, input: {
  title: string; type?: TaskType; category: TaskCategory; goal?: string; date?: string;
}): Promise<{ task: TaskSummary } | TaskError> {
  const title = (input.title ?? "").trim();
  if (title === "") return { code: "invalid_title", message: "title 不能为空" };
  const type: TaskType = (input.type ?? "development").trim();
  if (type === "daily") {
    return { code: "reserved_type", message: "daily 是系统保留的类型（默认 Task 由系统维护），不能手动新建" };
  }
  if (!/^[a-z][a-z0-9-]*$/.test(type)) {
    return { code: "invalid_type", message: "type 用小写英文与连字符，如 development、general、backend-api" };
  }
  const resolved = await resolveTaskTemplate(ctx, type);
  if ("code" in resolved) {
    return { code: resolved.code, message: `${resolved.message}。没有合适的类型时，先和用户讨论，再在 task-types/${type}/ 下建 template.json 与 AGENTS.md` };
  }
  const categoryTemplate = resolved.template.categories[input.category];
  if (categoryTemplate === undefined) {
    const allowed = Object.keys(resolved.template.categories).join(" / ");
    return { code: "invalid_category", message: `类型 ${type} 的 category 必须是 ${allowed}（模板 ${resolved.source}）` };
  }
  const manifest = await readProjectManifest(ctx.agentId, ctx.projectId);
  if (manifest === undefined && ctx.projectId !== "workspace") {
    const info = await stat(projectDir(ctx)).catch(() => undefined);
    if (info === undefined || !info.isDirectory()) return { code: "project_not_found", message: `找不到项目 ${ctx.projectId}` };
  }
  const number = await nextTaskNumber(ctx);
  const goalInput = (input.goal ?? "").trim();
  const task = await materialize(ctx, {
    number,
    title,
    type,
    categoryLabel: categoryTemplate.label,
    goal: goalInput === "" ? title : goalInput,
    dirName: `${String(number).padStart(4, "0")}-${sanitizeSegment(title)}`,
    date: input.date ?? localDate(),
    requiredDocs: [...categoryTemplate.docs.map((doc) => doc.file), ...(categoryTemplate.extraDirs ?? []).map((dir) => `${dir}/`)],
    extraDirs: categoryTemplate.extraDirs ?? [],
    docs: categoryTemplate.docs,
    typeRulesDir: resolved.source,
    pointer: "（下一步做什么 / 卡在哪——状态只写在这里）",
  });
  return { task };
}

// 同一项目并发取默认 Task 时只造一个（进程内串行；跨进程不是本版目标）。
const defaultLocks = new Map<string, Promise<TaskSummary>>();

/** 取/建该 Agent × 项目的默认 Task（协议 §6.1）：每个 Agent × 项目一个，长期存在。 */
export async function ensureDefaultTask(ctx: TaskContext): Promise<TaskSummary> {
  const key = `${ctx.agentId}\u0000${ctx.projectId}`;
  const running = defaultLocks.get(key);
  if (running !== undefined) return await running;
  const work = (async () => {
    const existing = (await listTasks(ctx)).find((task) => task.isDefault === true);
    if (existing !== undefined) return existing;
    const resolved = await resolveTaskTemplate(ctx, "daily");
    if ("code" in resolved) throw new Error(resolved.message);
    const categoryTemplate = resolved.template.categories.D;
    if (categoryTemplate === undefined) throw new Error("daily 模板缺少 D 类别");
    const number = await nextTaskNumber(ctx);
    return await materialize(ctx, {
      number,
      title: "默认",
      type: "daily",
      categoryLabel: categoryTemplate.label,
      goal: "日常对话的入口：没有明确 Task 时的交互都归到这里；按本地日期记入 daily/<日期>.md，只有发生交互的日子才有分片",
      dirName: `${String(number).padStart(4, "0")}-default`,
      requiredDocs: ["daily/（按天分片）"],
      extraDirs: categoryTemplate.extraDirs ?? [],
      docs: categoryTemplate.docs,
      typeRulesDir: resolved.source,
      pointer: "按日期分片：发起对话的那一天建 daily/<日期>.md；没有交互的日子没有分片",
    });
  })().finally(() => { defaultLocks.delete(key); });
  defaultLocks.set(key, work);
  return await work;
}

/**
 * 日期分片（协议 §6.1）：取/建默认 Task，并确保 `daily/<日期>.md` 存在（只放标题，create-only）。
 * 只在发起对话（每轮交互）时调用；没有交互的日子不建分片；跨天时会话仍指向默认 Task。
 */
export async function ensureDailyShard(ctx: TaskContext, date = localDate()): Promise<{ task: TaskSummary; file: string }> {
  const task = await ensureDefaultTask(ctx);
  const file = join(task.path, "daily", `${date}.md`);
  await mkdir(join(task.path, "daily"), { recursive: true, mode: 0o700 });
  await writeFile(file, `# ${date}\n\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }).catch(() => { /* 已存在：不覆盖 */ });
  return { task, file };
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
      const line = text.split("\n").find((candidate) => candidate.startsWith(`${label}：`) || candidate.startsWith(`${label}:`));
      if (line === undefined) return "";
      return line.slice(line.indexOf(label) + label.length + 1).trim();
    };
    const date = field("日期");
    const type = field("类型");
    out.push({
      id: match[1] ?? "",
      dirName: entry.name,
      number: Number(match[1]),
      title: (text.split("\n")[0] ?? "").replace(/^#\s*/, ""),
      type,
      category: field("类别"),
      status: field("状态"),
      goal: field("目标"),
      path: dir,
      ...(date !== "" ? { date } : {}),
      isDefault: type === "daily",
    });
  }
  return out.sort((a, b) => a.number - b.number);
}
