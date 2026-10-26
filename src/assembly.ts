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
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { resolveHome } from "./home.ts";
import { readProjectManifest } from "./projects.ts";
import { resolveTaskDir } from "./tasks.ts";

export type ModelChoice = { defaultProvider: string; defaultModel: string; defaultThinkingLevel?: string };

/**
 * 新建会话在"没有任何配置"时拿到的思考档位 = Pi 的默认值。
 * 来源：pi/packages/coding-agent/src/core/defaults.ts 的 `DEFAULT_THINKING_LEVEL`；
 * test/thinking-default.test.mjs 会读那个文件比对，Pi 改了这里会红。
 */
export const DEFAULT_PI_THINKING_LEVEL = "medium";

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

type SpecIndexEntry = { id?: unknown; path?: unknown };

/** 读一层的 specs/index.json，返回主题正文路径（只允许本层目录内，防止索引越界）。 */
async function readSpecPaths(root: string): Promise<string[]> {
  const data = await readJson(join(root, "index.json"));
  const entries = data?.specs;
  if (!Array.isArray(entries)) return [];
  const rootAbs = resolve(root);
  const out: string[] = [];
  for (const entry of entries as SpecIndexEntry[]) {
    if (typeof entry.path !== "string" || entry.path.trim() === "") continue;
    const path = resolve(rootAbs, entry.path);
    const rel = relative(rootAbs, path);
    if (rel.startsWith("..") || isAbsolute(rel) || rel === "") continue;
    out.push(path);
  }
  return out;
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

/** 当前 Task 的类型规则：Agent × 项目 → 共享项目 → 协议默认，找到第一份（协议 §3.7）。 */
async function resolveTypeRulesPath(agentId: string, projectId: string, type: string): Promise<string | undefined> {
  const home = resolveHome();
  const candidates = [
    join(home, "agents", agentId, "projects", projectId, "task-types", type, "AGENTS.md"),
    join(home, "projects", projectId, "task-types", type, "AGENTS.md"),
    join(home, "interaction-harness", "task-types", type, "AGENTS.md"),
  ];
  for (const path of candidates) {
    if (await readText(path) !== undefined) return path;
  }
  return undefined;
}

/** 一层的说明索引：只列「说明文件在哪、里面有什么」，不注入正文（协议 §9）。 */
async function layerIndex(label: string, root: string): Promise<string[]> {
  const hasNote = (await readText(join(root, "AGENTS.md"))) !== undefined;
  if (!hasNote) return [];
  const names = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.name !== "AGENTS.md" && !entry.name.startsWith("."))
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort();
  return [`- ${label}：${join(root, "AGENTS.md")}（有：${names.join("、") || "无"}）`];
}

/**
 * 装配（协议 §9）：
 * - 常驻：协议正文、协议目录说明；
 * - 规范：按 §4.3 顺序逐层追加（Agent × 项目 → 共享 workspace → 共享项目 → Agent × 项目 → Task），不覆盖、不扫描其他层；
 * - 当前 Task：只加载指针指向的那一个的 `AGENTS.md`、`task.md` 与类型规则；
 * - 其余层只给说明文件索引。
 * identity.md 单独作为 customPrompt（Agent 本身）。
 */
export type PromptParts = { customPrompt: string; harnessSection: string; sources: string[] };

/** 每次 run 都重新装配（Task 在会话中途可切换）；固定 parts 仍可用于离线测试。 */
export type PromptPartsSource = PromptParts | (() => Promise<PromptParts>);

