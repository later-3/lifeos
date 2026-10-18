// 项目注册（docs/architecture/agent.md §5.6 注册与解绑 · 2026-10-18 定稿）：
// - 共用层 = ~/.lifeos/projects/<pid>/project.json（跨 Agent 共享身份；扫描即枚举，不建 registry 总表）
// - pid = uuidv7（行业做法=单调时间序免碰撞，与 Pi 会话 id 同构）；同 path 幂等复用
// - manifest 只落家目录，**不写进用户项目目录**（保持用户仓库干净）
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { resolveHome } from "./home.ts";

export type SharedProject = { schemaVersion: 1; id: string; name: string; path: string };
export type ProjectError = { code: string; message: string; status: 400 | 404 };

const sharedRoot = () => join(resolveHome(), "projects");

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

/** 扫描共用层（枚举 = 扫描，同 agent 扫描判据先例）。 */
export async function readSharedProjects(): Promise<Map<string, SharedProject>> {
  const out = new Map<string, SharedProject>();
  const entries = await readdir(sharedRoot(), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(await readFile(join(sharedRoot(), entry.name, "project.json"), "utf8")) as SharedProject;
      if (typeof manifest.id === "string" && typeof manifest.path === "string") out.set(manifest.id, manifest);
    } catch { /* 坏 manifest 跳过 */ }
  }
  return out;
}

export async function getShared(pid: string): Promise<SharedProject | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(sharedRoot(), pid, "project.json"), "utf8")) as SharedProject;
    return typeof manifest.id === "string" && typeof manifest.path === "string" ? manifest : undefined;
  } catch { return undefined; }
}

/**
 * 注册（合成入口的注册半）：同 path 幂等复用；否则 uuidv7 新建 manifest。
 * 返回 404/400 错误语义交由调用方转 HTTP。
 */
export async function registerShared(path: string): Promise<{ project: SharedProject; created: boolean } | ProjectError> {
  const target = resolve(path.trim());
  const info = await stat(target).catch(() => undefined);
  if (info === undefined) return { code: "not_found", message: "目录不存在", status: 404 };
  if (!info.isDirectory()) return { code: "not_a_directory", message: "不是目录", status: 400 };
  const existing = await readSharedProjects();
  for (const project of existing.values()) {
    if (project.path === target) return { project, created: false };
  }
  const pid = uuidv7();
  const name = basename(target) || target;
  const project: SharedProject = { schemaVersion: 1, id: pid, name, path: target };
  const dir = join(sharedRoot(), pid);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, "project.json"), JSON.stringify(project, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  return { project, created: true };
}
