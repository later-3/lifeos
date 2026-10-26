// 装配层测试（2026-10-18 拍板）：两区注入、模型优先级 A、工具显式 8 个。
// 全部基于文件与已装配的 systemPrompt 断言——不调用模型。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { buildPromptParts, createLifeOsPromptExtension, resolveModelChoice } from "../src/assembly.ts";
import { createHostedResourceLoader, createSession, deleteSession, getSession } from "../src/agent-host.ts";
import { SettingsManager, loadProjectContextFiles } from "@earendil-works/pi-coding-agent";

async function freshHome() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-assembly-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  return home;
}

test("两区装配：customPrompt=交互 harness、appendSystemPrompt=identity（内容来自文件）", async () => {
  const home = await freshHome();
  const parts = await buildPromptParts("lifeosagent", "workspace");
  assert.match(parts.customPrompt, /^<lifeos_identity>[\s\S]+<\/lifeos_identity>$/, "customPrompt = identity（占 preamble）");
  assert.match(parts.harnessSection, /交互 harness 协议/, "harness 区含协议正文（来自 protocol.md）");
  assert.match(parts.harnessSection, /## 协议目录说明 · AGENTS\.md/, "协议目录说明常驻");
  assert.match(parts.harnessSection, /## 说明文件索引/, "其他层只给说明文件索引");
  assert.match(parts.harnessSection, /Agent × 项目 workspace：.*AGENTS\.md/, "索引列出 Agent × 项目的说明文件");
  assert.doesNotMatch(parts.harnessSection, /## 任务类型 · development\//, "没有选中 Task 时不加载任何任务类型细则");
  assert.doesNotMatch(parts.harnessSection, /## 记忆规则 · memory\.md/, "记忆规则已并入协议 §3.11，不再是单独文件");
  assert.equal(parts.harnessSection.startsWith("<lifeos_interaction_harness>"), false, "外层标签由 Pi 按 section 名自动包裹（协议正文内部提到该标签不算）");
  assert.ok(parts.sources.length >= 3, `来源应≥3，实际 ${parts.sources.length}`);
  for (const source of parts.sources) assert.ok(source.startsWith(home), "来源必须真实存在于家目录");
});

test("模型优先级 A：Agent 个人 > 系统 settings > 模型清单第一项 > 无", async () => {
  const home = await freshHome();
  assert.equal(await resolveModelChoice("lifeosagent"), undefined, "都没有 → undefined（交给 Pi 回落）");

  await mkdir(join(home, "config"), { recursive: true });
  // 清单第一项 = Life OS 隐式默认（新 Agent 没有个人配置、也没有 settings 时要能显示/使用它）
  await writeFile(join(home, "config", "models.json"), JSON.stringify({
    providers: {
      first: { models: [{ id: "m-first" }, { id: "m-second" }] },
      second: { models: [{ id: "m-other" }] },
    },
  }));
  const catalog = await resolveModelChoice("lifeosagent");
  assert.equal(catalog?.source, "catalog", "没有个人/系统配置时回落到清单第一项");
  assert.deepEqual({ p: catalog?.choice.defaultProvider, m: catalog?.choice.defaultModel }, { p: "first", m: "m-first" });

  await writeFile(join(home, "config", "settings.json"), JSON.stringify({ defaultProvider: "sys", defaultModel: "m-sys", defaultThinkingLevel: "high" }));
  const sysOnly = await resolveModelChoice("lifeosagent");
  assert.equal(sysOnly.source, "settings");
  assert.equal(sysOnly.choice.defaultModel, "m-sys");

  await writeFile(join(home, "agents", "lifeosagent", "projects", "workspace", "config.json"),
    JSON.stringify({ schemaVersion: 1, defaultProvider: "agent-p", defaultModel: "m-agent" }));
  const withAgent = await resolveModelChoice("lifeosagent");
  assert.equal(withAgent.source, "agent", "Agent 个人配置覆盖系统默认");
  assert.equal(withAgent.choice.defaultProvider, "agent-p");
  assert.equal(withAgent.choice.defaultThinkingLevel, undefined);
});

test("会话装配：19 个工具全部启用（8 内置 + 11 个 Life OS 自有）；注入发生在每次 run 开始时", async () => {
  const home = await freshHome();
  const sessionId = await createSession("lifeosagent", home, "workspace");
  const state = await getSession("lifeosagent", sessionId, home);
  assert.ok(state !== undefined);
  const active = [...state.session.getActiveToolNames()].sort();
  assert.deepEqual(active, ["bash", "edit", "find", "grep", "ls", "powershell", "read", "write",
    "lifeos_agent_create", "lifeos_agent_delete", "lifeos_task_create", "lifeos_task_list", "lifeos_task_enter",
    "lifeos_project_add", "lifeos_project_remove", "lifeos_project_list",
    "lifeos_memory_search", "lifeos_memory_record", "lifeos_memory_delete"].sort(),
    "8 个内置 + 11 个 Life OS 工具全部启用（白名单内才生效）");
  // 事实：system prompt 的分区在 _prepareRun（run 开始时）才应用 extension 变更；
  // 无模型环境下 prompt 在鉴权即失败、到不了注入点 → 这里只断言"未 run 时=Pi 默认"，注入逻辑由下一条离线测试覆盖。
  assert.match(state.session.systemPrompt, /^You are an expert coding assistant/, "未 run 时为 Pi 默认提示");
  await deleteSession("lifeosagent", sessionId);
});

test("Pi 的上下文文件已显式关闭：不读 cwd、也不向上继承父目录（不是我们的设计）", async () => {
  const home = await freshHome();
  // 造现场：父目录与 cwd 都有 AGENTS.md
  const parent = await mkdtemp(join(tmpdir(), "lifeos-ctx-"));
  const project = join(parent, "project");
  await mkdir(project, { recursive: true });
  await writeFile(join(parent, "AGENTS.md"), "# 父目录规范（不该被读到）\n");
  await writeFile(join(project, "AGENTS.md"), "# 项目自己的规范\n");

  // ① 先证明"Pi 默认确实会向上继承"——这就是我们不要的行为（Pi 改了这个行为时这条会红，提醒我们复查）
  const piFiles = loadProjectContextFiles({ cwd: project, agentDir: join(home, "config") });
  assert.ok(piFiles.some((file) => file.path === join(project, "AGENTS.md")), "Pi 默认会读 cwd 的 AGENTS.md");
  assert.ok(piFiles.some((file) => file.path === join(parent, "AGENTS.md")), "Pi 默认会读父目录的 AGENTS.md");

  // ② 我们的装配点：agentsFiles 必须为空（关掉了整条通道；项目规范只走 harness 区的私有层 AGENTS.md）
  const parts = await buildPromptParts("lifeosagent", "workspace");
  const configDir = join(home, "config");
  const loader = await createHostedResourceLoader({ cwd: project, configDir, settingsManager: SettingsManager.create(project, configDir), parts });
  assert.deepEqual(loader.getAgentsFiles().agentsFiles, [], "装配点必须关掉 Pi 的上下文文件（noContextFiles）");
});

test("项目规范只读「项目目录自己」的 AGENTS.md：父目录那份不许进 prompt", async () => {
  const home = await freshHome();
  const parent = await mkdtemp(join(tmpdir(), "lifeos-proj-parent-"));
  const project = join(parent, "demo");
  await mkdir(project, { recursive: true });
  await writeFile(join(parent, "AGENTS.md"), "# 父目录规范（禁止进 prompt）\n");
  await writeFile(join(project, "AGENTS.md"), "# 项目自己的规范\n\n- 用 pnpm test\n");

  // 打开这个目录（写 manifest）→ 该项目的会话装配
  const { registerProject } = await import("../src/projects.ts");
  const registered = await registerProject("lifeosagent", project);
  assert.ok(!("code" in registered), "注册失败？");
  const pid = registered.project.id;
  const parts = await buildPromptParts("lifeosagent", pid);

  assert.match(parts.harnessSection, /项目规范 · demo\/AGENTS\.md（项目目录，不继承父目录）/, "标题写清来源与边界");
  assert.match(parts.harnessSection, /项目自己的规范/, "项目目录自己的 AGENTS.md 进 prompt");
  assert.equal(parts.harnessSection.includes("父目录规范（禁止进 prompt）"), false, "父目录的 AGENTS.md 绝不能进 prompt");
  assert.ok(parts.sources.some((path) => path === join(project, "AGENTS.md")), "来源可反查（sources 里有这份文件）");

  // Pi 自带的上下文文件读取仍然关着（它一旦打开就会把父目录那份也拉进来）
  const configDir = join(home, "config");
  const loader = await createHostedResourceLoader({ cwd: project, configDir, settingsManager: SettingsManager.create(project, configDir), parts });
  assert.deepEqual(loader.getAgentsFiles().agentsFiles, [], "Pi 的上下文文件必须保持关闭");
});

test("方案 E 注入逻辑（离线）：identity 替换 preamble、Pi 的 tools/rules 原样回填、harness 独立区域", async () => {
  await freshHome();
  const parts = await buildPromptParts("lifeosagent", "workspace");
  const extension = createLifeOsPromptExtension(parts);
  let handler;
  const pi = { on: (name, fn) => { if (name === "before_agent_start") handler = fn; } };
  extension.factory(pi);
  assert.equal(typeof handler, "function", "extension 注册了 before_agent_start");

  const rendered = [
    "You are an expert coding assistant operating inside pi.",
    "",
    "<tools>",
    "- read: Read file contents",
    "- bash: Execute bash commands",
    "</tools>",
    "",
    "<rules>",
    "- Use read to examine files instead of cat or sed.",
    "- Be concise in your responses",
    "</rules>",
    "",
    "<docs>",
    "Pi documentation …",
    "</docs>",
  ].join("\n");
  const event = { systemPrompt: rendered, systemPromptOptions: { customPrompt: undefined, sections: { existing_section: "keep-me" } } };
  await handler(event);
  const options = event.systemPromptOptions;
  assert.equal(options.customPrompt, parts.customPrompt, "identity 进入 preamble 位");
  assert.match(options.sections.tools, /read: Read file contents/, "tools 原样回填");
  assert.match(options.sections.rules, /Use read to examine files/, "rules 含工具自带规则（Pi 原文）");
  assert.match(options.sections.rules, /Be concise in your responses/, "rules 含通用规则（Pi 原文）");
  assert.equal(options.sections.docs, undefined, "docs 有意舍弃");
  assert.equal(options.sections.existing_section, "keep-me", "不破坏其它区域");
  assert.equal(options.sections.lifeos_interaction_harness, parts.harnessSection, "harness 为独立区域");
});

test("before_agent_start 每次重新取 parts：Task 切换后下一轮 harness 变化", async () => {
  let harness = "## 当前 Task A\n\nA";
  const extension = createLifeOsPromptExtension(async () => ({ customPrompt: "", harnessSection: harness }));
  let handler;
  const pi = { on: (name, fn) => { if (name === "before_agent_start") handler = fn; } };
  extension.factory(pi);
  const makeEvent = () => ({ systemPrompt: "<tools>\n- read\n</tools>", systemPromptOptions: { customPrompt: undefined, sections: {} } });
  const first = makeEvent();
  await handler(first);
  assert.match(first.systemPromptOptions.sections.lifeos_interaction_harness, /Task A/);

  harness = "## 当前 Task B\n\nB";
  const second = makeEvent();
  await handler(second);
  assert.match(second.systemPromptOptions.sections.lifeos_interaction_harness, /Task B/);
  assert.doesNotMatch(second.systemPromptOptions.sections.lifeos_interaction_harness, /Task A/);
});
