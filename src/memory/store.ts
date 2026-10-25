// 每个记忆角色一个 MemOS 本地核心（一个 SQLite）——四角色天然隔离。
// 配置写入 <root>/config.yaml（密钥用环境变量占位）；不装 OpenClaw/Hermes/DSH，也不起 Viewer。
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrapMemoryCoreFull } from "@memtensor/memos-local-plugin/dist/core/pipeline/memory-core.js";
import { resolveHome as memosResolveHome } from "@memtensor/memos-local-plugin/dist/core/config/index.js";
import { memoryRuntimeConfig, writeMemoryConfig } from "./config.ts";
import { roleKey, storeRoot, type MemoryRole } from "./roles.ts";

// 记忆运行时目录（DB/日志/守护/技能缓存）是自动生成的，但协议要求每个目录有说明文件；
// 由创建者补一份，避免 home:check 把"程序生成的数据目录"当成结构缺口。
const RUNTIME_NOTE = `# 记忆运行时目录

- 背景：MemOS 记忆模块自动创建/维护的运行时目录，内容随使用变化。
- 内容：数据库、日志、守护进程或技能缓存；不是需要人读的文档。
- 何时读：排障、备份、迁移时；日常不用打开。
- 怎么用：不要手改或删除正在使用的文件；迁移/备份前先停后端。
`;

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
    for (const dir of [home.dataDir, home.logsDir, home.daemonDir, home.skillsDir]) {
      await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => undefined);
      await writeFile(join(dir, "AGENTS.md"), RUNTIME_NOTE, { flag: "wx", mode: 0o600 }).catch(() => undefined);
    }
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
