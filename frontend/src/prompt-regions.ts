/**
 * prompt 装配图（P0 版：块名 + 归属 + 代码事实源 + 改哪里会变）。
 * 存在理由：完整历史要能回答"这个区是什么、谁加的、改哪个文件会变"——而不是把 JSON 贴上去。
 * P1 会补：未登记区红标 + 测试（payload 出现未登记 section 就失败）。
 */
export type RegionSpec = {
  label: string;
  owner: "lifeos" | "pi" | "runtime";
  assembledBy: string;
  code: string;
  editable?: string;
};

export const PROMPT_REGIONS: Record<string, RegionSpec> = {
  preamble: {
    label: "身份区",
    owner: "lifeos",
    assembledBy: "identity.md 包成 <lifeos_identity>，替换 Pi 默认「编码助手」前言",
    code: "src/assembly.ts · buildPromptParts → customPrompt",
    editable: "agents/<id>/identity.md",
  },
  lifeos_interaction_harness: {
    label: "交互 harness 区",
    owner: "lifeos",
    assembledBy: "按协议 §9 拼：协议正文 / 协议目录说明 / 规范（Agent 本身 → 共享 workspace → 共享项目 → Agent × 项目 → Task）/ 当前 Task 的 AGENTS.md 与 task.md 与类型规则 / 说明文件索引",
    code: "src/assembly.ts · buildPromptParts → harnessSection",
    editable: "~/.lifeos/interaction-harness/** ＋ 各层 AGENTS.md 与 specs/（按层）",
  },
  tools: {
    label: "工具清单区",
    owner: "pi",
    assembledBy: "Pi 默认渲染 <tools> 后由我们的 extension 原样回填（不手写，跟随 Pi 更新）",
    code: "pi/packages/coding-agent/src/core/system-prompt.ts · buildSystemPromptSections ＋ src/assembly.ts · createLifeOsPromptExtension",
  },
  rules: {
    label: "规则区",
    owner: "pi",
    assembledBy: "Pi 默认渲染 <rules> 后原样回填",
    code: "pi/packages/coding-agent/src/core/system-prompt.ts · buildRules ＋ src/assembly.ts · createLifeOsPromptExtension",
  },
  project_context: {
    label: "项目上下文区（Pi 自带的上下文文件）",
    owner: "pi",
    assembledBy: "Pi 把 cwd 及其父目录的 AGENTS.md/CLAUDE.md 拼成 <project_context>；本装配点已显式关闭（noContextFiles），旧会话的历史条目里仍可能看到",
    code: "pi/packages/coding-agent/src/core/system-prompt.ts · renderProjectContext（+ src/agent-host.ts · createHostedResourceLoader）",
    editable: "agents/<id>/projects/<pid>/AGENTS.md（现在的项目规范通道，走 harness 区）",
  },
  skills: {
    label: "技能索引区",
    owner: "runtime",
    assembledBy: "资源加载器扫描已安装技能，只放 name/description/path 索引",
    code: "pi/packages/coding-agent/src/core/system-prompt.ts · formatSkillsForPrompt",
    editable: "~/.lifeos/config/skills/ ＋ 已安装的 Pi 包",
  },
  cwd: {
    label: "工作目录区",
    owner: "runtime",
    assembledBy: "会话创建时的工作目录（workspace → ~/.lifeos；外部项目 → 项目路径）",
    code: "src/agent-host.ts · createSession(cwd)",
  },
};

export function regionOf(key: string): RegionSpec {
  return PROMPT_REGIONS[key] ?? {
    label: "未登记区域",
    owner: "runtime",
    assembledBy: "payload 里出现了 prompt-regions.ts 未登记的 section —— 需要补登记",
    code: "frontend/src/prompt-regions.ts",
  };
}
