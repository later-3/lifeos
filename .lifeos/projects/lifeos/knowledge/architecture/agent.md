# Life OS Agent（现状）

> 角色：架构　类型：说明　状态：现状
>
> 只写**现在的事实**（每条都能在代码里找到依据）。没实现的东西不在这里描述——一句话登记在 [`../todo.md`](../../todo/todo.md)。

## 1 一个 Agent 是什么

- 出厂只有一个 Agent：`~/.lifeos/agents/lifeosagent/`（显示名 `Life Agent`）。**没有"新建/删除 Agent"的接口**（登记在 todo）。
- 一个 Agent = 一个目录，**目录名 = id**（稳定 slug，出现在 URL 里）；`agent.json` 里的 `id` 必须与目录名一致。

## 1.1 创建 / 归档一个 Agent（现状，2026-10-19 用户拍板）

**两个入口共用一份实现**（`src/agents.ts`，业务下沉、HTTP 只是薄适配）：**Pi 工具**（模型可调）`lifeos_agent_create` / `lifeos_agent_delete`（`src/agent-tools.ts`，英文描述、名字进白名单，见 reference-baseline「自有工具」行）与 **HTTP**（`POST /api/agents` · `DELETE /api/agents/:id`）。界面暂无「新建助手」按钮；**删除入口 = 助手行悬停出现的 ✕**（点击 → 确认对话框）。

- **创建**：参数**只有 `name`（必填）与 `description`（可选）**——不开放「传身份内容」之类的入口（用户 2026-10-19 定，见 harness 案例 C029）。id 由 name 生成 slug（冲突加序号）→ 建 `agents/<id>/`：`agent.json`（**不写 `defaultSessionId`**：预置会话只随出厂模板）+ `identity.md`（**只装骨架**）+ Agent 本身的 `AGENTS.md` / `tools/` / `memory/` + 默认项目 `projects/workspace/`（Agent × 项目骨架，协议 §5.1）+ 默认 Task `tasks/0001-default/`（协议 §6.1）。**结构与协议同构**：所有说明文字来自协议目录的 `skeleton/`，代码不另写；校验与 `PUT /api/agents/:id` 一致（name 截 60、description 截 300）；结构由 `pnpm home:check` 与 `test/protocol-flow.test.mjs` 守门。
- **id**：由 `name` 生成 slug（ASCII）；**非 ASCII 名得到不透明的随机后缀 `agent-3f9a`**（Kubernetes generateName 同款，不要生成过通用的 `agent`）。id 生成后**稳定**：改显示名不改 id；**创建按 name 幂等**——同名且未归档时返回已有 Agent（`POST` 200 / 工具结果 `created:false`），不会造出第二个实体。
- **归档（= 删除，可恢复）**：`agent.json` 写 `archivedAt` → 列表与详情都不再返回它；**目录、会话、记录全部保留**（恢复 = 删掉该字段）。护栏：有会话运行中 → 409；非归档只剩 1 个 → 400 `last_agent`。

## 1.2 任务（现状，2026-10-19 用户拍板）

**任务 = 有目标、需落盘、可追溯的工作单元**（协议 §3.8）；现在实现的是**用户下达任务**（定时任务未实现，见 todo）。

