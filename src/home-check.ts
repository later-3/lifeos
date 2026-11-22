// 家目录结构校验（协议 §5、§6；`pnpm home:check`）：Life OS 生成或安装出来的结构是否符合协议。
// 只读、不修改任何文件；错误 = 不符合协议，警告 = 需要人看一眼。
//
// 两条形态前提（协议 §3.7，2026-11-12 起是默认形态，不是可选项）：
// 1. **Task 的文档在工作区里**：`<taskDir>/home/agents/<a>/projects/<p>/tasks/<NNNN-x>/`，
//    主区 `<taskDir>/` 只剩 `home/`、`repo/` 两个挂载点与 `evidence/`。所以读 Task 一律先穿透
//    （`taskDocRootOf`，与业务层同一份判定），另加主区那份 `evidence/`。
// 2. **工作区与外部检出不是协作层**：它们有自己的目录结构，逐目录要求 AGENTS.md 会把别人的仓库
//    当成违规。判据是「协议保留名 ∪ 结构事实（`.git` / `.lifeos-worktree.json`）」，不是一张
//    今天恰好凑齐的名字清单——2026-11-19 实测：只按名字跳过时，一个历史 `worktree/`
//    让 check 报了 195 条假错误，而挂载点自身仍被要求说明文件（再 24 条）。
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { MARKER_FILE } from "./task-worktree.ts";
import { isWorktreeMount } from "./worktree-mount.ts";
import { taskDocRootOf, type TaskScope } from "./task-doc-path.ts";

export type HomeCheckReport = { errors: string[]; warnings: string[]; checked: number };

const TASK_TYPES = new Set(["daily", "development", "general", "troubleshooting"]);
const LEGACY_HARNESS = ["flywheel.md", "memory.md", "concept-space.md", "concept-space", "cases"];
const DATE_FILE = /^\d{4}-\d{2}-\d{2}\.md$/;
const TASK_DIR = /^(\d{4})-.+$/;

/** 过程资料：自身要说明文件（协议 §5.2），内部不递归（里面是外部克隆、截图、原始输出、探针脚本）。 */
const MATERIAL_DIR_NAMES = new Set(["evidence", "refs", "shots", "probe"]);
/** 依赖与生成物：不是协作层，逐目录要求说明文件只会把别人的构件树翻一遍（与遍历类工具的默认忽略一致）。 */
const GENERATED_DIR_NAMES = new Set(["node_modules", "__pycache__"]);

