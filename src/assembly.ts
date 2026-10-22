// 系统提示装配与模型选择（2026-10-18 用户拍板，方案 E 定稿）：
//  - customPrompt：identity.md → **替换 Pi 默认前言（preamble）**；
//  - harness：作为**独立自定义区域** `<lifeos_interaction_harness>`（经内联 extension 写入 systemPromptOptions.sections）；
//  - Pi 的 `<tools>`/`<rules>` 由 extension 从「Pi 自己的默认渲染结果」原样抽取后回填——不手写、自动跟随 Pi 更新；
//  - `<docs>`（Pi 文档指引）有意不保留。
// 模型优先级 A（有效默认）：Agent 个人（workspace/config.json）→ 系统（config/settings.json）
// → 模型清单第一项（Life OS 隐式默认，和 Agent 配置弹窗的 fallback 同源）→ 都没有才交给 Pi 回落。
// “有效默认”必须同时给新会话和顶部显示用，否则界面显示的模型和真正会用的模型会分叉。
import { readdir, readFile } from "node:fs/promises";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { basename, join } from "node:path";
import { resolveHome } from "./home.ts";
import { readProjectManifest } from "./projects.ts";

export type ModelChoice = { defaultProvider: string; defaultModel: string; defaultThinkingLevel?: string };

const readJson = async (path: string): Promise<Record<string, unknown> | undefined> =>
  readFile(path, "utf8").then((text) => JSON.parse(text) as Record<string, unknown>, () => undefined);
const readText = async (path: string): Promise<string | undefined> =>
  readFile(path, "utf8").then((text) => text, () => undefined);

function toChoice(data: Record<string, unknown> | undefined): ModelChoice | undefined {
  if (data === undefined) return undefined;
  const provider = data.defaultProvider;
  const model = data.defaultModel;
  if (typeof provider !== "string" || provider === "" || typeof model !== "string" || model === "") return undefined;
  const thinking = data.defaultThinkingLevel;
  return {
    defaultProvider: provider,
    defaultModel: model,
    ...(typeof thinking === "string" && thinking !== "" ? { defaultThinkingLevel: thinking } : {}),
  };
}

/** Agent 个人模型默认：agents/<id>/workspace/config.json。 */
export async function readAgentModelChoice(agentId: string): Promise<ModelChoice | undefined> {
  return toChoice(await readJson(join(resolveHome(), "agents", agentId, "projects", "workspace", "config.json")));
}

/** 系统默认：config/settings.json（字段名与 Pi 的 settings 同源）。 */
export async function readSystemModelChoice(): Promise<ModelChoice | undefined> {
  return toChoice(await readJson(join(resolveHome(), "config", "settings.json")));
}

/** 模型清单第一项 = Life OS 的隐式默认（和 Agent 配置弹窗「settings ?? 第一个 provider」一致）。 */
async function readCatalogModelChoice(): Promise<ModelChoice | undefined> {
  const data = await readJson(join(resolveHome(), "config", "models.json"));
  const providers = data?.providers;
  if (providers === undefined || typeof providers !== "object" || providers === null) return undefined;
  for (const [provider, value] of Object.entries(providers as Record<string, unknown>)) {
    const models = (value as { models?: unknown } | undefined)?.models;
    if (!Array.isArray(models)) continue;
    const first = models.find((model): model is { id: string } =>
      typeof model === "object" && model !== null && typeof (model as { id?: unknown }).id === "string");
    if (first !== undefined) return { defaultProvider: provider, defaultModel: first.id };
  }
  return undefined;
}

/** 优先级 A 的有效默认裁决（只给结论与来源，不构造 Pi 对象）。 */
export async function resolveModelChoice(agentId: string): Promise<{ choice: ModelChoice; source: "agent" | "settings" | "catalog" } | undefined> {
  const agentChoice = await readAgentModelChoice(agentId);
  if (agentChoice !== undefined) return { choice: agentChoice, source: "agent" };
  const systemChoice = await readSystemModelChoice();
  if (systemChoice !== undefined) return { choice: systemChoice, source: "settings" };
  const catalogChoice = await readCatalogModelChoice();
  if (catalogChoice !== undefined) return { choice: catalogChoice, source: "catalog" };
  return undefined;
}

/**
 * 两区装配（事实来源全部来自文件；不预先塞任何不存在的内容）：
 * - 交互 harness 区（customPrompt）：协议正文、本层指引、飞轮、概念索引、任务类型细则、当前项目指引；
 * - identity 区（appendSystemPrompt）：identity.md。
 * 返回 sources 供反查/将来"会话历史"展示真实来源。
 */
