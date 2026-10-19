// 项目（= 被某个 Agent 打开的目录）的存储层（docs/architecture/agent.md §5.6）。
//
// 这轮的形态（用户 2026-10-18 定，先只做单 Agent）：
// - **项目只属于一个 Agent**：manifest 落在 `agents/<id>/projects/<pid>/project.json`（worker 私有层），
//   会话/记录也在同一目录下——目录在就是项目（"结构即事实"）。
// - pid = uuidv7（单调时间序免碰撞，与 Pi 会话 id 同构）；同 path 幂等复用。
// - manifest 只落家目录，**不写进用户项目目录**（保持用户仓库干净）。
// - 顶层共用层 `~/.lifeos/projects/`（多 Agent 共享）**已取消**，旧数据在这里懒迁移进来（见 migrateLegacy）。
//
// 待实现（只登记，不实现）：多 Agent 共用项目信息/资源——见 agent.md §5.6。
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { resolveHome } from "./home.ts";

export type ProjectManifest = { schemaVersion: 1; id: string; name: string; path: string };
export type ProjectError = { code: string; message: string; status: 400 | 404 };

const agentProjectsRoot = (agentId: string) => join(resolveHome(), "agents", agentId, "projects");
const manifestPath = (agentId: string, pid: string) => join(agentProjectsRoot(agentId), pid, "project.json");

/** 旧设计（已取消）的顶层共用层：只在迁移时读一次。 */
const legacyRoot = () => join(resolveHome(), "projects");

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
      ? { schemaVersion: 1, id: parsed.id, name: parsed.name, path: parsed.path }
      : undefined;
  } catch { return undefined; }
};

/**
 * 旧数据迁移（幂等，读路径上顺带做）：共用层 `~/.lifeos/projects/<pid>/project.json`
 * → 该 Agent 的私有层同名位置；搬完删旧文件，旧目录空则一并删掉（不留残留）。
 */
async function migrateLegacy(agentId: string, pid: string): Promise<ProjectManifest | undefined> {
  const legacyFile = join(legacyRoot(), pid, "project.json");
  const raw = await readFile(legacyFile, "utf8").catch(() => undefined);
  if (raw === undefined) return undefined;
  const manifest = parseManifest(raw);
  if (manifest === undefined) return undefined;
  const target = manifestPath(agentId, pid);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await rm(legacyFile, { force: true });
  // 只用 rmdir：目录空才删得掉。非空说明还有别的东西，宁可留着也不误删。
  await rmdir(join(legacyRoot(), pid)).catch(() => { /* 非空就留着 */ });
  await rmdir(legacyRoot()).catch(() => { /* 还有别的项目就留着 */ });
  return manifest;
}

/** 读一个项目的 manifest（外部项目才有）；顺带完成旧数据迁移。 */
export async function readProjectManifest(agentId: string, pid: string): Promise<ProjectManifest | undefined> {
  const raw = await readFile(manifestPath(agentId, pid), "utf8").catch(() => undefined);
  if (raw !== undefined) {
    // 迁移过之后可能还留着空的旧顶层目录：顺手清一下（空才删得掉）
    await rmdir(join(legacyRoot(), pid)).catch(() => { /* 没迁完或非空 */ });
    await rmdir(legacyRoot()).catch(() => { /* 还有别的项目 */ });
    return parseManifest(raw);
  }
  return await migrateLegacy(agentId, pid);
}

/** 该 Agent 名下所有带 manifest 的项目（外部项目）；列表与"同 path 幂等"都用它。 */
export async function readProjectManifests(agentId: string): Promise<Map<string, ProjectManifest>> {
  const out = new Map<string, ProjectManifest>();
  const entries = await readdir(agentProjectsRoot(agentId), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const manifest = await readProjectManifest(agentId, entry.name);
    if (manifest !== undefined) out.set(manifest.id, manifest);
  }
  return out;
}

/**
 * 注册 = "打开一个目录"（同 path 幂等复用；否则 uuidv7 新建）。
 * 返回 404/400 错误语义交由调用方转 HTTP。
 */
export async function registerProject(agentId: string, path: string): Promise<{ project: ProjectManifest; created: boolean } | ProjectError> {
  const target = resolve(path.trim());
  const info = await stat(target).catch(() => undefined);
  if (info === undefined) return { code: "not_found", message: "目录不存在", status: 404 };
  if (!info.isDirectory()) return { code: "not_a_directory", message: "不是目录", status: 400 };
  const existing = await readProjectManifests(agentId);
  for (const project of existing.values()) {
    if (project.path === target) return { project, created: false };
  }
  const pid = uuidv7();
  const name = basename(target) || target;
  const project: ProjectManifest = { schemaVersion: 1, id: pid, name, path: target };
  const dir = join(agentProjectsRoot(agentId), pid);
  await mkdir(dir, { recursive: true, mode: 0o700 });          // 私有层目录：0700（与家目录其余部分一致）
  await writeFile(join(dir, "project.json"), JSON.stringify(project, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  return { project, created: true };
}
