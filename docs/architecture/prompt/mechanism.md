# Prompt 内容进入机制：区块、承载形态与作用域
> 角色：架构 / 开发　类型：参考　状态：现状

## 1. 文档地位

本文回答一个问题：**任何内容（规范、经验、记忆、知识、要点、能力）要进入一次模型请求，只有哪几条路，怎么归类，怎么被配置与审计。**

- 本文**扩展**[Agent 第一性原理 §2、§9](../lifeos-agent-first-principles.md)与[Context 与 Resource 统一模型 §15](../lifeos-context-resource-model.md)，**不重新定义**身份、所有权、作用域或加载规则；冲突时以那两篇的所有权结论为准，机制细节以本文为唯一正文。
- 状态标注约定：**【已实现】**由源码与测试支撑；**【目标】**是已确认的设计结论，尚未实现，不得当作可用行为（见[文档索引归档规则](../../README.md)第 3 条）。
- 不承载：某类内容的产品需求场景（进入Life OS 目标需求（**待重写**）与所属模块文档）、历次验收数字（进入任务记录，不在本仓库归档）。

## 2. 第一性事实：内容进入请求只有两个落点

Life OS 直接调用 Pi SDK（`createLife OSPiAgentSession` → `createAgentSession({settingsManager, sessionManager, resourceLoader, model})`），请求的每一个字节都由 Life OS 组装。因此**设计一个 Agent 等价于设计它这一次请求的构成**；不存在第三种可设计的东西。

一次请求里，内容只有两个落点：

1. **具名区块**：System Prompt 里的一段（含 Pi 原生区、Life OS 自定义区、context file、Skill 描述）。
2. **消息流内容**：用户/历史消息，或**工具结果**（包括 `read` 读回的文件正文）。

推论（这是整套机制能统一的原因）：两个落点位于**同一个请求边界**，因此**观测、记录、否决、预览与实际发送必须也是同一套**。Pi 的 `setContextEntryFilter` 语义同时作用于上下文与压缩（`src/lifeos-session.ts:98-103`）就是这条推论的原生形状。

已有的实现锚点：

| 事实 | 锚点 |
|---|---|
| 区块有稳定 id/tag/label/父子/可捕获性，一处定义三处消费 | `src/long-agents/prompt-region-registry.ts:42-50`（9 个区域） |
| 区块级否决与改写（本轮级） | `src/context-edit.ts:16,31,33,248`（`blockId` = `tag:<tag>#<子条目>`） |
| 区域无条件记录（id + 字符数 + 前 80 字符预览） | `src/session-interactions.ts:30` 及区域记录读写 |
| 工作区 context files（顺声明链条读取） | `src/agents/pi-agent-session.ts:152-170` → Pi `agentsFilesOverride` |
| Skill 描述进 prompt、正文按需读 | Pi `core/skills.ts:355`、`core/system-prompt.ts:66,156`；Life OS 传 `additionalSkillPaths`（`src/agents/pi-agent-session.ts:198-203`） |

## 3. 需求两问（评审入口）

设计任何需求时按顺序回答：

**Q1 · 它涉及 prompt 吗？** 判据：会改变模型**能看到**或**必须遵守**的内容 → 涉及。不涉及 → 走常规六步链（信息定义 → 存储 → 后端加载 → 前端展示 → 用户交互 → 实际生效），不适用本文。

**Q2 · 涉及 → 它属于哪个内容大类，用哪种承载形态？** 必须填出 §11 的六问表；填不出第 6 问（怎么断言它真的进了/没进这次请求）就是设计未完成，不得进入实施。

一个需求可以同时需要多个形态（例：记忆 = 工具 + 一条最小指针）。

## 4. 三种承载形态

