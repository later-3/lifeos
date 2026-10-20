// 记忆的读写 API（P1）：四角色、隔离、软删除。
// 上层（工具/HTTP/面板）只调这里，不直接碰 MemOS。
import { randomUUID } from "node:crypto";
import { readDeletions, writeDeletions, hiddenIds, expiredIds } from "./soft-delete.ts";
import { storeFor } from "./store.ts";
import { mergeRoleHits, type RoleHit } from "./merge.ts";
import type { MemoryRole } from "./roles.ts";

export type MemoryHit = { id: string; score: number; text: string };
export type MemoryToolCall = { name: string; input?: unknown; result?: string; isError?: boolean };

type SearchResult = Awaited<ReturnType<Awaited<ReturnType<typeof storeFor>>["core"]["searchMemory"]>>;

/** 写入一轮（用户说了什么、Agent 回了什么），落到指定角色。 */
export async function recordMemory(role: MemoryRole, input: {
  userText: string;
  agentText: string;
  toolCalls?: MemoryToolCall[];
  sessionId?: string;
  ts?: number;
}): Promise<{ traceId: string; episodeId: string }> {
  const { core } = await storeFor(role);
  const ts = input.ts ?? Date.now();
  const sessionId = input.sessionId ?? `memory-${randomUUID()}`;
  const session = await core.openSession({ agent: "lifeos", sessionId } as never);
  const episodeId = await core.openEpisode({ sessionId: session, userMessage: input.userText } as never);
  await core.onTurnStart({
    agent: "lifeos", sessionId: session, episodeId, userText: input.userText, ts,
  } as never);
  return await core.onTurnEnd({
    agent: "lifeos", sessionId: session, episodeId, agentText: input.agentText,
    toolCalls: input.toolCalls ?? [], ts,
  } as never) as unknown as { traceId: string; episodeId: string };
}

/** 检索一个角色（软删除的条目不返回）。 */
export async function searchMemory(role: MemoryRole, query: string, options: { limit?: number } = {}): Promise<MemoryHit[]> {
  const { core, root } = await storeFor(role);
  const result = await core.searchMemory({ agent: "lifeos", query, reason: "tool_driven" } as never) as unknown as SearchResult;
  const hidden = hiddenIds(await readDeletions(root));
  const hits = (result.hits ?? []) as Array<{ refId: string; score: number; snippet?: string }>;
  return hits
    .filter((hit) => !hidden.has(hit.refId))
    .slice(0, options.limit ?? 20)
    .map((hit) => ({ id: hit.refId, score: hit.score, text: String(hit.snippet ?? "") }));
}

/** 按给定角色顺序合并检索（默认顺序由 `defaultReadOrder` 给：私有→项目共享→Agent→用户）。 */
export async function searchMemoryScopes(roles: MemoryRole[], query: string, options: { limit?: number } = {}): Promise<RoleHit[]> {
  const limit = options.limit ?? 20;
  const groups: Array<{ role: MemoryRole; hits: MemoryHit[] }> = [];
  for (const role of roles) {
    groups.push({ role, hits: await searchMemory(role, query, { limit }) });
  }
  return mergeRoleHits(groups, limit);
}

/** 软删除：只记入软删清单（检索立即不可见），满保留期后由 purgeDeleted 真正删除。 */
export async function softDeleteMemory(role: MemoryRole, id: string, now = Date.now()): Promise<void> {
  const { root } = await storeFor(role);
  const map = await readDeletions(root);
  map[id] = new Date(now).toISOString();
  await writeDeletions(root, map);
}

/** 恢复软删除。 */
export async function restoreMemory(role: MemoryRole, id: string): Promise<boolean> {
  const { root } = await storeFor(role);
  const map = await readDeletions(root);
  if (map[id] === undefined) return false;
  delete map[id];
  await writeDeletions(root, map);
  return true;
}

/** 彻底删除过期（默认 30 天）的软删条目；返回实际清掉的 id。 */
export async function purgeDeleted(role: MemoryRole, retentionDays?: number, now = Date.now()): Promise<string[]> {
  const { core, root } = await storeFor(role);
  const map = await readDeletions(root);
  const expired = expiredIds(map, now, retentionDays);
  for (const id of expired) {
    await core.deleteTrace(id);
    delete map[id];
  }
  if (expired.length > 0) await writeDeletions(root, map);
  return expired;
}

/** 当前软删除清单（面板的"已删除/可恢复"视图用）。 */
export async function listDeleted(role: MemoryRole): Promise<Array<{ id: string; deletedAt: string }>> {
  const { root } = await storeFor(role);
  const map = await readDeletions(root);
  return Object.entries(map).map(([id, deletedAt]) => ({ id, deletedAt }));
}

export { closeMemoryStores } from "./store.ts";
export { storeRoot, roleKey, roleLabel, defaultReadOrder, DEFAULT_USER_ID } from "./roles.ts";
export { mergeRoleHits } from "./merge.ts";
export type { RoleHit } from "./merge.ts";
export type { MemoryRole } from "./roles.ts";
