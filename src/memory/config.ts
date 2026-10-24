// 记忆服务的模型配置（.lifeos/projects/lifeos/knowledge/architecture/agent-memory.md §7）：
// - LLM：摘要/抽取/关键词（chat/completions），可用 models.json 里任一 provider；
// - Embedding：向量（/v1/embeddings），默认本地 Ollama nomic-embed-text。
//
// 配置来源优先级：~/.lifeos/config/memory.json（可选）→ 默认值 / models.json 的第一个可用 provider。
// 密钥不落盘：config.yaml 里写 ${LIFEOS_MEMORY_API_KEY}，真实值只在本进程环境变量里。
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveHome } from "../home.ts";

export type MemoryModelConfig = {
  /** 生成 config.yaml 的内容（密钥用环境变量占位） */
  yaml: string;
  /** 进程内设置的密钥环境变量（与 yaml 占位一致） */
  apiKeyEnvName: string;
  apiKey: string;
};

type ModelsProvider = { baseUrl?: string; apiKey?: string; models?: Array<{ id?: string }> };
type MemoryConfigFile = {
  embedding?: { endpoint?: string; model?: string; apiKey?: string };
  llm?: { provider?: string; model?: string; endpoint?: string; apiKey?: string };
};

const DEFAULT_EMBEDDING = {
  endpoint: "http://127.0.0.1:11434/v1",
  model: "nomic-embed-text",
  apiKey: "ollama",
};

const quote = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

async function readJson<T>(path: string): Promise<T | undefined> {
  return readFile(path, "utf8").then((text) => JSON.parse(text) as T, () => undefined);
}

/** 选出 LLM：memory.json 指定 → 否则 models.json 里第一个有 apiKey 的 provider 的第一个模型。 */
async function resolveLlm(config: MemoryConfigFile): Promise<{ provider: string; baseUrl: string; apiKey: string; model: string } | undefined> {
  // 直接给 endpoint/model/apiKey（如本地 Ollama）：不需要在 models.json 里建 provider
  if (config.llm?.endpoint !== undefined && config.llm.model !== undefined && config.llm.apiKey !== undefined) {
    return { provider: config.llm.provider ?? "custom", baseUrl: config.llm.endpoint, apiKey: config.llm.apiKey, model: config.llm.model };
  }
  const models = await readJson<{ providers?: Record<string, ModelsProvider> }>(join(resolveHome(), "config", "models.json"));
  const providers = models?.providers ?? {};
  const wanted = config.llm?.provider;
  const order = wanted !== undefined && providers[wanted] !== undefined ? [wanted] : Object.keys(providers);
  for (const id of order) {
    const provider = providers[id];
    if (provider === undefined || typeof provider.baseUrl !== "string" || provider.baseUrl === "") continue;
    const model = config.llm?.model ?? provider.models?.find((entry) => typeof entry.id === "string")?.id;
    if (typeof model !== "string" || model === "") continue;
    const apiKey = typeof provider.apiKey === "string" ? provider.apiKey : "";
    if (apiKey === "") continue;
    return { provider: id, baseUrl: provider.baseUrl, apiKey, model };
  }
  return undefined;
}

export async function memoryRuntimeConfig(): Promise<MemoryModelConfig> {
  const file = await readJson<MemoryConfigFile>(join(resolveHome(), "config", "memory.json"));
  const embedding = {
    endpoint: file?.embedding?.endpoint ?? DEFAULT_EMBEDDING.endpoint,
    model: file?.embedding?.model ?? DEFAULT_EMBEDDING.model,
    apiKey: file?.embedding?.apiKey ?? DEFAULT_EMBEDDING.apiKey,
  };
  const llm = await resolveLlm(file ?? {});
  if (llm === undefined) {
    throw new Error("记忆需要 LLM：请配置 ~/.lifeos/config/memory.json 或在 config/models.json 里提供带 apiKey 的 provider");
  }
  const apiKeyEnvName = "LIFEOS_MEMORY_API_KEY";
  const yaml = [
    "embedding:",
    "  provider: openai_compatible",
    `  endpoint: ${quote(embedding.endpoint)}`,
    `  model: ${quote(embedding.model)}`,
    `  apiKey: ${quote(embedding.apiKey)}`,
    "llm:",
    "  provider: openai_compatible",
    `  endpoint: ${quote(llm.baseUrl)}`,
    `  model: ${quote(llm.model)}`,
    `  apiKey: "\${${apiKeyEnvName}}"`,
    "  timeoutMs: 120000",
    "",
  ].join("\n");
  return { yaml, apiKeyEnvName, apiKey: llm.apiKey };
}

/** 写 <root>/config.yaml（原子、0600；只含环境变量占位，不含真实密钥）。 */
export async function writeMemoryConfig(root: string, config: MemoryModelConfig): Promise<void> {
  const path = join(root, "config.yaml");
  const tmp = `${path}.tmp`;
  await writeFile(tmp, config.yaml, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}