| 形态 | 请求落点 | 常驻成本 | 否决方式 | Pi 原生入口 |
|---|---|---|---|---|
| **文本区块** | System Prompt 具名区块 | 每轮固定 | 区块级开关 / 差分 | `appendSystemPromptOverride`、`customInstructions`、context files |
| **指针区块**（推荐默认） | 区块内只放"这是什么 + 在哪个路径 + 何时必须读" | 每轮几十 token | 同上 | Skills（`SKILL.md` frontmatter 描述 + 按需读正文）、context file 索引、`read` |
| **工具** | 不占 prompt；结果进消息流 | 0 常驻 | 工具授权与资源选择（`tools`、`customTools`、`ResourceLoader`） | 同左 |
| **能力区块** | 不是文本，进 tools/resources 装配 | 工具 Schema 与描述 | Pi 的 tools/resources 选择与授权 | `resources.explicit`、`getDefaultTools` |

规则：

1. **形态必须区分**，因为业务含义不同：一段规范、一条记忆、一个工具 Schema 在字节层面都是文本，但否决机制、审计方式与失败后果不同。统一管理不等于伪装成同一种运行对象（第一性原理 §2 已定）。
2. **工具形态必须配一条最小指针**：模型不知道有得查，就不会查。指针属于"记忆地图/能力契约"这类常驻小区块，不是工具本身。
3. 能力区块**共用同一张注册表的默认 / 差分 / 作用域语义**，只是落到请求的不同位置；不为它另建配置通道。
4. **承载通道必须显式声明并可审计**（`PromptContentType.entersVia`）：文本 / 指针形态要么有区域 id（`region`），要么声明经 Pi 资源发现通道注入（`resource-discovery`，如 `AGENTS.md` / `PROJECT_*.md`，没有 Life OS 区域），要么登记为 `planned`（承载通道本身未实现）。审计强制：`planned` 不得声称已实现层；`resource-discovery` 必须有已实现层且不得声明区域 id。这样"注册表有一行"与"它真能进这次请求"不会脱节。

## 5. 常在还是按需（核心判据）

> **常在 = 不查就会犯错的**；**按需 = 查了才知道有没有的**。

- 常在候选：身份与职责；必须遵守的规则**摘要与其所在位置**；记忆地图（有哪几类记忆、各自在哪、用什么工具查、什么情形必须先查）。
- 按需：记忆正文、案例正文、规则正文、项目文件、历史细节、知识库条目。

上游同构证据（不是我们的发明）：

- **Pi `examples/extensions/claude-rules.ts`**：扫描项目规则目录，只在 System Prompt 里列清单，正文由 agent `read` 按需读。
- **Pi Skills 规范**：`formatSkillsForPrompt` 只放 name + description，正文按需读；这是"指针区块"的规范实现。

Life OS 现状体积（用于判断哪块违反判据，非规范值）：

- B5 实测 token 占比：交互 harness **20,806 tokens（2.13%，最大单块）**、长期记忆 **4,718（0.47%）**、自定义指令 **1,814（0.18%）**（见 pi-004 `dev/P3-discussion.md`）。
- 注入字符量：通用层每轮 **88,829**（其中 `cases/` 全文 **44,276**）；pi-agent × lifeos 每轮 **182,792**（案例全文 **113,524 = 62%**）；基线 72,873（10-09）→ 182,792（10-13），四日 ×2.5（见 pi-004 `04-plan.md` DP-7）。
- **结论**：长期记忆区块已经符合判据（只装 index + definition，各截 16,000 code points，`src/long-agents/agent-group-service.ts:28,609-614`）；违反判据的是**交互 harness 的案例全文注入**（案例正文按 `read`/Skill 按需读即可），处置见 §11 与 pi-004 P3-U6（DP-7）。

## 6. 记忆清单（Life OS 里到底有哪些记忆）

