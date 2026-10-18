# Life OS Agent 抽象定义（自顶向下逐层）
> 角色：架构　类型：说明　状态：现状（顶层已定义；下层逐项展开中）
>
> **这份文档管什么**：只做**层级 + 抽象定义 + 指针**——从 Life OS 入口进，一层层展开"Life OS Agent 是什么、由什么组成、每部分是什么"。
> 细节正文各有主人，本文**不复制**：Prompt 机制 → [`prompt/README.md`](./prompt/README.md) 与 [`prompt/mechanism.md`](./prompt/mechanism.md)；
> Agent 本质与稳定边界 → [`lifeos-agent-first-principles.md`](./lifeos-agent-first-principles.md)；Long Agent 领域模型 → [Agent 工具架构](agent-tools.md)；
> 承载与落地 → 需求文档（**待写**，本文件第 6 节列出它必须回答的问题）。

## 1 层级（阅读顺序）

```
L0  Life OS（系统入口：浏览器 → 后端 → 装配 → Pi）
   └─ L2  组成：① 身份 ② Prompt ③ 能力与工具 ④ 记忆 ⑤ 空间与产物 ⑥ 项目关系 ⑦ 运行与生命周期
      └─ L3  每部分的抽象定义（是什么 / 字段与取值 / 谁写谁读）
         └─ L4  承载与落地（放哪、何时读、谁写；→ 需求文档）
```

## 2 L0 · Life OS 系统入口

Life OS 里有很多东西；本文只沿 **Life OS Agent** 这一条线展开。入口链路与组件边界见
[`lifeos-current-architecture.md`](./lifeos-current-architecture.md)（浏览器 → 后端路由 → 装配 → Pi）与
[`prompt/backend-implementation.md`](./prompt/backend-implementation.md)（HTTP → Pi 的逐步链路）。

## 3 L1 · Life OS Agent 是什么

Life OS 里存在**两种生命周期**的 Agent（定义见 [`lifeos-agent-first-principles.md` §2.1](./lifeos-agent-first-principles.md)）：

2. **Long Agent**：用户长期管理的助手身份——**本文以下默认指它**（口语里的"我们的 Agent"）。

**一句话抽象**：Life OS Agent = 一个**有身份、有 Prompt、有可调用能力、有记忆、有自己空间、在若干项目里工作、可被创建/启用/删除**的长期对象。

## 4 L2 · 组成（七项）

| # | 部分 | 一句话 | 细节正文的主人 |
|---|---|---|---|
| ① | **身份** | 它叫什么、长什么样、长期职责是什么 | 本文 §5.1（**目前无其他主人**） |
| ② | **Prompt** | 它每轮被注入了什么（区域与承载） | [`prompt/README.md`](./prompt/README.md)、[`prompt/interaction-harness.md`](./prompt/interaction-harness.md) |
| ③ | **能力与工具** | 它能调用什么（内置工具 / 技能 / 扩展 / MCP） | [Agent 工具架构](agent-tools.md) |
| ④ | **记忆** | 它记得什么、怎么查（长期 / 共享 / 会话 / 每日） | `../modules/memory/README.md`（已删除） |
| ⑤ | **空间与产物** | 它自己的空间与运行产物放在哪 | 本文件 §5.5 |
| ⑥ | **项目关系** | 它和 Project 是什么关系 | [`lifeos-context-resource-model.md`](./lifeos-context-resource-model.md) |
| ⑦ | **运行与生命周期** | 怎么创建、启用、删除；怎么被前端选中 | 本文件 §5.7 |

## 5 L3 · 逐项抽象定义

### 5.1 身份

