# 主工作区页面设计（Agent × 项目 × 会话）

> 角色：设计　类型：页面设计　状态：实施中
>
> 统一规范见 `.lifeos/projects/lifeos/specs/frontend-development/frontend-spec.md`；需求见 `.lifeos/projects/lifeos/knowledge/requirements/conversation.md`，架构见 `.lifeos/projects/lifeos/knowledge/architecture/conversation.md`；本页只写本页的数据、关系、交互、状态。
> 页面入口：打开 Life OS 根路径即进入；无独立路由，主页面由 `frontend/src/App.tsx` 挂载。

## 0 背景

- **页面**：主工作区（Life OS 的默认页面）。
- **结构**：左侧三列级联（Agent → Project → Session）＋ 中间聊天 ＋ 右侧面板（文件浏览器 / 完整历史，互斥）。
- **代码**：`frontend/src/App.tsx`、`frontend/src/design/layout.ts`、`frontend/src/SessionHistory.tsx`、`frontend/src/FilePanel.tsx`。
- **使用方**：用户与当前 Agent 对话、切换项目、管理会话、查看文件与完整历史。
- **为什么需要**：这是 Life OS 的主界面；所有 Agent/项目/会话/消息关系都在这里被看见和操作。

## 1 数据

| 实体 | 字段 | 来源 | 说明 |
|---|---|---|---|
| Agent | `id`、`name`、`description`、`avatar`、`defaultProjectId`、`defaultSessionId` | `GET /api/agents` / agent.json | 左列枚举 |
| Project | 全局 `id`、`name`、`path`；绑定目录 | 项目绑定接口 / `project.json` | 第二列；同一项目可被多个 Agent 绑定 |
| Session | `id`、`name`、`updatedAt`、`running` | `GET /api/agents/:id/sessions` | 第三列 |
| Message | `role`、`blocks`（text / thinking / toolCall）、`stopReason`、`errorMessage` | 会话 JSONL / `GET …/entries` | 聊天区与历史 |
| Tool result | `toolCallId`、`isError`、结果正文、耗时 | 会话 JSONL | 挂回对应调用，不按顺序猜 |

- 消息与会话文件是事实源；前端不把本地状态当权威。
- 完整历史的 system 分区来自 Pi 的补丁序列，归属/拼装说明由 `frontend/src/prompt-regions.ts` 提供。

## 2 关系与表达

| 关系 | 基数 | 表达 |
|---|---|---|
| Agent → Project | 1:N（当前 Agent 视角；全局是 N:M） | 第 1 列选 Agent，第 2 列列出它的项目；行内显示会话计数 |
| Agent × Project → Session | 1:N | 第 2 列选 Project，第 3 列列出该 Agent 在该项目下的会话；行内显示相对时间/运行点 |
| Session → Message | 1:N | 主区聊天；消息按时间/内容块渲染 |
| Message → block | 1:N | 文本 / 思考 / 工具调用按 `contentIndex` 有序归并 |
| Session → 完整历史 | 1:1 | 右侧面板按“回合 → 请求/回复”展开 |

- **三列级联**：点上一级，下游整列切换；列之间独立，不互斥收起。
- **默认**只存在于数据层（`defaultProjectId` / `defaultSessionId`），界面不放“默认”徽标；避免与“运行中”绿点语义冲突。
- 项目行只写目录名；会话计数在行内固定槽位；列头不重复行内数据。
- 空态统一 `EmptyState`：图标 + 一句解释 + 主操作。

## 3 用户任务与交互

### 3.1 选择与下钻

- 选 Agent → 自动定位默认/最近 Project → 最近 Session；断开并重订该 Agent 的 SSE（重连即重新快照，不带游标）。
- 选 Project → 切换该项目的会话列；选 Session → 载入消息。
- 点当前已展开的列图标 = 收起；点其它列图标 = 展开；展开前若右侧面板开着，先关它。

### 3.2 会话与项目

- 新建会话（底部“＋新建会话”）；无会话时输入框仍可用，首条消息 = 建会话 + 发送。
- 重命名（`session_info`）、删除（确认；删当前会话则定位最近）；运行中删除 409。
- 项目从该 Agent 移除：行内 hover 操作；不移除目录/会话/manifest；默认项目不可移除。

### 3.3 发送与一轮对话

**大步骤固定 4 个（m=4，由我们的状态机定义；工具调用不算步骤）：**

| n/4 | 步骤 | 进入条件 | 子状态（不改变 n/4） |
|---|---|---|---|
| 1/4 | 发送消息 | 用户按发送 | — |
| 2/4 | 受理请求 | 后端 202 / 建会话成功 | — |
| 3/4 | 模型处理 | 受理后开始跑 | 等待模型响应、思考中、执行工具、输出中、重试中 |
| 4/4 | 完成 | done / error / aborted | 完成 / 失败原因 / 已中断 |

