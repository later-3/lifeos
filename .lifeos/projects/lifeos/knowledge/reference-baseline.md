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
| 新建会话 / 空项目的首次发送（2026-10-29 补：点击行为与空会话列表） | **Pi Web** `upstream/main@e533d9b`（2026-10-20）：`components/AppShell.tsx:901-954 handleNewSession` 点“新建会话”零请求（只改前端状态 + `router.replace('?cwd=…')`）；`hooks/useAgentSession.ts:928-943 ensureNewSession` 发送时才 `POST /api/agent/new`；`:903-927` 发送后立刻插 transient 行。空 runtime 不进历史：`lib/rpc-manager.ts:2362-2364`（`!persisted && (!isRunning() || !firstUserMessage)` → 跳过，注释写明“不要把 ensure_session 的空 runtime 泄漏进历史”），空闲超时回收 `:163-166, 708-733`。**Open WebUI** `main@33c1978d`：`src/lib/components/layout/Sidebar.svelte:937-950 newChatHandler` 零请求；首条消息才 `createNewChat`（`Chat.svelte:4787-4815`，记录与首条消息同一动作），命令按可用性过滤（`MessageInput.svelte:189-198`）。**Pi CLI** `pi@90d863f`：`session-manager.ts:1057` 新建只建内存 header，`:1166-1189` 有 user/assistant 消息才建文件 | 点击=界面动作、发送才建会话；列表只列承载过用户动作的会话（我们的判据 = 有名字的 pending）；草稿按 agent+project 归属；刷新用 URL 区分草稿与会话 | **不借** Pi Web 的 draftId/parked 草稿/草稿级模型选择（多草稿 key 管理，代价大于收益）；**不借** Open WebUI 的“建记录与首条消息同一动作”（要改 API，收益只是消掉罕见窗口）——我们补“明确非 2xx 删除刚建的会话”；**不借**其占位标题/自动生成标题（我们的标题来自首条消息） |
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
| composer 视觉（留白/提示/尺寸/焦点） | vercel/ai-chatbot `~/Code/reference/ai-chatbot` @c2f8235 `components/chat/multimodal-input.tsx:536-577`（textarea 独行 min-h-24 大留白 + 底部 Footer 行工具左/发送右；placeholder 单句 "Ask anything..."），open-webui @33c1978 `MessageInput.svelte:2066-2251`（rounded-3xl、placeholder 单句、focus 换边框色），LibreChat @8e5ef1f `ChatForm.tsx:375-452`（focus 档位换 shadow；textarea 单行 py-3.5） | 
| 借：单句 placeholder + 键盘提示同位；末行对齐发送钮；容器焦点整圈状态；空态低密度 | 不借 ai-chatbot 的 28px 尺寸（低于我们主操作≥44 档）、不借 inline CSS/Svelte 实现细节、闭源印象不作为证据（2026-10-26 曾因凭记忆判 ChatGPT/Claude 被用户纠正；本轮全部 A 级源码） |
| Life OS 自有工具（Agent 创建/归档、任务、项目） | Pi `extensions.md §Tools`（`defineTool` + 注册；throw = 失败结果；`content`+`details` 必填）与 `sdk.ts` 的 `tools` **白名单**语义（列出的才启用）；`annotations` 借 MCP 的 destructiveHint 等标注 | 用 Pi 的工具模型定义名字/英文描述/参数 schema/标注；业务动作下沉到 `src/agents.ts`（工具与 HTTP 共用一份实现）；工具名显式写进 allowlist | 不自己实现工具循环、参数解析或事件；不绕开 Pi 的工具系统（如让模型直接「执行命令」模拟工具）|
| 技能（skill） | Pi `docs/skills.md`：约定目录 + 递归发现；启动只把 **name/description/path** 放进 system prompt；正文按需读取 | 目录约定、发现顺序、"索引进 prompt、正文按需" | 不改 Pi 的发现规则 |
| 用户目录布局 | 实机 `~/.pi/agent/`：`auth.json`、`models.json`、`settings.json`、`extensions/`、`skills/`、`npm/` | 家的根放**名词式 json**（`config.json` 风格）、子目录按功能 | 不照搬 Pi 目录名（我们的家叫 `~/.lifeos`） |
| Agent 会话装配 | Pi `createAgentSession({ appendSystemPromptOverride, settingsManager, sessionManager, resourceLoader, customTools, model, thinkingLevel, providerRequestGate })` | 只用公开入口，不自建运行时 | 不 fork/改造 Pi |
| 运行时资产随包发布 | 本仓库实测教训（2026-10-15）：资产必须进构建（`nitro.config.ts` `serverAssets`），dev 读源码、构建态读 `assets:<baseName>` | 同一读法通吃两种形态 | 不假设"源码一定在" |

