// 多角色读取的合并（docs/architecture/agent-memory.md §3）：
// 顺序由调用方给（默认 4→1→3→2），先到先得、按 id 去重、截断到 limit。
import type { MemoryHit } from "./index.ts";
import type { MemoryRole } from "./roles.ts";

export type RoleHit = MemoryHit & { role: MemoryRole };

export function mergeRoleHits(groups: Array<{ role: MemoryRole; hits: MemoryHit[] }>, limit: number): RoleHit[] {
  if (limit <= 0) return [];
  const seen = new Set<string>();
  const out: RoleHit[] = [];
  for (const group of groups) {
    for (const hit of group.hits) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      out.push({ ...hit, role: group.role });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
