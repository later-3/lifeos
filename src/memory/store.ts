// 每个记忆角色一个 MemOS 本地核心（一个 SQLite）——四角色天然隔离。
// 配置写入 <root>/config.yaml（密钥用环境变量占位）；不装 OpenClaw/Hermes/DSH，也不起 Viewer。
import { mkdir } from "node:fs/promises";
import { bootstrapMemoryCoreFull } from "@memtensor/memos-local-plugin/dist/core/pipeline/memory-core.js";
import { resolveHome as memosResolveHome } from "@memtensor/memos-local-plugin/dist/core/config/index.js";
import { memoryRuntimeConfig, writeMemoryConfig } from "./config.ts";
import { roleKey, storeRoot, type MemoryRole } from "./roles.ts";

export type MemoryStore = {
  core: Awaited<ReturnType<typeof bootstrapMemoryCoreFull>>["core"];
  root: string;
};

const stores = new Map<string, Promise<MemoryStore>>();

export function storeFor(role: MemoryRole): Promise<MemoryStore> {
  const key = roleKey(role);
  const existing = stores.get(key);
  if (existing !== undefined) return existing;
  const pending = (async (): Promise<MemoryStore> => {
    const root = storeRoot(role);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const config = await memoryRuntimeConfig();
    // config.yaml 里是 ${LIFEOS_MEMORY_API_KEY}；真实密钥只进本进程环境
    process.env[config.apiKeyEnvName] = config.apiKey;
    await writeMemoryConfig(root, config);
    const home = memosResolveHome("lifeos", root);
    const { core } = await bootstrapMemoryCoreFull({ agent: "lifeos", home, initLogging: false });
    await core.init();
    return { core, root };
  })();
  stores.set(key, pending);
  pending.catch(() => stores.delete(key));
  return pending;
}

/** 关闭全部 store（进程退出/测试清理）。 */
export async function closeMemoryStores(): Promise<void> {
  const pending = [...stores.values()];
  stores.clear();
  await Promise.allSettled(pending.map(async (entry) => {
    const { core } = await entry;
    await core.shutdown();
  }));
}