| 凭据与环境变量的解析/生效（2026-11-03 补，Task 0017） | **12-factor App** §III（config 存 env，不存代码）；**Node dotenv**（`dotenv.config()` 一次性注入 `process.env`）；**dotenvx** / **Vault Agent 模板** / **k8s reloader**（文件变化 → 重新注入，进程不重启）；**Kubernetes Secret → env**（`envFrom`，启动时注入，起完改不了）；**AWS Secrets Manager / Vault**（运行时按 TTL 拉取，凭据可轮换）；Pi `packages/coding-agent/src/core/resolve-config-value.ts`（`${VAR}` 模板解析：`$$`/`$!` 转义、`!cmd` 命令式）与 `packages/ai/src/auth/context.ts:24-30`（`process.env[name]`，`value.trim().length > 0` 才算有） | 借：**引用式配置**（`models.json` 只存 `${VAR}`，值永远来自 env）；**启动即校验、失败要可见**（fail fast 的意图，但我们的实现是 warn + 请求时拦，理由见"不借"）；**按需现取**（`checkAuth()` 每次实时读 `process.env`，而不是缓存快照）；**文件热重载只读不执行**（学 dotenvx/reloader 的"重新注入"，但用静态解析代替跑 shell） | **不借** dotenv 的"一次性注入"（进程起来后改文件无效，正是本次故障）；**不借** `zsh -ic` 重跑用户 shell 配置（实测 **7.5 秒/次**，且会执行 `.zshrc` 全部副作用：conda init、nvm、后台守护）；**不借** Vault / AWS SM 那类凭据服务（单机项目，无多副本与集中轮换需求）；**不借** `exit` 式 fail fast（`models.json` 有 12 个 provider，一个本地模型没配就崩服务会把"3 个能用"变成"全不能用"，改为逐条 warn + 用到时拦） |

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

## 多 Agent 交互（2026-10-27 补，Task 0013 调研）

