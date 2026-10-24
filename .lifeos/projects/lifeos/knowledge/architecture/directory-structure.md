# Life OS 目录结构（事实）

> 角色：架构　类型：结构定义　状态：现状（2026-10-23，按交互 harness 协议重写）
>
> 结构的规则以协议为准：`~/.lifeos/interaction-harness/protocol.md` §4、§5。本文只写 Life OS 仓库与家目录里**现在**的布局。

## 1 仓库（进 Git）

```
lifeos/
├─ src/                     后端（Hono + Pi SDK）
│  ├─ main.ts               进程入口：起 HTTP 服务（--port，默认 43120）
│  ├─ server.ts             路由表
│  ├─ agent-host.ts         会话宿主：创建/恢复会话、跑一轮、Task 指针切换
│  ├─ assembly.ts           提示装配：协议正文、规范（按层）、当前 Task、说明文件索引
│  ├─ tasks.ts              Task：默认 Task、分片、普通 Task、模板选择、列表
│  ├─ project-skeleton.ts   结构骨架（各层与子目录的创建，说明文字来自协议目录的 skeleton/）
│  ├─ home-check.ts         家目录结构校验（pnpm home:check）
│  ├─ install.ts / home.ts  家目录安装（模板整树复制）
│  ├─ agents.ts / projects.ts / project-registry.ts  Agent、项目绑定与全局注册表
│  ├─ agent-tools.ts        Pi 工具（Agent / 项目 / Task），调用 tasks.ts 等共享实现
│  ├─ memory/               记忆：角色落点、MemOS 存储、读写、合并
│  └─ …                     stream-events、model-follow、failure、fs、events 等
├─ frontend/                前端（Vite + React）
├─ test/                    node:test：结构、装配、Task、项目、接口与协议全流程模拟
├─ .lifeos/                 家目录模板（随仓库；install = 整树复制到 ~/.lifeos）
└─ pi/                      Pi SDK 子模块（固定 commit）
```

仓库根的 `AGENTS.md` 是给开发 Agent 的仓库规则；设计文档、规范、知识库、待办都在 `.lifeos/projects/lifeos/`（见 §3）。

## 2 家目录（运行时数据；模板 = 仓库根 `.lifeos/`）

```
~/.lifeos/
├─ config/                      模型与文件根配置（含密钥，永不进 Git）
├─ logs/                       运行日志（backend-<date>.jsonl / frontend-<date>.jsonl；14 天滚动；运行时创建，模板不带——与协议无关的 Life OS 运行产物）
├─ interaction-harness/         协议目录：protocol.md · AGENTS.md · skeleton/（目录说明模板）· task-types/（协议默认的任务类型）
├─ projects/                    共享层（全局项目注册表）
│  ├─ workspace/                共享 workspace（所有 Agent）：project.json（无 path）· AGENTS.md · flywheel.md · concept-space.md · specs/ · cases/ · knowledge/ · tools/ · todo/ · memory/ · task-types/
│  └─ <pid>/                    共享项目：同上结构，另有 project.json（含 path）
├─ agents/<id>/                 Agent 本身：AGENTS.md · agent.json · identity.md · tools/ · memory/
│  └─ projects/<pid>/           Agent × 项目（默认项目 pid = workspace）：AGENTS.md · flywheel.md · concept-space.md · specs/ · cases/ · knowledge/ · tools/ · todo/ · memory/ · task-types/ · sessions/ · tasks/
│     └─ tasks/NNNN-标题/       Task：AGENTS.md · task.md · flywheel.md · concept-space.md · specs/ · cases/ · knowledge/ · tools/ · todo/ · 日志（开发类 log.md；日常类 daily/）
└─ install-receipt.json         安装收据
```

- 默认 Task 是 `tasks/0001-default/`（类型 `daily`）：日常对话按天写进 `daily/<日期>.md`。
- `project.json` **只在共享层**（`projects/<pid>/`），绑定目录不写身份（协议 §5.3）。
- 没有 `logs/`、`runtime/`；会话与日志随 Agent × 项目 / Task 存放，不另建顶层目录。

## 3 仓库里的知识与规范（`.lifeos/projects/lifeos/`）

| 位置 | 内容 |
|---|---|
| `knowledge/architecture/` | 系统事实：Agent、会话、记忆、底座、远程访问、本文件 |
| `knowledge/requirements/` | 需求：会话、记忆 |
| `knowledge/design/` | 单个页面的设计：聊天、文件浏览器、Agent 配置 |
| `knowledge/reference-baseline.md` | 参考基线：每个场景照谁做、借什么、不借什么 |
| `specs/frontend-development/` | 前端固定四步（`process.md`）与统一规范（`frontend-spec.md`） |
| `specs/frontend-mobile/` | 手机规范（`mobile.md`） |
| `specs/review/` | 检视与评审流程（`review.md`） |
| `specs/development-harness/` | 开发 Life OS 时怎么遵守交互 harness |
| `todo/todo.md` | 未实现功能的一句话登记 |

## 4 明确不建（现在没有；真要写时再建并说明用途）

- 代码：`src/agents/`、`src/routes/`、`src/utils/`、`shared/`、`packages/`、`deploy/`
- 家目录顶层：`runtime/`、`daily/`（日常沉淀只在默认 Task；生产运行日志是 Life OS 运行产物，落 `logs/`，不进模板——模板与运行时区分见 §2）
- 文档：`docs/`（已并入 `.lifeos/projects/lifeos/`）

## 5 命名

- 交互 harness 一律写全：代码与文件用 `interaction-harness`；
- 文件 kebab-case；函数/变量 camelCase；类型/组件 PascalCase；
- 规范目录与主题名用英文；
- 说明文件统一叫 `AGENTS.md`。
