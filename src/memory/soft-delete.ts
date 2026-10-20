// 软删除（docs/architecture/agent-memory.md §4 删除语义）。
// MemOS 的 deleteTrace 是硬删除；这里维护"软删清单"，检索时过滤、满 30 天后才真删。
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SOFT_DELETE_RETENTION_DAYS = 30;

export type DeletionMap = Record<string, string>;   // id → deletedAt(ISO)

const fileOf = (root: string): string => join(root, "soft-deleted.json");

export async function readDeletions(root: string): Promise<DeletionMap> {
  const text = await readFile(fileOf(root), "utf8").catch(() => "");
  if (text === "") return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: DeletionMap = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === "string") out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

export async function writeDeletions(root: string, map: DeletionMap): Promise<void> {
  const path = fileOf(root);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(map, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

export function hiddenIds(map: DeletionMap): Set<string> {
  return new Set(Object.keys(map));
}

/** 软删超过保留期的 id（用于 purge：调用 MemOS 的硬删除）。 */
export function expiredIds(map: DeletionMap, now: number, retentionDays = SOFT_DELETE_RETENTION_DAYS): string[] {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  return Object.entries(map)
    .filter(([, at]) => {
      const ts = Date.parse(at);
      return Number.isFinite(ts) && ts < cutoff;   // 满 30 天之后才删（边界当天仍可恢复）
    })
    .map(([id]) => id);
}
