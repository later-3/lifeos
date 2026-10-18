# 开发 Life OS 时怎么遵守交互 harness（自举约定）

> 角色：开发规范　类型：操作　状态：现状（2026-10-15 已落地并在实机验证）
>
> **前提**：我们开发 Life OS 的过程本身，就是"一个项目 + 一个 Agent 在工作"，因此**也要按 harness 协议走**：
> 概念先定义、案例要回填、任务有目录、日报按时写、任务类型按声明加载。这份文档只写**落点与动作**。

## 1. 三层落点（协议 §7 的分层）

| 层 | 物理位置 | 我们放什么 |
|---|---|---|
| 通用层（跨项目的共用资产） | `~/.lifeos/interaction-harness/` | 协议正文、本层指引、飞轮、概念空间索引、案例、**任务模板** `task-types/<type>/TEMPLATE.md` |
| **项目共用层**（= 已注册项目的共用信息） | `~/.lifeos/projects/<pid>/`（**仅当项目已注册**；记录不放这里） | 注册身份 `project.json`；项目声明等共用资产 |
| **Agent × 项目私有层**（记录跟当前工作项目走） | `~/.lifeos/agents/<agent>/projects/<当前工作项目>/`，**默认 = `workspace/`**；打开外部项目后 = `projects/<pid>/` | 任务 `tasks/`、日报 `daily/`、案例 `cases/`、`todo/` |

**方向（别再说反了）**：主体是 **Agent**，项目是它工作范围里的一部分（记录落在 Agent 目录内）；`boundProjectIds` 只是"这个 Agent 允许在哪些项目里干活"的清单。
| 项目自己的仓库文件 | `/Users/xulater/Code/lifeos/AGENTS.md` 等 | 仓库级约定（由 Pi 资源发现读取，不进 harness 区域） |

**注意（2026-10-15 定）**：按协议产出的内容**全部放 `~/.lifeos`**（属用户个人），**不放仓库**；协议本体仍在仓库文档，并在家里装一份可改的副本。
仓库里 `docs/standards/*` 是**人看的开发规范**，与家里由协议加载的那份不是同一机制，别互相抄。

**加载方式**：通用层与项目共用层的任务类型细则由 `readInteractionHarness` 读取（`src/long-agents/interaction-harness.ts:101`）；项目声明由 `readProjectTaskTypes` 读取；**Agent×项目私有层**由 `PROJECT_STANDARDS` 读取；项目自己的 `AGENTS.md` 走 Pi 资源发现。

## 2. 我们每轮要做的动作（与协议一致）

| 动作 | 落点 | 现状 |
|---|---|---|
| 任务要有目录与 `task.md` | `<agent>/projects/workspace/tasks/<slug>-<id8>/`（打开外部项目后随该项目 pid） | 已在做 |
| 每轮回填日报 | `<agent>/projects/workspace/daily/<日期>.md`（默认；外部项目打开后随该项目） | 已在做 |
| 正例/反例编号回填 | `<agent>/projects/workspace/cases/<日期>.md`；通用案例在 `~/.lifeos/interaction-harness/cases/` | 已在做 |
| 新概念先写概念空间再用 | `~/.lifeos/interaction-harness/concept-space.md` + 索引 | 待迁 |
| 任务类型按声明加载 | `~/.lifeos/projects/lifeos/task-types.json` = `{"schemaVersion":1,"taskTypes":["development"]}` + `~/.lifeos/interaction-harness/task-types/development/*.md` | ✅ 已建（2026-10-15，实机验证请求可见） |

## 3. 落地状态（2026-10-15 已完成）

1. **声明** ✅ `~/.lifeos/projects/lifeos/task-types.json` = `{"schemaVersion":1,"taskTypes":["development"]}`（**必须是对象**，数组会被拒）；
2. **内容** ✅ 7 份（TEMPLATE + 需求/开发/测试/前端/维护/task 规范）在通用层 `~/.lifeos/interaction-harness/task-types/development/`；
3. **Agent 私有层** ✅ `~/.lifeos/long-agents/lifeosagent/projects/lifeos/{project-guidance.md,tasks/,daily/,cases/}`（**默认 Agent = `lifeosagent`**）。

## 4. 实机验证（2026-10-15）

真实一轮（`contextProjectId=lifeos`）：请求的 harness 区域里出现 **纯规则 + 协议 §1–§14**、**任务类型 development 7 份各自分节**、**通用资产 5 份**、**本项目专属规范 project-guidance.md** → **自顶向下闭环成立**。

**未验**：任务落盘（自底向上）——需要先把 `lifeosagent` 绑定到项目 `lifeos`（配置 PUT 需完整字段，且 `definition` 必须含 `systemPrompt/customInstructions/tools`）。