**抽象定义：身份由四部分组成**（下表"抽象定义"列 = **我们的设计**；"输入"列 = 现在代码/底座的事实，仅作参考，不是权威）：
|---|---|---|
| **展示头像** | `{kind:"auto"}` ／ `{kind:"emoji", emoji}` ／ `{kind:"image", file, revision}`；`auto` 由稳定 id 推导颜色与首字母 | `src/long-agents/types.ts:32-35`（类型）、`src/long-agents/avatars.ts`（图片上传与 revision）；存 `~/.lifeos/long-agents.json` |
| **身份说明文本**（给人/Agent 看的"我是谁"） | 一段文本（**设计上要求有专门承载**） | 现状：**没有专门承载**：散在 `definition.json` 的 `description` 与 `customInstructions`（现 1 段 369 字符旧文本），由代码拼成 `<lifeos_identity>`（`src/long-agents/assembly.ts:22-35`） |

**落地（我们的设计，2026-10-15 定）**：

| 部分 | 落在哪 |
|---|---|
| 展示名 | `agents/<id>/agent.json` 的 `name`（注册表删除后为唯一来源） |
| 展示头像 | 图片文件放 `agents/<id>/avatar/`；`agent.json` 只存引用（`{kind, file, revision}`） |
| 身份与职责 + 人格与性格 | `agents/<id>/identity.md`（**人/模型可读的正文**；机器字段不写在这里） |

**区域**：`<lifeos_identity>`（"身份与职责"，`src/long-agents/prompt-region-registry.ts:48`）。

**人格与性格（初始化设定）**：**现状不存在**——全仓搜索无 `人格 / 性格 / persona` 定义（缺口，见 §7）。

### 5.2 Prompt

由**区域**组成（顶层区域清单与每块的承载见 [`prompt/README.md`](./prompt/README.md)）；交互 harness 区域的内部结构与装载见
[`prompt/interaction-harness.md`](./prompt/interaction-harness.md)。**规划**（`prompt/generic-layer-design.md`）要求：
内容文本必须来自 `~/.lifeos` 下的文件，代码只提供区域外壳与顺序。

### 5.3 能力与工具

能力领域与配置项目见 [Agent 工具架构](agent-tools.md)；
运行期差异（工具/技能/扩展在 Pi 里的真实差别）见 [`lifeos-agent-first-principles.md` §2](./lifeos-agent-first-principles.md)。

### 5.4 记忆

### 5.5 空间与产物（我们的设计，2026-10-15 定）

**一个 Agent 一个根目录**（目录名 = Agent id，唯一来源）：

```
/Users/xulater/.lifeos/agents/<agentId>/
├─ identity.md       身份与职责 + 人格与性格（人/模型可读正文；装骨架，之后归 Agent）
├─ avatar/           头像图片（`avatar-<revision>.<ext>`）
├─ capability.json   能力（工具/资源）——先占位，内容待讨论
├─ projects/         各项目数据（一项目一目录；内置 workspace/ 见 §5.6）
│  └─ workspace/     默认第一个 project（= Agent 的工作区：AGENTS.md / sessions / tasks / daily / cases / todo / concept-space.md）
├─ prompt-resources/ 规则与资源
├─ memory/           Agent 私有记忆
```

**workspace 归属（2026-10-17 定）**：每个 Agent 天然有一个默认 workspace，它是**该 Agent 的第一个 project**，落在 `agents/<id>/projects/workspace/`——Agent 打开就在这个 project 下面会话与工作。
原先平级的 `agents/<id>/workspace/` 与家目录顶层 `workspaces/` **取消**（顶层 `workspaces/` 已从 foundation §4 与家目录模板中删除）。
出厂时 `workspace/sessions/` 已带一条**默认会话**（预置 JSONL，第一句 = Agent 打招呼与说明书；文件驱动、只随 Life OS Agent，见协议 §15.2）。

**运行产物的归属（2026-10-15 定）**：

| 类型 | 放哪 |
|---|---|

**唯一来源约定**：① id = 目录名（`agent.json` 里的 id 必须一致，不一致即失败）；② `name/avatar/model/projects/enabled` 只在 `agent.json` 存一份；③ `identity.md` 只放文本。