async function isDir(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isDirectory(), () => false);
}
async function isFile(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isFile(), () => false);
}
async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}
async function readJsonFile(path: string): Promise<Record<string, unknown> | undefined> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return undefined; }
}
async function subdirs(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

/** 这个目录是不是「从别处来的检出」（git 仓或本项目的 Task 工作区）——不是协作层。 */
async function isForeignCheckout(dir: string): Promise<boolean> {
  return (await isFile(join(dir, MARKER_FILE))) || (await exists(join(dir, ".git")));
}

/**
 * 每个目录都必须有 AGENTS.md（协议 §5.2）；从 `root` 往下递归。三类子目录不按家目录结构查（协议 §3.7）：
 *
 * - **不是协作层**（`home/`、`repo/`、历史 `worktree/`、任何 git 检出）：**自身也不要**说明文件、不进去。
 *   它们是外部仓库的检出，`home/` 里甚至是整份家目录副本——进去等于把家目录再查一遍。
 * - **过程资料**（`evidence/`、`refs/`、`shots/`）：**自身要**说明文件，但不进去。
 * - **依赖与生成物**（`node_modules/` 等）：不进去，也不要求说明文件。
 *
 * `owned`（绝对路径）里的目录由调用方负责，这里整棵跳过：Task 目录的文档在工作区里，
 * 由 `checkTask` 按穿透后的读根检查，在这里再查一次只会重复报错。
 */
async function requireNotes(
  home: string,
  root: string,
  errors: string[],
  counter: { n: number },
  owned: ReadonlySet<string> = new Set(),
): Promise<void> {
  for (const name of await subdirs(root)) {
    const dir = join(root, name);
    if (owned.has(dir)) continue;
    if (GENERATED_DIR_NAMES.has(name)) continue;
    // 挂载点判定只有一处（`worktree-mount.ts`，Task 0004 · P1）：只认"路径本身是挂载点"，
    // **不认"在挂载点里面"**——后者会把整棵子树跳过，真阳性静默消失。
    if (isWorktreeMount(dir) || await isForeignCheckout(dir)) continue;
    counter.n += 1;
    const note = join(dir, "AGENTS.md");
    if (!await isFile(note)) errors.push(`缺少说明文件 AGENTS.md：${relative(home, dir)}/`);
    else {
      const text = await readFile(note, "utf8").catch(() => "");
      if (text.trim() === "") errors.push(`说明文件为空：${relative(home, dir)}/AGENTS.md`);
    }
    if (MATERIAL_DIR_NAMES.has(name)) continue;
    await requireNotes(home, dir, errors, counter, owned);
  }
}

/** `必需文档` 是人写的字段：剥掉装饰（`**`）与句尾批注（`（…）`，如「phases/（P1 已收口）」），只留路径。 */
function requiredDocPathOf(item: string): string {
  return item.replaceAll("**", "").replace(/(（[^）]*）)+\s*$/, "").trim();
}

/**
 * 检查一个 Task（协议 §3.7、§6）。
 *
 * 读文档一律走 `doc`（`taskDocRootOf`：有工作区就是工作区里那份）；`evidence/` 不进版本控制、
 * 只存在于主区，所以「必需文档」在两个根上都认——只认一个会漏报，或逼人把证据挪进工作区。
 * 返回 `type`（默认 Task 计数用）——读不到 `task.md` 时返回 undefined，那条错误已经报出去了。
 */
async function checkTask(
  home: string,
  dir: string,
  scope: TaskScope,
  errors: string[],
  warnings: string[],
  counter: { n: number },
): Promise<{ type: string; isDefault: boolean } | undefined> {
  const dirName = relative(join(home), dir).split("/").pop() ?? "";
  const doc = await taskDocRootOf(dir, scope, dirName);
  const docRel = relative(home, doc);
  const taskMd = join(doc, "task.md");
  if (!await isFile(taskMd)) { errors.push(`Task 缺少 task.md：${docRel}/`); return undefined; }
  const text = await readFile(taskMd, "utf8");
  const field = (label: string): string | undefined => {
    const line = text.split("\n").find((candidate) => candidate.startsWith(`${label}：`) || candidate.startsWith(`${label}:`));
    return line === undefined ? undefined : line.slice(line.indexOf(label) + label.length + 1).trim();
  };
  const id = field("ID");
  const dirId = TASK_DIR.exec(dirName)?.[1];
  if (id === undefined) errors.push(`task.md 缺少 ID 字段：${docRel}/task.md`);
  else if (id !== dirId) errors.push(`task.md 的 ID（${id}）与目录编号（${dirId}）不一致：${docRel}/`);
  const type = field("类型") ?? "";
  if (!TASK_TYPES.has(type)) errors.push(`task.md 的类型 "${type}" 不在 ${[...TASK_TYPES].join("/")} 之内：${docRel}/task.md`);
  // 共同结构（协议 §5.1）
  for (const file of ["AGENTS.md", "concept-space.md", "flywheel.md"]) {
    if (!await isFile(join(doc, file))) errors.push(`Task 缺少 ${file}：${docRel}/`);
  }
  for (const sub of ["specs", "cases", "knowledge", "tools", "todo"]) {
    if (!await isDir(join(doc, sub))) errors.push(`Task 缺少 ${sub}/：${docRel}/`);
  }
  // 类型决定的日志（协议 §3.8）
  const hasLog = await isFile(join(doc, "log.md"));
  const hasDaily = await isDir(join(doc, "daily"));
  if (type === "daily") {
    if (!hasDaily) errors.push(`日常 Task 缺少 daily/：${docRel}/`);
    if (hasLog) warnings.push(`日常 Task 不应有 log.md（日志就是 daily/）：${docRel}/log.md`);
    const shards = (await readdir(join(doc, "daily")).catch(() => [] as string[])).filter((name) => name !== "AGENTS.md");
    for (const shard of shards) if (!DATE_FILE.test(shard)) errors.push(`daily/ 分片名应为 YYYY-MM-DD.md：${docRel}/daily/${shard}`);
    if (field("日期") !== undefined) warnings.push(`默认 Task 不应写"日期"字段（按天分片）：${docRel}/task.md`);
  } else {
    if (type === "development" && !hasLog) errors.push(`开发类 Task 缺少 log.md：${docRel}/`);
    if (type === "general" && hasLog) warnings.push(`普通类 Task 没有 log.md 的约定，这里多出了 log.md：${docRel}/`);
    if (hasDaily) warnings.push(`非日常 Task 不应有 daily/：${docRel}/`);
    const required = (field("必需文档") ?? "").split("·").map(requiredDocPathOf).filter((item) => item !== "");
    for (const item of required) {
      // 文档树（工作区优先）与主区都认：`evidence/` 这类不进版本控制的只在主区。
      const root = await exists(join(doc, item)) ? doc : dir;
      const ok = item.endsWith("/") ? await isDir(join(root, item)) : await isFile(join(root, item));
      if (!ok) errors.push(`必需文档缺失：${relative(home, root)}/${item}`);
    }
  }
  // Task 子树里每个目录也要有说明文件（协议 §5.2）；Task 根由上面那组共同结构检查覆盖。
  await requireNotes(home, doc, errors, counter);
  // 工作区形态下主区那份只有挂载点与 `evidence/`：前者按名字跳过，后者照 §5.2 要说明文件。
  if (doc !== dir) await requireNotes(home, dir, errors, counter);
  counter.n += 1;
  return { type, isDefault: type === "daily" };
}

/** 检查 specs/index.json 的条目都指向存在的正文（协议 §3.3）。 */
async function checkSpecIndex(home: string, root: string, errors: string[]): Promise<void> {
  const indexPath = join(root, "specs", "index.json");
  if (!await isFile(indexPath)) return;
  const data = await readJsonFile(indexPath);
  if (data === undefined) { errors.push(`specs/index.json 不是合法 JSON：${relative(home, indexPath)}`); return; }
  const specs = Array.isArray(data.specs) ? data.specs as Array<{ path?: unknown }> : [];
  for (const spec of specs) {
    if (typeof spec.path !== "string") { errors.push(`specs 条目缺少 path：${relative(home, indexPath)}`); continue; }
    if (!await isFile(join(root, "specs", spec.path))) errors.push(`规范索引指向不存在的正文：${relative(home, join(root, "specs", spec.path))}`);
  }
}

export async function checkHome(home: string): Promise<HomeCheckReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const counter = { n: 0 };
  if (!await isDir(home)) return { errors: [`家目录不存在：${home}`], warnings, checked: 0 };

  // 运行数据目录（程序写入、不入库）同样要有说明文件（协议 §5.2）：存在才检查，不存在不报错。
  for (const runtime of ["logs", "state", "media"]) {
    const dir = join(home, runtime);
    if (!await isDir(dir)) continue;
    counter.n += 1;
    if (!await isFile(join(dir, "AGENTS.md"))) errors.push(`缺少说明文件 AGENTS.md：${runtime}/（运行数据目录）`);
  }

  // 协议目录
  const harness = join(home, "interaction-harness");
  for (const file of ["protocol.md", "AGENTS.md"]) {
    if (!await isFile(join(harness, file))) errors.push(`协议目录缺少 ${file}`);
  }
  for (const type of TASK_TYPES) {
    if (!await isFile(join(harness, "task-types", type, "template.json"))) errors.push(`协议默认任务类型缺少模板：task-types/${type}/template.json`);
    if (!await isFile(join(harness, "task-types", type, "AGENTS.md"))) errors.push(`协议默认任务类型缺少规则：task-types/${type}/AGENTS.md`);
  }
  for (const name of ["layer-shared", "layer-agent", "layer-project", "task", "specs", "concept-space", "flywheel"]) {
    if (!await isFile(join(harness, "skeleton", `${name}.md`))) errors.push(`协议目录缺少骨架模板：skeleton/${name}.md`);
  }
  for (const legacy of LEGACY_HARNESS) {
    if (await isFile(join(harness, legacy)) || await isDir(join(harness, legacy))) errors.push(`协议目录里有旧结构残留（应移到共享 workspace）：interaction-harness/${legacy}`);
  }

  // 共享层：共享 workspace 与共享项目
  const projectsRoot = join(home, "projects");
  for (const pid of await subdirs(projectsRoot)) {
    const dir = join(projectsRoot, pid);
    const manifest = await readJsonFile(join(dir, "project.json"));
    if (manifest === undefined) { errors.push(`共享层缺少 project.json：projects/${pid}/`); continue; }
    if (manifest.id !== pid) errors.push(`project.json 的 id（${String(manifest.id)}）与目录（${pid}）不一致：projects/${pid}/`);
    if (pid === "workspace" && manifest.path !== undefined) errors.push("共享 workspace 的 project.json 不应有 path");
    if (pid !== "workspace" && typeof manifest.path !== "string") errors.push(`共享项目缺少 path：projects/${pid}/project.json`);
    if (await isDir(join(dir, "daily"))) errors.push(`共享层不应有 daily/（日志在 Task 里）：projects/${pid}/daily`);
    for (const file of ["AGENTS.md", "flywheel.md", "concept-space.md"]) {
      if (!await isFile(join(dir, file))) errors.push(`共享层缺少 ${file}：projects/${pid}/`);
    }
    for (const sub of ["specs", "cases", "knowledge", "tools", "todo", "memory", "task-types"]) {
      if (!await isDir(join(dir, sub))) errors.push(`共享层缺少 ${sub}/：projects/${pid}/`);
    }
    await checkSpecIndex(home, dir, errors);
    counter.n += 1;
  }
  await requireNotes(home, projectsRoot, errors, counter);

  // Agent 本身与 Agent × 项目
  const agentsRoot = join(home, "agents");
  for (const id of await subdirs(agentsRoot)) {
    const agentDir = join(agentsRoot, id);
    const agent = await readJsonFile(join(agentDir, "agent.json"));
    if (agent === undefined) { errors.push(`Agent 缺少 agent.json：agents/${id}/`); continue; }
    if (agent.id !== id) errors.push(`agent.json 的 id（${String(agent.id)}）与目录（${id}）不一致`);
    if (!await isFile(join(agentDir, "identity.md"))) errors.push(`Agent 缺少 identity.md：agents/${id}/`);
    if (await isFile(join(agentDir, "project.json"))) errors.push(`Agent 本身不应有 project.json：agents/${id}/`);
    if (await isDir(join(agentDir, "daily"))) errors.push(`Agent 本身不应有 daily/：agents/${id}/daily`);
    if (!await isFile(join(agentDir, "AGENTS.md"))) errors.push(`Agent 本身缺少 AGENTS.md：agents/${id}/`);
    for (const sub of ["tools", "memory"]) {
      if (!await isDir(join(agentDir, sub))) errors.push(`Agent 本身缺少 ${sub}/：agents/${id}/`);
    }
    const defaultProject = typeof agent.defaultProjectId === "string" ? agent.defaultProjectId : "workspace";
    if (!await isDir(join(agentDir, "projects", defaultProject))) errors.push(`默认项目目录不存在：agents/${id}/projects/${defaultProject}/`);
    counter.n += 1;

    for (const pid of await subdirs(join(agentDir, "projects"))) {
      const pdir = join(agentDir, "projects", pid);
      const rel = `agents/${id}/projects/${pid}`;
      if (await isFile(join(pdir, "project.json"))) errors.push(`Agent × 项目不应有 project.json（身份只在共享层）：${rel}/`);
      if (await isDir(join(pdir, "daily"))) errors.push(`Agent × 项目不应有 daily/（日志在默认 Task 里）：${rel}/daily`);
      for (const file of ["AGENTS.md", "flywheel.md", "concept-space.md"]) {
        if (!await isFile(join(pdir, file))) errors.push(`Agent × 项目缺少 ${file}：${rel}/`);
      }
      for (const sub of ["specs", "cases", "knowledge", "tools", "todo", "memory", "task-types", "sessions", "tasks"]) {
        if (!await isDir(join(pdir, sub))) errors.push(`Agent × 项目缺少 ${sub}/：${rel}/`);
      }
      await checkSpecIndex(home, pdir, errors);
      // 任务：编号连续、类型合法、默认 Task 恰好一个。Task 目录由 checkTask 负责，
      // 所以 `requireNotes` 那趟要把它们整棵跳过（否则同一个 Task 会被查两遍、报两遍）。
      const tasksDir = join(pdir, "tasks");
      const scope: TaskScope = { agentId: id, projectId: pid };
      const taskDirs = new Set<string>();
      let defaults = 0;
      for (const name of await subdirs(tasksDir)) {
        if (!TASK_DIR.test(name)) { errors.push(`Task 目录名应为 NNNN-标题：${rel}/tasks/${name}`); continue; }
        taskDirs.add(join(tasksDir, name));
        const info = await checkTask(home, join(tasksDir, name), scope, errors, warnings, counter);
        if (info?.isDefault) defaults += 1;
      }
      if (defaults === 0) errors.push(`Agent × 项目缺少默认 Task（类型 daily）：${rel}/tasks/`);
      if (defaults > 1) errors.push(`默认 Task 应只有一个，现在有 ${defaults} 个：${rel}/tasks/`);
      await requireNotes(home, pdir, errors, counter, taskDirs);
    }
  }
  await requireNotes(home, harness, errors, counter);
  return { errors, warnings, checked: counter.n };
}
