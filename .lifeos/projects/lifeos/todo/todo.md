# 待实现（登记）

> 角色：需求登记　类型：清单　状态：现状（只登记，不实现）

规矩：一行一件事，写清**背景（现状）→ 是什么 → 要做什么**。实现之后删掉这行，把事实写进对应文档。

| # | 背景（现状） | 是什么 | 要做什么 |
|---|---|---|---|
| 1 | 全局项目身份、共享 workspace specs/记忆、项目共享 specs 已实现；**跨 Agent 共用的模板/资产同步**仍未做（只做了四层模板选择入口） | **Life OS 支持多 Agent 共用项目信息或者项目资源** | 设计共享资产层（同一全局项目下多 Agent 复用的模板/资源），再实现 |
| 2 | 已支持创建与归档（工具 + HTTP + 行内删除入口）；归档目前只能手动恢复 | 归档助手的恢复入口（HTTP/UI）与启用/停用语义 | 先定恢复动作、以及「停用」与「归档」的区别，再实现 |
| 3 | 注入是固定分区（方案 E，`src/assembly.ts`）；交互 harness 协议正文常驻，规范/Task 按作用域加载；**区域声明表**仍靠代码顺序 | Prompt 通用机制：区域声明与注册、常在/按需判据、请求边界门禁 | 设计区域注册表；把可变的 harness 资料继续改成索引 + 按需读取 |
| 4 | P1 + P2 已实现（四 store / 读写 / 硬删除 / 3 个工具 / 规则并入协议 §3.11），**待审阅**；不做面板 | **记忆体系**：剩余可选能力（导出/备份、审计；自动捕获不做） | 待文档与实现审阅；有需要再做导出/审计 |
| 5 | 已实现用户下达任务（`lifeos_task_create` / `lifeos_task_list`、编号 `NNNN-标题`、A/B/C 三类文档骨架） | Agent 定时任务（第二类）：启用/暂停/取消、运行历史、触发机制 | 先定调度与运行记录结构，再实现 |
| 6 | 只有 Web 前端走 HTTP/SSE | 多客户端（TUI / 桌面 / 手机） | 需要时再设计（含接口版本化） |
| 7 | 会话运行控制已对齐（打断/steer/followUp/压缩/切模型/思考级别/斜杠命令/历史） | 剩余 Pi 能力：`@` 文件提及、`/import` `/share`、`/login` `/logout` `/trust` `/settings`（`/fork` `/tree` `/clone` 单列到 #10） | 按使用频率分批接 |
| 8 | 手机竖屏已按 `mobile.md` 适配；横屏宽度 ≥640 当前仍走桌面/平板布局，没有独立手机横屏/平板布局 | 手机横屏/平板适配 | 先定断点与表面模型，再扩展 `useIsMobile`/触控尺寸/布局；不要只改断点 |
| 10 | Pi CLI/SDK 已有 `/fork`（从历史用户消息新建会话）、`/clone`（复制当前分支到新会话）、`/tree`（同会话文件内切换分支）、`--fork`、RPC `fork/clone/get_tree`、`SessionManager.getTree/createBranchedSession/forkFrom`；fork/clone 的 session header 有 `parentSession`，条目有 `id/parentId`。Life OS 的 `listSessions` 只读 session id/标题/时间，`SessionItem` 没有 parent；前端没有 fork/tree/clone 命令与任何关系展示。**8 个本地会话当前都没有 `parentSession`**（因为还没从 Web 建过 fork） | **Fork/clone/tree 的会话谱系与前端展示** | 先定产品语义：`/tree` 是同会话文件内分支，`/fork`/`/clone` 是新会话文件；再定列表展示（父会话 badge/缩进树/仅 header 链接）、fork 动作挂哪（历史用户消息/会话菜单）、新 fork 是否自动切换；后端解析 `parentSession` + 暴露 tree，前端只展示已确认关系；不要把 subagent 或群聊当成 fork |
| 11 | Prompt 目前只按层级组装，组装后不能编辑 | **Prompt 编辑**：组装后修改/删除/新增 section/内容 | 先设计编辑边界、持久化与回滚，再实现；当前不做 |

