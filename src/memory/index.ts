// 记忆的读写 API（P1）：四角色、隔离、软删除。
// 上层（工具/HTTP/面板）只调这里，不直接碰 MemOS。
import { randomUUID } from "node:crypto";
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
  const { core } = await storeFor(role);
  const result = await core.searchMemory({ agent: "lifeos", query, reason: "tool_driven" } as never) as unknown as SearchResult;
  const hits = (result.hits ?? []) as Array<{ refId: string; score: number; snippet?: string }>;
  return hits
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

/** 硬删除（MemOS `deleteTrace`，不可恢复）：只在用户明确要求时调用。 */
export async function deleteMemory(role: MemoryRole, id: string): Promise<boolean> {
  const { core } = await storeFor(role);
  const result = await core.deleteTrace(id) as unknown as { deleted: boolean };
  return result.deleted === true;
}

export { closeMemoryStores } from "./store.ts";
export { storeRoot, roleKey, roleLabel, defaultReadOrder, DEFAULT_USER_ID } from "./roles.ts";
export { mergeRoleHits } from "./merge.ts";
export type { RoleHit } from "./merge.ts";
export type { MemoryRole } from "./roles.ts";
