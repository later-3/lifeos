# Life OS 技术底座

> 角色：架构　类型：约束（设计定义）　状态：现状
> 2026-10-16 与用户确认：**A2 前后端分离**（前端 Vite SPA，后端独立 Node 进程）。

## 1 运行形态

```
frontend/   Vite + React SPA（纯静态产物，不含业务事实）
   │  HTTP/JSON + SSE
src/        后端：Node 进程，HTTP + 事件流（Hono）
   │
pi/         Pi SDK（子模块，固定 commit；Agent 运行时）
```

- 后端是**唯一事实源**；前端刷新即从后端重取，不依赖内存状态。
- 同仓布局：`src/`（后端）· `frontend/`（SPA）· `docs/` · `.lifeos/`（家目录模板）· `pi/`（子模块）。

## 2 Agent 运行时

- 用 Pi SDK：`@earendil-works/pi-coding-agent`（`createAgentSession` / `SessionManager` / `SettingsManager` / `DefaultResourceLoader` / `ModelRuntime`）+ `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`。
- Life OS 只负责：**配置装配、交互 harness 注入、会话托管、事件转发**；不自己实现 Agent 循环。
- 运行时宿主在 `src/agent-host.ts`（**不 import HTTP 框架**）；HTTP 层（`src/server.ts`）只是薄适配。
- 装配细节（agentDir / 模型优先级 / 注入方案 E）见 [`agent.md` §5](./agent.md)。

## 3 会话事实

- 会话 = Pi `SessionManager` 的 JSONL 文件，落 `agents/<id>/projects/<pid>/sessions/`；文件即事实，append-only。
- 会话、Agent 定义的**权威都在后端文件**；前端只做投影。

## 4 家目录（`~/.lifeos`）

```
config/                 唯一配置目录（models.json / auth.json / models-store.json / settings.json? / file-roots.json；含密钥，不进 Git）
interaction-harness/    通用层：协议正文、本层指引、飞轮、概念空间、案例、任务类型
agents/<id>/            每个 Agent 私有：agent.json · identity.md · avatar/ · projects/<pid>/（含 sessions/、project.json）
install-receipt.json    安装收据
```
骨架的**模板事实源 = 仓库根 `.lifeos/`**：`pnpm home:install` = 模板整树复制（家目录已存在则只提醒、不动任何东西）；服务启动只校验家目录存在，不创建、不覆盖。
环境变量只有 `LIFEOS_HOME`（读配置前告诉进程"家在哪"，测试与部署用）。

## 5 接口面（v1 最小集）

| 接口 | 作用 |
|---|---|
| `GET /api/agents` | 列出 Agent（扫描 `agents/*/agent.json`，**跳过归档 `archivedAt`**） |
| `POST /api/agents` | **创建助手** `{name, description?, identity?}` → id 由 name 生成 slug、建目录与 workspace 骨架（与 `lifeos_agent_create` 工具同一实现） |
| `DELETE /api/agents/:id` | **归档助手**（= 删除，可恢复）：写 `archivedAt`、数据全留；运行中 409、最后一个 400（与 `lifeos_agent_delete` 同一实现） |
| `GET /api/agents/:id` | 单个 Agent 定义（未知 404） |
| `PUT /api/agents/:id` | 基础信息（改名/描述，写 `agent.json` 原子） |
| `GET·PUT /api/agents/:id/identity` | 身份正文 `identity.md`（读/写） |
| `GET·PUT /api/agents/:id/config` | **Agent 个人模型默认**（`agents/<id>/projects/workspace/config.json`） |
| `GET /api/models-config` | 解析用户 `config/models.json` 为 provider/模型清单（**响应剔除一切密钥字段**；只读） |
| `POST·GET /api/agents/:id/avatar` | 头像：上传（png/jpg/webp≤2MB 魔数校验）/ reset 回自动 / 读图 |
| `GET /api/agents/:id/projects` | 项目列表 = **扫描 `agents/<id>/projects/` 目录 − `hiddenProjectIds`**；显示名：外部项目 = `basename(path)`，内部项目 = 目录名；默认项目在前 |
| `POST /api/agents/:id/projects` | **打开目录**（校验目录 → 同 path 幂等复用 → 否则 `pid=uuidv7`、建私有层目录并写 `project.json`） |
| `DELETE /api/agents/:id/projects/:pid` | **从列表移除**（写 `hiddenProjectIds`；目录、manifest、会话、记录全部保留；`workspace` 不可移除 400） |
| `GET /api/agents/:id/sessions` | 该 Agent 的会话列表（带 `running` 标记；未落盘的新会话按 pending 计入） |
| `GET /api/agents/:id/projects/:pid/sessions` | 某 project 下的会话列表（项目存在即 200，私有目录未建返回空列表） |
| `POST /api/agents/:id/projects/:pid/sessions` | 在某 project 下新建会话（**cwd：workspace = `~/.lifeos`；外部项目 = 项目 path**） |
| `POST /api/agents/:id/sessions` | 在默认 project（workspace）下新建会话（前端「＋新建会话」入口） |
| `GET /api/agents/:id/sessions/:sid` | 读消息（含 `thinking` / `toolCall` / `toolResult` 块） |
| `POST /api/agents/:id/sessions/:sid/messages` | 发一条消息（202 受理；run 在后台，输出走 SSE） |
| `GET /api/agents/:id/events`（SSE） | 一条流承载该 Agent 的全部会话：`snapshot` / `thinking` / `thinking_end` / `delta` / `tool_call` / `tool_result` / `done` / `error`；每条带 `seq`，`?since=` 可续传；**事件名 = 事件类型**（映射见 `src/stream-events.ts`） |
| `GET /api/agents/:id/sessions/:sid/entries` | **会话历史**：原始条目只读直出（`offset/limit` 分页、`labels`、`leafId`）；不投影、不改写，与会话 JSONL 逐条一致 |
| `PUT /api/agents/:id/sessions/:sid` | 重命名会话（写 Pi `session_info` 展示名） |
| `DELETE /api/agents/:id/sessions/:sid` | 删除会话（运行中 409） |
| `GET /api/fs/roots`、`POST /api/fs/roots` | 文件浏览器的根白名单（默认根 = 家目录；额外根持久化到 `config/file-roots.json`） |
| `GET /api/fs/tree`、`GET /api/fs/content` | 列目录 / 读文件（**resolve 后必须落在已注册根内**，越权 403） |
| `GET /api/fs/browse` | 目录选择器专用：任意路径只列子目录名（不读文件） |