| 12 | 用户已讨论（2026-10-24）：像手机弹通知一样的网页通知功能 可顺手做，不要与呈现层强绑定——先在第一包落"运行事实 store"（run/未读/队列的唯一事实源），通知只是它的一个订阅者（Web Notification API + Permission + 可选 push） | 网页通知（Web Notification） | 等用户挖坑时再立 task；本条是待办登记 |
| 13 | 任务 0007 已做**页面打开时**的后台完成提示（全局事件流 + 焦点路由 + 服务端未读）；页面关闭/标签页后台时没有系统级通知 | 网页推送通知（Web Push：VAPID 密钥 + Service Worker 订阅，参考pi-web `upstream/main e533d9b` 的 `lib/web-push.ts` / `lib/rpc-manager.ts:2742`） | 设计订阅存储与密钥轮换；完成事件复用 `session-views` 的完成事实，不另起通道；手机端 PWA 场景优先 |
| 14 | 图片输入已实现（`knowledge/design/image-input.md`）；门控读 `models.json` 的 `input` 声明。**实测（2026-10-25）**：默认模型 `command/z-ai/glm-5.3-flash` 对纯色图 5 次中 4 次答对，但同一张蓝图先后答"白色/蓝色/红色"——声明对、能力不稳 | 模型看图能力的**实测记录**（声明 ≠ 稳定性） | 对每个候选模型跑纯色/文字截图小样本（≥5 次），把结果记成可用性等级，并在界面提示"该模型看图可能不准"；不要只依赖手写 `input` 声明 |
| 15 | 现有前端 `--color-hover` 为 `#f1f1f3`，而列表副行用 `ink-500`（`#71717a`）→ 悬停态对比度 4.28 < AA 4.5（2026-10-28 实测，见 `knowledge/design/im/design-language.md` §3.1）；IM 版已改用 `#f7f7f9`（4.52） | 悬停态文字对比度不足 | 落码 IM 版时改 `frontend/src/design/tokens.css` 的 `--color-hover` 一处；或把副行提到 `ink-700`（10.44）后保留原值——二选一，改一处全站生效 |
| 16 | Task 0006 起：新建会话草稿存 localStorage，键 = `lifeos.draft.<agentId>/<projectId>`；同一项目开两个标签页时互相覆盖（后写覆盖前者）；Pi Web 的草稿在内存里（按标签页天然隔离，但刷新即丢） | **多标签页各自的会话草稿** | 若真成问题：草稿键加标签页 id（`sessionStorage` 存 tabId）并清理旧键；代价是关掉标签页后草稿取不回——先确认这个取舍值得 |
| 17 | **老会话（P7 之前内联的图）压缩时仍会带图**：新格式已根治（存储 0 个 image 块，P6 用例断言），但 D8 决定老会话不迁移 | 极长的**老**会话把 token 推到 98.4% 时，那次压缩仍可能 413 | 两条路：① 接受（老会话本就短命）；② 一次性迁移脚本把老会话的 image 块换成引用行。**先不动**，等真遇到再说 |
| 18 | 真测（2026-10-29，command/mimo-2.6-flash）发现：网关会把大型调试会话判成 `The request was rejected because it was considered high risk`（内容风控，非 413）；`src/failure.ts` 目前归 `unknown` | 用户只会看到"模型调用失败"，不知道是被风控拒了 | 新增 `content_rejected` 种类 + 文案（"网关内容风控拒绝了这次请求：换会话/减少上下文"），并确认是否需要脱敏策略 |
| 19 | **413 仍会被 Pi 重试**：pi 的 `isRetryableAssistantError`（`pi/packages/ai/src/utils/retry.ts`）会命中 413 报文里的 `server_error` 字样，于是仍重试 4 次；Life OS 侧**关不掉**（`settings-manager.ts:940-946` 只暴露 `timeoutMs/maxRetries/maxRetryDelayMs`）。Task 0012 已实现缓解（回合内自救：扫到落盘的 413 立即收紧预算，下一次重试变小）+ 归因文案 | 触发：任何真实 413（压缩路径漏网的老会话、上限未声明的新网关、估算偏低） | 两条路：① 给 pi 的 `NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN` 加 payload-too-large（走 pi 子模块流程）；② 或在 Life OS 侧接管该回合的重试。**先接受现状**，等需要时再选 |
| 20 | `frontend/test/ui-contract.mjs` 的截图基线用 `data-shot-mask` 把整块行内容遮掉（第 2/3 列的行、会话正文、usage）。2026-10-30 实测：项目行 13.5→15px/600 之后 6 张基线差异都是 **0.000%** —— 视觉闸看不见行内字号/字重/层级回归 | 截图基线对「行内排版」不可见 | 遮罩改成只替换文字内容（固定长度夹具文字）保留骨架与排版，让基线能看见层级/字号回归；期间用计算样式断言补位（已加 `ui-contract` 的「三列层级」三条） |
| 21 | 用户 2026-10-31：要有一个"带风格"的**主题模式**（现在这套是简易模式：朴实、不花哨），但**不保留两套前端**——先以现风格合并，风格升级后单独议 | 现在只有一套朴素视觉；"设计感"没有承载体 | 主题 = 换一套 token 值（数值唯一来源是 `tokens.css` + 设计语言），不复制组件；需要先定第二套 token 集与切换入口 | P-02 合并落地后
| 22 | 分组头**吸顶**：Mattermost `_sidebar-left.scss:605-619`（`.SidebarChannelGroupHeader { z-index:1; top:0 }`）| 长列表滚到组中部时组名看不见（括线能缓解归属，但组名不在） | 需要实底 + 阴影层，层次复杂化；`position: sticky` + 与 `overflow` 容器交互要测 | 单组可见项 > 屏幕高度时
| 23 | 组内过长：**show-more + 全量模态**：Zulip `.show-more-topics` / `#more-topics-modal`（`left_sidebar.css:2363,1135`） | 一个项目下会话多时把侧栏撑爆 | 需要"每组上限"策略（参考值是观察值，未推导）+ 模态 | 单项目会话 > 10 条时先实测再定上限
| 24 | 设计语言 §5.2 / §5.3 的**徽标几何（20/10）与图标尺寸（12/16/20）是目标值**，真前端现状未核对（只有 16 = `--size-icon` 已核对） | 拿目标值当断言基线会造成假绿 | 在真前端实测现状 → 写回表 → 加计算样式断言 | P-02 落码时顺带
| 25 | 2026-11-02 跑 `test:ui` 时四个宽度（1024/1280/1440/1600）都报同一批：`13:04`（失败时刻）、`历史记录`（历史失败标记）对比度 **4.40:1** < AA 4.5；`laterzxhp@outl` 那行命中区只有 **162×18**（< 28）。`main`（0014 之前）同样失败，属既有缺陷 | 状态文字在小字号下可读性不足；有一处可点目标低于命中区下限 | 对比度：这两处用的是 `text-ink-500`（`#71717a`，白底 4.83:1）+ `text-micro`（11px），实测 4.40 说明底色不是纯白（失败块 `bg-message-failure`、历史块在白底但被 `opacity` 压低）；先量真实底色再决定提到 `ink-700` 还是换底色。命中区：那行是列表副行（非按钮），要么提升到 28，要么明确它不是可点目标并让断言放行 | 动 token 之前先确认影响面（`ink-500` 全站在用） |
| 26 | 现在只有 **Agent 视角**（`App.tsx:44` 三级级联）。实体关系本身已支撑多视角（`Agent 1:N Project`、`Project 1:N Session`、Session→Task 是指针），但**没有视图切换**；项目视角要跨 Agent 合并（项目有全局身份 `projects/<pid>/project.json`） | **多视图：Agent 视角 / 项目视角 / 会话视角 / Task 视角** | 视图 = 同一份数据的排序/分组投影，不改实体与落点；先定每个视角的分组键与排序键（项目视角按全局 project id 合并、会话视角限当前 Agent 内平铺）再实现 |
| 27 | `knowledge/architecture/tasks.md:11` 写明 Task「每个 Agent × 项目一份，互不共享」→ **A 的 task-1 与 B 的 task-1 是两个目录**（实测 `0002-*` 有 12 个不同任务）。所以「一个 Task 多 Agent 协作」在数据上没有承载物 | **Task 提升为可共享实体（T2）**：给 Task 全局身份（如 `~/.lifeos/tasks/<id>/` 或挂全局 project 下），Agent × 项目挂引用 | 会碰 `tasks.ts` 落点、协议 §3.7/§6.1 默认 Task 规则、`home:check` 与家目录迁移；**独立项目级改动**，不要塞进 0015（0015 走 T1：lane 记发起方 Task） |
| 31 | 会话列表第二行原本想显示"这条会话现在在干什么"，但 `phase`/`activeTool` 只有**当前打开会话**一份（`App.tsx` 的 `useState<Phase>`），全局 `/api/runtime` 的 `running` 项只有 `{sessionId, startedAt, turnId}`（`globalSnapshot()`）。拿它渲染所有行 → 每条运行中的行都显示同一条文案（已在 Task 0015 移除该文案） | **每个运行中会话各自的阶段（多会话并行时）** | 给 `globalSnapshot()` 的 `running` 项补 `phase`/`activeTool`（从会话最后块推导，与 `src/peer.ts` 的 `derivePhase()` 同一口径）；前端按 sessionId 取。前提：确认轮询/事件频率够（30s 对账太慢，需走 SSE turn 事件） |
| 32 | 会话列表**全量渲染**（`App.tsx:1773,1796` 两层 map，无任何规模控制）。实测 10 项目×100 会话 = **1,010 行 / 27,110 DOM 节点 / 首屏 21.2 秒**；折叠（每组 6 条）后可压到 ≈70 行 / 1,785 节点，已在任务 0005 用 `05-basis.md` 定策 | **虚拟滚动**（列表只渲染视口 ± overscan）——折叠之后它只剩 60% DOM 收益，代价是 7 类强制保留状态（焦点/菜单/拖拽/重命名/待删）+ 滚动锚点 + 行高表 + aria 总数 + 重写 131 项 UI 契约 | **暂不实施**。触发条件（任一）：①单次渲染 > 100 行且用户实际这么用（照 DSH `VIRTUALIZATION_THRESHOLD=100`）②折叠后首屏仍 > 1 秒 ③滚动出现 > 50ms Long Task。完整计划（选型 `virtua`（RC 同款）/ 6 步实施 / 预期收益 / 风险）→ `knowledge/architecture/session-list-rendering.md` |
| 33 | Task 0012：输入历史已改成从会话消息派生、游标带作用域（`frontend/src/input-history.ts`）。但**同属会话级输入状态的图片附件仍是全站一份**：`App.tsx` 的 `attachments`/`attachmentsRef` 在 `resetChatState()` 里不清，切会话后上一会话的待发图片还在、会被误发到新会话 | **图片附件跨会话残留** | 按草稿键（`lifeos.draft.<sessionId>` 同一套归属）给附件分桶，或把待发附件并进草稿记录一起持久化；顺带回答"刷新后待发图片是否保留"。**暂不修**：症状可见（缩略图就在输入框里），且它要改的是"附件属于谁"这个数据归属问题，与输入历史不是同一件事，混做会扩大回归面 |
| 34 | Task 0008 交付了「一轮回复的三条信息条」（ResponseBar 正文上方 / MarkBar 正文下方 / SessionBar 输入框上方），
但**左侧导航竖条**（原 0008 需求 7–18）与**批注重做**（选中即复制、两段式入口、视觉与丝滑度）因用户 2026-11-06 收窄范围而移出；原型 `tools/nav-demo/` 已获用户认可 | **左侧消息导航竖条 + 批注交互重做** | 详见 `agents/coder/projects/workspace/tasks/0008-批注面板展示逻辑优化/todo/todo.md` B 节（含逐条裁决与连带未解项 T6 长度/token 口径、T7 滑动窗口）；建议拆 1–2 个新 Task：竖条是纯新增组件，批注重做要先出 `tools/` 交互原型 |