- **工具**（Pi 工具，名字进白名单）：`lifeos_task_create`（建任务）/ `lifeos_task_list`（按编号列状态）/ `lifeos_project_add`（目录注册并绑定）/ `lifeos_project_remove`（从列表移除，数据保留）/ `lifeos_project_list`（列项目）/ `lifeos_memory_search`（查记忆）/ `lifeos_memory_record`（记事实，scope 必填）/ `lifeos_memory_delete`（硬删除，仅用户明确要求）；**绑定会话上下文**——agent 与 project 由会话自身推导，模型不用传。**幂等**：同一路径重复添加不改变任何东西；默认项目不可移除；移除不动目录、manifest 与会话。
- **写操作闭环在共享实现里**（2026-10-20 架构修正）：`agents.ts`（创建/归档）与 `projects.ts`（绑定/移除）在写成功后广播 `agents_changed`，工具与 HTTP 两条入口自动生效——**不依赖调用方记得 notify**。事件总线在 `src/events.ts`、运行态在 `src/session-runtime.ts`，两者都不 import `agent-host`，因此 `agents/projects` 可以静态 import 而不是内联 `await import()`。
- **落点**：`agents/<id>/projects/<项目名>/tasks/<NNNN>-<标题>/`（**per-project 连续编号，中文标题允许**；目录平铺，日期写在 `task.md` 的 `日期：YYYY-MM-DD`，不建日期目录）。
- **默认 Task（协议 §6.1，2026-10-23 更新）**：每个 Agent × 项目一个，目录 `tasks/0001-default/`，类型 `daily`；新建会话与每次交互时 `ensureDailyShard` 取/建默认 Task 并确保当天的 `daily/<日期>.md` 存在；会话用自定义条目 `lifeos_active_task` 记录 `activeTaskId`（存 Task ID `NNNN`），普通会话共享默认 Task，不是绑定。
- **进入/接手 Task（2026-10-26 修正）**：切换只发生在对话里——Agent 用 `lifeos_task_create`（建即进入）或 `lifeos_task_enter`（接手已有）写会话的 `ACTIVE_TASK_ENTRY` 指针，下一轮装配生效；没有独立的 UI 切换命令，也没有 `PUT …/task` 端点（原先那条是自造的，已删）。
- **模板选择（选一份，不合并，协议 §3.7）**：`agents/<id>/projects/<pid>/task-types/<type>/` → `projects/<pid>/task-types/<type>/` → `interaction-harness/task-types/<type>/`。
- **`task.md` 是唯一状态源**（`ID: NNNN`、类型 daily/development/general、类别、状态、负责人、目标、必需文档、当前指针）+ **「本任务遵守」**（协议 · 类型规则 · 共享 workspace 规范 · 项目共享规范 · Agent × 项目规范 · 项目仓库 `AGENTS.md` 存在才写）。
- **类型 + 类别一起决定必需文档**（照 `task-types/<type>/template.json`，`TEMPLATE.md` 是给人读的说明；类型由目录声明、装配时按目录加载）：
  - `development`（开发/协作/结论）：`A` 改产品行为 → `01-background · 02-design · 03-phase · 04-plan · phases/`；`B` 改协作规范 → `01-background · 02-plan`；`C` 只出结论 → `01-background`；
  - `general`（**普通任务**：既不改产品行为也不改协作规范，只是把一件事管起来）：`G` → `01-background · 02-plan`（背景 + 步骤，保持简单；不建 `phases/`）。典型例子：资料整理、调研、外部沟通、一次性操作、环境维护等；改"怎么做"仍是 `development B`，改用户可观察行为仍是 `development A`。
  - 类别由类型的模板声明；类别与类型不匹配时直接拒绝。新类型 = 在 `task-types/` 下新建模板，不改代码。
- **列举 = 扫描 `tasks/` 读 `task.md`**（不维护索引文件）。

## 2 目录与文件（现状）

```
~/.lifeos/agents/<id>/
├─ agent.json     身份与默认值（唯一来源）
├─ identity.md    身份正文 → 注入 prompt 的 preamble（包成 <lifeos_identity>）
├─ avatar/        图片头像（avatar.png|jpg|webp，0600；文件不存在 = 自动头像）
└─ projects/<pid>/  每个项目一份（Agent × 项目，协议 §4.2）：
```

**项目目录命名（2026-10-19 用户定）**：目录名 = 项目名（用户会直接翻文件系统，不能是 UUID）；`manifest.id` 与目录名一致；旧 uuid 目录在读取时**懒迁移**成可读名（`legacyId` 记住旧 pid，旧 `?project=<uuid>` URL 仍可反查）。

`agent.json` 字段（`src/server.ts`）：`schemaVersion` · `id` · `name` · `description` · `defaultProjectId` · `defaultSessionId` · `hiddenProjectIds` · `avatar?{kind,file,revision}` · `archivedAt?`（归档标记）。

