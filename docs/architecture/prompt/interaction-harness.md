# 交互 harness 与 Prompt 的注入契约
> 角色：架构 / 需求 / 开发　类型：说明　状态：现状

本文回答一个问题：**交互 harness 这套协议，怎样进入 Life OS Agent 的请求。**
协议本身（内容、组织、维护规则）的事实源在用户级 `~/.lifeos/interaction-harness/`；本文只写**注入契约**，
不复制协议正文。定义与分层见 [Prompt 定义](./README.md)，承载形态与判据见 [通用机制](./mechanism.md)。

## 1 一句话

交互 harness 是 **Agent 与用户之间的协作协议**。它进 prompt 只有一种方式：
**System Prompt 里的一个常驻文本区域 `<lifeos_interaction_harness>`**，由 Long Agent 装配点读取文件后生成
（`src/long-agents/interaction-harness.ts` → `prepareLongAgentAssembly`）。

**协议在固定路径下，不存在"版本"概念**：改文件即改协议；请求里各节的来源文件名就是反查依据。

## 2 协议包含哪些内容、怎么组织

协议按**板块**组织（见 harness `AGENTS.md`）：规范 · 概念空间 · 飞轮 · 案例 · 每日记录 · Todo · 任务 · 工具 · 知识库。
对 prompt 而言要区分两组：

**进 prompt 的（装配点实际读取）**——路径下的 `~/.lifeos` 即 Life OS Home（`LIFEOS_HOME` 可覆盖）：

| 内容 | 通用层（所有 Long Agent） | 项目层（该 Agent × 该项目） |
|---|---|---|
| 纯规则 | `~/.lifeos/interaction-harness/protocol/*.md` | — |
| **任务类型细则与模板** | `task-types/<type>/*.md`（当前 `development`：需求 / 前端 / 开发 / task / 测试 / 维护） | `~/.lifeos/projects/<projectId>/task-types/<type>/`（项目共用，叠加在通用层之后） |
| 资产：本层指引 / 飞轮 / 概念索引 | `~/.lifeos/interaction-harness/{AGENTS.md,flywheel.md,concept-space.md,concept-space/00-索引.md,concept-space/harness/00-索引.md}` | `~/.lifeos/long-agents/<agentId>/projects/<projectId>/{AGENTS.md,flywheel.md,concept-space.md}` |
| 案例（现状=全文；目标=只注入索引） | `~/.lifeos/interaction-harness/cases/*.md` | `~/.lifeos/long-agents/<agentId>/projects/<projectId>/cases/*.md` |
| 项目指引 | — | `~/.lifeos/long-agents/<agentId>/projects/<projectId>/project-guidance.md` |

**不进 prompt 的（按需读取）**：`daily/`（每日记录）、`todo/`、`tasks/`（任务）、`shared/tools/`、
概念正文（`concept-space/**` 里的条目正文）、`knowledge/`（知识库）。
它们由 Agent 在处理具体任务时读文件取用；**"承载入口"（是什么、在哪、何时读）已在协议正文里**。

## 2.5 System Prompt 的完整组成与来源（2026-10-15 实测）

一次真实请求（Agent `lifeosagent`、项目 `lifeos`、Life OS Home `~/.lifeos`）的 system prompt 追加串共 **49,434 字符**，
由下面 5 块组成（**每块都给出确切来源**；尺寸为该次实测）：

| # | 区块 | 字符 | 确切来源 |
|---|---|---|---|
| 1 | `<lifeos_agent_custom_instructions>` | 1,576 | 包裹 5 个"非顶层"指令：<br>· Agent 定义自定义指令 369 ← `~/.lifeos/long-agents/<id>/definition.json` 的 `customInstructions`<br>· 每日工作机制 291 ← 代码常量（`src/long-agents/assembly.ts` 的 `DAILY_ARCHIVE_INSTRUCTIONS`）<br>· `<recent_daily_summaries days="0">` 157 ← 代码生成的交接文本（读每日总结的入口）<br>· `<memory_fact_contract>` 232 ← 代码常量（`assembly.ts` 内联）<br>· `<lifeos_runtime_capability_contract>` 452 ← 代码常量（`assembly.ts:140` 内联） |
| 4 | `<lifeos_interaction_harness>` | 39,402 | `~/.lifeos/interaction-harness/**` + `~/.lifeos/projects/<projectId>/task-types/**` + `~/.lifeos/long-agents/<id>/projects/<projectId>/project-guidance.md`（逐节见 §2 表） |
| 5 | `<lifeos_project_collaboration>` | 1,752 | 代码（`src/agents/assembly-context.ts:243`）+ 事实来自 `~/.lifeos/projects/registry.json`（项目名/描述/路径/工作区） |