| 记忆 | 归属 | 底座存储 | 当前形态 | 实测使用量（567 个会话文件的 `toolCall` 次数） |
|---|---|---|---|---|
| Personal 与 Project 共享事实 | 用户与项目 | Life OS Home（`memoryDir`） | **纯工具** `memory_search`、`memory_record` | 839 / 889 |
| 每日总结与归档 | Long Agent × 日 | Life OS Home | **纯工具** `summary_manage` | 1,341 |
| 规则、经验、案例 | 组织级 | `prompt-resources` store；交互 harness `cases/` | 勾选后进自定义指令；harness 目前全文注入 | — |

结论：**记忆的写入与检索已经全部工具化并被真实使用**（无 always-on 副本的 Personal/Project 记忆同样有大量调用），所以记忆层不需要新机制；需要的是（a）一张常驻**记忆地图**，（b）`lifeos_long_term_memory` 的**可配置开关**（目前无法关闭），（c）§9 的蒸馏层唯一性。

## 7. 内容类型注册表

机制只有这一张表 + 一个解析函数，做法与体积同 `prompt-region-registry.ts`（一行一类，一处定义多处消费）。

**实现位置**：`src/long-agents/prompt-content-registry.ts`（声明）、`src/long-agents/prompt-config.ts`（解析 + 会话级落点 + 上下文策略应用）、`src/long-agents/assembly.ts`（**唯一解析点**）、`src/agents/pi-agent-session.ts`（应用与生效记录）、`src/long-agents/prompt-content-projection.ts`（**面板投影**：按注册表逐行输出生效值 / 来源层 / 覆盖 / 已开放与未开放层，读 `GET /api/long-agents/:id/prompt-config?sessionId=…`）。门禁测试：`test/long-agents/prompt-content-registry.test.mjs`（注册表自洽 + 与区域注册表互查）、`test/long-agents/prompt-content-projection.test.mjs`（面板读到的生效值与装配 resolver 同源、未实现层必须显式返回、默认值取自真实 Pi 设置）。

**面板是投影不是事实源**（P3-U5）：前端 `frontend/lib/prompt-content-panel.ts` 只做 `unknown` 校验与写入调用，不计算生效值；三处入口（助手设置、输入区配置弹窗、发送前编辑面板）挂载同一个 `PromptContentPanel` 组件。写入仍只有两条既有通道：会话级 `PUT /api/sessions/:id/prompt-config`、默认层 `PUT /api/long-agents/:id/config`（字段已在白名单）。

字段：

| 字段 | 含义 |
|---|---|
| `id` | 与区域注册表同一命名空间；文本形态必须在区域注册表可见 |
| 名称 | 用户可读名（面板、检查视图、记录都取它，不得各自起别名） |
| 来源解析器 | 从哪个文件 / 服务 / 配置读（可多个） |
| 承载形态 | `text` / `pointer` / `tool` / `capability` / `runtime-config` / `record` |
| 默认 | 默认带不带（含"仅摘要"或"仅地图"） |
| 适用作用域 | 该类型允许在哪几层被配置 |
| 可否决 | 是否允许关掉或改写；不可否决必须写原因 |
| 正文是否入记录 | 记录正文还是只记 id + 体积 + 预览 |

两个注册表的分工：区域注册表**事后描述**这次请求里有什么；内容类型注册表**事前声明**该带什么。**同一个 id，缺一即门禁失败**（§10）。

### 7.1 通用层的实现程度（逐能力核对，2026-10-14）

