/**
 * 会话消息的内存缓存（Task 0016 · B1）。
 *
 * ## 为什么需要（实测）
 *
 * 三层都没缓存：退出会话再进去，**同一个会话重新下 490 KB、重新解析、重新渲染**。
 * 本机 40 ms 看不出痛，手机经 CF（300ms 延迟 + 4G）≈ 2.5 s —— 差 60 倍。
 *
 * ## 参考取舍（谁的做法、为什么不全抄）
 *
 * | 参考 | 做法 | 我们借什么 / 不借什么 |
 * |---|---|---|
 * | LibreChat `data-provider/Messages/queries.ts:270-274` | `refetchOnMount/OnWindowFocus/OnReconnect` 全 false → 命中缓存就不取 | **借**：命中即先用。<br>**不借**：它没有过期概念（文件级缓存永不到期，只靠 `getStableMessages` 兜竞态） |
 * | lobe-chat `store/chat/slices/message/actions/transcript.ts:40-46` | 流式期间 `skipFetch`（"a focus refetch doesn't clobber them with a stale DB snapshot"） | **借**：正在跑的会话不写缓存、不用缓存 |
 * | pi-web `hooks/useAgentSession.ts:219` | `cache: "no-store"`，不做任何客户端缓存 | **不借**：它靠 `deferThinking/deferMedia` 把载荷压小，但每次切会话仍要一次往返 |
 * | lobe-chat `libs/replica/prePaint.ts:3-12` | 先渲染缓存再校验，上限 50 ms | **借**思路，**不借** IndexedDB（只有"刷新页面"受益，成本是内存版的数倍；LibreChat 也没持久化） |
 *
 * ## 三条硬规则
 *
 * 1. **键必须带 agentId**（规范 2.12：跨作用域缓存要带归属）——同一个 sessionId 在
 *    两个 Agent 下是不同的事实。
 * 2. **正在跑的会话不进缓存**：流式内容一旦缓存，切回来看到的是"半句话"，
 *    而且 `meta.running` 也是旧的。这条与 lobe-chat 的 `skipFetch` 同一判据。
 * 3. **过期要靠"时间 + 服务端事实"两条**：时间（`TTL_MS`）防长期陈旧；
 *    `meta.running` 与服务端的 `turns/last` 是对账，切回来仍会走一次轻量对账（不只是读缓存）。
 *
 * ## 为什么是 Map + 上限，而不是无限增长
 *
 * 消息对象不小（一个 200 条的会话 ≈ 490 KB 的 JSON，堆里更大）。
 * 上限按条数而不是字节：条数是"用户切换过多少个会话"的直接度量，而字节数要逐条算（慢且无必要）。
 */
import type { Message } from "./Message";

/**
 * 缓存里带的 meta 只用到"能不能缓存"（`running`）与界面展示（原样透传）。
 * **不 import App.tsx 的 `SessionMeta`**：那是 App 的局部类型，反向依赖会把
 * 一个纯数据模块拖进整个页面 —— 用结构最小集，谁都能传。
 */
export type CachedMeta = { running?: boolean } & Record<string, unknown>;

/** 缓存条目的存活上限。60 s 是"用户切走再切回"的典型窗口（读别的会话、翻列表）。 */
export const MESSAGE_CACHE_TTL_MS = 60_000;

/** 最多缓存多少个会话。8 个 = 手机抽屉一屏可见的行数，再多也记不住。 */
export const MESSAGE_CACHE_MAX = 8;

export type CachedSession = {
  messages: Message[];
  meta?: CachedMeta;
  total?: number;
  tailStart?: number;
  /** 写入时刻（ms）：用于 TTL 判定与 LRU 淘汰。 */
  at: number;
};

/** 复合键：`<agentId>\u0000<sessionId>`（NUL 分隔，id 里不可能出现）。 */
export function messageCacheKey(agentId: string, sessionId: string): string {
  return `${agentId}\u0000${sessionId}`;
}

export type MessageCache = {
  get: (agentId: string, sessionId: string, now?: number) => CachedSession | undefined;
  set: (agentId: string, sessionId: string, value: Omit<CachedSession, "at">, now?: number) => void;
  /** 只更新 meta（流式收尾、对账之后），不动 messages —— 用于"内容没变但状态变了"。 */
  patchMeta: (agentId: string, sessionId: string, meta: CachedMeta | undefined, now?: number) => void;
  invalidate: (agentId: string, sessionId: string) => void;
  clear: () => void;
  /** 仅供测试/诊断。 */
  size: () => number;
};

/**
 * 造一个缓存实例（工厂而不是模块级单例：测试之间不串，Agent 切换时也可以整体清）。
 *
 * 淘汰策略：写入时若超上限，删掉**最旧**的那一条（`at` 最小）。这就是 LRU 的近似——
 * 读取不更新 `at`，因为我们要的是"最近打开过"，而读取发生在打开时（写缓存也在那一刻）。
 */
export function createMessageCache(options?: { ttlMs?: number; max?: number }): MessageCache {
  const ttlMs = options?.ttlMs ?? MESSAGE_CACHE_TTL_MS;
  const max = options?.max ?? MESSAGE_CACHE_MAX;
  const map = new Map<string, CachedSession>();

  const evictIfNeeded = () => {
    while (map.size > max) {
      let oldestKey: string | undefined;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [key, value] of map) {
        if (value.at < oldestAt) { oldestAt = value.at; oldestKey = key; }
      }
      if (oldestKey === undefined) return;
      map.delete(oldestKey);
    }
  };

  return {
    get(agentId, sessionId, now = Date.now()) {
      const key = messageCacheKey(agentId, sessionId);
      const hit = map.get(key);
      if (hit === undefined) return undefined;
      if (now - hit.at > ttlMs) { map.delete(key); return undefined; }
      return hit;
    },
    set(agentId, sessionId, value, now = Date.now()) {
      map.set(messageCacheKey(agentId, sessionId), { ...value, at: now });
      evictIfNeeded();
    },
    patchMeta(agentId, sessionId, meta, now = Date.now()) {
      const key = messageCacheKey(agentId, sessionId);
      const hit = map.get(key);
      if (hit === undefined) return;
      // 只在没超过 TTL 时补：过期条目补了 meta 也没人会用
      if (now - hit.at > ttlMs) { map.delete(key); return; }
      map.set(key, { ...hit, ...(meta !== undefined ? { meta } : {}), at: hit.at });
    },
    invalidate(agentId, sessionId) {
      map.delete(messageCacheKey(agentId, sessionId));
    },
    clear() { map.clear(); },
    size() { return map.size; },
  };
}

/**
 * 这条会话的数据能不能进缓存（规则 2：正在跑的不进）。
 *
 * 单独一个纯函数：判据只有一处，调用点不必各自想清楚"running 到底该不该缓存"。
 */
export function cacheableOf(meta: CachedMeta | undefined): boolean {
  return meta?.running !== true;
}