**注册表 `long-agents.json`（2026-10-15 定）**：**删除**。
Agent 的全部信息放在 `agents/<id>/agent.json`；**列举 = 扫描 `agents/*/agent.json`**，不再有单独的总表文件。

**注册判据（已定 2026-10-15）**：只认 `agents/*/agent.json`（有它才算注册）。其余细节（解析失败时跳过并告警、顺序按目录名排序、扫描结果只放内存缓存）为候选，待确认。

### 5.6 项目关系

主体是 **Agent**；**Project 在它的工作范围内**（记录落在 Agent 目录内部）。
**落地（我们的设计）**：`agents/<id>/agent.json` 的 `defaultProjectId` / `boundProjectIds` 是权威（注册表类总表已废，见 §5.5）。语义 = "允许在哪些项目里干活"的清单（方向 **Agent → Project**）。
项目共用信息（该项目的交互 harness 内容）在 `<home>/projects/<projectId>/`。细节见 [`lifeos-context-resource-model.md`](./lifeos-context-resource-model.md)。

**默认 project = workspace（2026-10-17 定）**：`defaultProjectId` 的缺省值就是内置 project `workspace`（`agents/<id>/projects/workspace/`）。项目指引（`AGENTS.md`）、会话（`sessions/`）、任务（`tasks/`）、每日记录（`daily/`）、案例（`cases/`）、`todo/`、概念索引（`concept-space.md`）都落在这个目录里（协议 §15）。与顶层 `projects/<pid>/`（项目共用层，跨 Agent 共享）的区分不变：**workspace 属 Agent 私有层**。

**注册与解绑（2026-10-18 定稿，本轮实现）**：
- **注册 = `POST /api/agents/:id/projects {path}` 合成入口**（注册+绑定一步，用户拍板）：校验目录 → **同 path 幂等复用** → 否则生成 **pid = uuidv7**、写共用层 `~/.lifeos/projects/<pid>/project.json {schemaVersion,id,name,path}`（**不写进用户目录**）、追加 `boundProjectIds`（agent.json 原子写）。
- **枚举 = 扫描 `agents/<id>/projects/` 下的目录**（2026-10-18 用户定，改自“boundProjectIds 解析 + 内置 workspace”）：**有多少个项目目录就有多少行**，每个 Agent 同构；**显示名 = 目录名**（`workspace` 就显示 `workspace`，不再用「工作区」这类展示名；外部项目显示其真实目录名 basename(path)）。文件、`.` 开头的目录不算项目；排序 = 默认项目在前，其余按名称。
- **目录即项目**：`projects/<pid>/` 存在即可用（含未注册的私有目录，cwd = 该目录）；注册（共用层 manifest）用于把外部真实目录接入（cwd = 项目 path）。注册时同步建 `projects/<pid>/` 目录，保证列表立刻可见。
- **解绑 / 移除 = `DELETE …/:pid`**：写 `hiddenProjectIds`（从列表移除），**目录与会话/记录全部保留**；再次 `POST /projects` 同 path → 从 hidden 摘除、重新出现；内置 workspace 不可移除（400），重复移除非幂等（404）。
- **manifest 的 `name` 字段不参与界面显示**（历史遗留的「工作区」已从出厂 manifest 移除）。
- **会话 cwd**：workspace → `~/.lifeos`；外部项目 → 项目 `path`（Pi 工具作用域 = 项目目录）。

### 5.7 运行与生命周期（包含"注册"）

**创建 = 注册（我们的设计）**：新建 `agents/<id>/` 并写入 `agent.json`（+ 装 `identity.md` 骨架）即便完成注册；枚举 = 扫描 `agents/*/agent.json`。
**启用/停用**：`enabled`（注册表字段）；**删除**：归档语义（见 `lifecycle.ts`）。
**前端如何选中**：前端以 `agentId` 指定；后端按该 id 解析配置与装配（见 `prompt/backend-implementation.md`）。

## 6 L4 · 承载与落地（→ 需求文档要回答的）

需求文档（**待写**）必须逐条回答：

