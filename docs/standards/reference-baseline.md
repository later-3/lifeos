# 参考基线（开发 Life OS 时"照谁做"的收敛定义）

> 角色：开发规范　类型：决策　状态：现状
>
> **为什么要有这份文档**：只说"行业惯例"会四不像——每个项目的机制与命名都不一样。
> 所以本仓库**只认下面列出的参照点**：每个参照点必须写明「**场景 → 具体项目 → 具体文件/机制 → 借什么、不借什么**」。
> 没写进来的，不许用"行业惯例/业界标准"当依据（要么补一行，要么先讨论）。

## 1. 主参照：Pi 生态（Life OS 建在 Pi 之上，能抄就抄）

| 场景 | 参照点（具体文件/机制） | 借什么 | 不借什么 |
|---|---|---|---|
| 资产打包与安装 | Pi `docs/packages.md`：`package.json` 的 `pi` 字段显式声明 + 约定目录；`pi install` 写声明到 `settings.json`；`pi update --extensions` 幂等 reconcile；本地路径装载不复制 | "声明 + 幂等 reconcile + 冲突保留先发现者并告警"的形态 | 不为 Life OS 另造一套包管理器 |
| 会话文件里 system 提示的 `sections` 语义 | Pi `system-prompt.ts`：`buildSystemPromptSections`（全量）与 `diffSystemPromptSections`（**只落变化的区，删除记 null**）；落盘的是补丁 | "补丁按序列累加 = 该轮真正生效的完整分区"这一还原方式；据此标注"本次变更 / 沿用上一轮" | 不借"把补丁当全量"的读法（面板第一版就是这样，第 2 轮只显示 2 个区，看起来像少了 5 个区） |
| 左侧图标轨与列收展 | VS Code Activity Bar（`src/vs/workbench/browser/parts/activitybar/activitybarPart.ts` + 官方交互：**点当前图标收起侧栏、图标条常驻**）；Pi Web `components/AppShell.tsx`（`useIsMobile()` → overlay 抽屉） | 图标轨常驻、**高亮 = 该面板打开**、点当前项收起、**不按窗口宽度替用户收列**；窄窗口用浮层抽屉保住内容区（不让内容被压扁，也不出现"点了没反应"） | 不借 VS Code 的视图容器/拖拽体系；不做 hover 自动展开；不做多列互斥（用户要求各自独立） |
| 会话区"正在工作"与过程流式 | Pi Web `components/ChatWindow.tsx`（`streamState` / `agentPhase` / `phaseLabel`）、`components/MessageView.tsx`（`ThinkingBlock` / `ToolCallBlock`）；Pi SDK 事件 `message_update.assistantMessageEvent`（thinking/text/toolcall）与 `tool_execution_start/update/end` | 事件流驱动会话区：阶段文案（等模型 / 思考 / 执行工具）+ 思考与工具块内联出现、按 `contentIndex` 定序、跑完带耗时与结果；"没内容时显示阶段、有内容后显示块"的取舍 | 不借 Pi Web 的 CSS 变量体系与 i18n；不借它的 thinking 延迟加载接口（我们的历史走 `…/entries`）；不另发明事件名——沿用 Pi 的事件名 |
| 空项目 / 新 Agent 的首次发送 | Pi Web `components/AppShell.tsx` 的 `newSessionCwd` + `newSessionDraftKey`（无会话时输入框可用、草稿挂在"待建会话"上，首条消息落地时才真正建会话）；ChatGPT / Claude 等同类产品一致（没有"先建会话"这一步） | 输入框不以"没有会话"为禁用条件；草稿按 agent+project 归属；发送时先建会话再发，URL/会话列自动补上 | 不借 Pi Web 的 draft 路由与恢复细节（我们按 URL 三键 + localStorage 草稿）|
| 模态/对话框的焦点与键盘 | Pi Web `components/DirectoryPicker.tsx`（`autoFocus` 放在路径输入框）+ 其焦点陷阱只在 Tab 上做（`MobileDeviceSwitcher.tsx`）；React 官方 `autoFocus` 语义 | 对话框打开时**显式指定初始焦点**（`initialFocus`，调用方给 ref）；焦点陷阱/`Escape` 逻辑**只在挂载时建立**（onClose 走 ref），不在每次渲染重设焦点 | 不自己写"每次渲染重设焦点"的陷阱（曾把焦点拽回关闭按钮，输入框收不到按键）；不引入焦点管理库（2 处需求不值得）|
| 会话运行控制与输入（打断/插话/排队/压缩/斜杠命令） | Pi Web `components/ChatInput.tsx`（`onAbort` 在 Esc 触发、`onSteer`/`onFollowUp` 两个分支、`BUILTIN_SLASH_COMMANDS` 面板）与 Pi `AgentSession` 的公开方法（`abort/steer/followUp/compact/setModel/setThinkingLevel`）；Pi CLI `src/modes/interactive/interactive-mode.ts` 的命令清单 | 打断=Esc/停止按钮、生成中 Enter=steer、斜杠命令面板、↑/↓ 历史；**全部直接调 Pi 原生方法**，不自造队列 | 不借 Pi Web 的 i18n/CSS 体系；不借它「流式时隐藏内置命令」的取舍（我们的命令在非流式也可见） |
| 失败与重试的可见性（超时/重试/失败原因） | Pi 事件 `auto_retry_start` / `auto_retry_end`（`attempt/maxAttempts/delayMs/errorMessage`）与 assistant 消息的 `stopReason=error` + `errorMessage`；Pi CLI 在流式区显示重试与错误 | 工作指示行显示「第几次/共几次 + 原因」，失败气泡显示原因并给「重新发送」 | 重试次数与退避用 Pi 的策略，不自己调 |
| 代码检视与缺陷分级（四类检视 / 缺陷-质量-架构三分 / 交互交付四问） | Pi `CONTRIBUTING.md`（"You must understand your code"）+ `pi/AGENTS.md` 的 Code Quality 条目（不用 `any`、不内联 import、改前读全文）；pi-web `design-qa.md`（对照目标、像素尺寸、交互断言、findings）；vercel/ai-chatbot 的目录分层（`components/ai-elements`、`hooks/`、`app/(chat)/api/*`） | 借：四类检视、三类结论分开处理、交互四问、证据清单、用门禁代替自觉 | 不借：Pi 的"core 最小化"取舍直接搬到产品；不借"把标杆项目的功能补齐"的思路 |
| 失败一轮的动作归属（"重新发送"挂哪） | Pi Web 把 retry/重试信息做成**输入框上方的横幅**（`ChatInput.tsx:1487`，运行中的 retrying n/m）+ 通知架（`ChatWindow.tsx:686`）；ChatGPT/Claude 的 "Regenerate" 挂在**助手回复**下（重新生成的是回复）；ai-chatbot `message-actions.tsx` 只放内容动作（复制/投票/编辑），流式中 `return null`；它的**容器/原子分层**（`components/ai-elements/message.tsx` 导出 `MessageActions` 容器 + `MessageAction` 原子，业务层只声明这两个原子）是我们动作条分层的参照 | 借：动作条里"流式中不出现"、容器/原子分层；**不借**它们的挂载位置——它们的动作是"重新生成回复"，我们的语义是**重发用户消息**（Pi 没有 regenerate API，只能再发一次），所以挂在**那条用户消息**的动作条里（`frontend/src/resend.ts` 决定挂哪条）；助手的失败原因留在助手消息 |
| 失败归因与工具状态（超时/连不上/鉴权/…；未完成 vs 执行中） | Pi `ai/src/types.ts` 的 `StopReason`（含 `aborted`/`length`）与 `ai/src/utils/retry.ts` 的可重试错误模式（network/connection/fetch failed/getaddrinfo/ENOTFOUND/timed out…）；Pi Web 用 retry 横幅表达"正在重试"，ai-chatbot 用 toast 表达错误 | 借 Pi 的错误语义与模式清单（不自己编网络错误串）；按种类给 Actionable 文案 + 原始错误小字；工具状态按"这一轮是否在跑"判定（`live`） | 不借"只有一句通用失败提示"；不借把错误只放 toast（会话里要留痕） |
| 消息动作条（统一悬停出现、复制/重发 + 反馈；容器 + 注册项） | Pi Web `components/MessageView.tsx`：底部右对齐动作行，`hovered` 控 `opacity`/`pointerEvents`（0.12s），`isMobile` 常显且 44px，复制后"已复制"1.5s，流式中（`isStreaming`）不给复制，只复制文本块；vercel/ai-chatbot `components/chat/message-actions.tsx` | 借：动作行位置与悬停显现（`opacity`+`pointerEvents`，不挤布局）、1.5s 反馈、流式不显示、只复制文本 | 不借：桌面 22px 命中区（我们门禁 ≥28px）、fork/编辑类动作（分支暂缓） |
| 任务编号与目录 | ADR 约定（`adr.github.io`：`docs/adr/0001-record-architecture-decisions.md`，四位编号 + 短标题）；我们的 `task-types/development/TEMPLATE.md` 文档骨架 | 四位编号前缀（按项目连续）+ 可读标题（允许中文）；一个任务一个目录、文档按类别必需 | 不借"一个决策一个文件"（我们是目录 + 多文档 + phases/units）|
| 文件面板的根目录历史 | VS Code「Open Recent」（打开过的文件夹按最近使用排序，MRU）；Pi Web `lib/project-groups.ts · getRecentProjects`（按最近活动排序去重，**不另存历史**） | 用**已有数据**当历史：根白名单 `config/file-roots.json` 按最近使用排序（家目录固定第一），切换即提权；界面用现有 Modal 列出来（不新增控件/存储） | 不新建"历史记录"存储、不做无限条目管理；不借 Pi Web 的项目分组逻辑（我们是文件根，不是会话项目）|
| 创建实体的唯一性（Agent） | Kubernetes `metadata.generateName`（名字 + 随机后缀，id 不承载语义）；声明式创建的 create-or-return（`kubectl apply` / Terraform 的 name 唯一键）；GitHub/Slack 改名不改 id | 非 ASCII 名得到不透明 id（`agent-3f9a`）；**创建按 name 幂等**（同名返回已有实体，`created:false`）；工具描述写明"id 生成后稳定，改名不变，不要归档重建" | 不引入 idempotency-key 机制（调用方是模型，按 name 幂等已足够）|
| 聊天输入框（Enter 发送 / 输入法组字 / 多行） | Pi Web `components/ChatInput.tsx`：`isComposingRef` + `nativeEvent.isComposing` + `keyCode === 229` + `compositionend` 后 `COMPOSITION_END_ENTER_GRACE_MS = 100` 宽限；Shift+Enter 换行 | 整套判定与宽限值；组字中把 Enter 让给输入法、组字刚结束吞掉那次冒泡 | 不借其自研 textarea / 自适应高度 / 移动端 Ctrl+Enter 快捷键（我们用原生 textarea + rows=1）|
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
3. 与 Pi 冲突时，**以 Pi 的公开接口与文档为准**；要偏离必须在本文件写明理由（并登记为决策）。