- 头像：上传存 `avatar/avatar.<ext>`（dir 0700 / 文件 0600），`agent.json.avatar` 只存引用；reset 删目录与字段 → 回到按 id 推导的自动头像。
- 没有头像字段时，前端用 id 推导颜色 + 首字母（`frontend/src/agent-avatar.tsx`）。

## 3 项目（2026-10-20 起：全局身份 + Agent 绑定）

**项目 = 一个目录 + 一条全局身份**；Agent 通过"绑定"引用它。存储分三层：

| 层 | 位置 | 放什么 |
|---|---|---|
| **共享层** | `~/.lifeos/projects/<id>/project.json` |
| **Agent × 项目** | `~/.lifeos/agents/<id>/projects/<全局 id>/` |
| **用户工作区** | 用户自己的目录（如 `~/Code/my-project`）；`workspace` 例外 → `~/.lifeos` | 用户代码/文档；只当 cwd，**不写我们的数据进去** |

绑定目录的骨架由 `src/project-skeleton.ts` 的 `ensureAgentProjectLayer` 补齐（说明文字来自协议目录的 `skeleton/`）

### 3.1 全局项目注册表（2026-10-20 定，已实现）

- **同一个目录只有一个全局 id**：按 canonical path（解析符号链接）判重；同 path 幂等复用；
- 不同 path 同名 → `<name>-2`、`<name>-3`；
- **Agent 绑定目录名 = 全局 id**：`agents/<id>/projects/<全局 id>/`；旧绑定目录名不同时懒迁移（改名，会话文件跟着搬）；
- 身份：`project.json` 只在共享层（协议 §5.3）；绑定目录不写身份，绑定列表由目录派生；
- 记忆：**项目共享记忆**落 `~/.lifeos/projects/<全局 id>/memory/`；**agent 的项目记忆**落 `agents/<id>/projects/<全局 id>/memory/`；
- `workspace` 有两层：共享 workspace `~/.lifeos/projects/workspace/`（id=workspace，无 path，所有 Agent 共享）与每个 Agent 的默认项目 `agents/<id>/projects/workspace/`（Agent × 项目，结构与其他项目相同，没有添加项目时交互在这里进行）；

接口与语义（`src/projects.ts` + `src/project-registry.ts` + `src/server.ts`）：

| 动作 | 接口 | 事实 |
|---|---|---|
| 打开目录（添加项目） | `POST /api/agents/:id/projects {path}` | 校验目录 → 共享层按 path 幂等取 id（或新建 `projects/<id>/project.json`）→ 建 Agent × 项目骨架与默认 Task（0700）→ 从 `hiddenProjectIds` 摘除 |
| 列表 | `GET /api/agents/:id/projects` | 扫描 Agent 绑定目录 − `hiddenProjectIds`；显示名 = `basename(path)`；`workspace` 在前 |
| 从列表移除（可逆） | `DELETE /api/agents/:id/projects/:pid` | 只写 `hiddenProjectIds`；**全局注册表、绑定目录、会话、记录全部保留**；再次打开同 path 即重新出现；`workspace` 不可移除（400） |

- **目录即项目**：绑定目录存在即可用；外部项目的 cwd = 共享层 `project.json` 的 `path`。
- 会话 cwd：`workspace` → `~/.lifeos`；外部项目 → 项目 `path`。**会话文件永远落家目录**（不写用户目录）。
- **共享身份、共享记忆、共享规范已可用**；多 Agent 共用的模板/资产（如项目级 task-types）仍只做了“项目/Agent 覆盖入口”，跨 Agent 同步未做——见 todo。

## 4 会话（现状）

