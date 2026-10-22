# 待实现（登记）

> 角色：需求登记　类型：清单　状态：现状（只登记，不实现）

规矩：一行一件事，写清**背景（现状）→ 是什么 → 要做什么**。实现之后删掉这行，把事实写进对应文档。

| # | 背景（现状） | 是什么 | 要做什么 |
|---|---|---|---|
| 1 | 全局项目身份、共享 workspace specs/记忆、项目共享 specs 已实现；**跨 Agent 共用的模板/资产同步**仍未做（只做了四层模板选择入口） | **Life OS 支持多 Agent 共用项目信息或者项目资源** | 设计共享资产层（同一全局项目下多 Agent 复用的模板/资源），再实现 |
| 2 | 已支持创建与归档（工具 + HTTP + 行内删除入口）；归档目前只能手动恢复 | 归档助手的恢复入口（HTTP/UI）与启用/停用语义 | 先定恢复动作、以及「停用」与「归档」的区别，再实现 |
| 3 | 注入是固定分区（方案 E，`src/assembly.ts`）；交互 harness 协议正文常驻，规范/Task 按作用域加载；**区域声明表**仍靠代码顺序 | Prompt 通用机制：区域声明与注册、常在/按需判据、请求边界门禁 | 设计区域注册表；把可变的 harness 资料继续改成索引 + 按需读取 |
| 4 | P1 + P2 已实现（四 store / 读写 / 硬删除 / 3 个工具 / `memory.md` 策略），**待审阅**；不做面板 | **记忆体系**：剩余可选能力（导出/备份、审计；自动捕获不做） | 待文档与实现审阅；有需要再做导出/审计 |
| 5 | 已实现用户下达任务（`lifeos_task_create` / `lifeos_task_list`、编号 `NNNN-标题`、A/B/C 三类文档骨架） | Agent 定时任务（第二类）：启用/暂停/取消、运行历史、触发机制 | 先定调度与运行记录结构，再实现 |
| 6 | 只有 Web 前端走 HTTP/SSE | 多客户端（TUI / 桌面 / 手机） | 需要时再设计（含接口版本化） |
| 7 | 会话运行控制已对齐（打断/steer/followUp/压缩/切模型/思考级别/斜杠命令/历史） | 剩余 Pi 能力：`@` 文件提及、`/import` `/share`、`/login` `/logout` `/trust` `/settings`（`/fork` `/tree` `/clone` 单列到 #10） | 按使用频率分批接 |
| 8 | 手机竖屏已按 `mobile.md` 适配；横屏宽度 ≥640 当前仍走桌面/平板布局，没有独立手机横屏/平板布局 | 手机横屏/平板适配 | 先定断点与表面模型，再扩展 `useIsMobile`/触控尺寸/布局；不要只改断点 |
| 9 | 流式 UI 把 `contentIndex` 当整轮全局槽位，未处理 `message_start/end`；`MessageView` 又把整轮 `busy` 传给所有思考/工具块，导致旧思考仍转圈、工具后下一条 message 的块覆盖前面槽位 | 流式块按 assistant message 分段 | 先改 `stream-events`（映射 message 边界）与 `stream-blocks`（段内槽位），再改 `MessageView` 的 live/工具状态；补“工具后 contentIndex 重置”的契约测试 |
| 10 | Pi CLI/SDK 已有 `/fork`（从历史用户消息新建会话）、`/clone`（复制当前分支到新会话）、`/tree`（同会话文件内切换分支）、`--fork`、RPC `fork/clone/get_tree`、`SessionManager.getTree/createBranchedSession/forkFrom`；fork/clone 的 session header 有 `parentSession`，条目有 `id/parentId`。Life OS 的 `listSessions` 只读 session id/标题/时间，`SessionItem` 没有 parent；前端没有 fork/tree/clone 命令与任何关系展示。**8 个本地会话当前都没有 `parentSession`**（因为还没从 Web 建过 fork） | **Fork/clone/tree 的会话谱系与前端展示** | 先定产品语义：`/tree` 是同会话文件内分支，`/fork`/`/clone` 是新会话文件；再定列表展示（父会话 badge/缩进树/仅 header 链接）、fork 动作挂哪（历史用户消息/会话菜单）、新 fork 是否自动切换；后端解析 `parentSession` + 暴露 tree，前端只展示已确认关系；不要把 subagent 或群聊当成 fork |
| 11 | Prompt 目前只按层级组装，组装后不能编辑 | **Prompt 编辑**：组装后修改/删除/新增 section/内容 | 先设计编辑边界、持久化与回滚，再实现；当前不做 |
| 13 | `specs/index.json` 可写 `appliesTo.scenes`，当前装配按层加载但**未按 scene 过滤**；`lifeos` 项目的 frontend 规范索引写了 `frontend` 场景 | 规范场景过滤 | 先定 scene 来源（Task 的 type/显式 scene 字段），再把索引过滤接入 `buildPromptParts`；没有来源前不要假装已按场景加载 |