| 场景 | 参照点 | 借什么 | 不借什么 |
|---|---|---|---|
| 父子委派（subagent） | **Pi 官方示例** `pi/packages/coding-agent/examples/extensions/subagent/index.ts`（spawn 独立 `pi` 进程、隔离上下文、single/parallel/chain、8 任务/4 并发）；**pi-subagents 0.78.0**（进程内子会话、后台、workflows、missions/schedules、intercom、外部 CLI 子代理）；**Claude Code** Subagents（<https://code.claude.com/docs/en/agents>）；**Codex** Subagents（并发默认 6） | 「子上下文隔离 + 只回摘要」这个契约；两种实现路线（独立进程 vs 进程内子会话）都保留；本地上限与并发上限要显式配置 | 不把 subagent 当"并行干活的万能方案"；不为 subagent 造"互相发消息"（那会变成团队场景） |
| 多 Agent 团队（lead + 共享任务列表 + 互发消息） | **Claude Code** Agent teams（实验特性、默认关闭、不做 worktree 隔离 → 要求分区文件）；**LobeHub** Agent Team（内置 host + 成员私信） | "共享任务列表 + 点对点消息 + lead 复核"三件；按文件分区避免冲突 | 不先做房间 UI；不在实验特性上做产品承诺 |
| 群聊 / 房间 | **Open WebUI** Channels（人与**多个模型**同一持久时间线、成员制、`write_access`）；**AutoGen** GroupChat / SelectorGroupChat（共享线程、轮流发言、模型选下一个发言者） | 房间的必备定义：成员、发言权、共享游标、轮次上限、终止条件、失败隔离 | **不借房间数据模型**：我们是单人个人系统，没有"多人同场"场景；规范 §5 的"没有定义不实现"继续有效 |
| 会话分叉（fork / clone / tree） | **Pi** `session-manager.ts:1529 getTree()`、`:1632 createBranchedSession()`、`:1815 forkFrom()`；**Claude Code** forked subagent（`/subtask` 继承完整上下文）vs `/fork`（复制会话到后台） | 谱系要能展示父会话与分支；"继承上下文的子任务"与"复制会话"是两个动作 | 不把 fork 当"自动并行"；不默认合并所有分支 |
| 长时间运行（durability） | **Temporal**（崩溃后重建状态继续，工作流可跑数年；含 OpenAI Agents SDK 集成）；**LangGraph** checkpointer（每 super-step 快照、可恢复、可 time travel）；**Cursor Cloud Agents**（隔离 VM 长跑、完成自动开 PR）；**Claude Code Projects**（云端长跑，按项目分线程）；**Pi** `packages/durable`（实验）+ **pi-subagents** background runs / missions | 用"持久状态 + 恢复点"表达长跑，而不是"进程别退出"；失败要能从检查点续；长跑必须有可见状态（运行事实/收据） | 不自建 durable 引擎；不把"后台跑"当成"长跑"（后者要跨崩溃） |
| 定时触发（trigger） | **pi-subagents schedules**（`.pi/subagents/schedules/`、`at/every/day/week` + IANA 时区、`catchUp latest\|none`、`overlap` 固定 `skip`、`quiet`、history；会话存活时进程内 `arm/fire`，不在时 `schedule.run-due` 由外部 launcher 调）；**Claude Code scheduled tasks**（云端按计划/API/GitHub 事件；本地 `/loop`+cron 仅 app 打开且机器醒着）；Temporal cron；launchd / systemd timer / GitHub Actions schedule | "durable 记录 + 可拉取的到期任务"表达调度；错过补偿、不重入、时区、历史四件必须齐全；触发方单独决定（常驻循环 vs 系统 cron/launchd） | 不写自己的调度器；不把定时与长跑混为一件事 |
| 跨会话 / 跨厂商消息（A2A） | **A2A 1.0.0**（<https://a2a-protocol.org/latest/specification/>）：`Task / Message / AgentCard / Part / Artifact`，操作 Send/Get/List/Cancel + Get Agent Card，绑定 JSON-RPC/gRPC/REST；**Claude Code** cross-session messaging（列/发消息到本机、另一台机、云端会话） | 会话寻址 + 任务式交互（Task 生命周期：提交/查询/取消）；"agent card 描述能力" | 单机个人系统**不实现** A2A 协议；不引入跨组织鉴权 |
| Agent 作为工具（MCP） | **Pi** `packages/mcp` + `registerMcpServer`，配置 `agentDir/mcp.json` 与项目 `.pi/mcp.json`；**Claude Code**「另一个工具就以 MCP server 暴露」 | 外部能力（含外部 Agent）统一走 MCP；白名单不拦 MCP 工具（Pi 现状） | 不自建 web 搜索/抓取工具去重造 MCP 已有能力 |