- 不从“等待模型”开始，第一步是用户发送；
- 工具调用只改 3/4 的子状态，不增加步骤；
- 4/4 是终止态：工作指示行不再保留，用一行完成状态（`4/4 · 完成 · Xs`）收尾；最终回复是完成结果。

- 发送即进入回复侧；用户消息在右侧，进度/失败在左侧。
- 生成中 Enter = Pi 原生 `steer` 插话（后端同时支持 `followUp`，但当前 UI 不绑定排队列表，不把它写成“排队”）；全局 Esc = 打断（组字中除外）；空会话输入框不禁用。
- 失败归属按步骤显示：发送失败 / 建会话失败 / 受理后中断 / 模型失败（连接·超时·鉴权·限流·5xx·空）/ 工具出错·无结果 / 中断·截断。
- 一轮可有多条 assistant message（工具调用前后各一段）；段内按 `contentIndex`、段间按顺序，旧段思考不跟着整轮转圈；工具执行中由 `tool_execution_start/update/end` 驱动；最终回答取最后一段 text。
- 消息动作条挂在被作用的对象上：复制/重发在用户消息；进度/失败说明在左侧本轮槽。悬停出现，触屏常显，反馈期间保持。

### 3.4 右侧面板

- 文件面板与完整历史互斥；打开一个自动关另一个。
- 面板可拖宽（左缘把手，右拉变小），宽度持久化；放不下就明确降级，不静默吞点击。
- 完整历史：回合 → 请求/回复；请求侧 system 分区标“本次变更/沿用上一轮”；回复侧工具结果按 `toolCallId` 配对；Esc 关闭。

### 3.5 输入框（模型 A：单容器 composer）

用户 2026-10-22 选择模型 A；参考证据见 `reference-baseline.md` 的“输入框对象结构”行。

- **区域**：一个 composer 容器包含两层：
  1. 上层槽：`/` 调色板，以及未来排队/通知横幅（当前没有排队 UI）；
  2. 下层槽：textarea + 发送/停止按钮。
  容器持有唯一的 focus ring；调色板不做成与输入框无关的独立浮层。
- **键盘**：Enter 发送、Shift+Enter 换行、IME 组字及 100ms 宽限；调色板打开时 ↑/↓ 选择、Enter 执行、Esc 关闭；空输入 ↑/↓ 浏览本进程输入历史；生成中全局 Esc 打断（组字中除外）。
- **生成中**：Enter 走 Pi 原生 `steer` 插话；API 也支持 `followUp`/排队，但当前 UI 不显示队列，页面文档不能把该行为写成“排队”。
- **高度**：自动 1–8 行，超过后内部滚动。
- **草稿**：按会话（或待建会话的 Agent+项目）归属；发送失败回填，不静默丢弃。
- **可访问**：textarea 必须有 `aria-label="输入消息"`；placeholder 不作为唯一可访问名；调色板行在手机 ≥44。
- **手机**：placeholder 只写“输入消息”，不塞键盘快捷键；composer 固定在键盘上方；调色板、发送/停止不 hover-only。
- **未来扩展**：排队、通知横幅必须进同一 composer 容器，不散落到 header 或状态条。

## 4 布局

| 区域 | 形式 | 约束 |
|---|---|---|
| 整体骨架 | 三列级联 + 聊天 + 右侧面板 | 列宽由 `layout.ts` 计算，组件不重算 |
| 列折叠 | 完全独立；收起进全局 44px 导航轨（常数与实现见 `specs/frontend-development/frontend-spec.md` §3） | 并列折叠仍保聊天宽度 |
| 列拖宽 | 列间 1px 分隔线拖动 | 夹紧区间；宽度 localStorage；方向按把手位置 |
| 左侧图标轨 | 常驻 44px（全局规则见 `specs/frontend-development/frontend-spec.md` §3），高亮 = 该列展开 | 不做 hover 自动展开；不做多列互斥 |
| 主区头部 | 44px：标题 + 头部状态条（header strip）+ 文件面板开关 | **头部状态条是分段容器**（Task 0002，2026-10-24）：`frontend/src/header-strip.ts` 的 `buildHeaderSegments()` 纯函数产出段（`agent/project/model/thinking/task`）后 `join(" · ")`，整体 truncate；增删调段 = 增删数组项，将来点击切换 = 给对应段挂 action（容器不改）；模型段没 `/model` 覆盖 → 有效默认（Agent 配置/系统/清单第一项），覆盖过 → 会话模型；无会话也显示有效默认；thinking 段显示会话生效档位本身（如 `high`，无"思考"二字）；task 段显示「ID 标题」（无 Task 前缀，标题来自项目任务清单，缺失时只 ID）；**无会话时显示项目默认 Task**（`0001 默认`，因为新建会话必然绑到它），有会话时只显示该会话的 Task、会话没有 Task 时不拿默认顶替（`header-strip.ts` 的 `headerTaskOf`） | 不放大徽标/计数；不为空白；长内容由容器统一截断 |
| 固定状态条 | 消息滚动区外、输入框上方；左边 4 步/阶段/耗时数字，右边 `⚡速度 · ↑输入 ↓输出 ◔上下文`（均有 tooltip） | 不随消息滚；不写“本轮”前缀；符号必须有 tooltip |
| 输入框 | 单容器 composer（见 §3.5）；草稿按会话归属；Enter 发送/插话；输入法组字不发送 | 发送失败回填草稿；`submittingRef` 防重复 |
| 消息区 | 阅读列居中；用户深色气泡，助手贴白底；思考/工具/成功/失败用不同 token 背景 | 禁 HTML 透传；思考/工具可折叠；每个块带 `data-message-kind` |
| 右侧面板 | 默认 440 / 最小 360；与文件面板互斥 | 宽预算同一套；窄窗降级 |

