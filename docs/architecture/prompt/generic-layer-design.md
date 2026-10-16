# Life OS Prompt 通用层设计（待审核）
> 角色：架构 / 开发　类型：说明　状态：**目标（设计待审核）**

**要解决什么**：让"往模型请求里放一类内容"成为通用能力——业务只声明"要什么内容、从哪来、适用什么范围"，
通用层负责加载、装入正确位置、记录与可验证。今天这件事**半自动**：装载位置是逐个硬编码的（见 [机制 §7.1](./mechanism.md)）。

## 1 现状（事实，2026-10-14）

| 环节 | 现状 |
|---|---|
| 声明（有哪些类型/区域） | ✅ `prompt-content-registry.ts` / `prompt-region-registry.ts` |
| 识别（装配顶层、捕获解析） | ✅ 由区域注册表生成 |
| 记录 / 展示 / 否决 / 差分 | ✅ 注册表驱动 |
| **加载**（把内容装进请求） | ❌ **逐条硬编码**：`assembly.ts:117-131` 的固定 9 项自定义指令 + `pi-agent-session.ts` 的 resources/tools/contextFiles/settings；注册表不参与 |

所以现在新增一类内容必须改装配核心；6 条 `planned` 因此永远不生效。

## 2 自底向上：Pi 已经给了什么，Life OS 要补什么

| 需要的能力 | Pi 的公开入口 | Life OS 现状 | Life OS 要补 |
|---|---|---|---|
| 文本进 System Prompt | `appendSystemPromptOverride` / `systemPrompt` | 用着（分区标签自己加） | 只补"按类型装区域"，不改机制 |
| 按需读正文（指针） | Skills（`SKILL.md` 描述进 prompt，正文 `read`） | **没用它承载任意内容** | **指针装载器**（见 §5） |
| 工具 | `customTools` / `tools` | 用着（按 `agent.tools`） | 类型 → 工具装配的映射 |
| 技能/扩展资源 | `ResourceLoader` + `additionalSkillPaths` / `extensionPaths` | 用着 | 类型 → 资源装配的映射 |
| 运行参数（模型/思考/压缩） | `createAgentSession()` / `SettingsManager` | 用着 | 类型 → 参数装配的映射 |
| 请求边界（记录/否决/改写） | `providerRequestGate`(onPayload)、`transformContext`、`setContextEntryFilter` | 用着 | 保持 |
| 记录与区域解析 | 无（Life OS 自己） | 已做 | 保持 |

**结论：不需要改 Pi。** Life OS 要补的是"声明 → 加载 → 装入位置"这一段自己的胶水层。

## 3 目标模型：一个类型 = 一条声明 + 一个生产者

```ts
// 声明：已有（prompt-content-registry.ts），不新增字段
interface PromptContentType { id; form; regionId?; layers; implementedLayers; entersVia?; ... }

// 新增：生产者（每类一个，装在本类自己的产生点）
interface PromptContentProducer {
  readonly typeId: string;
  produces(ctx: AssemblyContext): Promise<PromptContentPiece[]>;   // 读文件 / 配置 / 服务
}

// 新增：产出物，按 form 决定装入位置
type PromptContentPiece =
  | { form: "text";            regionId: string; body: string }
  | { form: "pointer";         regionId: string; what: string; where: string; when: string }
  | { form: "tool" | "capability"; tools?: ToolDefinition[]; skillPaths?: string[]; extensionPaths?: string[] }
  | { form: "runtime-config";  model?; thinkingLevel?; generation?; compaction? }
  | { form: "record";          recording?: "on" | "off" };          // 不进请求，只改记录
```

装配点的变化（`prepareLongAgentAssembly`）：

```text
今天：按固定顺序手写 9 项 customInstructions
目标：遍历注册表里"有生产者且本轮生效"的类型 → 调生产者 → 按 form 装入对应位置
```

**三条硬约束（保持现有红线不变）**

1. **产出必须与今天逐字相同**：迁移只把现有硬编码搬进生产者，不改变任何内容。
   回归靠现有请求边界测试（`test/agents/prompt-config-boundary.test.mjs`、`public-assembly.test.mjs`）逐字比对。
2. **区域内容仍在其产生点决定**：生产者就是产生点；公共装配不加第二次过滤。
3. **注册表不新增"语义字段"**：类型表只说"是什么、在哪层、怎么进"，不说"内容长什么样"。

## 4 迁移映射：现有 9 项 → 生产者（逐条对应，产出不变）

