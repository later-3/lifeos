# Life OS 目录结构（只放现在要用的）

> 角色：架构　类型：结构定义　状态：现状
>
> 原则（用户 2026-10-16 定）：**只建"这次真的要写的东西"的目录与文件；未来演进到了再建。**
> 参考项目（Pi / Pi Web）只用于**命名风格**，不用来新增我们还没涉及的东西。
> v1 / v1.1 是凭空想出来的（`utils/`、`sessions/`、`models/`、`projects/`、`shared/` 等），已作废。

## 1 仓库（进 Git）

```
lifeos/
├─ src/                     后端（Hono + Pi SDK）
│  ├─ main.ts               进程入口：起 HTTP 服务（--port，默认 43120）
│  ├─ server.ts             路由表（Agent / 项目 / 会话 / 事件流 / 文件浏览 / 配置）
│  ├─ agent-host.ts         会话宿主：创建/加载会话、跑一轮、条目读取、Pi 能力代理
│  ├─ events.ts             SSE 事件总线（按 Agent 的序号/缓冲/订阅；写操作在这里广播）
│  ├─ session-runtime.ts    运行态登记（哪些会话在跑）：agents/host 共用，避免循环依赖
│  ├─ failure.ts            失败归因（stopReason + errorMessage → 可显示的九类）
│  ├─ model-follow.ts       "默认 vs /model 覆盖"的判定（纯函数）
│  ├─ memory/               记忆：四角色路径 / MemOS store / 读写 / 软删除 / 多角色合并
│  ├─ assembly.ts           提示装配（方案 E：identity + harness 区 + Pi 的 tools/rules 回填）
│  ├─ stream-events.ts      Pi 会话事件 → SSE 流事件的唯一映射
│  ├─ projects.ts           项目 manifest 的读写与旧数据迁移
│  ├─ fs.ts                 文件浏览器后端（根白名单 / 列目录 / 读文件）
│  ├─ home.ts               家目录解析与校验 · install.ts 安装（模板整树复制）
├─ frontend/                前端（Vite + React + Tailwind v4）
│  └─ src/
│     ├─ App.tsx            三级级联 + 聊天 + 会话/项目/Agent 操作
│     ├─ Message.tsx        消息与块渲染（文本/思考/工具）· stream-blocks.ts 流式块归并
│     ├─ SessionHistory.tsx 完整历史（回合检查器）· prompt-patches.ts 分区补丁累加
│     ├─ FileTree.tsx / FilePanel.tsx / DirectoryPicker.tsx
│     ├─ AgentConfig.tsx · agent-avatar.tsx
│     └─ design/            tokens.css（唯一数值来源）· ui.tsx（primitive）· layout.ts（布局数学）· fold/rail/overlay/toast
├─ test/                    node:test：api / assembly / fs / home / ui-layout / stream-events / stream-blocks / prompt-patches / failure / tool-state / working / model-follow / resend / action-bar
├─ frontend/test/           UI 契约（ui-contract.mjs + 截图基线；基线本地生成、不进 Git）
├─ scripts/                 lint-tokens.mjs（视觉 token 闸）· stop.mjs（按端口优雅结束）· audit-ui.mjs
├─ docs/                    文档唯一准绳；入口 docs/README.md；未实现登记 docs/todo.md
├─ .lifeos/                 家目录模板（随包资产）：install = 整树复制到 ~/.lifeos
└─ pi/                      Pi SDK 子模块（固定 commit）
```

## 2 家目录（运行时数据；模板 = 仓库根 `.lifeos/`）

```
~/.lifeos/
├─ config/                  唯一配置目录（= Pi 的 agentDir）
│                            models.json · auth.json · models-store.json · settings.json? · file-roots.json · memory.json?（记忆的 LLM/embedding 覆盖）
├─ memory/user/<uid>/        用户记忆（MemOS store；跨项目、跨 Agent）
├─ projects/<pid>/memory/    项目共享记忆（MemOS store；项目下所有 Agent 可读）
├─ interaction-harness/      通用层（所有 Agent 共用）
│                            protocol.md · AGENTS.md · flywheel.md · concept-space.md · concept-space/ · cases/ · task-types/<type>/
├─ agents/<id>/              每个 Agent 私有（目录名 = id）
│  ├─ agent.json             身份与默认值（唯一来源）
│  ├─ identity.md            身份正文（注入 preamble）
│  ├─ avatar/                图片头像（可选）
│  ├─ memory/                Agent 记忆（MemOS store：config.yaml + data/memos.db）
│  └─ projects/<pid>/        一项目一份：AGENTS.md · sessions/ · daily/ · cases/ · todo/ ·（外部项目）project.json
│     └─ memory/             agent 的项目记忆（私有；MemOS store）
└─ install-receipt.json      安装收据
```

模板事实源 = 仓库根 `.lifeos/`（**整树复制，不在代码里另写目录清单**）；家目录已存在时安装只提醒、不改动任何文件。

## 3 产出内容的归属

| 内容 | 落点 |
|---|---|
| 会话（JSONL） · 每日记录 · 案例 · Todo · 任务 | `agents/<id>/projects/<pid>/`（默认 `workspace/`；打开外部项目后随该项目 pid） |
| 通用案例 · 协议正文 · 任务类型细则 | `interaction-harness/`（通用层） |
| 记忆：项目共享 / 用户 / Agent / agent 的项目记忆 | `projects/<pid>/memory/` · `memory/user/<uid>/` · `agents/<id>/memory/` · `agents/<id>/projects/<pid>/memory/`（各自一个 SQLite） |
| 项目身份（外部项目） | `agents/<id>/projects/<pid>/project.json` |

## 4 明确**不建**（现在没有；真要写时再建并说明用途）

- 代码：`src/agents/`、`src/routes/`、`src/long-agents/`、`src/utils/`、`src/sessions/`、`src/models/`、`shared/`、`packages/`、`deploy/`
- 家目录顶层：`logs/`、`runtime/`
- 文档：`docs/architecture/prompt/`、`agent-tasks.md`、`agent-tools.md`（2026-10-18 删除：描述的是未实现的机制；要点登记在 `docs/todo.md`）
- 说明：`agent-memory.md` 已于 2026-10-20 重建（架构 + 需求两份）；`projects/` 已用于项目共享记忆（不再属于"不建"）

## 5 命名

- **交互 harness 一律写全**：不单独说 harness；代码/文件用 `interaction-harness`。
- 文件 kebab-case；函数/变量 camelCase；类型/组件 PascalCase。
- HTTP 路径 `/api/<资源>`；Agent 路径段用 **id**（slug）。
- 家目录固定名：`config/`、`interaction-harness/`、`agents/<id>/`（含 `projects/<pid>/`）、`install-receipt.json`。