| 通用能力 | 是否存在 | 代码证据 | 说明 |
|---|---|---|---|
| **声明**（有哪些内容类型 / 区域） | ✅ 存在 | `prompt-content-registry.ts`（23 类 + 2 个待定来源）、`prompt-region-registry.ts`（9 区域） | 一行一类，唯一来源 |
| **识别**（装配判断顶层区域、捕获解析分区） | ✅ 存在 | `pi-agent-session.ts` 的 `topLevelTags()`、`session-prompt-capture.ts` 的 `captureSectionTags()` | 由区域注册表生成，不是三处各自定义 |
| **记录与展示**（区域记录、区域名、预览标签、面板投影） | ✅ 存在 | `session-interactions.ts`、`context-preview.ts`、`prompt-content-projection.ts` | 由注册表驱动 |
| **否决与差分**（区块/子项排除与改写、会话级差分） | ✅ 存在 | `context-edit.ts`（`blockId`）、`prompt-config.ts`（唯一解析点） | |
| **加载**（按类型加载对应区域的内容） | ❌ **不存在** | —— | 内容加载按区域**逐个硬编码**在产生点：`assembly.ts` 按固定顺序产生身份 / 自定义指令与运行合同 / 记忆 / 交接 / 范围 / harness；工具与资源在 `pi-agent-session.ts` 按 `agent.tools` / `agent.resources` 装配。注册表的 `id` / `regionId` / `entersVia` **不参与加载**，`entersVia` 目前只用于审计声明。 |

**按承载形态看实现度**

| 形态 | 登记数 | 已实现加载 | 缺口 |
|---|---|---|---|
| `text` | 13 | 身份、自定义指令与规则资源、运行合同、harness、**任务类型细则与模板**、长期记忆、Agent 空间规范、项目档案（后两者走 Pi 资源发现） | 6 条 `planned`：`capability-contract`、`long-agent-group-standards`、`project-settings`、`project-harness`、`project-shared-facts`，以及 `history-exclusion` 的会话级 |
| `pointer` | 1 | **0** | 唯一的指针条目（项目共享事实）也是 `planned`；**Life OS 层没有指针加载器**（Pi 的 Skill"描述进 prompt、正文按需读"是 Pi 机制，不是本通用层能力） |
| `tool` | 0 | —— | 工具以 Pi `customTools` / `tools` 装配在跑，但没有按类型登记与驱动 |
| `runtime-config` | 4 | 模型、思考强度、生成参数、上下文策略 | 前三项只落 Long Agent 单键（项目层未实现）；上下文策略为会话级 |
| `record` | 1 | 完整记录开关（Long Agent 默认 + 会话） | —— |

**含义**

1. **通用层部分存在**：声明、识别、记录、投影、否决是通用的且有门禁；**加载不是通用的**。
2. 因此"新增一类 prompt 内容"**不能只加注册表一行**：必须同时在产生点写加载代码（或走 Pi 资源发现），
   否则只会得到一行"可见但不生效"的登记——本次审计发现的 6 条 `planned` 正是这种状态，已如实标注。
3. **指针形态尚未实现**：若要把案例 / 飞轮 / 概念正文改为"按需读取"（见 [交互 harness 注入契约](./interaction-harness.md) §6），
   前置是补一个指针加载器；在那之前只能全文注入。

## 8. 一套差分，四种落点

差分结构只有一套（去掉 / 改写 / 新增 + 来源 + 时间），差别仅在存哪里：

| 作用域 | 落点 | 状态 |
|---|---|---|
| 本轮 | 请求体（发送前配置） | 【已实现】B5：区块勾选、改写、手写新增，预览与发送同源。面板在此处只读并指向发送前编辑，不新增第三处写入口 |
| 会话 | 追加式只读会话条目 | 【已实现】内容配置 `lifeos.long-agent-prompt-config.v1`（`{longAgentId, config, revision}`：追加不改写、revision 乐观并发冲突 409、重启或重新打开读到同一份）；同型先例：`lifeos.interaction-recording`（`src/session-interactions.ts:30`） |
| Long Agent × 项目 | 项目层配置文件 | 【目标】 |
| Long Agent 默认 | Long Agent 层配置（现有 `agentConfigs` 等只读兼容映射） | 【部分】 |

顺序：**Long Agent 默认 → Long Agent × 项目 → 会话 → 本轮**，后层覆盖前层。当前已开到**会话层**；**Long Agent × 项目层只预留字段与接口、未实现写入**，不得在面板上当成可用能力。进行中的轮次沿用已冻结的定义（重试不变），新轮次才读到新会话配置。历史记录不改写；旧持久名与模型可见名按兼容名注册（pi-004 DP-4 已批准）。冻结规则沿用[Context 与 Resource §15.4、§15.6](../lifeos-context-resource-model.md)：正文按 revision / hash 冻结，只记 hash 却仍读可变文件不算冻结。

