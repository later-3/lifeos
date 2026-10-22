# 开发 Life OS 时怎么遵守交互 harness（自举约定）

> 角色：开发规范　类型：操作　状态：现状
>
> **前提**：我们开发 Life OS 的过程本身，就是"一个项目 + 一个 Agent 在工作"，因此**也要按 harness 协议走**：
> 概念先定义、案例要回填、日报按时写、任务有目录、任务类型按声明加载。这份文档只写**落点与动作**。

## 1 作用域落点（现状）

| 层 | 物理位置 | 放什么 |
|---|---|---|
| **通用层**（所有 Agent 共用） | `~/.lifeos/interaction-harness/` | 协议正文 `protocol.md` · 本层指引 `AGENTS.md` · 飞轮 `flywheel.md` · 概念空间 `concept-space.md` + `concept-space/` · 通用案例 `cases/` · 任务类型 `task-types/<type>/*`（`development` 开发/协作/结论 · `general` 普通任务） |
| **共享 workspace**（所有 Agent） | `~/.lifeos/projects/workspace/` | 共享规范 `specs/` · 共享记忆 `memory/`；没有 path，不是用户目录 |
| **项目共享层**（同一项目的所有 Agent） | `~/.lifeos/projects/<projectId>/` | `project.json` · 共享记忆 `memory/` · 项目规范 `specs/` |
| **Agent 私有层**（跟当前 Agent × 项目走） | `~/.lifeos/agents/<id>/projects/<项目名>/`，**默认 = `workspace/`** | 会话 `sessions/` · 任务 `tasks/` · 日报 `daily/` · 案例 `cases/` · `todo/` · 项目指引 `AGENTS.md` · 本层规范 `specs/` ·（外部项目）`project.json` |

**方向**：主体是 **Agent**，项目是全局实体；一个项目可被多个 Agent 绑定，记录分两层：Agent 私有层（会话/daily/cases/todo/agent 的项目记忆）与项目共享层（project.json/共享记忆/规范）。

## 2 每轮要做的动作

| 动作 | 落点 |
|---|---|
| 新概念先写进概念空间再用 | `~/.lifeos/interaction-harness/concept-space.md` + `concept-space/` 索引 |
| 正例/反例编号回填 | `agents/<id>/projects/<pid>/cases/<日期>.md`（通用案例放 `interaction-harness/cases/`） |
| 可复用结论回填飞轮 | `~/.lifeos/interaction-harness/flywheel.md` |
| 当天记录（追加，含时间戳） | `agents/<id>/projects/<pid>/daily/<日期>.md` |
| 遗留事项 | `agents/<id>/projects/<pid>/todo/` |
| 任务目录与 `task.md` | `agents/<id>/projects/<项目名>/tasks/<NNNN>-<标题>/`（用 `lifeos_task_create` 建，编号连续；`task.md` 是唯一状态源；日期写字段，不建日期目录） |
| 规范 | 共享 workspace / 项目共享 / Agent 私有 workspace / Agent × 项目 / Task 的 `specs/`；提升时移动正文并留指针 |

## 3 这些内容怎么进入 Agent 的 prompt（现状，代码依据）

`src/assembly.ts` 的 `buildPromptParts(agentId, projectId, taskId?)` 把这些文件读成**一个** `lifeos_interaction_harness` 区（顺序如下，文件不存在就跳过）：

1. 协议正文 `interaction-harness/protocol.md`
2. 本层指引 `interaction-harness/AGENTS.md`
3. 飞轮 `interaction-harness/flywheel.md`
4. 概念空间元规则 + 两份索引（`concept-space/00-索引.md`、`concept-space/harness/00-索引.md`）
5. 任务类型细则 `interaction-harness/task-types/<type>/*.md`（按类型目录自动加载；新增类型 = 加一个目录）
6. **规范层** `specs/index.json`：共享 workspace → 当前项目共享 → Agent 私有 workspace → Agent × 项目 → Task；逐层追加，不覆盖，不跨项目扫描
7. **当前 Task** `tasks/<taskId>/task.md`（会话有 `activeTaskId` 才加载；普通会话默认 Task 也走这里）
8. **本项目指引（Agent 私有）** `agents/<id>/projects/<pid>/AGENTS.md`
9. **项目规范（项目目录）** `<项目目录>/AGENTS.md`——外部项目才有；**只读项目目录自己这一份，不继承父目录**

末尾附"按需读取"指针（案例目录、`{daily,tasks,todo}`）。**Pi 自带的上下文文件读取已关闭**（`noContextFiles`）：项目规范只从第 8、9 条这两条通道进 prompt，不继承父目录。

**注意**：按协议产出的内容（daily / cases / todo / tasks）**全部放 `~/.lifeos`**（属用户个人），不放仓库；仓库里 `docs/` 是**人看的开发规范**，与家里那份由协议加载的副本不是同一机制，别互相抄。

## 4 规范与飞轮怎么“提升”

提升不是逐级搬家，而是**看谁必须遵守**：只有当前 Task 用 → 留 Task；当前项目所有 Agent 用 → 项目共享；
当前 Agent 跨项目用 → Agent 私有 workspace；所有 Agent 用 → 共享 workspace；属于协作机制本身 → 协议。

动作固定为三步：

1. 把正文**移动**到目标层的 `specs/`（飞轮文档同理），不复制；
2. 在源位置留一行指针（路径 + 一句话），不保留第二份正文；
3. 在目标层 `specs/index.json` 登记，跑 `pnpm test` 的装配测试确认新层被加载、旧层不再重复注入。

**案例、daily、todo 不搬家**：它们留在发生层；只有从它们提炼出的规范/飞轮正文可以提升。日期目录不因 Task 日期改变。
