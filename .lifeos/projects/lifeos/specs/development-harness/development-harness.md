# 开发 Life OS 时怎么遵守交互 harness

> 角色：开发规范　类型：操作　状态：现行（2026-10-23，按协议重写）
>
> 前提：开发 Life OS 的过程本身也是“一个 Agent 与用户在一个项目里工作”，因此**也按协议走**。协议正文只在 `~/.lifeos/interaction-harness/protocol.md`，本文只写**开发时的落点与动作**。

## 1 每一层的落点（协议 §4.2）

| 层 | 位置 | 开发 Life OS 时放什么 |
|---|---|---|
| 共享 workspace | `~/.lifeos/projects/workspace/` | 跨项目通用的飞轮、概念、规范（如协作规范） |
| 共享项目 `lifeos` | `~/.lifeos/projects/lifeos/` | 本项目的设计、规范、知识、待办、项目飞轮、项目概念 |
| Agent × 项目 | `~/.lifeos/agents/<id>/projects/lifeos/` | 该 Agent 在 Life OS 上的会话与 Task |
| Task | `…/tasks/NNNN-标题/` | 一件具体工作：目标、过程、沉淀、状态 |

仓库里的 `.lifeos/projects/lifeos/` 是这些内容的**模板来源**；安装后即为 `~/.lifeos/projects/lifeos/`。改规范时改仓库里的原文件，并同步安装副本（或重装），不在两份之间各改一点。

## 2 每轮要做的动作（协议 §3、§12）

| 动作 | 落点 |
|---|---|
| 新概念先写进所在层的 `concept-space.md`，再使用 | 项目概念在 `projects/lifeos/concept-space.md`；通用概念在共享 workspace |
| 闲聊、日常沉淀 | 默认 Task 的 `daily/<日期>.md`（按天，只追加） |
| 一件具体开发工作的过程与重要事项 | 该 Task 的 `log.md` |
| 正例/反例 | 发生的 Task 的 `cases/<日期>.md`（带编号，标签按需） |
| 可复用的结论 | 所在层的 `flywheel.md`（按协议 §3.1 的更新判据选层） |
| 遗留事项 | 所在层的 `todo/`；Life OS 的未实现登记在 `projects/lifeos/todo/todo.md` |
| 规范 | 对应层的 `specs/<主题>/`，逐层追加加载 |

## 3 Task 的开发约定

- 普通 Task 用 `lifeos_task_create` 建，编号连续（`NNNN-标题`），`task.md` 是唯一状态源；
- 开发类（`development`）：A 改产品行为、B 改协作规范、C 只出结论；必需文档见模板 `template.json`；
- 普通类（`general`）：只有背景与步骤，没有 `log.md`；
- 日常类（`daily`）只属于默认 Task，由系统维护，不手动新建。

## 4 装配：这些内容怎样进入 Agent 的 prompt（协议 §9）

- 常驻：协议正文、协议目录说明；
- 规范：按 Agent 本身 → 共享 workspace → 共享项目 → Agent × 项目 → Task 的顺序逐层追加（不覆盖）；
- 当前 Task：指针指向的那一个的 `AGENTS.md`、`task.md` 与类型规则；
- 其他层：只给说明文件索引，正文按需读取；
- 项目仓库自己的 `AGENTS.md`（仓库根）作为“项目规范”单独读取，不继承父目录。

## 5 提升：规范与飞轮怎么上移（协议 §11）

提升不是逐级搬家，看谁必须遵守：只有当前 Task 用 → 留 Task；同一项目的 Task 都用 → 共享项目；同一 Agent 跨项目用 → Agent 的默认 workspace；所有 Agent 用 → 共享 workspace。

动作固定为三步：

1. 把正文**移动**到目标层（规范到 `specs/`，飞轮到 `flywheel.md`），不复制；
2. 在源位置留一行指针（路径 + 一句话）；
3. 在目标层的 `specs/index.json` 登记（规范），再跑 `pnpm test` 与 `pnpm home:check`，确认新层被加载、旧层不再重复注入。

**案例、日志、待办不搬家**：它们留在发生的层；只有从它们提炼出的规范、飞轮可以提升。

## 6 结构检查

- 家目录结构改动后运行 `pnpm home:check`：说明文件缺失、旧结构残留、Task 编号与类型不一致、开发类缺 `log.md`、默认 Task 不唯一等都会报错。
- 安装测试与全流程模拟在 `test/home.test.mjs`、`test/protocol-flow.test.mjs`，改结构时要同步更新。

## 7 运行环境约束（应该）

**应该** 不要在**有真实网页会话运行**时 live-edit 服务端源码（`src/**`）：

- 开发服务用 `node --watch` 启动，源码一改就重启子进程，**正在执行的那一轮会被静默杀死**（没有最终回复、没有错误条目，会话停在工具结果上）；
- 真实使用/验收时，**应该** 用独立端口 + 独立 `LIFEOS_HOME` 的实例，或 `pnpm start`（构建产物）运行；
- 一旦发生中断：先看 `logs/` 与 JSONL 尾条，用 `turns/last` 对账；**不要**把"没在跑"当"已完成"（见 turn-verdict 判定修复，2026-10-24 案例 C116）。
- 依据：2026-10-24 会话 01a16bd9 被 `node --watch` 重启掐断（`evidence/2026-10-24-01-时间轴.md`、`03-进程与日志时间点.md`）。