## 9. 与压缩的关系（必须避免双蒸馏）

Pi 的压缩由 `SettingsManager.compaction`（`enabled`、`keepRecentTokens`、`reserveTokens`）与压缩摘要条目承载；Life OS 已在装配时读取 `getCompactionReserveTokens()` 保留运行/输出预算（`src/agents/pi-agent-session.ts`），且排除条目对上下文与压缩同时生效（`src/lifeos-session.ts:98-103`）。

会话级覆盖【已实现】：`applyContextPolicy` 把差分发到**装配用的 in-memory SettingsManager 副本**（无覆盖时复用原实例，不写回用户 `settings.json`），真实作用于装配入参与超预算 fail-closed 判定（断言见 `test/agents/prompt-config-boundary.test.mjs`）。注意：**阈值变化只作用于后续轮次**，已压缩的历史不能回退；面板与文档必须明说，否则用户会当成“没生效”。

一旦引入"会话要点/会话记忆"区块，**只能有一个事实上的蒸馏层**：压缩摘要是唯一生产者，会话要点作为其输入或补充投影，不得各自产生一份"上次说到哪"。这是 P6 设计的前置决策，不是实现细节；同时它决定了"有了要点层之后可以把 `keepRecentTokens` 降到多少"——这正是历史可以少带的机制来源。【目标·待设计讨论】

## 10. 门禁（可机器检查）

1. 进入 prompt 的内容必须在内容类型注册表有一行，文本形态的 id 必须在区域注册表可见；能力形态必须显式登记为 tools/resources 装配。
2. **同源断言**：装配 / 预览 / 记录 / 实际发送消费同一 `resolvePromptContent` 输出；测试必须断言"预览里没有的东西，请求里也没有"。
3. **数据驱动**：新增同类实例（再加一条规则、一个案例、一类记忆）不得要求修改源码，只放文件即生效。
4. **体积回归**：常驻区块体积变化必须给出实测前后对比（沿用 pi-004 evidence 的测量方法）。
5. **禁止双头**：同一语义不得存在第二套写入路径或第二份可写事实源（同一 id 只能有一个写入落点）。

## 11. 六问模板（涉及 prompt 的 unit/需求卡必填）

| # | 问题 | 不合格示例 |
|---|---|---|
| 1 | 属于哪个内容大类 | "能力配置"（不是大类，是笼统标签） |
| 2 | 承载形态（text / pointer / tool / capability，可组合） | 未写 |
| 3 | 来源解析器读哪里 | "从配置读"（未指文件或服务） |
| 4 | 默认带不带；否决发生在哪一层 | "可配置" |
| 5 | 差分落到哪个存储；与现有通道是否同一 | 新起一个字段（→ 双头） |
| 6 | 怎么断言它真的进了/没进这次请求 | 只写单测名字，无请求边界断言 |

## 12. 当前差距与处置

差距清单、砍 / 拆 / 加的具体 unit 映射，维护在任务侧记录源：`~/.lifeos/long-agents/pi-agent/projects/lifeos/tasks/pi-004-full-history-optimization/06-content-mechanism-alignment.md`（该记录写在**旧家 `~/.lifeos`**，2026-10-14 切换前）（任务文档记录过程与处置，本文只留机制与判据；两侧不得互抄正文）。

相关既有正文：[第一性原理 §2、§9、§14](../lifeos-agent-first-principles.md)、[Context 与 Resource §15](../lifeos-context-resource-model.md)、[Life OS Agent 定义](../agent.md)、[Pi 会话能力基线](../../modules/pi/lifeos-pi-session-capabilities.md)。