### 5.1 路径里用的是 **id**（不是可改的显示名）

- 目录名 = URL 里那一段 = **id**，必须是稳定 slug：`^[a-z0-9][a-z0-9-]{0,63}$`（例：`lifeosagent`）。
- `name` 是**显示名**（可中文、可随时改），只用于界面展示，不进 URL、不被会话/配置引用。
- 不用"id 或 name 二选一解析"：两义性会带来改名后的歧义与冲突。

## 6 构建与命令

| 命令 | 做什么 |
|---|---|
| `pnpm dev` | 后端 `node --experimental-strip-types --watch src/main.ts`（默认 43120；`--port=` 可换） |
| `pnpm dev:web` | 前端 Vite dev（5173，代理 `/api` 到后端） |
| `pnpm build` | 后端 esbuild → `dist/server.mjs`；前端 → `frontend/dist` |
| `pnpm start` | `node dist/server.mjs`（同时托管 `frontend/dist` 静态文件） |
| `pnpm verify` | 门禁：typecheck + lint:tokens + test + test:ui |
| `pnpm stop` | 按端口优雅结束开发/发布进程（`--port=` 可指定） |

## 7 依赖

- 保留：`@earendil-works/pi-*`（agent-core / ai / coding-agent）、`hono` + `@hono/node-server`；前端自己的 react/vite/tailwind 走 `frontend/package.json`。

## 8 验收

- 行为级：`pi/packages/evals`（Pi 自带，按需使用）。
- 真链路：浏览器 + `curl`，每一步给出命令与数字；前端另有三道闸（token / primitive / UI 契约），见 [`frontend-path.md`](../design/frontend-path.md)。

## 9 明确不做

- 不做登录、不多用户（本机个人系统）。
- 不在后端做页面渲染。
- 不复用旧前端组件与旧设计数值（界面参考见 [`references.md`](../design/references.md)）。
- 不做多客户端接入（等真要做时再设计，见 [`todo.md`](../todo.md)）。

## 10 事件流（现状）

- **一条流承载一个 Agent 的所有会话**：`GET /api/agents/:id/events?since=<seq>`。
- **接上先给快照**（`snapshot`：当前 `seq` + 正在运行的会话列表）→ 刷新/断线可用 `since` 续传，多标签页各自带 `since` 订阅同一条流。
- **发消息是命令，不是订阅**：`POST …/sessions/:sid/messages` 返回 `202 { accepted: true }`，输出只走事件流（运行与传输解耦）。
- **运行注册表**在服务端按 `sessionId` 记录运行状态（running/done/error），供快照与列表使用。
