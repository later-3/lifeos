# Life OS Agent（现状）

> 角色：架构　类型：说明　状态：现状
>
> 只写**现在的事实**（每条都能在代码里找到依据）。没实现的东西不在这里描述——一句话登记在 [`../todo.md`](../todo.md)。

## 1 一个 Agent 是什么

- 出厂只有一个 Agent：`~/.lifeos/agents/lifeosagent/`（显示名 `Life Agent`）。**没有"新建/删除 Agent"的接口**（登记在 todo）。
- 一个 Agent = 一个目录，**目录名 = id**（稳定 slug，出现在 URL 里）；`agent.json` 里的 `id` 必须与目录名一致。

## 1.1 创建 / 归档一个 Agent（现状，2026-10-19 用户拍板）

**两个入口共用一份实现**（`src/agents.ts`，业务下沉、HTTP 只是薄适配）：**Pi 工具**（模型可调）`lifeos_agent_create` / `lifeos_agent_delete`（`src/agent-tools.ts`，英文描述、名字进白名单，见 reference-baseline「自有工具」行）与 **HTTP**（`POST /api/agents` · `DELETE /api/agents/:id`）。界面暂无「新建助手」按钮；**删除入口 = 助手行悬停出现的 ✕**（点击 → 确认对话框）。

- **创建**：参数**只有 `name`（必填）与 `description`（可选）**——不开放「传身份内容」之类的入口（用户 2026-10-19 定，见 harness 案例 C029）。id 由 name 生成 slug（冲突加序号）→ 建 `agents/<id>/`：`agent.json`（**不写 `defaultSessionId`**：预置会话只随出厂模板）+ `identity.md`（**只装骨架**）+ workspace 骨架，**与出厂模板同构**：`project.json` / `AGENTS.md` / `concept-space.md` / `sessions/` / `daily/` / `cases/` / `todo/`（不建 `avatar/`；只差预置会话文件）。**内容也与模板同源**：`identity.md` 骨架的标题结构（`## 身份` / `## 人格`）、`AGENTS.md` 的项目私有层指引都取自模板（后者只去掉「出厂预置会话」那半句）；校验与 `PUT /api/agents/:id` 一致（name 截 60、description 截 300）；同构由测试的 readdir 深比较当守门人。
- **id**：由 `name` 生成 slug（ASCII）；**非 ASCII 名得到不透明的随机后缀 `agent-3f9a`**（Kubernetes generateName 同款，不要生成过通用的 `agent`）。id 生成后**稳定**：改显示名不改 id；**创建按 name 幂等**——同名且未归档时返回已有 Agent（`POST` 200 / 工具结果 `created:false`），不会造出第二个实体。
- **归档（= 删除，可恢复）**：`agent.json` 写 `archivedAt` → 列表与详情都不再返回它；**目录、会话、记录全部保留**（恢复 = 删掉该字段）。护栏：有会话运行中 → 409；非归档只剩 1 个 → 400 `last_agent`。

## 1.2 任务（现状，2026-10-19 用户拍板）

**任务 = 有目标、需落盘、可追溯的工作单元**（协议 §3.8）；现在实现的是**用户下达任务**（定时任务未实现，见 todo）。

