// 全局项目注册表（协议 §4.2、§5.3）：`~/.lifeos/projects/<id>/project.json` 是项目身份的唯一来源；骨架由 project-skeleton 补齐。
// 项目是全局实体：同一个目录无论被多少个 Agent 打开，都只有一个全局 id。
// 记忆的「项目共享记忆」、项目 specs 与跨项目读取都用这个 id；workspace 是特殊全局项目（无 path）。
import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { resolveHome } from "./home.ts";
import { entityId, sanitizeSegment, uniqueId } from "./segments.ts";
import { ensureSharedLayer } from "./project-skeleton.ts";

export type GlobalProject = { schemaVersion: 1; id: string; name: string; path?: string; icon?: string };

/** `icon` 的形态（任务 0005 · 用户 2026-11-03 拍板）：
 *  **一个 emoji 或一个内置图标名**，不是图片文件。
 *  为什么不做图片：存储/尺寸/裁剪/缓存/迁移是另一个量级；6 个参考项目里
 *  有视觉标识的 3 个（Open WebUI / Zulip / Rocket.Chat）全部是单字符形态。
 *  空串、非字符串、超过 32 字符一律视为“没有图标”（不编占位）。 */
export const ICON_MAX_CHARS = 32;

export function normalizeIcon(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if ([...trimmed].length > ICON_MAX_CHARS) return undefined;
  if (/[\r\n\t]/.test(trimmed)) return undefined;
  return trimmed;
}

const registryRoot = () => join(resolveHome(), "projects");

/**
 * 路径 → 稳定但不透明的 id（`project-a1b2c3`）。
 *
 * 为什么不用随机：同一个目录必须永远得到同一个 id（幂等注册是硬要求）。
 * 为什么不用 sanitizeSegment：中文 id 会进 URL，必坏。
 * hash 取路径的 sha1 前 6 位——极低碰撞，且同路径确定。
 */
function opaqueProjectId(canonicalPath: string): string {
  const digest = createHash("sha1").update(canonicalPath).digest("hex").slice(0, 6);
  return `project-${digest}`;
}
const manifestPath = (id: string) => join(registryRoot(), id, "project.json");

const parse = (raw: string): GlobalProject | undefined => {
  try {
    const parsed = JSON.parse(raw) as Partial<GlobalProject>;
    if (typeof parsed.id !== "string" || typeof parsed.name !== "string") return undefined;
    const icon = normalizeIcon(parsed.icon);
    return {
      schemaVersion: 1, id: parsed.id, name: parsed.name,
      ...(typeof parsed.path === "string" && parsed.path !== "" ? { path: parsed.path } : {}),
      ...(icon !== undefined ? { icon } : {}),
    };
  } catch { return undefined; }
};

/** 共享 workspace：所有 Agent 的全局特殊项目；id 与私有 workspace 同名，靠层级区分。 */
export const SHARED_WORKSPACE_ID = "workspace";

export async function ensureSharedWorkspace(): Promise<GlobalProject> {
  const project: GlobalProject = { schemaVersion: 1, id: SHARED_WORKSPACE_ID, name: "workspace" };
  await ensureSharedLayer(join(registryRoot(), SHARED_WORKSPACE_ID), project);
  return project;
}

/** 全局项目 id 清单（目录名 = id；忽略隐藏目录与坏文件）。 */
export async function listGlobalProjects(): Promise<Map<string, GlobalProject>> {
  const out = new Map<string, GlobalProject>();
  const workspace = await ensureSharedWorkspace();
  out.set(workspace.id, workspace);
  const entries = await readdir(registryRoot(), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const project = await readGlobalProject(entry.name);
    if (project !== undefined) {
      await ensureSharedLayer(join(registryRoot(), project.id), project);
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
  // 特殊：注册 home 等于共享 workspace；返回同一个 workspace 身份。
  if (canonicalTarget === await canonical(resolveHome())) return await ensureSharedWorkspace();
  const projects = [...(await listGlobalProjects()).values()];
  for (const project of projects) {
    if (project.path !== undefined && await canonical(project.path) === canonicalTarget) return project;
  }
  // id 必须 ASCII：pid 会进 URL（`/api/agents/:id/projects/:pid/...`），而前端不做 encodeURIComponent。
  // 以前用 sanitizeSegment（允许中文），只要有人注册中文目录就会产出中文 pid → 请求直接坏掉。
  // 现在：名字可读的走 ASCII slug；转不出就用不透明但**稳定**的 `project-<hash>`（不是随机，
  // 同一路径永远同一个 id），并在 name 里保留可读名——界面显示 name，id 只内部用（07-id-normalization.md）。
  const displayName = basename(target) || (preferredName ?? "");
  const wanted = preferredName !== undefined && preferredName !== "" ? preferredName : displayName;
  const generated = entityId(wanted, "url");
  const base = generated.ok ? generated.id : opaqueProjectId(canonicalTarget);
  const taken = new Set((await readdir(registryRoot()).catch(() => [] as string[])).filter((name) => !name.startsWith(".")));
  const id = uniqueId(base, taken);
  const project: GlobalProject = { schemaVersion: 1, id, name: displayName || id, path: target };
  await ensureSharedLayer(join(registryRoot(), id), project);
  return project;
}

/** 读全局项目；兼容旧调用（没有就按 path 注册）。 */
export async function ensureGlobalProject(path: string, preferredName?: string): Promise<GlobalProject> {
  return registerGlobalProject(path, preferredName);
}
