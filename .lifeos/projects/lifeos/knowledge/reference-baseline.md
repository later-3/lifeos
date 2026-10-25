# 参考基线（开发 Life OS 时"照谁做"的收敛定义）

> 角色：开发规范　类型：决策　状态：现状
>
> **为什么要有这份文档**：只说"行业惯例"会四不像——每个项目的机制与命名都不一样。
> 所以本仓库**只认下面列出的参照点**：每个参照点必须写明「**场景 → 具体项目 → 具体文件/机制 → 借什么、不借什么**」。
> 没写进来的，不许用"行业惯例/业界标准"当依据（要么补一行，要么先讨论）。

## 0. 参考映射（2026-10-24 用户指示：每个参考项目按"前端/后端/方法论"逐项写清；新场景按行补）

| 参考项目 | 用在哪（我们对它"参考什么"） | 前端具体参考 | 后端具体参考 | 方法论（怎么用） | 不借 |
|---|---|---|---|---|---|
| **piweb**（同底座；基线 = `upstream/main e533d9b`，2026-10-20） | 一切会话 UI/协议对照的"镜子"：对照出我们少做了什么、做错了什么（例：unread 集合、"运行中"列表刷新，正是我们三态列表的缺口来源）。**版本纪律（2026-10-25 更正）**：只认上游默认分支最新 commit；本地 `~/Code/pi-web` 当前检出 `codex/later-custom` = `f3a5c91`（2026-08-28，我们自己的 fork，不含 `e533d9b`），其 `runningSessionIds` 写死 `[]`、`chat-workflow-contract` 无 images——那是**我们分支的定制**，不是上游退化。上游 `app/api/sessions/route.ts:45,55` 正常调用 `getRunningRpcSessionIds()`，图片能力完整 | 排队区结构 `components/ChatInput.tsx:1419-1485`（textarea 上方成组排队、横幅同容器）；未读/运行点 `components/SessionSidebar.tsx:303` `RUNNING_SESSIONS_POLL_MS=2500` + `unreadSessionIds`，运行态来自 `lib/rpc-manager.ts:2418` `getRunningRpcSessionIds()`；图片 `lib/image-attachments.ts:1-2`（单条 10 张、单张 10MB）、`components/ChatInput.tsx:427-429`（>1MB 才压、1024px、q0.85） | 单进程 RPC 的"服务端事实即客户端事实"模型（对照我们的"前后端分离 + SSE 可能断流"差异） | 读它的同场景实现并逐文件引用；没有对应实现就自己写，并在下一节"不借"里写清 | 它的 worktree/fork 谱系复杂性；React 全栈假设 |
| **LibreChat**（46.2k★MIT，官方架构文档） | 回合生命周期/steer 的"权威语义"样板 | steer 的可见呈现：steered 消息作为内容块重放为用户消息；composer 的排位与确认状态 | **服务端裁决**：`POST /api/agents/chat/steer` 校验"活 job"（PR #14220/commit 9bb351a）；`on_steer_applied` 确认事件；`steerArmConfirmationTimeoutMs` 防"服务器早就停了" | 先读官方文档 → 出问题再读源码 → 逐条写"借什么/不借什么"；几个参考项目一起"召开三选一讨论"后再落我们的方案 | 它的后端框架（Node+agents.x）、多用户 Job store 跨实例模型 |
| **Open WebUI**（156.5k★，官方 Logging 文档 + 审计 PR#10436） | 日志与排障"可回放"的样板 | 浏览器 console 结构化输出（官方 Logging 文档"两个日志面：浏览器 console + 后端 server 事件"） | 结构化 JSON 日志 + OTel 导出（`utils/telemetry/logs.py`）；审计中间件（结构化请求/载荷 JSON + 级别可配） | 以后端为主、两级统一；用环境变量切级别+聚合（LocLoki/Datadog 思路），本项目映射为 `~/.lifeos/logs/` | PostgreSQL 依赖栈；Python 后端 |
| 结论式出路（来自两次调整 C113/C114） | 参考要**落到端点/事件/UI 位置**，不写"大概像它们那样" | "像 LibreChat 排队话"必须能指着它的 events/字段与 UI 位置说"在哪出现、何时刷新" | "像 LibreChat 服务端判定"必须能指着它的路由与鉴权语义说"在哪校验、遇失败回什么" | 逐项"借什么/不借什么"到**端点/位置**粒度；参考不是风格而是**可检查的对象** | 拿某参考当"整体外观"，未核对差异就照抄数值 |