| 35 | 长回复的流式渲染成本：`frontend/src/message-markdown.tsx:13-21` 每个 delta 都 `marked.parse` + `DOMPurify.sanitize` 整段 markdown（`useMemo([text])`）。Pi TUI 自 v1.5.0 用 `MarkdownSlot` 复用已渲染块（`assistant-message.ts`），每次渲染只重排最后一块（#10971）。对照结论见 Task 0015 的 `knowledge/pi-reply-display-comparison.md` §1.1 | **长回复的 Markdown 分段渲染** | 把已稳定的段与正在增长的最后一段分开渲染（上游同思路）；先测基线：一条 2000 字回复，末尾每 token 的重解析耗时。与 #35 同批做（同一渲染管线） |
| 36 | 工具块的参数增长让整条消息每来一个 `tool_execution_update` 就重渲染一次。Pi TUI 自 v1.5.0 改成 `argsPending` + 下一次 `render()` 才应用（#9265，大工具调用曾经吃满 CPU） | **工具块增量渲染合并** | 我们是声明式渲染，拿不到 `requestRender`；做法是把工具参数增长隔离成独立组件 + rAF 合并（不要照抄命令式的 `argsPending`）。与 #34 同批 |
| 37 | 压缩期没有任何可见状态：`stream-events.ts` 不映射压缩事件（`specs/code/api/api.md` 2.2 明确不把 compact 类生命周期事件泄漏成 UI 事件）。pi-web 的 `lib/chat-phase-label.ts` 在压缩时显示 `chat.compacting`（含排队数），理由是压缩可能很久、显示等待模型看起来像卡住 | **压缩期可见（正在压缩）** | 先定压缩算不算状态条的一部分；若做，走状态条的派生层（不新增 UI 事件），文案从服务端事实来。对照见 Task 0015 的 `knowledge/pi-reply-display-comparison.md` §2.3 |