| 今天（`assembly.ts:117-131` 等） | 变成的类型 | form | 装入位置 |
|---|---|---|---|
| `execution.customInstructions`（Agent 定义/规则资源） | `prompt-rule-resources` | text | `lifeos_agent_custom_instructions` |
| `identityInstruction`（`buildLife OSIdentityInstruction`） | `lifeos_identity` | text | `lifeos_identity` |
| `memoryInstruction`（`agent-group-service`） | `memory-injection` | text | `lifeos_long_term_memory` |
| `DAILY_ARCHIVE_INSTRUCTIONS` + `handoff` | `daily-archive-handoff`（新登记） | text | 自定义指令区（现为同区，保持） |
| `longAgentScopeInstructions` | `scope-instructions`（新登记） | text | 自定义指令区 |
| `memory_fact_contract` | `memory-fact-contract`（新登记） | text | 自定义指令区 |
| `harnessInstruction`（`interaction-harness.ts`） | `harness-injection` | text | `lifeos_interaction_harness` |
| `lifeos_runtime_capability_contract`（常量） | `runtime-contract` | text | `lifeos_runtime_capability_contract` |
| `agent.tools` / `agent.resources`（`pi-agent-session.ts`） | `tools` / `skills` / `extensions-plugins-mcp` | tool/capability | 请求 `tools` 字段 / `ResourceLoader` |
| 模型 / 思考 / 生成参数 / 压缩（`createAgentSession` 入参 / SettingsManager） | `model` / `thinking-level` / `generation-params` / `context-policy` | runtime-config | 装配参数 |
| `promptCapture`（`lifeos.interaction-recording`） | `full-recording` | record | 记录层 |
| 工作区上下文文件（`agentsFilesOverride`） | `agent-home-standards` / `project-profile` | text | Pi 资源发现通道（不加区域） |

> 表里"新登记"的 3 条只是把已经在请求里的固定文案显式登记进注册表，不改变内容 —— 现在它们在注册表里没有对应行，
> 按机制要求"进了请求的内容必须有登记"，这三条属于补登记。

## 5 指针装载器（本次要定的第二件事）

`pointer` 形态目前 0 实现。两种做法：

| 方案 | 形状 | 评价 |
|---|---|---|
| **A（推荐）复用 Pi Skill** | 把要按需读的内容做成 Skill：`SKILL.md` 的 name+description 常驻，正文按需 `read` | 不新造机制；Pi 原生；与"Skill 描述进 prompt、正文按需读"一致 |
| B 自定义指针条目 | 区域里写 `## 参考资料 · <名>｜路径｜何时读`，正文由 Agent `read` | 需要自己定义与维护约定；只有"不是 Skill 形状"的内容才需要 |

**倾向 A**：指针 = Skill（或 context file 索引）；Life OS 只负责"把它装配进 `additionalSkillPaths` 并登记为类型"。
这样"harness 瘦身"= 把案例/飞轮/概念正文做成 Skill 或索引文件，通用层不需要新写法。

## 6 自顶向下：一个 prompt 相关需求怎么落

四类典型需求与落法：

| 需求形态 | 例子 | 落法 |
|---|---|---|
| 新增一类常驻规则 | "给它加一条输出格式要求" | 归 `prompt-rule-resources`（已有类型）→ 走 Prompt 资源库；通用层不动 |
| 把大块改成按需 | "案例不要再全文注入" | 用**指针**（Skill/索引文件）→ 需要 §5 的装载器 |
| 新增运行参数 | "每个 Agent 能配 thinking" | 归 `runtime-config` → 生产者读配置 → 装配参数（已有实现，补类型驱动） |
| 新增能力（工具/技能） | "接入一个新的记忆工具" | 归 `tool`/`capability` → 生产者产出工具/资源 → 装配（已有实现，补类型驱动） |
| 真的是一类新内容 | "群级共同约定" | 注册表加一行 + 写生产者（或登记 `planned`）+ 请求边界断言 |

需求提出时必须回答（缺一条就是设计未完成）：**① 类型（已有/新增）② 形态 ③ 来源 ④ 作用范围 ⑤ 可否决 ⑥ 请求边界断言**。

## 7 分阶段（建议）