## 1. 主参照：Pi 生态（Life OS 建在 Pi 之上，能抄就抄）

| 场景 | 参照点（具体文件/机制） | 借什么 | 不借什么 |
|---|---|---|---|
| 资产打包与安装 | Pi `docs/packages.md`：`package.json` 的 `pi` 字段显式声明 + 约定目录；`pi install` 写声明到 `settings.json`；`pi update --extensions` 幂等 reconcile；本地路径装载不复制 | "声明 + 幂等 reconcile + 冲突保留先发现者并告警"的形态 | 不为 Life OS 另造一套包管理器 |
| 会话文件里 system 提示的 `sections` 语义 | Pi `system-prompt.ts`：`buildSystemPromptSections`（全量）与 `diffSystemPromptSections`（**只落变化的区，删除记 null**）；落盘的是补丁 | "补丁按序列累加 = 该轮真正生效的完整分区"这一还原方式；据此标注"本次变更 / 沿用上一轮" | 不借"把补丁当全量"的读法（面板第一版就是这样，第 2 轮只显示 2 个区，看起来像少了 5 个区） |
| 左侧图标轨与列收展 | VS Code Activity Bar（`src/vs/workbench/browser/parts/activitybar/activitybarPart.ts` + 官方交互：**点当前图标收起侧栏、图标条常驻**）；Pi Web `components/AppShell.tsx`（`useIsMobile()` → overlay 抽屉） | 图标轨常驻、**高亮 = 该面板打开**、点当前项收起、**不按窗口宽度替用户收列**；窄窗口用浮层抽屉保住内容区（不让内容被压扁，也不出现"点了没反应"） | 不借 VS Code 的视图容器/拖拽体系；不做 hover 自动展开；不做多列互斥（用户要求各自独立） |
| 会话区"正在工作"与过程流式 | Pi Web `components/ChatWindow.tsx`（`streamState` / `agentPhase` / `phaseLabel`）、`components/MessageView.tsx`（`ThinkingBlock` / `ToolCallBlock`）；Pi SDK 事件 `message_update.assistantMessageEvent`（thinking/text/toolcall）与 `tool_execution_start/update/end` | 事件流驱动会话区：阶段文案（等模型 / 思考 / 执行工具）+ 思考与工具块内联出现、按 assistant message 分段、段内 `contentIndex` 定序、跑完带耗时与结果；"没内容时显示阶段、有内容后显示块"的取舍 | 不借 Pi Web 的 CSS 变量体系与 i18n；不借它的 thinking 延迟加载接口（我们的历史走 `…/entries`）；不另发明事件名——沿用 Pi 的事件名 |
| SSE / 事件消费与重连（2026-10-25 多 Agent 后台完成任务 0007 复核，逐个读源码） | **Codex app-server** `codex-rs/app-server/src/thread_state.rs:322-441`（事件只发给订阅了该 thread 的连接）、`src/in_process.rs:620-680`（有界 channel：请求满 → 明确 OVERLOADED 错误）、`src/thread_status.rs:1-60`（RAII 守卫 Drop 时释放运行态）；**opencode** `packages/server/src/event-feed.ts`（全局总线、每订阅者有界队列 4096、溢出即失败）、`handlers/event.ts`（先发 connected、15 秒心跳）、`packages/client/src/solid/data.ts:636-650`（连上后 REST 快照，期间事件覆盖快照）、`packages/app/src/shell/notifications/notification.tsx`（未读 = 服务端 idle > viewed）；**Open WebUI** `backend/open_webui/socket/main.py:1401-1431`（信封带 chat_id 发 user room）、`backend/open_webui/main.py:1755-1800,1891-1899`（任务注册表驱动 chat:active）、`src/lib/components/layout/Sidebar.svelte:772-800`；**LibreChat** `packages/api/src/stream/GenerationJobManager.ts:5122,6168,9675`、`implementations/InMemoryEventTransport.ts`（回放双上限 + 明确错误）；**pi-web 旧版** `lib/rpc-manager.ts:510`（被停止的回合不发完成）、`:2742`（完成 → Web Push） | 一条全局流承载所有 Agent 的回合级事件（零丢失）；细节流按焦点路由（非焦点不洪泛）；运行态与未读是服务端事实且持久化；溢出即断线重快照（**不静默丢**，对齐 opencode 的"溢出即失败"但补上重连与重快照）；连接即快照（服务端先缓冲）；心跳发现死连接；被停止的回合不算完成 | 不借：Redis 任务注册表与多副本（单进程不需要）；LibreChat 的准入/转向队列（复杂度与本系统不匹配）；Open WebUI 的全量细节广播（并发时 token 洪泛）；pi-web HEAD 的 `runningSessionIds: []`（退化）；opencode 的"volatile，断线丢事件"契约（我们不接受丢失） |
| 空项目 / 新 Agent 的首次发送 | Pi Web `components/AppShell.tsx` 的 `newSessionCwd` + `newSessionDraftKey`（无会话时输入框可用、草稿挂在"待建会话"上，首条消息落地时才真正建会话）；ChatGPT / Claude 等同类产品一致（没有"先建会话"这一步） | 输入框不以"没有会话"为禁用条件；草稿按 agent+project 归属；发送时先建会话再发，URL/会话列自动补上 | 不借 Pi Web 的 draft 路由与恢复细节（我们按 URL 三键 + localStorage 草稿）|
| 模态/对话框的焦点与键盘 | Pi Web `components/DirectoryPicker.tsx`（`autoFocus` 放在路径输入框）+ 其焦点陷阱只在 Tab 上做（`MobileDeviceSwitcher.tsx`）；React 官方 `autoFocus` 语义 | 对话框打开时**显式指定初始焦点**（`initialFocus`，调用方给 ref）；焦点陷阱/`Escape` 逻辑**只在挂载时建立**（onClose 走 ref），不在每次渲染重设焦点 | 不自己写"每次渲染重设焦点"的陷阱（曾把焦点拽回关闭按钮，输入框收不到按键）；不引入焦点管理库（2 处需求不值得）|
| 会话运行控制与输入（打断/插话/排队/压缩/斜杠命令） | Pi Web `components/ChatInput.tsx`（`onAbort` 在 Esc 触发、`onSteer`/`onFollowUp` 两个分支、`BUILTIN_SLASH_COMMANDS` 面板）与 Pi `AgentSession` 的公开方法（`abort/steer/followUp/compact/setModel/setThinkingLevel`）；Pi CLI `src/modes/interactive/interactive-mode.ts` 的命令清单 | 打断=Esc/停止按钮、生成中 Enter=steer、斜杠命令面板、↑/↓ 历史；**全部直接调 Pi 原生方法**，不自造队列 | 不借 Pi Web 的 i18n/CSS 体系；不借它「流式时隐藏内置命令」的取舍（我们的命令在非流式也可见） |
| 失败与重试的可见性（超时/重试/失败原因） | Pi 事件 `auto_retry_start` / `auto_retry_end`（`attempt/maxAttempts/delayMs/errorMessage`）与 assistant 消息的 `stopReason=error` + `errorMessage`；Pi CLI 在流式区显示重试与错误 | 工作指示行显示「第几次/共几次 + 原因」，失败气泡显示原因并给「重新发送」 | 重试次数与退避用 Pi 的策略，不自己调 |
| 代码检视与缺陷分级（四类检视 / 缺陷-质量-架构三分 / 交互交付四问） | Pi `CONTRIBUTING.md`（"You must understand your code"）+ `pi/AGENTS.md` 的 Code Quality 条目（不用 `any`、不内联 import、改前读全文）；pi-web `design-qa.md`（对照目标、像素尺寸、交互断言、findings）；vercel/ai-chatbot 的目录分层（`components/ai-elements`、`hooks/`、`app/(chat)/api/*`） | 借：四类检视、三类结论分开处理、交互四问、证据清单、用门禁代替自觉 | 不借：Pi 的"core 最小化"取舍直接搬到产品；不借"把标杆项目的功能补齐"的思路 |
| 失败一轮的动作归属（"重新发送"挂哪） | Pi Web 把 retry/重试信息做成**输入框上方的横幅**（`ChatInput.tsx:1487`，运行中的 retrying n/m）+ 通知架（`ChatWindow.tsx:686`）；ChatGPT/Claude 的 "Regenerate" 挂在**助手回复**下（重新生成的是回复）；ai-chatbot `message-actions.tsx` 只放内容动作（复制/投票/编辑），流式中 `return null`；它的**容器/原子分层**（`components/ai-elements/message.tsx` 导出 `MessageActions` 容器 + `MessageAction` 原子，业务层只声明这两个原子）是我们动作条分层的参照 | 借：动作条里"流式中不出现"、容器/原子分层；**不借**它们的挂载位置——它们的动作是"重新生成回复"，我们的语义是**重发用户消息**（Pi 没有 regenerate API，只能再发一次），所以挂在**那条用户消息**的动作条里（`frontend/src/resend.ts` 决定挂哪条）；助手的失败原因留在助手消息 |
| 运行中状态（阶段/计时/重试/过程详情） | Pi CLI `src/modes/interactive/components/status-indicator.ts`：spinner + 文案；**重试是实时倒计时**「Retrying (i/max) in Ns...（Esc 取消）」+ `countdown-timer.ts`；Pi Web `hooks/useAgentSession.ts` 的 `AgentPhase`（`waiting_model` / `running_tools` 带工具名与 progress）+ `ChatWindow.tsx` 的 `ProcessDetailsGroup`（**没有最终回复时自动展开过程详情**） | 借：阶段文案、重试倒计时、Esc 取消提示、无最终回复时自动展开过程；**加**我们自己的总计时（两家都没有）；"失败=回复"放左侧 | 不借：Pi Web 只显示阶段不带计时；Pi CLI 的 TUI 布局与颜色（我们走 token） |
| 顶部模型显示（默认 vs `/model` 覆盖） | Pi `settingsManager`（全局默认）+ 会话 `model_change`（session 级持久，`agent-session.ts::setModel`）；Pi CLI `/model` 是会话级、`persist` 才改全局 | 顶部显示会话当前模型；**未覆盖时跟随 Agent 默认**（默认变更 → 顶部跟着变）；覆盖必须有显式标记（计划 `lifeos_model_override` 自定义条目），不靠值相等推断 | 不借：Pi CLI 的"模型名即状态"（我们顶部要能看出"当前用哪个"）；不借用 `persist` 改全局（我们的 Agent 默认在自己的 config） |
| 记忆（四种角色 / 读写权限 / 隔离 / 工具契约） | **MemOS** `MemTensor/MemOS`：`MemCube { user_id, cube_id }`、`writable_cube_ids` / `readable_cube_ids`（搜索结果带 `cube_id`）、`agent_id` / `conversation_id` 隔离；本地插件 L1/L2/L3/Skill、SQLite + FTS5 + 向量、Memory Viewer。**Memmy**（同组织）：同一套记忆模型，服务化封装。`pi-memory` 仅作"日记=每日日志"形态参考 | 借：四层记忆模型（trace→policy→world model→skill）、按角色 ID 隔离（user/agent/cube）、本地 SQLite + 混合检索、"记忆可见"的 Viewer 形态、操作审计思路；写操作单角色、读取按优先级合并 | 不借：Cloud/Neo4j/Docker 自托管路线、团队 Hub 共享、软删除/可恢复（用户定硬删除，MemOS `deleteTrace`）、把项目记忆挂在 Agent 目录下（项目是全局实体，私有经验才归 Agent） |
| 失败归因与工具状态（超时/连不上/鉴权/…；未完成 vs 执行中） | Pi `ai/src/types.ts` 的 `StopReason`（含 `aborted`/`length`）与 `ai/src/utils/retry.ts` 的可重试错误模式（network/connection/fetch failed/getaddrinfo/ENOTFOUND/timed out…）；Pi Web 用 retry 横幅表达"正在重试"，ai-chatbot 用 toast 表达错误 | 借 Pi 的错误语义与模式清单（不自己编网络错误串）；按种类给 Actionable 文案 + 原始错误小字；工具状态按"这一轮是否在跑"判定（`live`） | 不借"只有一句通用失败提示"；不借把错误只放 toast（会话里要留痕） |
| 消息动作条（统一悬停出现、复制/重发 + 反馈；容器 + 注册项） | Pi Web `components/MessageView.tsx`：底部右对齐动作行，`hovered` 控 `opacity`/`pointerEvents`（0.12s），`isMobile` 常显且 44px，复制后"已复制"1.5s，流式中（`isStreaming`）不给复制，只复制文本块；vercel/ai-chatbot `components/chat/message-actions.tsx` | 借：动作行位置与悬停显现（`opacity`+`pointerEvents`，不挤布局）、1.5s 反馈、流式不显示、只复制文本 | 不借：桌面 22px 命中区（我们门禁 ≥28px）、fork/编辑类动作（分支暂缓） |
| 任务编号与目录 | ADR 约定（`adr.github.io`：`docs/adr/0001-record-architecture-decisions.md`，四位编号 + 短标题）；我们的 `task-types/<type>/TEMPLATE.md` 文档骨架（development A/B/C · general G） | 四位编号前缀（按项目连续）+ 可读标题（允许中文）；一个任务一个目录、文档按类别必需 | 不借"一个决策一个文件"（我们是目录 + 多文档 + phases/units）|
| 文件面板的根目录历史 | VS Code「Open Recent」（打开过的文件夹按最近使用排序，MRU）；Pi Web `lib/project-groups.ts · getRecentProjects`（按最近活动排序去重，**不另存历史**） | 用**已有数据**当历史：根白名单 `config/file-roots.json` 按最近使用排序（家目录固定第一），切换即提权；界面用现有 Modal 列出来（不新增控件/存储） | 不新建"历史记录"存储、不做无限条目管理；不借 Pi Web 的项目分组逻辑（我们是文件根，不是会话项目）|
| 创建实体的唯一性（Agent） | Kubernetes `metadata.generateName`（名字 + 随机后缀，id 不承载语义）；声明式创建的 create-or-return（`kubectl apply` / Terraform 的 name 唯一键）；GitHub/Slack 改名不改 id | 非 ASCII 名得到不透明 id（`agent-3f9a`）；**创建按 name 幂等**（同名返回已有实体，`created:false`）；工具描述写明"id 生成后稳定，改名不变，不要归档重建" | 不引入 idempotency-key 机制（调用方是模型，按 name 幂等已足够）|
| 聊天输入框（Enter 发送 / 输入法组字 / 多行） | Pi Web `components/ChatInput.tsx`：`isComposingRef` + `nativeEvent.isComposing` + `keyCode === 229` + `compositionend` 后 `COMPOSITION_END_ENTER_GRACE_MS = 100` 宽限；Shift+Enter 换行 | 整套判定与宽限值；组字中把 Enter 让给输入法、组字刚结束吞掉那次冒泡 | 不借其自研 textarea / 自适应高度 / 移动端 Ctrl+Enter 快捷键（我们用原生 textarea + rows=1）|
| 输入框对象结构（composer / 菜单 / 排队 / 横幅） | Pi Web `components/ChatInput.tsx`：L1419-1485 排队消息在 textarea 上方成组显示、L1487-1514 retry/compact 横幅同容器、L1054-1177 slash/history/@ 菜单键盘导航、L1393-1416 单一 wrapper（`maxWidth:820;margin:0 auto`）；LobeHub `src/features/ChatInput/Mobile/index.tsx`：`ChatInput` header/footer action bar + `InputEditor defaultRows=1` + `SendArea`，`fullscreen` 才绝对定位铺满 | 输入区视为**一个对象**：textarea、发送/停止、palette、排队/横幅在同一容器内分组；移动端默认 1 行，菜单/发送在附近；视觉用我们自己的 token | 不借 Pi Web 的 inline CSS / i18n / 自研 textarea 与自动高度实现；不借 LobeHub 的文件上传/expand 机制；不把同一输入对象的动作拆到不相邻区域 |
| Life OS 自有工具（Agent 创建/归档、任务、项目） | Pi `extensions.md §Tools`（`defineTool` + 注册；throw = 失败结果；`content`+`details` 必填）与 `sdk.ts` 的 `tools` **白名单**语义（列出的才启用）；`annotations` 借 MCP 的 destructiveHint 等标注 | 用 Pi 的工具模型定义名字/英文描述/参数 schema/标注；业务动作下沉到 `src/agents.ts`（工具与 HTTP 共用一份实现）；工具名显式写进 allowlist | 不自己实现工具循环、参数解析或事件；不绕开 Pi 的工具系统（如让模型直接「执行命令」模拟工具）|
| 技能（skill） | Pi `docs/skills.md`：约定目录 + 递归发现；启动只把 **name/description/path** 放进 system prompt；正文按需读取 | 目录约定、发现顺序、"索引进 prompt、正文按需" | 不改 Pi 的发现规则 |
| 用户目录布局 | 实机 `~/.pi/agent/`：`auth.json`、`models.json`、`settings.json`、`extensions/`、`skills/`、`npm/` | 家的根放**名词式 json**（`config.json` 风格）、子目录按功能 | 不照搬 Pi 目录名（我们的家叫 `~/.lifeos`） |
| Agent 会话装配 | Pi `createAgentSession({ appendSystemPromptOverride, settingsManager, sessionManager, resourceLoader, customTools, model, thinkingLevel, providerRequestGate })` | 只用公开入口，不自建运行时 | 不 fork/改造 Pi |
| 运行时资产随包发布 | 本仓库实测教训（2026-10-15）：资产必须进构建（`nitro.config.ts` `serverAssets`），dev 读源码、构建态读 `assets:<baseName>` | 同一读法通吃两种形态 | 不假设"源码一定在" |

