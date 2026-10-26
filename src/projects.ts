// 项目（= 被某个 Agent 打开的目录）的私有绑定层（.lifeos/projects/lifeos/knowledge/architecture/agent.md §5.6）。
//
// 形态（2026-10-22 校正）：
// - 项目是**全局实体**：`~/.lifeos/projects/<projectId>/project.json` 是共享身份；共享记忆与 specs 也在这里。
// - 本文件只负责该 Agent 的**私有绑定**：`agents/<id>/projects/<pid>/`（只有会话、任务与 Agent × 项目的规范，协议 §5.3）；
//   目录在就是绑定（"结构即事实"）。
// - pid = 可读目录名（中文允许）；同 path 幂等复用；旧 uuid 目录读取时懒迁移。
// - manifest 只落家目录，**不写进用户项目目录**（保持用户仓库干净）。
// - 共享 workspace 是顶层特殊项目 `projects/workspace/`；Agent 私有同名 `agents/<id>/projects/workspace/`。
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { resolveHome } from "./home.ts";
import { sanitizeSegment } from "./segments.ts";
import { ensureGlobalProject, readGlobalProject, type GlobalProject } from "./project-registry.ts";
import { ensureAgentProjectLayer } from "./project-skeleton.ts";
import { ensureDefaultTask, type TaskSummary } from "./tasks.ts";
import { readAgent, writeAgent } from "./agents.ts";
import { broadcast } from "./events.ts";

// id = 目录名 = **可读名**（用户会直接翻文件系统，2026-10-19 定）：中文允许；
// 旧设计的 uuid 目录在读取时懒迁移成可读名（manifest 里留 legacyId 供旧 URL 反查）。
export type ProjectManifest = { schemaVersion: 1; id: string; name: string; path: string; legacyId?: string };

