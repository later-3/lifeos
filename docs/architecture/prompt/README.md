# Prompt（Life OS 的 Prompt 定义与通用机制）
> 角色：架构 / 需求 / 开发　类型：说明　状态：现状（定义与约束）+ 目标（标注处）

本目录是 Life OS 里**与 Prompt 有关的唯一事实源**。

| 文档 | 回答 |
|---|---|
| 本文件 | **Prompt 在 Life OS 里指什么**、分几层、业务怎样挂在上面、做 Prompt 相关业务必须遵守什么 |
| [mechanism.md](./mechanism.md) | **通用机制**：区域声明与注册、承载形态、常在/按需判据、差分落点、请求边界门禁 |
| [harness-protocol.md](../../../.lifeos/interaction-harness/protocol.md) | **交互 harness 协议（首版，待审核）**：是什么、由什么组成、逐部分展开、自举概念空间、日期与大小策略、层级与归属机制 |
| [interaction-harness.md](./interaction-harness.md) | **交互 harness 的注入契约**：包含哪些内容、进哪个区域、各场景怎样使用 |
| [generic-layer-design.md](./generic-layer-design.md) | **通用层设计（目标，待审核）**：一个类型 = 声明 + 生产者；装入位置按形态；指针复用 Pi Skill；四类 prompt 需求的落法 |
| [backend-implementation.md](./backend-implementation.md) | **后端实现（第一层）**：用户发消息到 Pi SDK 请求的逐步链路、Pi 与 Life OS 的职责分界、验证状态 |

需求侧（要什么内容、给谁用）写在Life OS 目标需求（**待重写**）与各模块文档；本层不重复业务内容，
业务文档也不重复本层定义。

---

## 1 定义：Prompt 与一次请求

**Prompt = 客户端（Life OS）为一次模型调用组装并交给模型的内容与指令。**

一次请求的物理组成（Pi SDK 的事实，Life OS 只填内容、不改结构）：

| 请求组成 | 是什么 | Life OS 的写入方式 |
|---|---|---|
| **System Prompt** | 系统指令文本，可含 Life OS 的具名区域 | Pi `systemPrompt` / `appendSystemPromptOverride`（`customInstructions`） |
| **消息序列** | 用户、助手、工具结果的按序上下文 | Pi `SessionManager` 原生条目；工具结果由工具调用产生 |
| **工具定义** | 可调用工具的名称、描述、参数 Schema | Pi `tools` / `customTools`；不占 System Prompt 文本 |
| **请求参数** | 模型、thinking 级别、生成参数等 | `createAgentSession()` 入参 + `SettingsManager` |

术语约定（避免一词多义）：

- 说"整个请求"时用 **请求**；说"系统指令文本"时用 **System Prompt**；
- **Prompt** 用于泛指"交给模型的内容与指令"，不单独指 System Prompt；
- **区域**指 System Prompt 里由 Life OS 管理的具名块；**内容**指区域或消息里的实际文本/数据。

## 2 分层：Pi 提供机制，Life OS 装配，业务填内容

```text
① Pi 生态（底层，Life OS 不改）
   请求结构、SDK 接口、ResourceLoader / Skills / Tools / Session / SettingsManager
   → Life OS 只引用 pi/ 与 modules/pi/*，不重写、不复制

② Life OS 通用层（本目录）
   Prompt 的定义与约束 + 通用机制：区域怎样声明、内容以哪种形态进入、怎样在请求边界验证

③ Life OS 业务层（需求与模块文档）
   交互 harness、规则与经验、记忆、项目上下文、任务与历史……
   各自声明"要什么内容、为什么、适用范围"，机制由 ② 提供
```

**为什么必须有 ②**：Life OS 里的一切能力最终都落进上面那张请求表。没有 ② 时，每类内容都自己决定"塞进哪里、怎么关、
怎么证明生效"，于是同一件事被写成多份、开关语义互相覆盖。② 的作用是**把"内容怎样进入请求"收成一套**，业务只填内容。

## 3 Life OS 的通用能力：自定义区域

Life OS 在 Pi 的"追加 System Prompt"之上定义**具名区域**（`<lifeos_xxx …>`）。这是 Life OS 的通用能力：

- **可以增加区域**：新区域用稳定 id/tag/名称声明，进装配、记录、展示、检查四处共用（`prompt-region-registry.ts` 为唯一声明处）。
- **区域里放什么由业务决定**：身份、协作规范、长期记忆、项目上下文等是不同业务往同一机制里填的内容。
- **承载形态要区分**（详见 [mechanism.md §4](./mechanism.md)）：文本区块 / 指针区块 / 工具 / 能力装配。
  统一管理不等于把不同运行对象伪装成同一种。

### 一个已落地的例子：交互 harness

交互 harness 是一套**协作协议**，目的是让基于它的 Agent 遵守这套规范。按上面的分层：

| 层 | 这一层负责什么 |
|---|---|
| 协议本身 | 规范、概念空间、案例、飞轮、任务等协作资产的**内容与维护**（事实源在 `~/.lifeos/interaction-harness/`） |
| Life OS 通用层 | 提供"常驻文本区域"这一能力，以及区域的声明、装配与请求边界验证 |
| Life OS 业务层 | 决定它是**常驻文本**（不是工具），固定在 `<lifeos_interaction_harness>` 自定义区域；决定从哪些路径加载、加载哪些、区域标签怎么写 |