1. 每一部分**放在哪**（`~/.lifeos` 下的具体文件/目录）、**什么时候读**、**谁写**；
2. **Agent 之间怎么隔离**（配置/空间/记忆/会话的边界）；
3. **怎么创建一个 Agent**（注册流程、必填与默认、失败恢复）；
4. **Workspace 与运行产物放哪**、保留多久；
5. **新增一个 Agent / 查询共有多少个**的公共逻辑（不得每个 Agent 写死目录）；
6. **Agent 与 Project 的关系**怎么表达与校验；
7. 前端到后端：怎么指定 Agent、怎么知道当前在与哪个 Agent 交互。

## 7 缺口与待决议

| # | 项 | 状态 |
|---|---|---|
| 1 | 身份说明文本的承载 | **已定**：`agents/<id>/identity.md`（含人格与性格小节） |
| 2 | 展示名/描述重复 | **已定**：`long-agents.json` 删除；`agents/<id>/agent.json` 为唯一来源 |
| 3 | 人格与性格 | **已定**：并入 `identity.md`（不单开文件） |
| 4 | Prompt 内容仍写死在代码里（`assembly.ts` 内联两块、`daily-summary-task.ts` 常量、`assembly-context.ts` 固定英文句、交互 harness 区域前言） | 待处理：移文件 / 删除并登记恢复项 / 批准保留 |
| 5 | 加载与注册缺公共机制（内容加载逐类硬编码） | 待处理：声明表驱动的装载/注册 |
| 6 | 目录改名 `long-agents/` → `agents/<id>/`、私有运行产物搬进 `agents/<id>/runtime/` | 设计已定，**代码改动待排期** |
| 7 | ~~注册表字段归属~~ | **已定**：注册表删除，`agent.json` 权威。剩余细节：扫描规则（候选，待确认） |
| 8 | 能力（工具/技能/扩展/MCP）与记忆 | **先放下**（按用户指示），待后续讨论 |
| 9 | workspace 归属 / 会话放哪 / 默认会话 / Todo（2026-10-17 用户指出骨架与协议没对齐） | **已定并已落地（2026-10-17 晚）**：workspace = 默认第一个 project（`projects/workspace/`）；会话物理即 `projects/workspace/sessions/`（结构即事实，无迁移）；默认会话 = 出厂预置 JSONL（`opening.md` 方案废弃）；Todo 落 project 的 `todo/`。详见协议 §15 |

## 8 实现阶段的待决项（不属 Agent 定义，等做到再定）

> 这些是"把它做出来时才要拍板"的工程问题；现在只登记事实与候选，**不占用 Agent 定义**。

### 8.2 扫描细节

只认 `agents/*/agent.json`（已定）；**解析失败时跳过并告警 / 顺序按目录名 / 只放内存缓存**——候选，实现时确认。

## 9 配置（Life OS 的系统配置）

> 这一节管的是**Life OS 系统怎么运行**的配置（底座对接、模型、默认行为）——**不属于 Agent 的定义**，不进 `agents/<id>/agent.json`。

### 9.1 原则

1. **值不写死在代码里**：代码只给**默认值**（保证开箱能跑）；
2. **配置写文件**：日常改配置改文件，不改代码、不重编译；
3. **不使用环境变量**（2026-10-15 定）：有配置文件就不再引入第二套机制；同一份代码换机器/端口，改文件即可；
4. **配置只读**：运行期代码不写这些文件（首次安装最多装骨架/示例）；
5. 每个配置文件带 `schemaVersion`，**未知字段拒绝**（沿用现有做法）；文件存在但解析失败 → **报错，不静默降级**。

### 9.2 配置目录（草案）

`/Users/xulater/.lifeos/config/` —— 每类配置一个文件：