- **工具**（Pi 工具，名字进白名单）：`lifeos_task_create`（建任务）/ `lifeos_task_list`（按编号列状态）/ `lifeos_project_add`（目录注册并绑定）/ `lifeos_project_remove`（从列表移除，数据保留）/ `lifeos_project_list`（列项目）/ `lifeos_memory_search`（查记忆）/ `lifeos_memory_record`（记事实，scope 必填）/ `lifeos_memory_delete`（硬删除，仅用户明确要求）；**绑定会话上下文**——agent 与 project 由会话自身推导，模型不用传。**幂等**：同一路径重复添加不改变任何东西；默认项目不可移除；移除不动目录、manifest 与会话。
- **写操作闭环在共享实现里**（2026-10-20 架构修正）：`agents.ts`（创建/归档）与 `projects.ts`（绑定/移除）在写成功后广播 `agents_changed`，工具与 HTTP 两条入口自动生效——**不依赖调用方记得 notify**。事件总线在 `src/events.ts`、运行态在 `src/session-runtime.ts`，两者都不 import `agent-host`，因此 `agents/projects` 可以静态 import 而不是内联 `await import()`。
- **落点**：`agents/<id>/projects/<项目名>/tasks/<NNNN>-<标题>/`（**per-project 连续编号，中文标题允许**）。
- **`task.md` 是唯一状态源**：类型 / 类别 / 状态 / 负责人 / 目标（没给先用标题）/ 必需文档 / 当前指针 + **「本任务遵守」**（协议 · 本层指引 · **该类型的细则** · 本项目指引 · 项目仓库 `AGENTS.md` 存在才写）+ **「引用的案例」**占位（模型随后补 `cases/<日期>.md#Cxxx`）。
- **类型 + 类别一起决定必需文档**（照 `task-types/<type>/TEMPLATE.md`，类型由目录声明、装配时按目录加载）：
  - `development`（开发/协作/结论）：`A` 改产品行为 → `01-background · 02-design · 03-phase · 04-plan · phases/`；`B` 改协作规范 → `01-background · 02-plan`；`C` 只出结论 → `01-background`；
  - `general`（**普通任务**：既不改产品行为也不改协作规范，只是把一件事管起来）：`G` → `01-background · 02-plan`（背景 + 步骤，保持简单；不建 `phases/`）。判据：资料整理、调研、外部沟通、一次性操作、环境维护等；改"怎么做"仍是 `development B`，改用户可观察行为仍是 `development A`。
  - 类别必须与类型匹配（`general` 只接受 `G`，`development` 只接受 `A/B/C`），错配直接拒绝。
- **列举 = 扫描 `tasks/` 读 `task.md`**（不维护索引文件）。

## 2 目录与文件（现状）

```
~/.lifeos/agents/<id>/
├─ agent.json     身份与默认值（唯一来源）
├─ identity.md    身份正文 → 注入 prompt 的 preamble（包成 <lifeos_identity>）
├─ avatar/        图片头像（avatar.png|jpg|webp，0600；文件不存在 = 自动头像）
└─ projects/<pid>/  每个项目一份：AGENTS.md · sessions/ · daily/ · cases/ · todo/ ·（外部项目）project.json
```

**项目目录命名（2026-10-19 用户定）**：目录名 = 项目名（用户会直接翻文件系统，不能是 UUID）；`manifest.id` 与目录名一致；旧 uuid 目录在读取时**懒迁移**成可读名（`legacyId` 记住旧 pid，旧 `?project=<uuid>` URL 仍可反查）。

`agent.json` 字段（`src/server.ts`）：`schemaVersion` · `id` · `name` · `description` · `defaultProjectId` · `defaultSessionId` · `hiddenProjectIds` · `avatar?{kind,file,revision}` · `archivedAt?`（归档标记）。

- 头像：上传存 `avatar/avatar.<ext>`（dir 0700 / 文件 0600），`agent.json.avatar` 只存引用；reset 删目录与字段 → 回到按 id 推导的自动头像。
- 没有头像字段时，前端用 id 推导颜色 + 首字母（`frontend/src/agent-avatar.tsx`）。

## 3 项目（2026-10-20 起：全局身份 + Agent 绑定）

**项目 = 一个目录 + 一条全局身份**；Agent 通过"绑定"引用它。分两层：

| 层 | 位置 | 放什么 |
|---|---|---|
| **全局注册表** | `~/.lifeos/projects/<name>/project.json` | 全局身份 `{schemaVersion, id(=目录名), name, path}`；项目共享记忆 `memory/` 也在这里 |
| **Agent 绑定层** | `~/.lifeos/agents/<id>/projects/<全局 id>/` | 该 Agent 在这项目里的记录（`sessions/`、`daily/`、`cases/`、`todo/`、`AGENTS.md`、`concept-space.md`）+ `agent 的项目记忆`（`memory/`） |

