// 全局项目注册表（2026-10-20 定）：`~/.lifeos/projects/<name>/project.json`。
// 项目是全局实体：同一个目录无论被多少个 Agent 打开，都只有一个全局 id。
// 记忆的「项目共享记忆」与跨项目读取都用这个 id。
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { resolveHome } from "./home.ts";
import { sanitizeSegment } from "./segments.ts";

export type GlobalProject = { schemaVersion: 1; id: string; name: string; path: string };

const registryRoot = () => join(resolveHome(), "projects");
const manifestPath = (id: string) => join(registryRoot(), id, "project.json");

const projectAgentsMd = `# 全局项目层

这里是项目的全局身份（\`project.json\`）与**项目共享记忆**（\`memory/\`）。

- 同一个目录无论被多少个 Agent 打开，都只有一个全局 id；
- 项目共享记忆所有绑定它的 Agent 都可读/写/删；
- 会话、daily、cases、todo 等私有记录在 \`agents/<agentId>/projects/<projectId>/\`，不在这里。`;

const memoryAgentsMd = `# memory/

项目共享记忆（属于项目这个全局实体，所有绑定它的 Agent 都可读/写/删）。

- 由记忆工具读写（\`lifeos_memory_search/record/delete\`），**不要手改数据库文件**；
- 空目录正常：第一次写入时才创建 SQLite；
- 项目私有数据（会话、daily、cases、todo）在各自的 Agent 绑定目录，不在这里。`;

async function ensureMemoryDir(id: string): Promise<void> {
  const dir = join(registryRoot(), id, "memory");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, "AGENTS.md"), memoryAgentsMd + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" })
    .catch(() => { /* 已存在：不覆盖 */ });
  await writeFile(join(registryRoot(), id, "AGENTS.md"), projectAgentsMd + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" })
    .catch(() => { /* 已存在：不覆盖 */ });
}

const parse = (raw: string): GlobalProject | undefined => {
  try {
    const parsed = JSON.parse(raw) as Partial<GlobalProject>;
    return typeof parsed.id === "string" && typeof parsed.name === "string" && typeof parsed.path === "string"
      ? { schemaVersion: 1, id: parsed.id, name: parsed.name, path: parsed.path }
      : undefined;
  } catch { return undefined; }
};

/** 全局项目 id 清单（目录名 = id；忽略隐藏目录与坏文件）。 */
export async function listGlobalProjects(): Promise<Map<string, GlobalProject>> {
  const out = new Map<string, GlobalProject>();
  const entries = await readdir(registryRoot(), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const project = await readGlobalProject(entry.name);
    if (project !== undefined) {
      await ensureMemoryDir(project.id);
      out.set(project.id, project);
    }
  }
  return out;
}

export async function readGlobalProject(id: string): Promise<GlobalProject | undefined> {
  return parse(await readFile(manifestPath(id), "utf8").catch(() => ""));
}

/** 规范化路径（解析符号链接）；不存在时退回 resolve。 */
async function canonical(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

/**
 * 注册一个目录为全局项目（同 path 幂等）。
 * - 同一个 path 永远返回同一个 id；
 * - 不同 path 同名 → `<name>-2`、`<name>-3`；
 * - `preferredName` 用来让已有 Agent 的目录名尽量保持不变。
 */
export async function registerGlobalProject(path: string, preferredName?: string): Promise<GlobalProject> {
  const target = resolve(path);                       // 存用户看到的路径（不把 /tmp 变成 /private/tmp）
  const canonicalTarget = await canonical(target);    // 匹配用 canonical（符号链接也视为同一目录）
  const projects = [...(await listGlobalProjects()).values()];
  for (const project of projects) {
    if (await canonical(project.path) === canonicalTarget) {
      await ensureMemoryDir(project.id);
      return project;
    }
  }
  const base = sanitizeSegment(preferredName !== undefined && preferredName !== "" ? preferredName : basename(target));
  const taken = new Set((await readdir(registryRoot()).catch(() => [] as string[])).filter((name) => !name.startsWith(".")));
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base.slice(0, 55)}-${n}`;
  const project: GlobalProject = { schemaVersion: 1, id, name: basename(target) || id, path: target };
  await ensureMemoryDir(id);
  await writeFile(manifestPath(id), JSON.stringify(project, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  return project;
}

/** 读全局项目；兼容旧调用（没有就按 path 注册）。 */
export async function ensureGlobalProject(path: string, preferredName?: string): Promise<GlobalProject> {
  return registerGlobalProject(path, preferredName);
}