| 文件 | 放什么 | 现状在哪 |
|---|---|---|
| `config/devices.json` | 设备清单 | 现在声明为 `<home>/devices.json`（尚未创建） |
| `config/models.json` | provider 与模型清单（含 key） | 现在 `<home>/agent/models.json`（**Pi 的目录约定**，见 9.4） |
| `config/settings.json` | 默认 provider / model / thinking | 现在 `<home>/agent/settings.json`（同上） |

**读取优先级**：**配置文件 > 代码默认值**（没有环境变量这一层）。

### 9.3 与 Agent 的关系

- Agent 的目录（`agents/<id>/agent.json`、`identity.md` 等）是**内容**，不是系统配置。

### 9.4 模型配置收回到 `config/`（2026-10-15 定）

**决定**：**不跟 Pi 的目录混**——Life OS 不是 Pi 项目（后面可能改名，但不会是 Pi 项目）。
模型与相关设置属 **Life OS 的系统配置**，因此：

| 内容 | 目标位置 | 现状位置（输入） |
|---|---|---|
| provider 与模型清单（baseUrl、key） | `config/models.json` | `<home>/agent/models.json`（Pi 的 agentDir，由 Pi `ModelRuntime` 读） |
| 默认 provider / model / thinking、默认工具集 | `config/settings.json` | `<home>/agent/settings.json`（由 Pi `SettingsManager` 读） |
| provider 认证（如需要） | `config/` 下对应文件（细节待定） | `<home>/agent/auth.json` |

**落地方式（2026-10-15 实现）**：`~/.lifeos/` 下**不再有 `agent/` 目录**——Life OS Home 的配置目录就是 **`config/`**，Pi 的 `agentDir` **指向它**
（`src/lifeos-home.ts`：`agentDir: resolve(root, "config")`），因此 Pi 的 `settings.json` / `models.json` / `auth.json` 物理上就落在 Life OS 的 `config/` 下——
"不跟 Pi 的目录混"落实为"**只有一个配置目录，叫 `config/`**"。

原来的方式（保留参考）：Life OS 从 `config/` 读取后在装配时传给 Pi——
`createAgentSession({ modelRuntime, model, settingsManager })`（我们现在已经在传这几个参数，`src/agents/pi-agent-session.ts:390-396`），
不再依赖 Pi 去 `agent/` 目录自行发现。实现时同步调整写入接口（`PUT /api/models-config`）与迁移。

### 9.5 唯一保留的环境变量：`LIFEOS_HOME`（2026-10-15 定）

- **用途**：在**读配置文件之前**告诉进程"家在哪"（引导变量）；**主要为了测试**——54 个测试/脚本用它指向临时家目录，保证数据隔离。
- **例外性**：它不是业务配置，而是"配置放在哪个家"的前提；除它之外，**其余一律走配置文件，不再使用环境变量**。
- **部署也在用**：模板 `deploy/lifeos.env.example:9` 与本机 plist（第 7-8 行）都设了 `LIFEOS_HOME=/Users/xulater/.lifeos`。

### 8.5 实现阶段要做一次端到端分析（2026-10-15 用户要求，登记）

进入实现阶段时，先把"给 Agent 发一条消息"的**完整链路**从头到尾跑一遍并逐跳核对（含每跳的读写与记录），据此列出**要清理/要替换**的清单。
产出：一份"实现清单"（改什么、删什么、谁承接、怎么验收）。

## 10 能力（工具类型）→ 见 [`agent-tools.md`](./agent-tools.md)

**立场**：能力类型直接跟 Pi 生态，**不自造定义**；具体清单、现状三条通道与待筛状态由
[Agent 工具架构](./agent-tools.md) 拥有（本文不复制）。与记忆的关系见 §11：**记忆的读写靠工具**。

## 11 记忆 → 见 [`agent-memory.md`](./agent-memory.md)

记忆的类型与归属由 [Agent 记忆架构](./agent-memory.md) 拥有（本文不复制）；其中 **Agent 记忆先做**，
其余三类（项目/个人/会话）先登记（`todo/33`）。记忆的读写**靠工具**，与 §10 的工具架构一起看。