绑定目录的骨架由 `src/project-skeleton.ts` 的 `ensureProjectSkeleton` 补齐（**create-only，不覆盖已有文件**；`tasks/` 按需建）。新建绑定立即建；老绑定在列出项目时补——两条入口共用同一份实现。
| **工作区**（真实目录） | 用户自己的目录（如 `~/Code/my-project`）；内置 `workspace` 例外 → `~/.lifeos` | 用户代码/文档；我们只当 cwd，**不写任何自己的数据进去** |

### 3.1 全局项目注册表（2026-10-20 定，已实现）

- **同一个目录只有一个全局 id**：按 canonical path（解析符号链接）判重；同 path 幂等复用；
- 不同 path 同名 → `<name>-2`、`<name>-3`；
- **Agent 绑定目录名 = 全局 id**：`agents/<id>/projects/<全局 id>/`；旧绑定目录名不同时懒迁移（改名，会话文件跟着搬）；
- 迁移：读路径上确保注册表有条目；`project.json` 里保持 `{id, name, path}`（兼容旧读取）；
- 记忆：**项目共享记忆**落 `~/.lifeos/projects/<全局 id>/memory/`；**agent 的项目记忆**落 `agents/<id>/projects/<全局 id>/memory/`；
- `workspace` 是内置项目的特例，不进全局注册表。

接口与语义（`src/projects.ts` + `src/project-registry.ts` + `src/server.ts`）：

| 动作 | 接口 | 事实 |
|---|---|---|
| 打开目录（添加项目） | `POST /api/agents/:id/projects {path}` | 校验目录 → 全局注册表按 path 幂等取 id（或新建）→ 建/改 Agent 绑定目录（0700）+ 写 `project.json`（0600）→ 从 `hiddenProjectIds` 摘除 |
| 列表 | `GET /api/agents/:id/projects` | 扫描 Agent 绑定目录 − `hiddenProjectIds`；显示名 = `basename(path)`；`workspace` 在前 |
| 从列表移除（可逆） | `DELETE /api/agents/:id/projects/:pid` | 只写 `hiddenProjectIds`；**全局注册表、绑定目录、会话、记录全部保留**；再次打开同 path 即重新出现；`workspace` 不可移除（400） |

- **目录即项目**：绑定目录存在即可用（内部项目的 cwd = 该目录）；外部项目必须有 `project.json`（cwd = 它的 `path`）。
- 会话 cwd：`workspace` → `~/.lifeos`；外部项目 → 项目 `path`。**会话文件永远落家目录**（不写用户目录）。
- 多 Agent **共用项目资源**（共享模板/资产）仍未做——见 todo；全局身份与共享记忆已可用。

## 4 会话（现状）