| 阶段 | 内容 | 风险 |
|---|---|---|
| 第 1 步 | 补登记 3 条固定文案 + 引入生产者接口，把现有 9 项**逐字搬入**（产出不变，靠边界测试回归） | 中：动装配核心，必须逐字回归 |
| 第 2 步 | 指针装载器（方案 A），先给一类内容试用（例如案例索引） | 低 |
| 第 3 步 | 类型驱动工具/资源/参数装配（现在已能跑，只是没走注册表） | 低 |
| 不做 | 6 条 `planned` 的承载通道（等项目级/群级业务真的要做） | —— |

## 8 需要你定的

1. **是否引入"生产者 + 装入位置"这一层**（我倾向：引入，但最小化，只做转发，产出逐字不变）。
2. **指针是否复用 Pi Skill**（我倾向：复用，不新造写法）。
3. **第 1 步是否现在做**（我倾向：可以先做——它是后面一切按需加载与"新增类型不改装配核心"的前提）。

---

## 9 操作面：先分清"改的是哪一层"

讲"增加/删除/编辑"之前必须先分层，否则删除会混淆（删掉一行声明？删掉一段内容？还是只是这次不带它？）：

| 层 | 是什么 | 谁能改 | 现在怎么改 |
|---|---|---|---|
| **L1 区域类型** | 代码里的声明（id / form / regionId / 可配层） | 开发者 | 改代码（`prompt-content-registry.ts`）；**没有运行时增删** |
| **L2 区域实例** | 某次请求里的那一段（生产者产出） | 不可直接编辑 | 本轮编辑层可排除 / 改写 / 追加（`context-edit.ts`） |
| **L3 内容实例** | 被读到的原文（文件 / 配置字段 / 资源记录 / 外部服务） | 用户 / Agent / 开发者 | 按内容类别不同（§10） |
| **L4 选择与引用** | 哪个 Agent / 项目 / 会话用哪些内容 | 用户 / Agent | 配置 PUT、会话条目、请求体 |
| **L5 记录**（**不是内容层，是观测面**） | 每轮请求的完整 payload 与响应，落在 `interactions/<sid>/` | 系统 | 记录开关 `PUT /api/sessions/:id/interaction-recording` |

L5 说明：`interactions/` 是**事后核对用的记录**，**不进模型请求**（对应内容类型里的 `record` 形态：只改记录、不改请求）。
把它列在操作分层里是因为它同样有"开关"语义；但它不属于"内容"，下面 §14 的对象模型里也不出现。

**推论**：所谓"新增一个区域"其实有三种完全不同的意思——**新增类型（L1，代码）／新增实例（L2，目前只能靠编辑层追加）／新增内容（L3，数据驱动）**。设计必须把它们分开，否则"用户可以自由增加自定义区域"这句目标无法落地。

## 10 Life OS 从哪里获取这些内容（来源清单，含写通道）