export async function buildPromptParts(agentId: string, projectId: string, taskId?: string): Promise<PromptParts> {
  const home = resolveHome();
  const harnessRoot = join(home, "interaction-harness");
  const agentDir = join(home, "agents", agentId);
  const projectDir = join(agentDir, "projects", projectId);
  const sharedWorkspace = join(home, "projects", "workspace");
  const sharedProject = join(home, "projects", projectId);
  const sections: string[] = [];
  const sources: string[] = [];

  const pushFile = async (title: string, path: string): Promise<void> => {
    const text = await readText(path);
    if (text === undefined || text.trim() === "") return;
    sources.push(path);
    sections.push(`## ${title}\n\n${text.trim()}`);
  };

  // 常驻：协议正文与协议目录说明
  await pushFile("协议正文 · protocol.md", join(harnessRoot, "protocol.md"));
  await pushFile("协议目录说明 · AGENTS.md", join(harnessRoot, "AGENTS.md"));

  // 规范：逐层追加，同一份正文只加载一次
  const specRoots: Array<{ label: string; root: string }> = [
    { label: "共享 workspace", root: join(sharedWorkspace, "specs") },
    ...(projectId !== "workspace" ? [{ label: `共享项目 ${projectId}`, root: join(sharedProject, "specs") }] : []),
    { label: `Agent × 项目 ${projectId}`, root: join(projectDir, "specs") },
  ];

  // 当前 Task（协议 §7）：只加载指针指向的这一个
  const ctx = { agentId, projectId };
  const taskDir = taskId !== undefined && taskId !== "" ? await resolveTaskDir(ctx, taskId) : undefined;
  let typeRules: string | undefined;
  if (taskDir !== undefined) {
    const taskMd = await readText(join(taskDir, "task.md"));
    const type = taskMd?.split("\n").find((line) => line.startsWith("类型："))?.slice("类型：".length).trim() ?? "";
    const taskLabel = basename(taskDir);
    await pushFile(`当前 Task · ${taskLabel}/AGENTS.md`, join(taskDir, "AGENTS.md"));
    await pushFile(`当前 Task · ${taskLabel}/task.md`, join(taskDir, "task.md"));
    if (type !== "") {
      typeRules = await resolveTypeRulesPath(agentId, projectId, type);
      if (typeRules !== undefined) await pushFile(`任务类型规则 · ${type}/AGENTS.md`, typeRules);
    }
    specRoots.push({ label: `Task ${taskLabel}`, root: join(taskDir, "specs") });
  }

  const seenSpecs = new Set<string>();
  for (const { label, root } of specRoots) {
    for (const path of await readSpecPaths(root)) {
      if (seenSpecs.has(path)) continue; // 同一份正文只加载一次
      seenSpecs.add(path);
      const topic = basename(resolve(path, ".."));
      await pushFile(`规范 · ${label} · ${topic}`, path);
    }
  }

  // 项目仓库自己的规范：只读「项目目录本身」这一份（外部项目才有；不继承父目录）。
  const manifest = await readProjectManifest(agentId, projectId);
  if (manifest !== undefined) {
    await pushFile(`项目规范 · ${basename(manifest.path)}/AGENTS.md（项目目录，不继承父目录）`, join(manifest.path, "AGENTS.md"));
  }

  // 说明文件索引（只列在哪、有什么，不注入正文）
  const index = [
    ...(await layerIndex("Agent 本身", agentDir)),
    ...(await layerIndex("共享 workspace", sharedWorkspace)),
    ...(projectId !== "workspace" ? await layerIndex(`共享项目 ${projectId}`, sharedProject) : []),
    ...(await layerIndex(`Agent × 项目 ${projectId}`, projectDir)),
    ...(taskDir !== undefined ? await layerIndex(`当前 Task ${basename(taskDir)}`, taskDir) : []),
  ];

  const harnessSection = [
    "以下是用户与该项目的交互 harness（协作规范与资料），本次会话必须遵守；需要完整资料时按索引读取。",
    "",
    sections.join("\n\n"),
    "",
    "## 说明文件索引（按需读取，不常驻）",
    ...index,
  ].join("\n");

  // identity 占 preamble（Pi 默认“编码 agent”前言被身份取代）。
  const identity = await readText(join(agentDir, "identity.md"));
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
export function createLifeOsPromptExtension(source: PromptPartsSource): InlineExtension {
  return {
    name: "lifeos-prompt",
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", async (event) => {
        // Task 可切换：每次 run 重新读当前 activeTaskId；固定 parts 用于离线测试/旧调用。
        const parts = typeof source === "function" ? await source() : source;
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
