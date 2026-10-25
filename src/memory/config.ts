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

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 展开 models.json 里 apiKey 的环境变量引用（$VAR / ${VAR}），与 Pi provider-composer 同语义。
 * 为什么不能复用 Pi 的 resolveConfigValue：@earendil-works/pi-coding-agent 根包未导出该函数，
 * 深路径导入被 Node exports map 拒绝；这里是最小等价实现。
 * - 明文 key（不含 $）原样返回，向后兼容；
 * - 遇 !command 形式显式报错（memory 链路不支持，不能静默把字面量发给上游）；
 * - 引用的环境变量未设置 → 显式报错（响亮失败，不静默降级）。
 */
export function expandEnvValue(raw: string, what: string): string {
  if (raw.startsWith("!")) {
    throw new Error(`${what}：memory 链路不支持 !command 形式的密钥，请改用 \${ENV} 引用`);
  }
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const dollar = raw.indexOf("$", i);
    if (dollar < 0) {
      out += raw.slice(i);
      break;
    }
    out += raw.slice(i, dollar);
    const next = raw[dollar + 1];
    if (next === "$") {
      out += "$";
      i = dollar + 2;
      continue;
    }
    let name: string | undefined;
    let end: number;
    if (next === "{") {
      const close = raw.indexOf("}", dollar + 2);
      if (close < 0) {
        out += "$";
        i = dollar + 1;
        continue;
      }
      const candidate = raw.slice(dollar + 2, close);
      if (!ENV_NAME_RE.test(candidate)) {
        out += raw.slice(dollar, close + 1);
        i = close + 1;
        continue;
      }
      name = candidate;
      end = close + 1;
    } else {
      const match = raw.slice(dollar + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (match === null) {
        out += "$";
        i = dollar + 1;
        continue;
      }
      name = match[0];
      end = dollar + 1 + name.length;
    }
    const value = process.env[name];
    if (value === undefined) {
      throw new Error(`${what}：环境变量 ${name} 未设置（无法解析密钥）`);
    }
    out += value;
    i = end;
  }
  return out;
}

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
    const rawKey = typeof provider.apiKey === "string" ? provider.apiKey : "";
    if (rawKey === "") continue;
    // models.json 的 key 允许 ${ENV} 引用（models.json 可入库、真实 key 只在环境变量）；明文照原样通过
    const apiKey = expandEnvValue(rawKey, `models.json provider "${id}" 的 apiKey`);
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