| # | 内容 | 事实源（从哪读） | 读它的代码 | 增 / 删 / 改的通道 | 作用域 | 有版本吗 | 停用方式 |
|---|---|---|---|---|---|---|---|
| 1 | 固定文案（运行合同、记忆事实契约、日终交接指引） | 代码常量 | `assembly.ts:127,129`、`daily-summary-task.ts` | 改代码 | 全局 | 无 | **不可停用**（`nonOverridableReason`） |
| 2 | 身份（`systemPrompt` / `customInstructions`） | `long-agents/<id>/definition.json` | `assembly.ts:20-36` | `PUT /api/long-agents/:id/config`；Agent 可在授权内自改 | Long Agent 默认 | 配置 revision（CAS） | 只能改写内容 |
| 4 | **交互 harness** | `~/.lifeos/interaction-harness/**` + `<agent>/projects/<project>/**` | `interaction-harness.ts` | **没有 API**：改文件（Agent 用文件工具、用户手工） | 通用层 + 项目层 | 无 | 开关（默认 / 会话） |
| 5 | 规则与经验资源 | `prompt-resources` store（personal / project） | `prompt-resources` 服务 + `agent-config-loader`（冻结 revision） | **没有直写 API**（只有 GET）；写走对话：rule-management 的 `prompt_resource_create_draft / update_draft / commit_draft / propose_for_agent`，用户确认后落库 | 默认 + 项目 | **有版本链** | 取消引用（勾选） |
| 7 | Personal / Project 共享事实 | Life OS Home `memoryDir` | memory 服务（不进装配） | `memory_record` / `/api/memories` | 个人 / 项目 | 记录级 | 本来就是工具（无注入副本） |
| 8 | 项目上下文（`AGENTS.md` / `PROJECT_*.md`） | 项目根文件 | `assembly-context.ts`、`pi-agent-session.ts:180`（Pi 资源发现） | 改项目文件 | 该项目会话 | 无 | **无开关** |
| 9 | Agent 空间规范 | `<agent>/workspace/AGENTS.md` 等 | 同上 | 改文件 | 会话 | 无 | **无开关** |
| 10 | 技能 / 扩展 | 个人 / 项目 / Agent 目录 | `ResourceLoader`、`additionalSkillPaths` | 安装/删除文件 + `agent.resources` 选择 | 默认 / 项目 | 冻结快照 | 取消选择 |
| 11 | 工具 | 代码注册 + Extension | `customTools` / `tools` | 改代码或安装扩展 | 默认 / 项目 | 快照（`lifeos.agent-assembly-tools.v1`） | 取消选择 / `noTools` |
| 12 | 运行参数（模型 / 思考 / 生成 / 压缩） | `capability-config.json` + `agent/settings.json` + Pi `SettingsManager` | `createAgentSession` 入参、`applyContextPolicy` | `PUT config`；会话级压缩走 `PUT /prompt-config` | 默认 / 会话 | revision | 覆盖（会话级可清） |
| 13 | 会话级内容差分 | 会话条目 `lifeos.long-agent-prompt-config.v1` | `prompt-config.ts`（唯一解析点） | `PUT /api/sessions/:id/prompt-config`（单项写 `null` 撤销，写 `{}` 清空） | 该会话（下一轮生效） | 追加条目（revision + 409） | 撤销即停 |
| 14 | 本轮编辑 | 会话条目 `lifeos.context-edit` | `context-edit.ts`（gate 处应用） | `PUT /api/sessions/:id/context-edit`（excluded / modified / added，按 `blockId`） | 该会话起（后续轮次继续） | 追加 | 恢复即还原 |
| 15 | 完整记录开关 | 会话条目 `lifeos.interaction-recording` | `session-interactions.ts` | `PUT /api/sessions/:id/interaction-recording` | 会话 | 追加 | 关闭 |
| 16 | 个人 / 工作区 context 文件 | `~/.lifeos/agent/**` | `pi-agent-session.ts:180` | 改文件 | 个人 | 无 | 无开关 |

**四条读出来的事实**：

1. **一半内容没有写 API**（harness、项目上下文、Agent 空间规范、个人 context 文件）——它们的增删改只能"改文件"，因此也**没有引用检查、没有编辑历史、没有冲突保护**。
2. **只有规则与经验资源有版本链**（草稿 → 提交 → revision），但**写入口是对话式的**，没有直写 API。
3. **项目层（Long Agent × 项目）目前没有任何写入通道**（第 5/8/9 列里"项目"只出现在文件路径与资源库上）。
4. Context 文件走的是 Pi 的**资源发现**通道，**没有开关也没有记录为区域**——它们进请求，但不在 Life OS 的区域机制内。

## 11 增 / 删 / 改各自的闭环与缺口

### 11.1 增加

两条路：**数据驱动**（内容落到文件/配置/资源，类型已存在）与**代码驱动**（新增 L1 类型）。
新增一类内容时，**必须同时**完成：① 注册表一行（或复用已有类型）② 生产者读它的代码 ③ 作用范围声明 ④ 请求边界断言。
缺任何一条 → 得到"登记了但不生效"（现在有 6 条 `planned` 就是这种）。

**缺口**：① 项目层写入没有；② 用户新增"自定义区域实例"（L2）没有通道，只能靠会话级编辑层一次性追加；
③ 新增类型的清单只写在代码里，界面无法回答"这个 Agent 到底装了哪些类型、各自哪来的"。

### 11.2 删除（最容易混淆，必须分三种语义）

| 语义 | 含义 | 现状 | 缺什么 |
|---|---|---|---|
| **删内容** | 原文消失，所有引用者都受影响 | 只能"删文件"（harness/项目上下文等），无任何检查 | **引用检查**（谁在选它）、影响面提示、是否保留历史 |
| **停用注入** | 内容还在，只是本轮不进请求 | 有开关（harness、记忆、完整记录） | 仅覆盖 2–3 类，其余没有停用通道 |
| **取消引用** | 从该 Agent / 项目 / 会话的选择里去掉 | 有（资源勾选、会话差分写 `null`） | 无"影响面预览"（去掉后哪些会话会变） |

已受理的历史轮次不受影响（装配快照已冻结，`lifeos.agent-assembly-*`），这一点是现成的，但**删除操作没有把它讲给用户**。