> 一句话判据（Task 0013 §7）：先答五问——谁协调 / worker 要不要互相通信 / 上下文隔离还是继承 / 一次性还是持久 / 是否改同一批文件。| 移动端 IM 导航（Agent=同事） | **Zulip** `web/src/overlays.ts`/`overlay_util.ts`（单层 overlay+滚动锁，commit 3e9bc1e，2026-10-27 本机检出）；**飞书/Telegram/钉钉** 列表→对话→详情三点定位与返回栈（C 级观察） | 手机四屏=消息流(同事行)/聊天(根级、默认上次会话)/同事详情(切对话·切项目·话题选择)/项目 Tab(工作台)；系统返回=退一层、单层 overlay 语义；URL `?agent&project&session` 承担 deep-link | **不借**三家开源的视觉与任何前端样式；不借 Zulip 的多栏窄屏切换表单 |
| 未读与"在忙"模型 | **Zulip** `web/src/unread.ts`（stream:topic 二级键，mention 独立 Set）；**Rocket.Chat** `client/sidebar/RoomList/MoreUnreadsBubble.tsx`（>50 未读折叠为一条气泡，commit 034260f）；**Mattermost** `channels/src/components/sidebar/sidebar_category/`（分类聚合） | 未读语义=kiss 既有 status-map 纯函数（会话计/项目聚合/Agent 待看），只随 IM 界面换呈现位置（同事行/项目卡/详情对话行）；一行内未看较多时用折叠气泡不逐行标数；"正在生成…"复用 IM typing 的呈现位（头像绿点+行内动画） | **不做已读回执**（三家开源均无此语义）；不借 Zulip 的 mute/pointer（P1 评估后再议） |
| 项目空间与任务卡 | **飞书** 群空间/任务卡/工作台（C 级观察，乌OS 无群聊直聊实体）；任务 0003 `02-design.md` 全映射；开源 IM 均无"群=项目"（结构上无参考，借飞书形态） | 项目详情页=进行中任务卡（名称+类型徽标+负责同事+进度）+近期对话+参与同事+空态引导；任务条在聊天 header 常显；新建项目后落详情页带两步引导 | 不学开源 IM 的项目概念（无强概念可借）；不造"项目群聊天"假实体（Session∈Agent×Project 数据模型不变） |
| **shadcn/ui Sidebar**（审美基线；`https://ui.shadcn.com/r/styles/new-york-v4/sidebar.json` 取到源码，2026-10-31） | **一级/二级导航（层次面板）的观感基线**：分组怎么表达、状态怎么给、密度怎么分级 | 导航自有 token 家族（`--sidebar-background/foreground/accent/border/ring`，light 值见 §5.4.2 对照）；分组标签 `h-8 text-xs font-medium text-sidebar-foreground/70`（`:408`，alpha 前景，**静息无 ring**）；行 `rounded-md p-2 gap-2` + `shadow-[0_0_0_1px var(--sidebar-border)]` → **hover 只换描边色**（`:483`）；子列表 `mx-3.5 border-l border-sidebar-border px-2.5 py-0.5` + `translate-x-px`/子项 `-translate-x-px`（`:646/:689`，1px 光学补偿）；密度分级 h-8 / p-2 / h-7 | 无（组件库） | 读源码取"角色层 token + 状态词汇 + 密度分级"，落到我们的 `--color-nav-*` 与 `Row/GroupHeader` primitive | 它的 React/Radix 组件结构与 Tailwind 类名；不复制其皮肤值 |
| **Radix Themes**（审美基线；`@radix-ui/themes@3.3.0` 已取到发布包） | 颜色阶与 alpha 机制的"权威做法" | 12 步中性（`gray-1..12` + `gray-a1..a12`）+ 9 步主色（`indigo-1..9`）+ 语义层（`--color-panel-solid/translucent`、`--color-surface: rgba(255,255,255,.85)`）；组件里悬停用 `--gray-a3`（57 处）、卡片描边 `--gray-a3/a6`（`components.css:1932-1967`） | 无 | 借"阶 + 角色层 + alpha"机制，替掉我们手挑的 4 个中性 hex | 它的整体观感（中性克制，不是我们的 IM 气质）；不引入它的组件实现 |
| **LobeChat `@lobehub/ui@6.10.2`**（审美基线，IM 气质） | 对话类产品的观感 + 主题派生 | 用 `chroma-js` 从品牌色推导整套色；含 `Tree`/`ChatHeader` 等 IM 组件 | 无 | "主题模式"的实现路数：一套 token，多套色阶 | 它的业务组件与图标集 |

### 0.1 参考分两栏（2026-10-31 用户裁决，案例 C155）

**"参考某个项目"必须先说明借哪一栏。** 两栏不能混：混了就会把丑产品的装饰件抄进来（已发生：P-02 照抄 Zulip 括线）。

| 栏 | 允许借 | 本项目名单 |
|---|---|---|
| **机制参考**（观感反例，只借机制/算法/结构） | 缩进 = disclosure 列宽、描边用 alpha、弱填充 + 描边做状态、折叠状态存数组、深色用公式派生 | **Zulip** @`3e9bc1e`、**Mattermost** @`8b2fb370`、**Rocket.Chat** @`034260e` |
| **审美基线**（必须好看且可核） | 表面分层、中性色相与阶、状态词汇、密度分级、光学补偿、主题派生 | **shadcn/ui Sidebar**、**Radix Themes**、**LobeChat `@lobehub/ui`** |

取不到源码的（Linear/Arc/Notion/Vercel Geist）**只能当 C 级气质参考**：存图、比气质，不写条文、不当基线。

## 对话区升级：社媒式身份 + 过程折叠（2026-11-02 补，Task 0014）