| 38 | 检视模式（Task 0010）已交付 P1/P2/S1–S4-i + P4 总览 + G5/G6/G8/G9/G10/G11/G12/G13/G14/G15 + D29/D31/D32；事实见 `knowledge/architecture/review-mode.md` | **检视模式的手机适配**（唯一剩余项） | 按 `specs/frontend-mobile/mobile.md` 走全屏表面 + 单主列 + 44px 触控；跨 agent 候选列表已裁决**不做**（D31g + 协议 §3.7）；实现后把事实写进 `review-mode.md` §9 并删掉这条 |
| 39 | 项目概览卡（Task 0010 · 分组头计数药丸）已落地：路径/任务/知识库/案例/工具/规范计数 + 移除项目；设计文档 `knowledge/design/im/project-space.md`（工作台覆盖层）已是 IM v2 定稿（任务 0003 demo）但未落地 | **项目空间工作台页**（概览卡的下一站） | 落地 project-space.md 的工作台覆盖层（统计条+任务卡+近期对话+同事卡，入口三处：rail/分组头/任务条）；入口从概览卡升级为开页；PM 类参考已拉：Plane @ `9cefae8`（已登记 reference-projects.md） |
| 40 | AgentConfig（助手设置模态）为 v0 草案（`knowledge/design/agent-config.md` 自述"待评审"）；用户 2026-11-13 点名"比较简陋，跟不上现在的设计" | **AgentConfig 重设计** | 参照项目概览卡的信息分区思路 + 当下设计语言重做设置表单（四态/命中区/对比度全套）；不动数据接口 |
| 41 | `frontend/test/ui-contract.mjs` 在全新家目录上跑：显示设置"恢复默认"失败后字号卡在 2×，导致后续无竖向裁切/徽标呼吸等多项级联假红（2026-11-13 实测：改前/改后 stash A/B 均有 30 项）；另依赖真会话数 ≥3（夹具）与模型密钥（回合） | **ui-contract 的全新家目录健壮性** | 显示设置每段用例结束必须恢复默认（try/finally）；夹具会话不足时显式跳过而非假红；无密钥环境的回合依赖用例用 route mock 补齐；先在全新 `~/.lifeos-dev/` 家目录复现再修 |

- [ ] 可选：用 Tauri/Electron 薄壳包住 Life OS 现有 Web 地址做桌面应用（零架构改动，用户想要桌面图标时再做）