export { sanitizeSegment } from "./segments.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 在某个 Agent 的 projects/ 下取一个不冲突的目录名（同名就 -2/-3）。 */
export async function uniqueSegment(agentId: string, base: string): Promise<string> {
  const taken = new Set(await readdir(agentProjectsRoot(agentId)).catch(() => [] as string[]));
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base.slice(0, 55)}-${n}`;
  return candidate;
}
export type ProjectError = { code: string; message: string; status: 400 | 404 | 422 };

const agentProjectsRoot = (agentId: string) => join(resolveHome(), "agents", agentId, "projects");

/** uuidv7：48 位时间戳 + version 7 + variant 10（与 Pi 的 createSessionId 同构）。 */
export function uuidv7(): string {
  const now = Date.now();
  const bytes = randomBytes(16);
  const ts = (shift: number) => Math.floor(now / 2 ** shift) % 256;
  bytes[0] = ts(40); bytes[1] = ts(32); bytes[2] = ts(24); bytes[3] = ts(16); bytes[4] = ts(8); bytes[5] = ts(0);
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);   // version 7
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);   // variant 10
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const parseManifest = (raw: string): ProjectManifest | undefined => {
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectManifest>;
    return typeof parsed.id === "string" && typeof parsed.path === "string" && typeof parsed.name === "string"
      ? {
          schemaVersion: 1, id: parsed.id, name: parsed.name, path: parsed.path,
          ...(typeof parsed.legacyId === "string" ? { legacyId: parsed.legacyId } : {}),   // 旧 pid 反查要用
        }
      : undefined;
  } catch { return undefined; }
};

/** 读一个绑定的项目身份：来自共享层 `projects/<pid>/project.json`（协议 §5.3）；外部项目才有 path。 */
export async function readProjectManifest(agentId: string, pid: string): Promise<ProjectManifest | undefined> {
  if (pid === "workspace") return undefined;
  if (!(await stat(join(agentProjectsRoot(agentId), pid)).then((info) => info.isDirectory(), () => false))) return undefined;
  const global = await readGlobalProject(pid);
  if (global === undefined || global.path === undefined) return undefined;
  return { schemaVersion: 1, id: global.id, name: global.name, path: global.path };
}

/** 该 Agent 名下所有带 manifest 的项目（外部项目）；列表与"同 path 幂等"都用它。 */
export async function readProjectManifests(agentId: string): Promise<Map<string, ProjectManifest>> {
  const out = new Map<string, ProjectManifest>();
  for (const dir of await scanProjectDirs(agentId)) {
    if (UUID_RE.test(dir)) continue;   // 旧 uuid 绑定目录不再自动迁移（历史数据搬迁另议）
    const manifest = await readProjectManifest(agentId, dir);
    if (manifest !== undefined) {
      await ensureAgentProjectLayer(join(agentProjectsRoot(agentId), dir));
      const global = await ensureGlobalProject(manifest.path, manifest.id);
      out.set(global.id === manifest.id ? manifest.id : dir, global.id === manifest.id ? manifest : { ...manifest, id: dir });
    }
  }
  return out;
}

/**
 * 注册 = "打开一个目录"（同 path 幂等复用；否则 uuidv7 新建）。
 * 返回 404/400 错误语义交由调用方转 HTTP。
 */
/** 项目在界面上的投影：id/name 都有；外部项目才带 path（workspace 的家目录不暴露）。 */
export type ProjectItem = { id: string; name: string; isDefault: boolean; path?: string };

/** 扫描某 Agent 的项目目录（只看目录，文件忽略；排序稳定）。 */
export async function scanProjectDirs(agentId: string): Promise<string[]> {
  const entries = await readdir(agentProjectsRoot(agentId), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
}

/** 列表 = projects/ 下的目录 − 已移除项；默认项目置顶，其余按名字。 */
export async function listAgentProjects(agentId: string): Promise<ProjectItem[]> {
  const agent = await readAgent(agentId);
  if (agent === undefined) return [];
  const defaultId = agent.defaultProjectId ?? "workspace";
  const manifests = await readProjectManifests(agentId);
  const hidden = new Set(agent.hiddenProjectIds ?? []);
  const items: ProjectItem[] = [];
  for (const dir of await scanProjectDirs(agentId)) {
    if (hidden.has(dir)) continue;
    const manifest = manifests.get(dir);
    const name = dir === "workspace" ? "workspace" : manifest !== undefined ? basename(manifest.path) || dir : dir;
    const path = dir === "workspace" ? undefined : manifest?.path ?? join(agentProjectsRoot(agentId), dir);
    items.push({ id: dir, name, isDefault: dir === defaultId, ...(path !== undefined ? { path } : {}) });
  }
  items.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  return items;
}

/** 注册并绑定：同 path 幂等复用；之前"从列表移除"过的话摘掉 hidden 标记（重新出现）。 */
export async function bindProject(agentId: string, path: string): Promise<{ project: ProjectItem; created: boolean; changed: boolean; defaultTask: TaskSummary } | ProjectError> {
  const agent = await readAgent(agentId);
  if (agent === undefined) return { code: "agent_not_found", message: "找不到这个 Agent", status: 404 };
  const registered = await registerProject(agentId, path).catch((error: unknown) => {
    // 项目骨架或默认 Task 建不出来：返回可读错误，且（新建绑定时）已回滚到"没添加过"的状态
    if (error instanceof DefaultTaskFailed) return { code: "default_task_failed" as const, message: error.message, status: 422 as const };
    throw error;
  });
  if ("code" in registered) return registered;
  const defaultId = agent.defaultProjectId ?? "workspace";
  const project: ProjectItem = {
    id: registered.project.id, name: registered.project.name, path: registered.project.path,
    isDefault: registered.project.id === defaultId,
  };
  const hidden = (agent.hiddenProjectIds ?? []).filter((item) => item !== project.id);
  const unhidden = hidden.length !== (agent.hiddenProjectIds ?? []).length;
  if (unhidden) await writeAgent({ ...agent, hiddenProjectIds: hidden });
  const changed = registered.created || unhidden;
  // 写操作在共享实现里广播：工具与 HTTP 两条入口都会闭环，不依赖调用方记得 notify
  if (changed) broadcast({ type: "agents_changed" });
  return { project, created: registered.created, changed, defaultTask: registered.defaultTask };
}

/** 从该 Agent 的列表移除：写 hiddenProjectIds；目录、manifest、会话全部保留；默认项目不可移除。 */
export async function unbindProject(agentId: string, pid: string): Promise<"unbound" | ProjectError> {
  const agent = await readAgent(agentId);
  if (agent === undefined) return { code: "agent_not_found", message: "找不到这个 Agent", status: 404 };
  const defaultId = agent.defaultProjectId ?? "workspace";
  if (pid === "workspace" || pid === defaultId) return { code: "cannot_unbind_default", message: "默认项目不可解绑", status: 400 };
  const hidden = agent.hiddenProjectIds ?? [];
  if (hidden.includes(pid)) return { code: "project_not_found", message: "该 Agent 下没有这个项目", status: 404 };
  if (!(await scanProjectDirs(agentId)).includes(pid)) return { code: "project_not_found", message: "该 Agent 下没有这个项目", status: 404 };
  await writeAgent({ ...agent, hiddenProjectIds: [...hidden, pid] });
  broadcast({ type: "agents_changed" });
  return "unbound";
}

export async function registerProject(agentId: string, path: string): Promise<{ project: ProjectManifest; created: boolean; defaultTask: TaskSummary } | ProjectError> {
  const target = resolve(path.trim());
  const info = await stat(target).catch(() => undefined);
  if (info === undefined) return { code: "not_found", message: "目录不存在", status: 404 };
  if (!info.isDirectory()) return { code: "not_a_directory", message: "不是目录", status: 400 };
  const existing = await readProjectManifests(agentId);
  for (const project of existing.values()) {
    if (project.path === target) {
      // 已有绑定：确保全局注册表有同 path 的条目，并让 Agent 的绑定目录名 = 全局 id
      const global = await ensureGlobalProject(project.path, project.id);
      const bound = await bindAgentProject(agentId, project.id, global);
      return { project: bound.manifest, created: false, defaultTask: bound.defaultTask };
    }
  }
  const name = basename(target) || target;
  const global = await ensureGlobalProject(target, sanitizeSegment(name));   // 目录名 = 项目名（可读）
  const bound = await bindAgentProject(agentId, undefined, global);
  return { project: bound.manifest, created: true, defaultTask: bound.defaultTask };
}

/**
 * 把全局项目绑定到 Agent：目录名 = 全局 id（会话/记录/私有记忆都在这个目录下）。
 * 旧绑定目录名不同时顺便改名（会话文件跟着搬）。
 */
async function bindAgentProject(agentId: string, localId: string | undefined, global: GlobalProject): Promise<{ manifest: ProjectManifest; defaultTask: TaskSummary }> {
  const targetDir = join(agentProjectsRoot(agentId), global.id);
  const sourceDir = localId !== undefined && localId !== global.id ? join(agentProjectsRoot(agentId), localId) : targetDir;
  const existedBefore = await stat(targetDir).then((info) => info.isDirectory(), () => false);
  const moved = sourceDir !== targetDir;
  if (moved) {
    const targetExists = await stat(targetDir).catch(() => undefined);
    if (targetExists === undefined) await rename(sourceDir, targetDir).catch(() => { /* 并发/已搬走：按现状 */ });
  }
  if (global.path === undefined) throw new Error(`external project ${global.id} has no path`);
  // Agent × 项目层骨架（create-only，协议 §5.1）；身份只在共享层 project.json（协议 §5.3）
  await ensureAgentProjectLayer(targetDir);
  // 默认 Task：每个 Agent × 项目一个（协议 §6.1）。它是绑定的硬前提：
  // 失败就说明这个项目不能正常用（新建会话会立刻失败），所以不能留下"项目在列表里但用不了"的半成品。
  let defaultTask: TaskSummary;
  try {
    defaultTask = await ensureDefaultTask({ agentId, projectId: global.id });
  } catch (error) {
    // 只回滚**本次新建**的绑定目录；搬过来的目录里有会话文件，删掉就是丢数据，绝不动。
    if (!existedBefore && !moved) await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    throw new DefaultTaskFailed(global.id, error instanceof Error ? error.message : String(error));
  }
  return { manifest: { schemaVersion: 1, id: global.id, name: global.name, path: global.path }, defaultTask };
}

/** 默认 Task 建不出来：带上原因，让 HTTP / 工具层能给可读错误，而不是 500 纯文本。 */
export class DefaultTaskFailed extends Error {
  readonly projectId: string;
  constructor(projectId: string, reason: string) {
    super(`默认 Task 创建失败：${reason}`);
    this.name = "DefaultTaskFailed";
    this.projectId = projectId;
  }
}