## 2. 次参照（只在写明场景时使用）

| 场景 | 参照点 | 借什么 | 不借什么 |
|---|---|---|---|
| 安装记录（install receipt）的**文件名** | Homebrew `INSTALL_RECEIPT.json` | **只借用词** `install-receipt.json` | 不借它的机制（Cellar 布局、formula 概念） |
| 依赖/内容锁定概念 | npm `package-lock.json`（Pi 自己也在用：`~/.pi/agent/npm/`） | "锁定 + 漂移检测"的想法（我们记录 sha256 判断用户是否改过） | 不引入 npm 依赖树语义 |

## 3. 明确不参照

- **泛泛的"行业惯例"**：不写具体项目与文件的，不作为依据；
- 与本项目形态差异大的系统（K8s/Helm/Terraform 等）：除非某场景真的需要它已成型的小机制，否则不引；
- 第三方 Agent 框架（LangChain 等）：Life OS 的 Agent 运行时是 Pi，**不引第二套**。

## 4. 使用规则

1. 提出新机制/新命名时，先在本文件找到**对应场景行**；找不到就**先补行**（补行要写明"借什么、不借什么"）；
2. 参照点要**可核**：给出文件路径、命令或实机位置，不写"某某框架一般这么做"；
3. 只写“它是怎么做的”不够：必须能回答**为什么这样设计 / 好处 / 适用条件与代价 / 我们的情况 / 倾向**；“借什么/不借什么”是分析后的结论，不是分析本身；
4. **场景行不是永久判决**：倾向绑定当前功能/数据/设备场景；需求或数据变了就重新评估，不采用的原因要连同“复核触发条件”一起记录，拆解可复用；详细分析放任务文档，完成后回填本文件，不另建第三份清单；
5. 与 Pi 冲突时，**以 Pi 的公开接口与文档为准**；要偏离必须在本文件写明理由（并登记为决策）。