- 落点：`agents/<id>/projects/<pid>/sessions/<时间戳>_<会话id>.jsonl`（Pi 格式，append-only；文件即事实）。
- 出厂预置一条默认会话（模板 JSONL）；显示名 = `session_info.name` ‖ 首条用户消息。
- 刚建、还没发消息的会话不在磁盘上（Pi 延迟落盘）→ 后端把它们并入列表（pending）。
- 事件流（任务 0007，2026-10-25 起）：**一条全局流** `GET /api/events` 承载**所有 Agent** 的事件；每条带全局 `seq`、`agentId`（回合级事件）与 SSE `id`。投递分两级：**回合级**（`turn` / `done` / `error` / `agents_changed`）发给所有连接，保证后台 Agent 的完成/失败实时可见；**细节级**（`delta` / `thinking` / `tool_*` / `retrying` …）只发给**焦点连接**（`PUT /api/events/focus` 上报的 agentId+sessionId），非焦点会话的 token 不占用连接与界面。**连接先发 snapshot**（`connectionId`、基线 `seq`、跨 Agent 的 `running`（带 turnId）、服务端 `unread`、回合账本），快照与订阅在同一个同步块里生成，之后只推快照之后的事件；**过载即断线**（每连接发送积压超过 512KB → 关闭，客户端重连拿新快照，绝不静默丢事件）；10 秒具名 `ping` 心跳（客户端 25 秒无任何帧即判陈旧并重连，C124）。运行态与未读都是服务端事实（`session-runtime.ts` / `session-views.ts`，未读持久化到 `state/session-views.json`）。实现：`src/events.ts`（总线）、`src/bounded-sink.ts`（有界发送）、`frontend/src/event-router.ts`（分流纯函数）。**事件名全集与语义的唯一事实源 = `conversation.md`**（映射实现在 `src/stream-events.ts`）；接口设计约束见 `specs/code/api/`。
- **会话 cwd 由它所属项目决定**（`cwdOfSession()`）：`workspace` → `~/.lifeos`；外部项目 → `project.json.path`。**与后端进程从哪个目录启动无关**（曾经用 `process.cwd()`，恢复旧会话时工具作用域会跑偏到后端启动目录）。
- **会话能力（全部对接 Pi 原生 API，不自造）**：`abort()` 打断 · `steer()` 生成中插话 · `followUp()` 本轮后处理 · `compact()` 压缩上下文 · `setModel()` 会话级切模型（写 `model_change`，不动全局默认）· `setThinkingLevel()` 思考级别 · **切换 activeTask**（写自定义条目，下一轮重新装配）。（注意：Task 切换不是 Pi 原生 API，属于 Life OS 的会话上下文）
- **前端交互**（对照基线：Pi CLI / Pi Web，2026-10-19）：交互事实（断/插话/心跳/斜杠面板/历史浏览）的唯一事实源 = `knowledge/design/chat.md` 与 `knowledge/architecture/conversation.md`；本文件不重复。代码条文：前端键序契约 = `specs/code/frontend/` 2.5、判丢心跳 = 2.9。
- **失败与状态可见**（2026-10-19 起，2026-10-20 与用户对齐归属）：**进度与失败属于"这一轮"→ 显示在左侧**；失败原因在 assistant 侧显示"归类文案 + 原始错误小字"（`src/failure.ts` 分类）；**「重新发送」属于用户消息**（动作挂在被重发的那条消息上），不放在失败提示旁。左侧本轮槽的阶段、计时与失败归属见 `.lifeos/projects/lifeos/knowledge/design/chat.md` §3.3（设计出发点 + 哪一步显示什么）。失败原因与重试信息全部来自 Pi（`stopReason` / `errorMessage` / `auto_retry_start`），不自造文案。
- **深链接**（`?agent&project&session`）：URL 指定项目时**只在该项目里选会话**，不拿别的项目"记住的会话"顶上（2026-10-19 实测：`?project=<空项目>` 被 workspace 会话顶掉）。
- **失败归因（2026-10-20 用户点名）**：种类全集（九类）与界面文案 1:1 对照的唯一事实源 = `src/failure.ts` + `conversation.md`；接口约束见 `specs/code/api/`（2.4：映射与文案两侧互为断言）。
- **工具块状态**：`running` 只在"这一轮还在跑"时成立（`frontend/src/tool-state.ts`）；这一轮已结束但没拿到结果 = `missing`，显示**未完成**（不转圈）。工具结果**只按 `toolCallId` 精确配对**（曾用"最后一个没有结果的调用"兜底，导致同一条消息里两个调用的结果互串，`ls` 永远"执行中"）。
- 模型选择：**有效默认** = `agents/<id>/projects/workspace/config.json`（Agent 个人）→ `config/settings.json`（系统）→ `config/models.json` **清单第一项**（Life OS 隐式默认，与 Agent 配置弹窗 fallback 同源）→ 清单为空才 Pi 回落；`GET /api/agents/:id/config` 返回 `config/effective/source`，顶部显示与新会话创建共用这一个裁决；**恢复旧会话不传 model**（尊重会话里的 `model_change`）。新建会话的模型与来源会打一行日志 `[assembly] 新建会话 … · 模型 <provider>/<id>（来源 …）`，排查"怎么用了这个模型"先看它。
- **会话级切换**（`/model` `/thinking`，走 Pi `setModel` / `setThinkingLevel`）：只改当前会话（Pi 写 `model_change`），不动 Agent 默认、不动全局；`setModel` 会校验 provider 是否配了 key，失败原因（如 `No API key for …`）原样显示，不吞成"切换失败"。
- **思考级别与模型同规则**（2026-10-24）：没对本会话用过 `/thinking` → 跟随 Agent 默认（`defaultThinkingLevel`）；用过 → 保留会话覆盖。覆盖判定用显式自定义条目 `lifeos_thinking_override`（`setSessionThinking` 写入），不靠值猜；恢复会话与新默认保存都会同步未覆盖且不在跑的会话（`applyAgentDefaultThinking`）。
- **顶部模型显示规则**（2026-10-20/10-22 用户定）：**没对本会话用过 `/model`** → 显示 Agent 的**有效默认**（不是拿会话值反猜），默认变了顶部跟着变；**用过 `/model`** → 显示会话覆盖模型（`model_change` 持久），之后默认再变也不影响它。判定覆盖用**显式标记**（Pi 自定义条目 `lifeos_model_override`，不参与模型上下文），不靠"值相等"猜。**实现**：`src/model-follow.ts` 做判定（纯函数、穷举测试）；只认 `/model` 写的显式覆盖标记（早期 `legacy:true` 标记一律忽略）；没有标记 → 一律跟随当前有效默认。保存默认 → `applyAgentDefaultModel` 同步未覆盖且**不在跑**的打开中会话 + 广播 `agents_changed`（前端刷新有效默认与 meta）；**打开/重开**会话时若未覆盖且模型不是默认 → 跟随。
- **一轮的路径**（失败归属的骨架）：① 前端发送（本地插入用户消息 + 左侧本轮占位）→ ② 新建会话（仅无会话）→ ③ 后端受理（202，`void runTurn`）→ ④ 后端开跑（登记 running、订阅 Pi 事件）→ ⑤ Pi 模型循环（思考/文本/工具调用与结果，临时错误自动重试）→ ⑥ 收尾（`done`，或抛错 → `error` 带归类）→ ⑦ 前端重读会话（文件是事实源）。哪一步失败，左侧就写哪一步；具体显示映射见 `.lifeos/projects/lifeos/knowledge/design/chat.md` §3.3。