### 11.3 编辑

三种方式并存：**就地改文件**（无版本、立即生效）、**追加版本**（资源库 draft → commit，有 revision）、**会话级差分**（不改原文，只改本会话取值）。
后两种是安全的；第一种是当前最主要的编辑方式，也最危险（无历史、无冲突检测、改完即影响下一个新轮次）。

**必须一起考虑的**：编辑后**已受理的轮次不变**（快照）、**下一轮生效**、以及"谁改的"至今没有统一记录（只有 Agent Memory、Agent Group 有审计日志）。

### 11.4 移动 / 提升与排序

- 项目层 → 通用层（harness 的"提升"）：现在只能手工复制，没有"提升"操作，也没有"通用层不得引用项目层"的检查。
- 区域顺序：由装配顺序写死（`assembly.ts` 的固定序列）；"可任意新增、命名、排序"的目标**没有实例化载体**。

## 12 由上面的分析新增的设计点（并入待定）

| 编号 | 设计点 | 为什么必须定 |
|---|---|---|
| D1 | **区域实例层**：用户自定义区域 = 名称 / 顺序 / 启停 / 内容来源（文件或文本）/ 作用域 | 否则"可以自由增加自定义区域"只能是会话级一次性编辑 |
| D2 | **文件类内容的写通道**：是否为 harness / 项目上下文 / 个人 context 提供 API + 引用检查 | 现在一半内容无 API、无检查、无历史 |
| D3 | **删除三语义的统一表达与影响面** | "删内容 / 停用 / 取消引用"必须在界面上分开 |
| D4 | **项目层写入**（Long Agent × 项目） | 目前 0 实现，而它是"项目里自动加载不同规范"的核心诉求 |
| D5 | **顺序与启停的载体** | 顺序现在写死在装配里；启停只覆盖 2–3 类 |
| D6 | **权限模型**：用户 / Agent / 项目维护者分别能改什么 | Agent 自我管理已经在做（规则资源、提示词），没有边界文档 |
| D7 | **编辑历史**：文件类是否需要版本与审计 | 资源库有，文件类没有；改坏了无法回退 |

## 13 三个场景走一遍（用上面的层与操作）

**场景 1：用户想给某个 Agent 加一条"输出格式"要求**
L3 新增内容 → 走规则资源（对话式 `prompt_resource_create_draft → commit`）→ L4 引用（勾选，冻结 revision）→ 进 `lifeos_agent_custom_instructions`。
不需要动 L1/L2。删除时：取消勾选（不停用内容）；要彻底删内容走资源库归档（有版本链）。

**场景 2：把"案例全文"改成按需读取**
需要先把 L3 内容改成指针形态（Skill 或索引文件）→ 需要 §5 的指针装载器（L1 的 `pointer` 生产者）→ 原区域正文缩短为入口。
删除时：原文件不删（内容仍在），只是不再进区域。

**场景 3：删掉某个 Agent 不再需要的项目规范**
L3 删内容（项目文件）→ 但**先要回答**：还有谁在用（同项目其他 Agent？会话快照？）→ 历史轮次不受影响（快照）；
当前做法是直接删文件，没有任何提示 —— 这是 D2/D3 要补的。

---

## 14 对象模型：归属 × 遵守范围（这一维之前漏了）

前面按"层"讲操作，还不够——**同样是"一条规范"，它属于谁、要求谁遵守，决定它放哪、谁改、怎么生效**。
两个正交维度：**归属（谁拥有它）** × **遵守范围（谁必须遵守）**。Life OS 里可实现的六档：