## 前端页面布局（2026-10-21 补）

| 场景 | 参照点 | 借什么 | 不借什么 |
|---|---|---|---|
| 个人资料编辑（头像/名字/简介/身份） | Instagram「编辑主页」、**LobeHub Agent Profile**（`ProfileEditor/AgentHeader.tsx`：头像 72 + 大标题；`ProfileEditor/index.tsx`：顶部资料区 + runtime config 面板 + prompt editor，无 Tab）、**Grok Bot**（Name / Job / Description 三字段）、OpenAI ChatGPT 资料区 | 头像作为视觉锚点；名字/简介/身份成组；头像立即生效；一个清晰的主保存；移动端单列；模型/运行配置作为同页面板，不另开页 | 不借社交产品的品牌渐变/玩法；不把“用户名/关注数”等社交字段搬进来；不借 GitHub 式死板设置列表 |
| 两段式配置（基本信息 / 模型） | ChatGPT 个性化设置、Claude 个人偏好、LobeHub Agent Profile（runtime config + prompt 同页） | 按任务分组；模型作为同页配置面板；只有 3+ 分区才用全宽 Tab/侧栏；窄屏单列 | 不用左上角小胶囊；只有 2 段时不硬上侧栏；单实体编辑不把头像塞进左栏 |
| 单实体编辑 vs 多实体导航 | LobeHub Agent Profile（顶部 header，无左栏）；Slack/Discord 设置（多实体/多分区才用左栏） | 单实体：顶部资料 header + 单页 sections；左栏只用于多 Agent/多分区导航 | 不把单个头像当作左栏全部内容；不为 2 个 section 造一个空左栏 |
| 多 Agent 工作台（参考形态） | CopilotKit OpenBot（每个 agent 一个 channel；工作上下文留在 channel）、LobeHub 左侧 agent 列表 | 多 Agent 时用左栏承载“Agent 列表/切换”，不是单个 profile；会话按 Agent/Channel 保持上下文 | 不把“单 Agent 配置弹窗”做成左栏工作台；不借 OpenBot 的后端/权限实现 |
| 模型选择（provider / model / thinking） | OpenAI/Claude 模型选择、VS Code 设置里的模型项 | 服务→模型→档位联动；显示当前默认；只列模型支持的档位；保存后说明影响范围 | 不做大表格/目录式模型清单；不把未支持的档位显示成可选 |
| 会话过程状态条 | Pi Agent TUI `FooterComponent` + `StatusIndicator` + viewport 分层 | 固定底部状态；tokens/context/model；spinner/重试倒计时；状态与消息流分层 | 不搬 TUI 的终端字符布局；不用状态条替代消息内容 |
| 移动端会话/设置 | ChatGPT / Claude 手机端（抽屉 + 固定 composer）；LobeHub 移动端响应式设置；Linear 手机端（单列 + 底部导航）；Instagram 编辑资料手机端（全屏表单 + 单保存） | 单主列、抽屉/底部导航、固定 composer、全屏设置、触控目标 44、键盘/安全区；多级导航用 drill-down（选上一级进下一级，不关闭）；状态条只保留关键项 | 不把桌面三列压窄；不保留 hover-only；不照搬桌面侧栏宽度 |
| 手机返回栈 / 全屏表面 | **LobeHub** `src/routes/(mobile)/settings/_layout/Header.tsx`（`ChatHeader showBackButton` + sticky）、`src/features/Pages/MobilePageHeader/index.tsx`（`location.key === 'default' ? '/' : navigate(-1)`）、`src/components/server/MobileNavLayout.tsx`（header 在滚动区外）；**LibreChat** `client/src/components/UnifiedSidebar/mobile/Scrim.tsx`（可聚焦 scrim）、`client/src/hooks/Nav/useDrawerDismiss.ts`（焦点交还/inert）、`client/src/components/UnifiedSidebar/mobile/BottomBar.tsx`（`env(safe-area-inset-bottom)`）；**Open WebUI** `src/lib/components/layout/Sidebar.svelte`（`MobileSwipePanel`、选中即关闭、关闭态 `inert`） | 详情页/全屏面板有明确返回；直接进入无历史回根；选中叶子关闭、选上级 drill-down；全屏表面锁背景、焦点循环、关闭还原焦点；底部安全区用 `env()`；页面只存在一个滚动容器 | 不借社交产品的业务功能/品牌色；不把桌面 aside 直接铺成手机全屏；不照搬 LobeHub 底部 Tab（我们的根是单一聊天）；不照搬 LibreChat 的复杂手势实现，手势只做返回 |
| 会话回到底部 | **Pi TUI** `pi/packages/coding-agent/src/modes/interactive/tui-renderer.ts:32` 的 `scrollToEndIndicator`：`↓ Jump to latest message`，离开底部时出现，点击回到底部；`chat-viewport.ts` 的 `follow: "end"` | 离开底部才出现；向下箭头/“回到底部”；点击后恢复跟随；桌面和手机同一语义 | 不照搬终端字符/快捷键样式；不做常驻按钮、不在贴底时占位 |
| 会话状态条 / Token 展示 | **Pi TUI** `FooterComponent`/`StatusIndicator`；**Codex TUI** 可配置 status line（model/context/tokens）；**Claude Code** 可配置 status line（context/cost）；**Gemini CLI** `ContextUsageDisplay`；**LobeHub TokenTag/UsageDetail**（emoji 指示 + 数字，点击展开用量） | 固定底部/输入区；符号 + 数字 + tooltip/点击详情；上下文/成本/限额按需；窄屏隐藏次要项 | 不满屏文字铺开；不裸用无图例箭头；不把 usage 做成大表格常驻 |

