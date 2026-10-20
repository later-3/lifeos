# 待实现（登记）

> 角色：需求登记　类型：清单　状态：现状（只登记，不实现）

规矩：一行一件事，写清**背景（现状）→ 是什么 → 要做什么**。实现之后删掉这行，把事实写进对应文档。

| # | 背景（现状） | 是什么 | 要做什么 |
|---|---|---|---|
| 1 | 全局项目身份已实现（`~/.lifeos/projects/<name>/project.json`，同 path 幂等、Agent 绑定用全局 id）；**共享项目资源**（模板/资产）仍未做 | **Life OS 支持多 Agent 共用项目信息或者项目资源** | 设计共享资产层（同一全局项目下多 Agent 复用的模板/资源），再实现 |
| 2 | 已支持创建与归档（工具 + HTTP + 行内删除入口）；归档目前只能手动恢复 | 归档助手的恢复入口（HTTP/UI）与启用/停用语义 | 先定恢复动作、以及「停用」与「归档」的区别，再实现 |
| 3 | 注入是固定 6 区（方案 E，`src/assembly.ts`）；交互 harness 全文（约 26KB）常驻 system prompt | Prompt 通用机制：区域声明与注册、常在/按需判据、请求边界门禁 | 设计区域注册表；把 harness 全文改成索引 + 按需读取 |
| 4 | P1 已实现（四 store / 读写 / 硬删除，**待审阅**）；架构见 [`architecture/agent-memory.md`](./architecture/agent-memory.md)，需求见 [`requirements/agent-memory.md`](./requirements/agent-memory.md)；工具与面板未做 | **记忆体系**：三个记忆工具（search/record/delete）+ prompt 规则、记忆面板 | 待两份文档审阅通过 → P2 工具与 prompt → P3 面板 |
| 5 | 已实现用户下达任务（`lifeos_task_create` / `lifeos_task_list`、编号 `NNNN-标题`、A/B/C 三类文档骨架） | Agent 定时任务（第二类）：启用/暂停/取消、运行历史、触发机制 | 先定调度与运行记录结构，再实现 |
| 6 | 只有 Web 前端走 HTTP/SSE | 多客户端（TUI / 桌面 / 手机） | 需要时再设计（含接口版本化） |
| 7 | 会话运行控制已对齐（打断/steer/followUp/压缩/切模型/思考级别/斜杠命令/历史） | 剩余 Pi 能力：`/fork` `/tree` `/clone`（分支）、`@` 文件提及、`/import` `/share`、`/login` `/logout` `/trust` `/settings` | 按使用频率分批接；分支类需要先有分支 UI |