补充：
- **顶层区域由区域注册表声明**（`src/long-agents/prompt-region-registry.ts`：`topLevel: true` 的才与自定义指令并列）。
- **技能（SKILL.md）的 name/description 不在这段追加串里**——由 **Pi** 注入 base system prompt（Life OS 只负责把技能文件装到 `<home>/agent/skills/`）。
- 解析注意：协议正文里**自带** `<lifeos_interaction_harness>`/`<lifeos_runtime_capability_contract>` 标签（自述），
  所以按标签切块必须用**唯一闭合标签**或按装配顺序核对，不能见标签就切。

## 3 注入位置与区域结构（自底向上：内容 → 请求）

区域：`<lifeos_interaction_harness>` —— 在 `src/long-agents/prompt-region-registry.ts` 登记为**顶层、可捕获**区域，
与身份、长期记忆、自定义指令并列。区域内部按**性质分四节**，节标题带来源文件名：

```xml
<lifeos_interaction_harness>
以下是用户与该项目的交互 harness（协作规范 + 案例 + 概念索引），必须在本次开发中遵守；
动手前先读反例与正例；每轮结束后回填案例与每日记录；需要概念完整解释时按索引读取。

## 纯规则 · protocol/collaboration.md
## 任务类型 · development/需求规范.md
## 通用资产 · AGENTS.md
## 本项目专属规范 · project-guidance.md
</lifeos_interaction_harness>
```

**区域结构如何体现分类**：区域只表达一件事——"这是必须遵守的协议"（不混入身份/记忆/项目上下文）；
**内部分节承担分类**：

| 节 | 性质 | 为什么这样分 |
|---|---|---|
| `## 纯规则 ·` | 最硬的协作规则（怎么做协作/任务/收尾） | 必须先读，放最前 |
| `## 任务类型 ·` | 本轮选中任务类型的细则与模板（`<type>/<file>`） | 由**项目共用声明**选中才注入；不是所有 Agent 都适用 |
| `## 通用资产 ·` | 本层指引、飞轮、概念索引 | 是"资料入口"，与"必须遵守"区分 |
| `## 本项目专属规范 ·` | 该 Agent 在该项目的指引 / 飞轮 / 概念索引 / 案例 | 只在该项目生效 |

## 4 自顶向下：从请求反查内容

请求里看到 `<lifeos_interaction_harness>` → 按节标题里的来源名（`需求规范.md`、`project-guidance.md`、`cases/2026-10-14.md`…）
→ 到 `~/.lifeos/interaction-harness/` 或 `~/.lifeos/long-agents/<agent>/projects/<project>/` 打开对应文件即原文。
因为路径固定、内容即事实，**不需要也没有版本号**。

## 5 各场景下怎样使用

| 场景 | 是否注入 | 项目层 | 说明 |
|---|---|---|---|
| 默认回合（Web / IM 事件 / 定时 / 后台工作） | 注入 | 有则注入 | 装配点按该 Long Agent 的有效开关 + 本轮项目 |
| 发送前预览 / 检查视图 | 只读展示 | 同上 | 与真实发送同源 |
| 会话级开关关闭 | **不注入** | — | 关闭只是"不注入"，文件仍在；后果是**该会话失去协议约束**，界面必须说明 |
| 本轮没有项目（Agent 容器，`projectId=null`） | 注入通用层 | 无 | 项目层不存在即不注入项目节 |

## 6 当前决策与将来优化

- **当前**：通用协议（`protocol/`）+ 本层指引 + 飞轮 + 概念索引 + 案例，**全文注入**；**任务类型细则只注入本项目声明的类型**
  （声明在 `~/.lifeos/projects/<projectId>/task-types.json`，没声明就只注入通用协议）。
- **优化方向（已确认，尚未实施）**：**按内容分别采用不同加载策略——只注入"承载入口"**：规则正文保留（必须遵守）；
  案例 / 飞轮 / 概念正文改为"分区索引 + 在哪读 + 何时读"，正文由 Agent 按需读取。体积口径见 [通用机制 §5](./mechanism.md)。
- **触发方式**：由用户按需触发；**不预置阈值、不建待办**。在此之前一律按当前全量注入。
- **不做**：不给协议加版本号；不把协议拆成多个区域（它是一个性质）。

## 7 边界

- 协议正文在用户级 `~/.lifeos`，仓库只留索引（[docs/interaction-harness/README.md](../../interaction-harness/README.md)）；
  本文只描述注入契约。
- 交互 harness **不等于**"所有 Long Agent 的所有规则"：身份、长期记忆、项目上下文、规则与经验资源各有自己的
  区域与来源（见 [Prompt 定义 §5](./README.md)）。
- 每个 Long Agent 参与哪些项目、在哪个目录下工作，由它的 workspace 与项目目录体现，**不另建"参与声明"**。