| # | 遵守范围 | 归属（事实源） | 今天是否注入 | 谁改 | 进请求的位置 |
|---|---|---|---|---|---|
| 1 | **所有 Agent × 所有项目**（用户级 / 协议） | `~/.lifeos/interaction-harness/**`（协作协议）、`~/.lifeos/agent/{skills,prompts}`、`~/.lifeos/prompt-resources`（Personal 规则） | ✅ 通用 harness 对所有 Long Agent；个人资源按选择 | 用户 / Agent（改文件或对话式资源） | `<lifeos_interaction_harness>`、`lifeos_agent_custom_instructions`、资源 |
| 2 | **项目内所有 Agent**（项目规范） | **项目仓库根的 `AGENTS.md`**（Pi 资源发现；Life OS 只读用户级 + 当前项目根，不继承父子目录） | ✅ 已实现（`project-profile`，resource-discovery） | 项目维护者 / Agent（改项目文件） | `<lifeos_current_project>` / `<lifeos_context>` |
| 3 | **单个 Agent × 所有项目**（Agent 私有） | `long-agents/<id>/definition.json`（身份、自定义指令）、`capability-config.json`（能力）、`<id>/workspace/AGENTS.md`、`<id>/prompt-resources`、`<id>/skills` | ✅（身份 / 自定义指令 / 能力 / Agent 空间规范） | 用户（Web 设置）/ Agent | `lifeos_identity`、`lifeos_agent_custom_instructions`、`lifeos_context scope=agent`、请求 `tools` 字段 |
| 4 | **单个 Agent × 单个项目**（该 Agent 在该项目的专属规范） | `<id>/projects/<project>/`：`project-guidance.md`、`AGENTS.md`、`flywheel.md`、`concept-space.md`、`cases/` | ✅（并入 harness 区域的项目节） | 用户 / Agent（改文件） | `<lifeos_interaction_harness>` 的「本项目专属规范」节 |
| 5 | **一个会话** | 会话条目 `lifeos.long-agent-prompt-config.v1`（内容开关/取值）、`lifeos.context-edit`（排除/改写/追加） | ✅ | 用户（面板 / 发送前编辑） | 覆盖默认或改写区域 |
| 6 | **一轮** | 请求体（`agentConfigs` / `promptCapture` / 附件）与发送前编辑 | ✅ | 用户 | 该轮请求 |

**四类典型问题由此可以直接回答：**

- **"项目有一个项目级的规范，放哪里？"** → 放 **项目仓库根的 `AGENTS.md`**（第 2 档，今天就能用，所有在该项目工作的 Agent 都遵守）。
  若这条规范只要求**某一个 Agent** 遵守 → 放第 4 档 `<id>/projects/<project>/project-guidance.md`。
  两者都不要复制到 Agent 私有目录（那是第 3 档，会变成所有项目都生效）。
- **"所有 Agent 要遵守的"** → 第 1 档（协议类）：`~/.lifeos/interaction-harness/`；**注意范围问题**：现在它对**所有 Long Agent**
  注入，但内容是"协作开发协议"，对生活类 Agent 属于多余占用 → 范围应收窄（见 §15）。
- **"单独 Agent 要遵守的"** → 第 3 档（Agent 私有，跨项目生效）或第 4 档（只在该项目生效）。**这两档最容易放错**：
  想让"这个 Agent 在 A 项目这么做"却写进了第 3 档，就会在 B 项目也生效。
- **"只这一次这么做"** → 第 5/6 档（会话差分 / 本轮编辑），不动文件。

**机制映射（每档用哪个区域/字段，由形态决定）**：第 1/2/3/4 档都是「文本常驻」或「资源发现」；
第 3 档的能力（工具/技能/扩展）走请求的 `tools` 字段与资源装配；第 5/6 档是"差分"，作用在 1–4 档已经产生的区域上。

## 15 范围问题：第 1 档现在过宽（要定）

`~/.lifeos/interaction-harness/**` 今天对**所有 Long Agent** 注入（开关默认 on）。但它是"用户与 Agent 的协作协议"，
内容偏协作开发（需求/前端/开发/任务/测试/维护规范 + 案例 + 飞轮 + 概念索引）。

三种收窄方式（要你选）：

| 方式 | 做法 | 影响 |
|---|---|---|
| A 按 Agent | 只有声明"参与开发类工作"的 Long Agent 注入 | 需要 Agent 上一个"用途/角色"标记，或按"绑定项目类型"判断 |
| B 按项目 | 通用层只保留**最小协议**（怎么协作、怎么收尾），细则下沉到项目层（第 4 档） | 内容要重新分层，改动在文件组织，不在代码 |
| C 保持全量 | 现状；接受占用 | 零改动，占用继续存在 |

倾向 **B**：与"协议入口常驻、细则按项目"一致，也符合"内容在项目层更贴场景"；代码侧只需改"通用层读哪些文件"。

## 16 代码工作量评估（结论：很小）

