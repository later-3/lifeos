# Life OS 技术底座（v1）

> 角色：架构　类型：约束（设计定义）　状态：目标
> 2026-10-16 与用户确认：**A2 前后端分离**（前端 Vite SPA，后端独立 Node 进程）。

## 1 运行形态

```
frontend/   Vite + React SPA（纯静态产物，不含业务事实）
   │  HTTP/JSON + SSE
src/        后端：Node 进程，HTTP + 事件流
   │
pi/         Pi SDK（子模块，Agent 运行时）
```

- 后端是**唯一事实源**；前端刷新即从后端重取，不依赖内存状态。
- 同仓布局：`src/`（后端）· `frontend/`（SPA）· `docs/` · `pi/`（子模块）。
- **一个后端可服务多个客户端**（Web / TUI / 桌面 / 其他前端），见 §6。

## 2 Agent 运行时

- 用 Pi SDK：`@earendil-works/pi-coding-agent`（`AgentSession`、`SessionManager`、`SettingsManager`、`ResourceLoader`）+ `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`。
- Life OS 只负责：**配置装配、交互 harness 注入、会话托管、事件转发**；不自己实现 Agent 循环。
- 运行时宿主写在 `src/core/`，**框架无关**（不 import HTTP 框架），HTTP 层只是薄适配。

## 3 会话事实

- 默认：Pi `SessionManager`（会话 JSONL 文件）。
- 需要多写者/并发时：切 `pi/packages/session-backends/sqlite-node`（durable）。
- 会话、轮次、提示词配置、Agent 定义的**权威都在后端文件**；前端只做投影。

## 4 家目录（`~/.lifeos`）

```
config/                 唯一配置目录（settings.json、models.json；含密钥，不进 Git）
interaction-harness/    协议、任务类型、概念空间、案例
agents/<id>/            Agent 定义与私有空间（agent.json、identity.md、projects/<pid>/…含出厂默认会话）
projects/<pid>/          项目共用层（跨 Agent 共享）
runtime/ logs/
install-receipt.json    安装收据
```
骨架的**模板事实源 = 仓库根 `.lifeos/`**：`pnpm home:install` = 模板整树复制（家目录已存在则只提醒、不动任何东西）；服务启动只校验家目录存在，不创建、不覆盖。
细则见 `agent.md` §9。**不引入环境变量**（仅 `LIFEOS_HOME` 作引导/测试）。

## 5 接口面（v1 最小集）

| 接口 | 作用 |
|---|---|
| `GET /api/health` | 健康 |
| `GET /api/home`、`GET /api/home/installation` | 家目录与安装收据 |
| `GET·POST /api/agents`、`GET·PATCH·DELETE /api/agents/:id` | Agent 定义 |
| `GET·PUT /api/agents/:id/avatar` | 头像 |
| `GET /api/agents/:id/projects` | Agent 的 project 列表（扫描 `agents/<id>/projects/*/`，name 读 `project.json`） |
| `GET /api/agents/:id/projects/:pid/sessions` | 某 project 下的会话列表 |
| `PUT /api/agents/:id/sessions/:sid` | 重命名会话（写 Pi `session_info` 展示名） |
| `DELETE /api/agents/:id/sessions/:sid` | 删除会话（运行中 409） |
| `GET /api/sessions`、`GET /api/sessions/:id`、`DELETE /api/sessions/:id` | 会话 |
| `POST /api/agents/:id/turns` | 发一条消息（受理） |
| `GET /api/turns/:turnId/events`（SSE） | 回合事件流（带游标，可续） |
| `POST /api/turns/:turnId/interrupt` | 打断 |
| `GET·PUT /api/sessions/:id/prompt-config`、`GET·PUT /api/agents/:id/prompt-config` | 提示词配置（会话级 / 默认层） |
| `GET·PUT /api/models-config` | 模型与运行参数 |
| `GET /api/projects`、`POST /api/projects/open` | 项目注册表 |

### 5.1 路径里用的是 **id**（不是可改的显示名）

- 目录名 = URL 里那一段 = **id**，必须是稳定 slug：`^[a-z0-9][a-z0-9-]{0,63}$`（例：`lifeosagent`）。
- `name` 是**显示名**（可中文、可随时改），只用于界面展示，**不进 URL**、不被会话/配置引用。
- 所以 `GET /api/agents/lifeosagent` 里的那一段看着像名字，其实是 id：改了显示名，链接、会话归属、配置引用都不受影响。
- 不用"id 或 name 二选一解析"：两义性会带来改名后的歧义与冲突。

## 6 多客户端（这是 A2 的核心收益）

- 所有客户端**只通过同一 HTTP/SSE 契约**工作：Web 前端、TUI、桌面（Tauri/Electron 包前端）、手机（PWA）、将来的其他前端。
- 三条硬要求（否则"多客户端"只是口号）：
  1. **事件流带游标**（`Last-Event-ID`）——断线重连、多端同时在线可续；
  2. **合同有版本**（`/api/v1` 或响应里的 `schemaVersion`）——客户端不被后端变更打断；
  3. **业务逻辑在下沉模块**（`src/core/`），不在 HTTP 处理器里——将来要让 TUI 走 stdio/CBOR 也只是换一层适配。
- 非 HTTP 传输的现成参考：Pi 的 `pi-server` + `pi-client` + `pi-protocol`（CBOR，unix socket；**官方标注 experimental，只作参考不依赖**）。
- TUI 参考：Pi 的 `pi-tui`（差分渲染的终端 UI 库）。

## 7 构建与命令

| 命令 | 做什么 |
|---|---|
| `pnpm dev` | 后端（tsx watch）+ 前端（vite dev，代理 `/api`） |
| `pnpm build` | `vite build` → `frontend/dist`；后端 esbuild → `dist/server.mjs` |
| `pnpm start` | `node dist/server.mjs`（同时托管 `frontend/dist` 静态文件） |

不再有 Nitro 与 `.output/`。

## 8 依赖

- 保留：`pi` 链接包（agent-core / ai / coding-agent）、`hono`；前端自己的 react/vite/tailwind/radix 走 `frontend/package.json`。

## 9 验收

- 行为级：`pi/packages/evals`。
- 真链路：浏览器 + `curl`；每一步给出命令与数字。

## 10 明确不做

- 不做登录、不多用户（本机个人系统）。
- 不在后端做页面渲染。
- 不复用旧前端组件与旧设计数值；界面参考项目见 `docs/design/references.md`。

## 11 事件流与运行（2026-10-16 定）

- **一条流承载一个 Agent 的所有会话**：`GET /api/agents/:id/events?since=<seq>`；事件形状
  `{ seq, sessionId, type: "delta" | "done" | "error", text?, message? }`，`seq` 单调递增。
- **接上先给快照**（`snapshot`：当前 `seq` + 正在运行的会话列表）→ 刷新/断线可用 `since` 续传，
  多标签页/多端也可各自带 `since` 订阅同一条流。
- **发消息是命令，不是订阅**：`POST …/sessions/:sid/messages` 返回 `202 { accepted: true }`，
  输出只走事件流；这样"运行"与"传输"解耦，将来换传输（或加多路复用）不动业务。
- **运行注册表**在服务端按 `sessionId` 记录运行状态（running/done/error），供快照与列表使用。
- **并发上限与队列**（做定时/长期任务时落地）：模型调用并发有配额，运行要在调度层排队，
  不允许无限并发。
- 运行队列、会话列表 UI、多端续看都在这个形状上扩展，**不需要改协议**。