> 状态条/Token 参考：Codex status line https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/footer.rs ；Claude Code status line https://code.claude.com/docs/en/statusline ；Gemini CLI ContextUsageDisplay https://github.com/google-gemini/gemini-cli/blob/f8541cf7/packages/cli/src/ui/components/ContextUsageDisplay.tsx ；LobeHub TokenTag https://ui.lobehub.com/components/chat/token-tag / UsageDetail https://github.com/lobehub/lobehub/blob/6c1e6aea/src/features/Conversation/Messages/components/Extras/Usage/UsageDetail/index.tsx ；Pi TUI footer/status。

> 移动端参考：Apple HIG 44pt https://developer.apple.com/design/tips/ ；Material 3 48dp https://m3.material.io/foundations/designing/structure ；WCAG 2.5.5 44×44 https://www.w3.org/WAI/WCAG21/Understanding/target-size.html 。

> 参考链接：LobeHub `https://github.com/lobehub/lobehub/blob/6c1e6aea/src/routes/%28main%29/agent/profile/features/ProfileEditor/index.tsx` / `AgentHeader.tsx`（顶部头像 72 + 大标题，runtime config 面板 + prompt editor，无 Tab）；Grok Bot `https://docs.x.ai/grok-bot/bots`（Name / Job / Description）；OpenBot `https://www.copilotkit.ai/openbot`（每 Agent 一个 channel 的工作台，不是单 Agent 配置弹窗）；Instagram 编辑资料 https://help.instagram.com/583107688369069 ；编辑个人资料/bio https://help.instagram.com/936495066470190/ ；ChatGPT 资料 https://help.openai.com/en/articles/20001539-shareable-profiles-in-chatgpt ；ChatGPT 自定义指令 https://help.openai.com/en/articles/8096356-chatgpt-custom-instructions ；Claude 个性化 https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features ；Pi TUI `pi/packages/coding-agent/src/modes/interactive/components/footer.ts` / `status-indicator.ts` / `theme/dark.json`。

## 远程访问（2026-10-21 补）

| 场景 | 参照点 | 借什么 | 不借什么 |
|---|---|---|---|
| 公网访问本机服务（不开入站端口） | 我们的 Chat `pi-011` 任务：`~/.chat/long-agents/pi-agent/projects/chat/tasks/pi-011-remote-access-foundation/`（`02-design.md` §2/§6、`04-execution-log.md` 18:17、`05-access-runbook.md` §4/§6）；Cloudflare 官方 Tunnel + Access（self-hosted app + One-time PIN） | 出站隧道（cloudflared 主动连 CF 边缘，无公网 IP/DDNS/路由器改动）；一条隧道多 ingress；LaunchAgent/systemd 常驻；Access 在边缘做身份门；`502 = 隧道通、源端未起` 的判读 | 不借 Chat 的无登录公网入口（Life OS 有 bash/文件工具）；不借入站端口/路由器放行；不复用 Chat 的隧道与配置（独立生命周期） |