这也是判断一个新需求该怎么做的样板：**先判性质与形态，再选区域或请求字段，最后在业务层写清来源与范围。**

## 4 做 Prompt 相关业务的约束（必须遵守）

1. **只经公共装配入口**：一切内容经 `createLife OSPiAgentSession()` 进入请求；不得在业务代码里另起注入通道
   （例：绕过装配直接拼 System Prompt、在工具层偷偷追加系统文本）。
2. **先答判据，再动手**：涉及 Prompt 的需求必须答出 ①内容属于哪个区域或请求字段，②从哪读，
   ③适用范围（默认/项目/会话/本轮），④**怎么在真实请求边界验证它进了或没进**。答不出第 ④ 条＝设计未完成。
3. **一个事实一个来源**：区域内容只在其产生点决定，公共装配不二次过滤；同一语义不得有两个写入路径。
4. **形态与语义一致**：文本、指针、工具、能力各自的否决与审计方式不同，不得混同（见 [mechanism.md](./mechanism.md)）。
5. **Pi 生态优先**：先用 Pi 既有机制（系统提示追加、Context 文件、Skills、`customTools`、`SettingsManager`）；
   确需改 Pi 先按 `pi/AGENTS.md` 评审。参考 Pi 生态（Pi coding agent / Pi Web / 官方 extension）的既有做法，
   不自造平行机制。
6. **状态显式**：本层与业务文档都要标"现状 / 目标"；目标不得写成已发布行为。

## 5 业务挂载一览（谁在用什么形态）

| 业务内容 | 进入请求的位置 | 形态 | 业务文档 |
|---|---|---|---|
| 身份与职责 | `<lifeos_identity>` | 文本 | [Life OS Agent 定义](../agent.md) |
| 交互 harness（协作规范） | `<lifeos_interaction_harness>` | 文本（常驻） | [注入契约](./interaction-harness.md) · [Long Agent 架构](../../modules/long-agents/lifeos-long-agent-architecture.md) |
| 长期记忆 | `<lifeos_long_term_memory>` + 记忆工具 | 文本（地图）+ 工具 | Memory（已删除） |
| 项目上下文文件 | `<lifeos_current_project>` / `<lifeos_context>` | 文本 | [Project 框架](../../modules/projects/lifeos-project-framework.md) |
| 协作上下文 | `<lifeos_project_collaboration>` | 文本 | [Session 架构](../../modules/sessions/lifeos-session-architecture.md) |
| 任务与历史 | 消息序列 | 消息 | [Session 架构](../../modules/sessions/lifeos-session-architecture.md) |

**新增一类内容时**：先在第 4 节第 2 条的四个问题里定位，再找上表里已有的形态复用；确实需要新区域或新形态时，
按 [mechanism.md §7、§11](./mechanism.md) 的字段与模板声明，并同步注册表、记录解析与检查视图。

---

## 6 运行时：Prompt 是谁、在什么时候组装的

### 6.1 默认回合（Web / IM / 定时 / 后台工作）

```text
前端（Web 输入区 / IM 事件 / 调度触发）
  → POST /api/long-agents/:id/turns                        受理入口（携带意图，不携带装配结果）
  → acceptLongAgentTurn                                     耐久接受 + 返回执行引用（202）
  → drainLongAgentTurns                                     同一 Session 串行出队
  → prepareLongAgentAssembly（src/long-agents/assembly.ts）  ★ 唯一解析点：
                                                              内容配置（默认→会话）+ 身份 + 交互 harness
                                                              + 记忆 + 项目上下文 + 工具/资源
  → createLife OSPiAgentSession（src/agents/pi-agent-session.ts）★ 唯一装配工厂：
                                                              SettingsManager / ResourceLoader /
                                                              AgentSession（检查与执行共用）
  → Pi AgentSession → provider 请求
```

关键点：

- **受理与装配分离**：前端只提交意图（文本/附件/项目/本轮调整），装配在后端受理后发生；已受理轮次用冻结快照重试。
- **解析点唯一**：只有 `prepareLongAgentAssembly` 解析内容配置；公共装配不再二次过滤（区域在其产生点决定）。
- **装配工厂唯一**：执行、检查（`agent-inspection.ts`）、发送前预览（`context-preview.ts`）走同一工厂与同一解析器，
  因此"预览里没有的东西，请求里也没有"。

### 6.3 内容来源与作用域（与 [mechanism.md](./mechanism.md) §8 一致）

| 内容 | 来源 | 作用域 | 解析点 |
|---|---|---|---|
| 身份、能力、长期指令 | `long-agents/<id>/definition.json` + `capability-config.json` | Long Agent 默认 | `prepareLongAgentAssembly` |
| 交互 harness | `~/.lifeos/interaction-harness/**` + 该项目目录 | 默认 + 该项目 | 同上（区域产生点） |
| 项目上下文 | 项目根 `AGENTS.md` 等（Pi 资源发现） | 该项目 | 装配工厂 |
| 规则与经验资源 | Prompt 资源库（Personal / Project） | 默认 / 项目 | 同上 |
| 会话级覆盖（内容配置） | 会话条目 `lifeos.long-agent-prompt-config.v1` | 该会话 | 同上 |
| 本轮调整 | 请求体 → 发送前编辑 | 该轮 | 预览与发送同源 |

执行主体是本轮 Long Agent；`minimal-pi-coding-agent` 仅作为旧 id 兼容别名存在。