> 用户提供的素材：`frontend/resources/` 12 张 webp（SaaS 仪表盘 / IM / 落地页混合）+ 2 张 GitHub Copilot 会话截图（`Snipaste_2026-11-01_22-01-36.png` / `22-05-25.png`）。
> **素材索引与读取规则**：每张图的内容/布局/风格/可借/不可借、以及“先读索引→联系表→单张缩略→原图”的四级阶梯（实测全量读原图 ≈ 33,700 图像 token，看联系表 ≈ 3,500，只读文字索引 = 0）见 `frontend/resources/AGENTS.md`。**要翻参考图先读那份，不要直接读图。**
> **关键结论：14 张里只有那 2 张 Copilot 截图含"Agent 干活过程怎么折叠"的信息**，其余是版式气质参考。

| 场景 | 参照点 | 为什么这样设计 | 好处 | 适用条件与代价 | Life OS 现状 | 倾向 |
|---|---|---|---|---|---|---|
| **过程折叠的形态** | **GitHub Copilot 会话**（用户 11-01 22:01/22:05 截图，C 级观察）：工具调用渲染成一行行 `🔧 View ThemeToggle.tsx` / `>_ Run the focused Theme…`，无边框无底色，末尾极小的 `5s` | 一轮里工具调用可能几十条，逐条展开会淹没正文；但用户又要能确认"它到底干了什么" | 过程默认让位给结论，一行即可扫过；要看细节再展开 | 代价：丢失"每条工具输出"的即时可读性——对调试场景不够；适用前提是**过程可点开** | 单轮工具数可达 **194 次**（实测 01a14774），远多于 Copilot 的个位/十位 | **只借"轻量单行"这个形**；不逐条列工具（194 行等于没折叠）；不做摘要 |
| **过程条只给统计，不做摘要** | **无参考可借**（Copilot 给 `5s` 是一致思路，但它不汇总次数）；用户 2026-11-02 直接裁决 | 摘要要额外调一次模型：多花钱、多等一轮，还会引入"这段过程说了什么"的第二套事实 | 零额外成本、纯可数事实、永不与完整过程矛盾 | 代价：用户看不到"干了什么的概括"——但那本就该点开看 | 已有 `durationMs` / `usage` 字段，无需新增数据 | **采用**（自研）。工具次数 · 时长 · token，三项都可缺省 |
| **折叠粒度 = 一轮** | **无参考可借**；依据是自有数据 | 每轮 assistant 消息数中位 6、平均 12.7、**最大 198**；按"一条消息"折会碎成上百块 | 一轮 = 用户一句 → Agent 停，符合"一问一答"的心理模型 | 代价：轮内所有中间过渡语一并被收起（那正是想要的） | `groupIntoSpans()` 按用户消息边界切轮 | **采用**（自研） |
| **折叠后留哪段正文** | 沿用 `chat.md §3.3` 既有语义：最终回答取**最后一段** text | 中间段的 text 是过程独白（"我先看一下…"），不是给用户的回答 | 结论始终在折叠区外面，一眼可读 | — | 现有渲染顺序即可 | **采用**（复用既有规则，不新立） |
| **参与者表达（会话列表 / 头部 / 消息行）** | **Codomo 看板**（`original-f5768864…webp`：header 右侧叠放头像 + `+8` + `Add assign`；任务卡底叠放小头像）、**Design You**（`original-27f477cc…webp`：`Internal Teams` 头像组 + `+N`、卡内 `CI: COO` 名字:身份标签）、**GitHub Copilot**（`Snipaste_2026-11-01_22-05-25.png`：参与者块 = 头像 + 名字 + 时间 + 动作条） | 一屏要区分多个说话人（用户 / Agent / 未来的多 Agent）；"一组参与者"用叠放 + 计数，单人用头像+名字+时间 | 叠放省空间、`+N` 可扩展；参与者块自带身份时，多方同屏不塌 | 代价：叠放的头像太小（16–24）无法点开；名字在窄列里放不下 | 会话列表 272→300 宽；已有 `AgentAvatar`/`UserAvatar` 与 24/20/16 尺寸档 | **采用**（Task 0015 · T17）：列表行叠放（Agent↔Agent）或单头像（用户↔Agent）；头部 chip 串；消息行单头像。**没找到**"Agent↔Agent 多会话列表"的先例（14 张全是人↔人协作），列表行的具体形状是"叠放机制 + 本节字级"推导的，**待实现后复核** |
| **头像 + 名字 + 时间 + 左右分侧** | **Grok Bot 群聊**（`reference-baseline` §2 既有行）、**Telegram/Instagram/微信**（用户口述："像微信，发起方始终在右"） | 一屏要区分多个说话人（用户 / Agent / 未来群聊的多个 Agent） | 谁说的、什么时候说的，扫一眼即得 | 代价：每条消息多一行头部，垂直空间变密 | 现有 `AgentAvatar` + `align` 参数已具备；缺"用户"这个身份 | **采用**；用户侧头像 = 本人（`/api/profile`），**不引入"用户 Agent"实体** |
| **两条会话区滑块（宽度 / 字号）** | **Obsidian 专注模式**（用户指定，C 级观察：正文居中约 1/3 屏，其余留白） | 长文阅读需要窄列；代码/表格需要宽列；同一个人不同任务需求不同 | 一套界面覆盖两种极端，不用做两套 | 代价：滑块本身要占一个入口；宽度参与列宽预算（我们的 `layout.ts` 已有唯一出口） | 原先 `--container-reading: 860px` 硬编码 | **采用**：专注（视口 1/3，地板 360）→ 视口宽 → 铺满；字号 85%–200% 整组等比 |
| **头像随字号缩放** | 用户 2026-11-02 现场发现："纯字号变大了而头像没跟着一起变，就有点畸形" | 头像是文字行的视觉锚点，比例失衡会被一眼看出 | 大字号下排版仍然协调 | 代价：头像最大 1.6×（防止在 200% 时吃掉正文宽度） | `AgentAvatar` 接 `size` 参数，已支持 | **采用**（自研规则：随放大、不随缩小、双向封顶） |
| **用户气泡的最大宽度**（Task 0004） | **Open WebUI** `src/lib/components/chat/Messages/UserMessage.svelte:431`（`max-w-[90%]`；repo `open-webui/open-webui`、`main`、`33c1978d5bad52a31df75ea55143025dfad18d16`、2026-10-25）；**Vercel ai-chatbot** `components/chat/message.tsx:180`（`w-fit max-w-[min(80%,56ch)]`；repo `vercel/ai-chatbot`、`main`、`c2f8235e1f3ea903ad8b7f61447c4f74164b5c58`、2026-07-08）；助手侧无上限的旁证：Open WebUI `ResponseMessage.svelte:709`（`flex-auto w-0`，没有 max-w，跟随列宽） | 气泡跟文字长短自适应，但需要一个上限；上限用**比例**跟容器、用 **ch** 跟字号，才能在宽屏 / 窄屏 / 大字号三种变化下都不难看 | 比例上限防止窄列被撑破；ch 上限防止宽列一行 100+ 汉字。Open WebUI 只有 90%（无 ch，铺满模式下列 1924 时气泡可到 1731）；Vercel 只有 80%+56ch（比例更紧）；两家都没有用一个数覆盖两种边界 | 我们的列宽本身就是相对量（滑块 → `--container-reading-width`），两个相对量叠加不需要任何像素字面量；助手侧我们统一列宽（与 Vercel 一致） | 原先 `--container-bubble: 720px` 写死；用户 2026-11-02：「按屏幕比例，而不是固定数值」 | **采用 `min(90%, 56ch)`**（两家各取一段：90% 抄 Open WebUI、56ch 抄 Vercel）；**不借** Vercel 的 80%（更紧，且我们已有 56ch 约束行长） |

**没借的部分与理由**

| 看到的 | 不借 | 理由 |
|---|---|---|
| Copilot 逐条列每个工具调用 | 不借 | 我们的单轮工具数可达 194；逐条列等于没折叠 |
| SaaS 仪表盘那 8 张（01/02/03/05/07/08/12 等） | 不借 | 信息密度靠"卡片 + 满屏边框"堆出来，与 `frontend-spec` §2「靠背景差 + alpha 描边分层」直接冲突 |
| 所有参考图的品牌色 / 图标集 / 插画 / 字体 | 不借 | 数值只来自 `tokens.css`；视觉角色映射到 token，不搬品牌色（`process.md` Step 2 硬规则） |
| 社媒式的"已读回执""在线状态" | 不借 | 单人系统无此语义（同 §2 既有结论） |

**复核触发**：出现**群聊**（多个 Agent 同屏）→ 分侧规则要重评（"只有自己发的话在右"该扩展到"每个 Agent 一个固定侧"）；出现 **Agent 间对话的 drawer** → 过程折叠要确认是否两处共用（当前共用 `MessageView`）；单轮工具数分布变化（例如以后普遍 < 10）→ "不逐条列工具"这个结论要重评。