export async function buildPromptParts(agentId: string, projectId: string): Promise<{
  customPrompt: string;
  harnessSection: string;
  sources: string[];
}> {
  const harnessRoot = join(resolveHome(), "interaction-harness");
  const projectDir = join(resolveHome(), "agents", agentId, "projects", projectId);
  const sections: string[] = [];
  const sources: string[] = [];

  const pushFile = async (title: string, path: string): Promise<void> => {
    const text = await readText(path);
    if (text === undefined || text.trim() === "") return;
    sources.push(path);
    sections.push(`## ${title}\n\n${text.trim()}`);
  };

  await pushFile("协议正文 · protocol.md", join(harnessRoot, "protocol.md"));
  await pushFile("本层指引 · AGENTS.md", join(harnessRoot, "AGENTS.md"));
  await pushFile("飞轮 · flywheel.md", join(harnessRoot, "flywheel.md"));
  await pushFile("概念空间元规则 · concept-space.md", join(harnessRoot, "concept-space.md"));
  await pushFile("记忆规则 · memory.md", join(harnessRoot, "memory.md"));
  for (const rel of ["concept-space/00-索引.md", "concept-space/harness/00-索引.md"]) {
    await pushFile(`概念索引 · ${rel}`, join(harnessRoot, rel));
  }
  // 任务类型按目录加载（development / general …）：新增类型 = 加一个目录，不改装配代码
  const taskTypesRoot = join(harnessRoot, "task-types");
  const taskTypes = (await readdir(taskTypesRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  for (const type of taskTypes) {
    const dir = join(taskTypesRoot, type);
    const files = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".md")).sort();
    for (const name of files) {
      await pushFile(`任务类型 · ${type}/${name}`, join(dir, name));
    }
  }
  await pushFile(`本项目指引 · ${projectId}/AGENTS.md（Agent 私有约定）`, join(projectDir, "AGENTS.md"));

  // 项目仓库自己的规范：只读「项目目录本身」这一份（外部项目才有 manifest）。
  // 不向上继承父目录——Pi 的上下文文件读取已在装配点关闭（noContextFiles）；
  // 这里是我们自己的显式通道：读哪个文件、进哪个区、标题里写清楚，可反查。
  const manifest = await readProjectManifest(agentId, projectId);
  if (manifest !== undefined) {
    await pushFile(`项目规范 · ${basename(manifest.path)}/AGENTS.md（项目目录，不继承父目录）`, join(manifest.path, "AGENTS.md"));
  }

  // 区域内容（外层 <lifeos_interaction_harness> 标签由 Pi 按 section 名自动包裹，这里不写标签）
  const harnessSection = [
    "以下是用户与该项目的交互 harness（协作规范与资料），本次会话必须遵守；需要完整资料时按索引读取。",
    "",
    sections.join("\n\n"),
    "",
    "## 资料（按需读取，不常驻）",
    `- 案例：${join(harnessRoot, "cases")}/（按日期分文件）`,
    `- 每日记录 / 任务 / todo：${projectDir}/{daily,tasks,todo}`,
  ].join("\n");

  // identity 占 preamble（Pi 默认“编码 agent”前言被身份取代）。
  const identity = await readText(join(resolveHome(), "agents", agentId, "identity.md"));
  const customPrompt = identity === undefined || identity.trim() === ""
    ? ""
    : `<lifeos_identity>\n${identity.trim()}\n</lifeos_identity>`;

  return { customPrompt, harnessSection, sources };
}

/** 从 Pi 默认渲染结果中抽取具名段落（标签是 Pi 的公开契约："让后续能匹配更新"）。 */
export function extractRenderedSection(rendered: string, tag: string): string | undefined {
  return rendered.match(new RegExp(`<${tag}>\n([\\s\\S]*?)\n</${tag}>`))?.[1];
}

/**
 * 方案 E 的内联 extension（2026-10-18 用户拍板）：
 * - identity → customPrompt（替换 Pi 默认 preamble）；
 * - harness → 独立自定义区域 `lifeos_interaction_harness`；
 * - Pi 的 <tools>/<rules> 从默认渲染结果**原样回填**（不手写、跟随 Pi 更新）；<docs> 有意舍弃。
 */
export function createLifeOsPromptExtension(parts: { customPrompt: string; harnessSection: string }): InlineExtension {
  return {
    name: "lifeos-prompt",
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", (event) => {
        const rendered = event.systemPrompt;      // 读在修改之前 = Pi 默认分支的渲染结果
        const tools = extractRenderedSection(rendered, "tools");
        const rules = extractRenderedSection(rendered, "rules");
        const options = event.systemPromptOptions;
        if (parts.customPrompt !== "") options.customPrompt = parts.customPrompt;
        options.sections = {
          ...options.sections,
          ...(tools !== undefined ? { tools } : {}),
          ...(rules !== undefined ? { rules } : {}),
          lifeos_interaction_harness: parts.harnessSection,
        };
      });
    },
  } satisfies InlineExtension;
}