| 要做的事 | 代码量 | 说明 |
|---|---|---|
| 六档对象模型 → 文档与检查视图呈现 | 无（文档 + 现有投影） | 第 1–4 档事实源都是**已存在的路径** |
| 项目级规范（第 2 档） | **0** | 项目根 `AGENTS.md` 已经经 Pi 资源发现注入 |
| 第 1 档范围收窄（选 B） | 小 | 只改 `readInteractionHarness` 读哪些文件 + 一份文件搬家 |
| 区域实例（D1，自定义区域） | 中 | 需要存储 + UI + 装配遍历；**除非你确实要"用户自己加区域"，否则不做** |
| 项目层写入（D4） | 中 | 需要项目目录约定 + 写通道 + 作用域解析 |
| 引用检查 / 删除影响面（D2/D3） | 小–中 | 读侧已经能回答"谁选了它"（资源选择就在配置里） |
| 指针装载器（§5） | 小 | 复用 Pi Skill，只加装配映射 |

**结论**：把"归属 × 遵守范围"讲清后，**大部分需求不需要新代码**——它们是"把内容放到对的那一档"；
真正要写代码的只有：第 1 档范围收窄（小）、指针装载器（小）、以及你要不要 D1/D4 这两个能力。

---

## 17 重新定位：harness 是「任务执行协议 + 任务模板」，不是开发协议

用户 2026-10-14 的纠正：**交互 harness 约束的是"不同类型的 task 该怎么完成"，以及 task 的模板**。
"开发"只是其中一种任务类型，所以它不该占据通用层（这正是 §15"对生活类 Agent 纯占用"的真正原因——不是范围没设好，
是**内容放错了层**）。分类轴因此不是"开发 / 生活"，而是：

| 维度 | 是什么 | 例子 |
|---|---|---|
| **项目类型** | 一个项目目录承担什么工作、资料放哪、有什么规范 | 看书项目（书目 / 笔记 / 进度）、旅游项目（行程 / 价格源 / 监控）、开发项目（代码 / 任务目录 / 案例） |
| **任务类型** | 一类任务怎么做 + 模板（步骤、输入、交付物、验收、回填） | 读书笔记、价格监控、功能开发、旅行规划、周报 |
| **Agent** | 谁来做、有什么能力与偏好 | Nexus（陪读）、Coder（技术书摘）、Planner（出行方案） |

三者**正交**：一个项目可以有多种任务类型；一个 Agent 可以在多个项目里做不同任务类型；约束来自"任务类型"，
不是来自"Agent 是谁"。

### 17.1 harness 内容的重新分类（现有内容要审核）

| 类别 | 应该放哪 | 现有内容归属（待审核确认） |
|---|---|---|
| **通用协议**（怎么做任务、怎么协作、怎么收尾回填） | 第 1 档：`~/.lifeos/interaction-harness/` | `protocol/*.md`、`AGENTS.md`（本层指引）、飞轮（方法/原则/工具/教训） |
| **任务类型细则**（某类任务必须遵守什么） | 任务类型资产，**不进通用层** | **开发规范 6 份**（需求/前端/开发/task/测试/维护）→ 实为"功能开发"任务类型的细则 |
| **任务模板**（步骤 + 交付物 + 验收） | 任务类型资产 | **现在没有**（Task 只有自由文本 `prompt` + `deliverable{kind:post|note, slot, audience}` + `schedule`）→ 新增 D8 |
| **经验与词汇**（跨类型的案例、概念、知识） | 通用 + 项目两级（按"别的项目会不会遇到"） | `cases/`、`concept-space/`、`knowledge/` |

**这条分类一旦成立，"生活类 Agent 被纯占用"的问题自动消失**：通用层只剩最小协议；开发细则只在"做功能开发任务"时加载。

### 17.2 与 §14 六档的对应

| 内容 | 档位 | 例子 |
|---|---|---|
| 通用协议 | 第 1 档（所有 Agent） | 怎么接任务、怎么协作、怎么收尾回填 |
| 项目类型规范 | 第 2 档（项目内所有 Agent） | "看书项目"的目录约定与笔记要求（项目根 `AGENTS.md`） |
| 任务类型细则 + 模板 | 任务类型资产：可跨项目复用（第 1 档）或限定项目（第 2 档） | "读书笔记"模板、"功能开发"细则 |
| Agent 偏好与能力 | 第 3 档 | 该 Agent 的输出格式偏好、可用工具 |
| Agent × 项目 | 第 4 档 | 该 Agent 在该项目的专属指引 |
| 会话 / 轮次 | 第 5/6 档 | 这次例外 |

### 17.3 三个场景走一遍（用于验证模型）

**场景 A：看书（项目 = 一个目录，多 Agent，多种任务类型）**