- 落点：`agents/<id>/projects/<pid>/sessions/<时间戳>_<会话id>.jsonl`（Pi 格式，append-only；文件即事实）。
- 出厂预置一条默认会话（模板 JSONL）；显示名 = `session_info.name` ‖ 首条用户消息。
- 刚建、还没发消息的会话不在磁盘上（Pi 延迟落盘）→ 后端把它们并入列表（pending）。
- 事件流：`GET /api/agents/:id/events`（SSE）一条流承载该 Agent 的**所有**会话；事件名 = 事件类型：`snapshot` / `thinking` / `thinking_end` / `delta` / `tool_call` / `tool_result` / `done` / `error`，每条带 `seq`，`?since=` 可续传（映射见 `src/stream-events.ts`）。
- **会话 cwd 由它所属项目决定**（`cwdOfSession()`）：`workspace` → `~/.lifeos`；外部项目 → `project.json.path`。**与后端进程从哪个目录启动无关**（曾经用 `process.cwd()`，恢复旧会话时工具作用域会跑偏到后端启动目录）。
- **会话能力（全部对接 Pi 原生 API，不自造）**：`abort()` 打断 · `steer()` 生成中插话 · `followUp()` 本轮后处理 · `compact()` 压缩上下文 · `setModel()` 会话级切模型（写 `model_change`，不动全局默认）· `setThinkingLevel()` 思考级别。
- **前端交互**（对照 Pi CLI / Pi Web，2026-10-19）：生成中 **Esc / 停止按钮 = 打断**；生成中 Enter = **steer 插话**；生成中超过 **60s 无事件 = 判为运行丢失**（清生成态 + 重载）；SSE 重连快照显示"不在跑"也走同一恢复；斜杠命令面板（`/compact /model /thinking /name /new /copy /export /abort`）；空输入时 **↑/↓ 浏览发送历史**。**已修（2026-10-20）**：发送时重置心跳计时；判丢前先查 `GET …/sessions/:sid` 的 `meta.running`，还在跑就再给一个窗口——修掉"页面静置 >60s 后发送立刻被判丢"的误报。推断性文案只出现在左侧本轮槽。
- **失败与状态可见**（2026-10-19 起，2026-10-20 与用户对齐归属）：**进度与失败属于"这一轮"→ 显示在左侧**；失败原因在 assistant 侧显示"归类文案 + 原始错误小字"（`src/failure.ts` 分类）；**「重新发送」属于用户消息**（动作挂在被重发的那条消息上），不放在失败提示旁。左侧本轮槽的阶段、计时与失败归属见 `docs/design/frontend-structure.md` §2.1（设计出发点 + 哪一步显示什么）。失败原因与重试信息全部来自 Pi（`stopReason` / `errorMessage` / `auto_retry_start`），不自造文案。
- **深链接**（`?agent&project&session`）：URL 指定项目时**只在该项目里选会话**，不拿别的项目"记住的会话"顶上（2026-10-19 实测：`?project=<空项目>` 被 workspace 会话顶掉）。
- **失败归因（2026-10-20 用户点名）**：`src/failure.ts` 把 Pi 的 `stopReason`（`ai/src/types.ts`：pending/stop/length/toolUse/error/aborted/deferred）与 `errorMessage`（`ai/src/utils/retry.ts` 的网络/超时模式）归成 `aborted / truncated / empty / timeout / network / auth / rate_limit / server / unknown`；界面按种类说人话（如"模型服务响应超时"、"连不上模型服务：网络或端点不可达"、"模型服务拒绝鉴权"），原始 `errorMessage` 作为小字证据保留。SSE 的 `error` 事件同样带 `kind`，前端 toast 用同一套文案。
- **工具块状态**：`running` 只在"这一轮还在跑"时成立（`frontend/src/tool-state.ts`）；这一轮已结束但没拿到结果 = `missing`，显示**未完成**（不转圈）。工具结果**只按 `toolCallId` 精确配对**（曾用"最后一个没有结果的调用"兜底，导致同一条消息里两个调用的结果互串，`ls` 永远"执行中"）。
- 模型选择：**优先级 A** = `agents/<id>/projects/workspace/config.json`（Agent 个人）→ `config/settings.json`（系统）→ Pi 回落；**恢复旧会话不传 model**（尊重会话里的 `model_change`）。新建会话的模型与来源会打一行日志 `[assembly] 新建会话 … · 模型 <provider>/<id>（来源 …）`，排查"怎么用了这个模型"先看它。
- **会话级切换**（`/model` `/thinking`，走 Pi `setModel` / `setThinkingLevel`）：只改当前会话（Pi 写 `model_change`），不动 Agent 默认、不动全局；`setModel` 会校验 provider 是否配了 key，失败原因（如 `No API key for …`）原样显示，不吞成"切换失败"。
- **顶部模型显示规则**（2026-10-20 用户定）：顶部显示**本会话当前模型**。**没对本会话用过 `/model`** → 它就是 Agent 默认；**默认变了，顶部跟着变**。**用过 `/model`** → 会话级覆盖（`model_change` 持久），默认再变也不影响它。判定覆盖用**显式标记**（Pi 自定义条目 `lifeos_model_override`，不参与模型上下文），不靠"值相等"猜。**实现**：`src/model-follow.ts` 做判定（纯函数、穷举测试）。**只认 `/model` 写的显式覆盖标记**（`lifeos_model_override`；早期逻辑补的 `legacy:true` 标记一律忽略）；没有标记 → 一律跟随当前默认。保存默认 → `applyAgentDefaultModel` 同步未覆盖且**不在跑**的打开中会话 + 广播 `agents_changed`（前端只刷 meta）；**打开/重开**会话时若未覆盖且模型不是默认 → 跟随。不再用"值是否相等"去猜用户是否覆盖过（2026-10-20 实测：猜错会让默认永远跟不上）。
- **一轮的路径**（失败归属的骨架）：① 前端发送（本地插入用户消息 + 左侧本轮占位）→ ② 新建会话（仅无会话）→ ③ 后端受理（202，`void runTurn`）→ ④ 后端开跑（登记 running、订阅 Pi 事件）→ ⑤ Pi 模型循环（思考/文本/工具调用与结果，临时错误自动重试）→ ⑥ 收尾（`done`，或抛错 → `error` 带归类）→ ⑦ 前端重读会话（文件是事实源）。哪一步失败，左侧就写哪一步；具体显示映射见 `docs/design/frontend-structure.md` §2.1。

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
| `lifeos_interaction_harness` | 协议正文 · 本层指引 · 飞轮 · 概念空间索引 · **记忆规则（`memory.md`）** · 任务类型 · **本项目 `AGENTS.md`**（内容全部来自 `~/.lifeos` 下的文件） |
| `tools` / `rules` | Pi 默认渲染结果**原样回填**（不手写，自动跟随 Pi 更新）；`<docs>` 有意舍弃 |

