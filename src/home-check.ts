// 家目录结构校验（协议 §5、§6；`pnpm home:check`）：Life OS 生成或安装出来的结构是否符合协议。
// 只读、不修改任何文件；错误 = 不符合协议，警告 = 需要人看一眼。
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export type HomeCheckReport = { errors: string[]; warnings: string[]; checked: number };

const TASK_TYPES = new Set(["daily", "development", "general"]);
const LEGACY_HARNESS = ["flywheel.md", "memory.md", "concept-space.md", "concept-space", "cases"];
const DATE_FILE = /^\d{4}-\d{2}-\d{2}\.md$/;
const TASK_DIR = /^(\d{4})-.+$/;

async function isDir(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isDirectory(), () => false);
}
async function isFile(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isFile(), () => false);
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

/** 每个目录都必须有 AGENTS.md（协议 §5.2）；递归检查。 */
async function requireNotes(home: string, root: string, errors: string[], counter: { n: number }): Promise<void> {
  for (const name of await subdirs(root)) {
    const dir = join(root, name);
    counter.n += 1;
    const note = join(dir, "AGENTS.md");
    if (!await isFile(note)) errors.push(`缺少说明文件 AGENTS.md：${relative(home, dir)}/`);
    else {
      const text = await readFile(note, "utf8").catch(() => "");
      if (text.trim() === "") errors.push(`说明文件为空：${relative(home, dir)}/AGENTS.md`);
    }
    await requireNotes(home, dir, errors, counter);
  }
}

/** 检查一个 Task 目录（协议 §3.7、§6）。 */
async function checkTask(home: string, dir: string, errors: string[], warnings: string[]): Promise<{ type: string; isDefault: boolean } | undefined> {
  const rel = relative(home, dir);
  const taskMd = join(dir, "task.md");
  if (!await isFile(taskMd)) { errors.push(`Task 缺少 task.md：${rel}/`); return undefined; }
  const text = await readFile(taskMd, "utf8");
  const field = (label: string): string | undefined => {
    const line = text.split("\n").find((candidate) => candidate.startsWith(`${label}：`) || candidate.startsWith(`${label}:`));
    return line === undefined ? undefined : line.slice(line.indexOf(label) + label.length + 1).trim();
  };
  const id = field("ID");
  const dirId = TASK_DIR.exec(relative(join(home), dir).split("/").pop() ?? "")?.[1];
  if (id === undefined) errors.push(`task.md 缺少 ID 字段：${rel}/task.md`);
  else if (id !== dirId) errors.push(`task.md 的 ID（${id}）与目录编号（${dirId}）不一致：${rel}/`);
  const type = field("类型") ?? "";
  if (!TASK_TYPES.has(type)) errors.push(`task.md 的类型 "${type}" 不在 daily/development/general 之内：${rel}/task.md`);
  // 共同结构（协议 §5.1）
  for (const file of ["AGENTS.md", "concept-space.md", "flywheel.md"]) {
    if (!await isFile(join(dir, file))) errors.push(`Task 缺少 ${file}：${rel}/`);
  }
  for (const sub of ["specs", "cases", "knowledge", "tools", "todo"]) {
    if (!await isDir(join(dir, sub))) errors.push(`Task 缺少 ${sub}/：${rel}/`);
  }
  // 类型决定的日志（协议 §3.8）
  const hasLog = await isFile(join(dir, "log.md"));
  const hasDaily = await isDir(join(dir, "daily"));
  if (type === "daily") {
    if (!hasDaily) errors.push(`日常 Task 缺少 daily/：${rel}/`);
    if (hasLog) warnings.push(`日常 Task 不应有 log.md（日志就是 daily/）：${rel}/log.md`);
    const shards = (await readdir(join(dir, "daily")).catch(() => [] as string[])).filter((name) => name !== "AGENTS.md");
    for (const shard of shards) if (!DATE_FILE.test(shard)) errors.push(`daily/ 分片名应为 YYYY-MM-DD.md：${rel}/daily/${shard}`);
    if (field("日期") !== undefined) warnings.push(`默认 Task 不应写"日期"字段（按天分片）：${rel}/task.md`);
  } else {
    if (type === "development" && !hasLog) errors.push(`开发类 Task 缺少 log.md：${rel}/`);
    if (type === "general" && hasLog) warnings.push(`普通类 Task 没有 log.md 的约定，这里多出了 log.md：${rel}/`);
    if (hasDaily) warnings.push(`非日常 Task 不应有 daily/：${rel}/`);
    const required = (field("必需文档") ?? "").split("·").map((item) => item.trim()).filter((item) => item !== "");
    for (const item of required) {
      const target = join(dir, item);
      const ok = item.endsWith("/") ? await isDir(target) : await isFile(target);
      if (!ok) errors.push(`必需文档缺失：${rel}/${item}`);
    }
  }
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
      // 任务：编号连续、类型合法、默认 Task 恰好一个
      const tasksDir = join(pdir, "tasks");
      let defaults = 0;
      for (const name of await subdirs(tasksDir)) {
        if (!TASK_DIR.test(name)) { errors.push(`Task 目录名应为 NNNN-标题：${rel}/tasks/${name}`); continue; }
        const info = await checkTask(home, join(tasksDir, name), errors, warnings);
        if (info?.isDefault) defaults += 1;
        counter.n += 1;
      }
      if (defaults === 0) errors.push(`Agent × 项目缺少默认 Task（类型 daily）：${rel}/tasks/`);
      if (defaults > 1) errors.push(`默认 Task 应只有一个，现在有 ${defaults} 个：${rel}/tasks/`);
      await requireNotes(home, pdir, errors, counter);
    }
  }
  await requireNotes(home, harness, errors, counter);
  return { errors, warnings, checked: counter.n };
}