```text
项目目录 ~/Code/reading/            ← 项目类型"看书"
  AGENTS.md      项目规范：书目在 books/、笔记在 notes/、进度写 progress.md；读完一章产出笔记
  books/         书籍资料
  notes/         读书笔记（产物）
  progress.md    进度

任务类型"读书笔记"（模板）：读指定章节 → 摘录要点 → 写 notes/<book>-<chapter>.md（交付物 note）
                          → 更新 progress.md → 收尾（回填每日记录 / 案例）
任务类型"书单整理"（模板）：扫描 books/ → 输出候选书单（交付物 note）

Agent：Nexus 陪读（读书笔记）、Coder 做技术书摘（另一模板）

一次任务：用户对 Nexus 说"读第 3 章"
  → 受理（本轮 projectId = reading）→ 装配：通用协议 + 项目规范（第 2 档）+ 任务类型模板（读书笔记）
  → 执行：读 books/ 第 3 章 → 写 notes/ → 更新 progress.md
  → 收尾：回填 daily/；产出物登记 artifact
验收：notes/ 有新文件 + progress.md 更新 + 该轮请求里能看到"通用协议 + 项目规范 + 模板"三段
```

**场景 B：旅游价格监控**

```text
项目目录 ~/Code/travel-hokkaido/    ← 项目类型"旅行"
  AGENTS.md     项目规范：行程在 itinerary.md、价格源在 sources/、监控结论写 monitoring.md
任务类型"价格监控"（模板）：抓 sources/ 里的源 → 与上次比对 → 有变化则记 monitoring.md 并按需通知
                 （现已可映射为 Task：schedule=cron + deliverable note + channel_send）
一次任务：定时触发 → 同上装配（项目规范 + 监控模板）→ 执行 → 回填
验收：monitoring.md 有新记录；无变化时不发通知（模板里写明）
```

**场景 C：功能开发（现有内容其实就是这个）**

```text
项目目录 = Life OS 仓库                ← 项目类型"开发"
  AGENTS.md     项目规范（第 2 档，已实现注入）
任务类型"功能开发"（模板 + 细则）：建任务目录 → phases/unit 卡 → 实施 → 自检 → 案例/飞轮/每日记录回填
                 ← 这就是现在的"开发规范 6 份"，应作为任务类型资产，而不是通用层
一次任务：与现状一致（唯一差别是加载时机——只在做开发任务时加载）
验收：任务目录 + 门禁通过 + 案例回填
```

### 17.4 由此新增的设计点

| 编号 | 设计点 | 说明 |
|---|---|---|
| **D8** | ~~任务类型与模板~~ → **已实施（2026-10-14）**：`task-types/<type>/`（通用层）+ `~/.lifeos/projects/<projectId>/task-types/<type>/`（项目共用叠加）；选中来源 = `~/.lifeos/projects/<projectId>/task-types.json`；注入为 harness 区域里的 `## 任务类型 · <type>/<file>` 分节；未声明则只注入通用协议。**模板文件约定**（`TEMPLATE.md`：步骤/输入/交付物/验收/回填）已写入 `task-types/README.md` | 与现有 `Task` 的关系待接（任务实例选择类型，目前是项目级声明） |
| **D9** | ~~harness 内容审核与重分类~~ → **已实施（2026-10-14）**：6 份开发规范从 `standards/` 迁入 `task-types/development/`；通用层保留 `protocol/` + 本层指引 + 飞轮 + 概念索引 + 案例；23 处引用同步；Life OS 项目声明 `taskTypes: ["development"]` 保持行为不变 | 遗留：`concept-space/harness/task-types.md` 把"任务类型"定义为 A/B/C（交付物性质），与本次"任务领域"同名 → **术语待你裁定** |
| **D10** | 项目类型是否显式建模（项目目录里声明"我是什么类型的项目"） | 场景 A/B 的"项目类型"目前靠 `AGENTS.md` 文字表达；是否需结构化字段待定 |

### 17.5 需要验证的问题（拿出来跑）

1. 场景 A 里，**通用协议 + 项目规范 + 任务模板**三段能否都进请求、各自进哪个区域、能否在检查视图看全 —— 现在第 1/2 档可验证，任务模板（D8）还没有。
2. "同一项目、不同 Agent、不同任务类型"是否真的不互相污染（Agent A 的读书模板不会跑到 Agent B 的开发任务里）。
3. 换项目时是否正确切换：同一个 Agent 在看书项目与开发项目下加载的内容不同（第 2 档差异）。