实测（2026-10-18，真实家 + 真实一轮的落盘 system 条目）：sections = `preamble(identity) · skills · cwd · tools · rules · lifeos_interaction_harness`。
**Pi 的上下文文件读取已显式关闭**（`createHostedResourceLoader({ noContextFiles: true })`，2026-10-18 用户定）：Pi 默认会把 cwd **及其所有父目录**的 `AGENTS.md`/`CLAUDE.md` 读进 `<project_context>` 区——「向上继承父目录规范」不是我们的设计。项目规范只走我们自己的通道（写进 harness 区，标题里标了来源，可反查）：
  ① `agents/<id>/projects/<pid>/AGENTS.md`＝**Agent 私有约定**（这个 Agent 对这个项目的规定）；
  ② `<项目目录>/AGENTS.md`＝**项目公共约定**（外部项目才读，**只读项目目录自己这一份，不继承父目录**）。

注意（事实）：注入发生在**每次 run 开始时**；run 结束后 `session.systemPrompt` getter 回落到默认基准——要查"那一轮到底注入了什么"，看会话 JSONL 的 system 条目。

## 6 配置（现状）

- **模型清单与 Pi CLI 共用同一份**（2026-10-19 用户定）：`config/models.json` 内容与 `~/.pi/agent/models.json` 保持一致（当前 6 个 provider / 20 个模型）。**同步用复制，不要用软链**——实测软链会让 Pi 的 `ModelRuntime` 读不到 provider（`getModel` 落空）。
- 只有 `models.json` 同步；`settings.json`（Pi CLI 的默认模型）**不自动复制**——它的默认可能指向本机 local 端点，端点没开时新 Agent 会失败。要换默认模型：在 Agent 配置里选（个人配置优先），或自己加 `config/settings.json`。
- **只有一个配置目录** `~/.lifeos/config/`（= Pi 的 `agentDir`）：`models.json`（provider/模型/密钥）· `auth.json` · `models-store.json` · `settings.json?` · `file-roots.json`（文件浏览器的根白名单）。
- Agent 个人模型默认：`agents/<id>/projects/workspace/config.json`。
- 环境变量只有 `LIFEOS_HOME`（读配置前告诉进程"家在哪"，测试与部署用；其余一律走配置文件）。

## 7 前端怎么选中（现状）

URL 三键 `?agent=&project=&session=`；缺省回落到上次选择 → 第一个 Agent/项目/会话。
