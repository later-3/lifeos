// 任务（用户下达任务）：把交互 harness 的模板落成可检查的目录结构（2026-10-19 用户定）。
//
// - 落点：`agents/<agent>/projects/<project>/tasks/<NNNN>-<标题>/`（编号 per-project 连续；中文目录名允许——用户会翻文件系统）
// - `task.md` 是唯一状态源：类型 / 类别 / 状态 / 负责人 / 目标 / 必需文档 / 当前指针 / 本任务遵守的规范 + 引用案例
// - 类型：development（开发/协作/结论，A/B/C 三类）/ general（普通任务：背景 + 步骤，只两份文档）
// - 类别（照 task-types/<type>/TEMPLATE.md）：A 改产品行为（01-background·02-design·03-phase·04-plan·phases/）
//   / B 改协作规范（01-background·02-plan）/ C 只出结论（01-background）/ G 普通任务（01-background·02-plan）
// - 业务动作只在这里；Pi 工具（src/agent-tools.ts）与将来的 HTTP 都调它。
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
  /** 本任务生成/必需的文档（工具回执用） */
  docs?: string[];
};

export type TaskError = { code: string; message: string };

const tasksRoot = (ctx: TaskContext) => join(resolveHome(), "agents", ctx.agentId, "projects", ctx.projectId, "tasks");
const projectDir = (ctx: TaskContext) => join(resolveHome(), "agents", ctx.agentId, "projects", ctx.projectId);

const CATEGORY_LABEL: Record<TaskCategory, string> = {
  A: "A 改产品行为",
  B: "B 改协作规范",
  C: "C 只出结论",
  G: "G 普通任务",
};

/** 每种任务类型允许的类别（类型决定类别，避免"普通任务选 A"这种错配）。 */
const CATEGORIES_BY_TYPE: Record<TaskType, readonly TaskCategory[]> = {
  development: ["A", "B", "C"],
  general: ["G"],
};

/** 每个类别要生成的文档（与 TEMPLATE.md 的"必需文档"一致）。 */
const REQUIRED_DOCS: Record<TaskCategory, Array<{ file: string; title: string; sections: string[] }>> = {
  A: [
    { file: "01-background.md", title: "01 背景", sections: ["现状事实（文件/命令/实测）", "完成标准（可验收）"] },
    { file: "02-design.md", title: "02 设计", sections: ["抽象定义", "逐项链路", "取舍与风险"] },
    { file: "03-phase.md", title: "03 阶段", sections: ["端到端拆解（P1/P2…）", "每阶段完成后可验证的现象"] },
    { file: "04-plan.md", title: "04 计划", sections: ["顺序与依赖", "验证方式"] },
  ],
  B: [
    { file: "01-background.md", title: "01 背景", sections: ["触发案例", "要改的协作行为"] },
    { file: "02-plan.md", title: "02 计划", sections: ["变更点", "影响面", "生效与回滚"] },
  ],
  C: [
    { file: "01-background.md", title: "01 结论与依据", sections: ["结论（前置）", "依据（文件/命令/实测）", "未验证项"] },
  ],
  G: [
    { file: "01-background.md", title: "01 背景", sections: ["现状与为什么做（一两句事实）", "完成标准（怎么算做完）"] },
    { file: "02-plan.md", title: "02 步骤", sections: ["步骤（按顺序；做到哪算完成）", "验收（怎么确认做到）"] },
  ],
};

const docSkeleton = (title: string, sections: string[]): string =>
  [`# ${title}`, "", ...sections.flatMap((section) => [`## ${section}`, "", "（待填）", ""]),].join("\n");

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
}): Promise<{ task: TaskSummary } | TaskError> {
  const title = (input.title ?? "").trim();
  if (title === "") return { code: "invalid_title", message: "title 不能为空" };
  const type: TaskType = input.type ?? "development";
  if (type !== "development" && type !== "general") {
    return { code: "invalid_type", message: "type 必须是 development（开发/协作/结论）或 general（普通任务）" };
  }
  const category = input.category;
  if (!CATEGORIES_BY_TYPE[type].includes(category)) {
    return {
      code: "invalid_category",
      message: type === "general"
        ? "普通任务（general）的 category 必须是 G（背景 + 步骤）"
        : "开发任务（development）的 category 必须是 A / B / C（A 改产品行为 · B 改协作规范 · C 只出结论）",
    };
  }
  const manifest = await readProjectManifest(ctx.agentId, ctx.projectId);
  if (manifest === undefined && ctx.projectId !== "workspace") {
    return { code: "project_not_found", message: `找不到项目 ${ctx.projectId}` };
  }

  const number = await nextTaskNumber(ctx);
  const id = `${String(number).padStart(4, "0")}-${sanitizeSegment(title)}`;
  const dir = join(tasksRoot(ctx), id);
  const goalInput = (input.goal ?? "").trim();
  const goal = goalInput === "" ? title : goalInput;
  const docs = REQUIRED_DOCS[category];

  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (category === "A") await mkdir(join(dir, "phases"), { recursive: true, mode: 0o700 });
  const taskMd = [
    `# ${title}`,
    "",
    `类型：${type}`,
    `类别：${CATEGORY_LABEL[category]}`,
    "状态：进行中",
    `负责人：${ctx.agentId} ｜ 记录者：${ctx.agentId}`,
    `目标：${goal}`,
    `必需文档：${docs.map((doc) => doc.file).join(" · ")}${category === "A" ? " · phases/" : ""}`,
    "当前指针：（下一步做什么 / 卡在哪——状态只写在这里）",
    "",
    ...(await referenceBlock(ctx, type)),
  ].join("\n");
  await writeFile(join(dir, "task.md"), taskMd, { encoding: "utf8", mode: 0o600 });
  for (const doc of docs) {
    await writeFile(join(dir, doc.file), docSkeleton(doc.title, doc.sections), { encoding: "utf8", mode: 0o600 });
  }
  return { task: { id, number, title, type, category: CATEGORY_LABEL[category], status: "进行中", goal, path: dir, docs: docs.map((doc) => doc.file) } };
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
    out.push({
      id: entry.name,
      number: Number(match[1]),
      title: (text.split("\n")[0] ?? "").replace(/^#\s*/, ""),
      type: field("类型"),
      category: field("类别"),
      status: field("状态"),
      goal: field("目标"),
      path: dir,
    });
  }
  return out.sort((a, b) => a.number - b.number);
}
