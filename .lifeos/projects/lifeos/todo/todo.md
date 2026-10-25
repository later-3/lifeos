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