## 5 装配（方案 E，2026-10-18 定稿，现状）

`src/agent-host.ts` 的 `createHostedSession()`（配 `src/assembly.ts`）显式传：

- `agentDir = ~/.lifeos/config`（Pi 由此读 `models.json` / `auth.json`）；
- `modelRuntime`（读 `config/models.json` + `config/auth.json`）、`settingsManager`（读 `config/settings.json`）；
- `resourceLoader`（装**内联 extension**，不落用户目录）；
- `tools` = Pi 注册的 8 个内置工具（`read/bash/edit/write/grep/find/ls/powershell`，显式声明，不随隐式默认漂移）。

系统提示注入（`createLifeOsPromptExtension`，在 `before_agent_start` 修改 `systemPromptOptions`）：

| 区 | 内容 |
|---|---|
| `preamble` | `identity.md`（包 `<lifeos_identity>`）→ **替换** Pi 默认的"编码 agent"前言 |
| `lifeos_interaction_harness` | 协议正文 · 协议目录说明 · **规范层**（Agent 本身 → 共享 workspace → 共享项目 → Agent × 项目 → Task，逐层追加）· **当前 Task 的 `AGENTS.md` 与 `task.md`** 与类型规则（`task-types/<类型>/AGENTS.md`，只有指针指向的那一个）· **说明文件索引**（只列位置与内容，不注入正文）· 项目仓库 `AGENTS.md`（外部项目）。记忆规则并入协议 §3.11，不再单独注入 |
| `tools` / `rules` | Pi 默认渲染结果**原样回填**（不手写，自动跟随 Pi 更新）；`<docs>` 有意舍弃 |