- 窄窗口：左三列转浮层抽屉，聊天只让出图标轨宽度；点遮罩收起全部。
- 列头只写列名；计数/时间/运行点在行内只出现一次。

## 4.1 移动端

完整规则见 [`mobile.md`](../../specs/frontend-mobile/mobile.md)，本页只写差异：

- 手机（<640）只保留**单主列**消息 + composer + 状态条；不并排三列。
- 会话页 header 左侧是**返回项目**：打开导航并停在项目级；无会话时才是“打开导航”（助手级）。
- 导航页：助手 → 项目 → 会话；选助手/项目只进下一级，选会话才关闭；系统返回/右边缘向左滑一次退一层。
- header/status/composer 固定，只有消息区滚动；`visualViewport` 处理键盘；顶部/底部安全区由 `pt-safe`/`pb-safe` 处理。
- 离开底部时消息区显示“回到底部”箭头，点击回到最新并恢复跟随。
- 状态条保留步骤/耗时；tokens/context 用紧凑指标 + 图例按钮，空间不足时收起次要项。
- 导航/列表行、操作按钮触控目标 ≥44；hover-only 动作在触屏常显（文件页签关闭必须常显）。
- 完整历史/文件面板全屏，header 有返回/关闭且按钮在视口内；焦点陷阱/Esc/滚动锁与配置 sheet 共用。

## 5 状态

| 对象 | 加载 | 空 | 错误 | 进行中 |
|---|---|---|---|---|
| Agent 列 | Skeleton | 无 Agent（不应发生） | 重载提示 | — |
| Project 列 | Skeleton/行内 | “还没有项目”空态提示 | 错误提示 | — |
| Session 列 | Skeleton | EmptyState + 新建 | 错误提示 | 运行点 |
| 聊天 | 载入消息 | 空会话提示“直接输入并发送” | 失败归因 + 原始错误 | 固定状态条：4 步/计时/重试 |
| 历史 | 载入 rounds | “暂无完整历史” | 错误提示 | — |

- 发送/受理/模型/工具/收尾的失败归属见 `§3.3`；判定“丢了”前先确认 `meta.running`。
- 保存类状态（重命名/删除/移除项目）必须有进行中/成功/失败反馈。

## 6 范围外

- 跨 Agent 运行状态聚合（只订阅当前 Agent 的流）。
- harness 数据/系统配置界面（等对应接口）。
- 会话分页/搜索（量大时再做）。
- 跨 Agent 共享项目资源的完整管理（项目身份已全局，共享资产未做；见 `.lifeos/projects/lifeos/todo/todo.md`）。

## 7 设计验收

- 三列级联选中态正确，切 Agent 后下游列重置到默认/最近；URL `?project=` 深链接不被“上次会话”顶掉。
- 列收起/展开成本恒为 44px；拖宽方向正确；刷新后宽度保持；窄窗不压破聊天。
- 发送即出现左侧本轮槽；失败在左侧归属到具体步骤；用户消息动作条只在悬停/触屏/反馈期可见。
- 无会话时修改 Agent 默认模型，头部 meta 立即显示新模型；有会话时：没 `/model` 覆盖 → 跟随有效默认并随 Agent 配置更新；用过 `/model` → 始终显示覆盖模型，之后改默认也不变。
- 空会话输入框可用；首条消息自动建会话；输入法组字中的 Enter 不发送。
- 右侧面板互斥；完整历史工具结果按 `toolCallId` 配对，不出现“永远执行中”。
- 手机：会话页可见“返回项目”；导航选会话关闭；系统返回逐级退；离开底部出现回到底部箭头，点击后恢复跟随。
- 输入框：composer 只有一个 focus ring；调色板/未来横幅在容器内；textarea 有可访问名；自动 1–8 行；空输入 ↑/↓ 能取回本进程输入历史；手机 placeholder 只有“输入消息”，调色板行 ≥44。