实测（2026-10-18，真实家 + 真实一轮的落盘 system 条目）：sections = `preamble(identity) · skills · cwd · tools · rules · lifeos_interaction_harness`。
**Pi 的上下文文件读取已显式关闭**（`createHostedResourceLoader({ noContextFiles: true })`，2026-10-18 用户定）：Pi 默认会把 cwd **及其所有父目录**的 `AGENTS.md`/`CLAUDE.md` 读进 `<project_context>` 区——「向上继承父目录规范」不是我们的设计。项目规范只走我们自己的通道（写进 harness 区，标题里标了来源，可反查）：
  ① `agents/<id>/projects/<pid>/AGENTS.md`＝**Agent 私有约定**（这个 Agent 对这个项目的规定）；
  ② `<项目目录>/AGENTS.md`＝**项目公共约定**（外部项目才读，**只读项目目录自己这一份，不继承父目录**）。
  ③ `specs/`＝**规范层**：`src/assembly.ts` 读 `specs/index.json`，按共享 workspace → 项目共享 → Agent 私有 workspace → Agent × 项目 → Task 顺序追加；只加载当前项目可见的层，不覆盖。

注意（事实）：注入发生在**每次 run 开始时**；run 结束后 `session.systemPrompt` getter 回落到默认基准——要查"那一轮到底注入了什么"，看会话 JSONL 的 system 条目。

## 6 配置（现状）

- **模型清单与 Pi CLI 共用同一份**（2026-10-19 用户定）：`config/models.json` 内容与 `~/.pi/agent/models.json` 保持一致（当前 6 个 provider / 20 个模型）。**同步用复制，不要用软链**——实测软链会让 Pi 的 `ModelRuntime` 读不到 provider（`getModel` 落空）。
- 只有 `models.json` 同步；`settings.json`（Pi CLI 的默认模型）**不自动复制**——它的默认可能指向本机 local 端点，端点没开时新 Agent 会失败。要换默认模型：在 Agent 配置里选（个人配置优先），或自己加 `config/settings.json`；两者都不存在时，`models.json` 清单第一项是隐式默认（与 Agent 配置弹窗 fallback 一致）。
- **只有一个配置目录** `~/.lifeos/config/`（= Pi 的 `agentDir`）：`models.json`（provider/模型/密钥）· `auth.json` · `models-store.json` · `settings.json?` · `file-roots.json`（文件浏览器的根白名单）。
- Agent 个人模型默认：`agents/<id>/projects/workspace/config.json`。
- 环境变量只有 `LIFEOS_HOME`（读配置前告诉进程"家在哪"，测试与部署用；其余一律走配置文件）。

## 7 前端怎么选中（现状）

URL 三键 `?agent=&project=&session=`；缺省回落到上次选择 → 第一个 Agent/项目/会话。

- **状态映射**（任务 0008）：服务端只存会话级事实（运行快照、未读快照、回合事件，均带 `agentId`/`projectId`）；前端 `status-map.ts` 纯函数派生项目与 Agent 的运行/未读数量，不另存聚合。运行事实仓库 `run-facts.ts` 的 `meta` 保存会话归属。未读记录的 `projectId` 在启动时回填，孤儿记录清理。语义见 `requirements/conversation.md` 第 6 节。
