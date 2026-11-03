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
- 工具 = 8 个 Pi 内置（`read/bash/edit/write/grep/find/ls/powershell`）+ 10 个 Life OS 自有（`lifeos_agent_create` / `lifeos_agent_delete` / `lifeos_task_create` / `lifeos_task_list` / `lifeos_project_add` / `lifeos_project_remove` / `lifeos_project_list` / `lifeos_memory_search` / `lifeos_memory_record` / `lifeos_memory_delete`）；**名字必须显式写进 `tools` 白名单**（Pi 的语义是 allowlist：不写就不启用）。
- 装配细节（agentDir / 模型优先级 / 注入方案 E）见 [`agent.md` §5](./agent.md)。

## 3 会话事实

- 会话 = Pi `SessionManager` 的 JSONL 文件，落 `agents/<id>/projects/<pid>/sessions/`；文件即事实，append-only。
- 会话、Agent 定义的**权威都在后端文件**；前端只做投影。

## 4 家目录（`~/.lifeos`）

```
config/                 唯一配置目录（models.json / auth.json / models-store.json / settings.json? / file-roots.json；含密钥，不进 Git）
interaction-harness/    协议目录：protocol.md · AGENTS.md · skeleton/（目录说明模板）· task-types/（协议默认的任务类型模板）
projects/               共享层：workspace/（所有 Agent 共享，无 path）· <pid>/（共享项目，project.json 在这里）
agents/<id>/            Agent 本身：agent.json · identity.md · tools/ · memory/ · projects/<pid>/（Agent × 项目：sessions/、tasks/、specs/ 等）
install-receipt.json    安装收据
```
骨架的**模板事实源 = 仓库根 `.lifeos/`**：`pnpm home:install` = 模板整树复制（家目录已存在则只提醒、不动任何东西）；服务启动只校验家目录存在，不创建、不覆盖。
环境变量只有 `LIFEOS_HOME`（读配置前告诉进程"家在哪"，测试与部署用）。

## 5 接口面（v1 最小集）

| 接口 | 作用 |
|---|---|
| `GET /api/agents` | 列出 Agent（扫描 `agents/*/agent.json`，**跳过归档 `archivedAt`**） |
| `POST /api/agents` | **创建助手** `{name, description?}`（参数只这两个）→ id 由 name 生成 slug、建与出厂模板同构的 workspace 骨架（与 `lifeos_agent_create` 工具同一实现） |
| `DELETE /api/agents/:id` | **归档助手**（= 删除，可恢复）：写 `archivedAt`、数据全留；运行中 409、最后一个 400（与 `lifeos_agent_delete` 同一实现） |
| `GET /api/agents/:id` | 单个 Agent 定义（未知 404） |
| `PUT /api/agents/:id` | 基础信息（改名/描述，写 `agent.json` 原子） |
| `GET·PUT /api/agents/:id/identity` | 身份正文 `identity.md`（读/写） |
| `GET·PUT /api/agents/:id/config` | **Agent 个人模型默认**（`agents/<id>/projects/workspace/config.json`）；保存时校验 provider/model **必须在 `config/models.json` 里**（否则 400 `model_not_found`）——默认只能从清单里来 |
| `GET /api/models-config` | 解析用户 `config/models.json` 为 provider/模型清单（**响应剔除一切密钥字段**；只读） |
| `POST·GET /api/agents/:id/avatar` | 头像：上传（png/jpg/webp≤2MB 魔数校验）/ reset 回自动 / 读图 |
| `GET /api/agents/:id/projects` | 项目列表 = **扫描 `agents/<id>/projects/` 目录 − `hiddenProjectIds`**；**目录名 = 项目名**（可读、允许中文；旧 uuid 目录懒迁移，`legacyId` 供旧 URL 反查）；默认项目在前 |
| `POST /api/agents/:id/projects` | **打开目录**（校验目录 → 全局项目按 path 幂等取 id → 绑定到 Agent；不写用户目录） |
| `DELETE /api/agents/:id/projects/:pid` | **从列表移除**（写 `hiddenProjectIds`；目录、manifest、会话、记录全部保留；`workspace` 不可移除 400） |
| `GET /api/agents/:id/sessions` | 该 Agent 的会话列表（带 `running` 标记；未落盘但**已命名**的会话按 pending 计入，没发过消息的草稿不计入） |
| `GET /api/agents/:id/projects/:pid/sessions` | 某 project 下的会话列表（项目存在即 200，私有目录未建返回空列表） |
| `POST /api/agents/:id/projects/:pid/sessions` | 在某 project 下新建会话（**cwd：workspace = `~/.lifeos`；外部项目 = 项目 path**） |
| `GET /api/agents/:id/projects/:pid/tasks` | 当前项目的任务清单（读 `tasks/*/task.md`，用于 `/task` 切换器） |

| `POST /api/agents/:id/sessions` | 在默认 project（workspace）下新建会话（前端「＋新建会话」入口） |
| `GET /api/agents/:id/sessions/:sid` | 读消息（含 `thinking` / `toolCall` / `toolResult` 块）+ **`meta`**（会话当前 `model`、`thinkingLevel`、**`running`**（这一轮是否在跑，前端判丢前先查它）、**`modelOverridden`**（是否用 `/model` 覆盖过））；失败的那条 assistant 带 **`error`**（Pi 原始 `errorMessage`）与 **`failure`**（归类：`timeout/network/auth/rate_limit/server/empty/aborted/truncated/unknown`，见 `src/failure.ts`）；工具结果**只按 `toolCallId` 配对** |
| `POST /api/agents/:id/sessions/:sid/messages` | 发一条消息（202 受理；run 在后台，输出走 SSE）；**`behavior: "steer"\|"followUp"`** = 生成中投入输入，直接走 Pi 原生 `steer()`/`followUp()` 队列 |
| `POST /api/agents/:id/sessions/:sid/abort` | **打断**当前 run（Pi `abort()`；run 的 finally 照常发 `done`） |
| `POST /api/agents/:id/sessions/:sid/compact` | **压缩上下文**（Pi `compact()`；会先 abort 当前 run） |
| `POST /api/agents/:id/sessions/:sid/model` | **会话级切模型** `{provider, model}`（Pi `setModel()`：写 `model_change`、不动全局默认）。失败分三种：404 `session_not_found` / 404 `model_not_found` / **409 `model_rejected`（Pi 原文案，如 `No API key for …`）** |
| `POST /api/agents/:id/sessions/:sid/thinking` | **会话级思考级别** `{level}`（Pi `setThinkingLevel()` 会按模型能力夹取；返回**实际生效值**，非法档位 400） |
| `GET /api/events`（SSE，全局） | 一条流承载**所有 Agent**：`snapshot`（`connectionId`、基线 `seq`、跨 Agent 运行列表、服务端未读）→ 回合级 `turn` / `done` / `error`（带 `kind`）/ `agents_changed` 发给所有连接；细节级 `thinking` / `thinking_end` / `delta` / `tool_call` / `tool_result` / `retrying` / `retry_end` 只发给焦点连接；每条带全局 `seq` 与 `agentId`；过载即断线（客户端重连重取快照）；10 秒具名 `ping` 心跳（客户端 25 秒无任何帧即判陈旧并重连，C124）。事件名 = 事件类型（映射见 `src/stream-events.ts`） |
| `PUT /api/events/focus` | 上报焦点：`{connectionId, agentId, sessionId, visible}`；可见时顺手记为已读；未知连接 404 |
| `GET /api/runtime` · `POST /api/runtime/drain` | 运行态（跨 Agent 在跑的回合）· 排空（开发 supervisor 用：拒绝新回合，等现有回合结束） |
| `GET /api/agents/:id/sessions/:sid/entries` | **会话历史**：原始条目只读直出（`offset/limit` 分页、`labels`、`leafId`）；不投影、不改写，与会话 JSONL 逐条一致 |
| `PUT /api/agents/:id/sessions/:sid` | 重命名会话（写 Pi `session_info` 展示名） |
| `DELETE /api/agents/:id/sessions/:sid` | 删除会话（运行中 409） |
| `GET /api/fs/roots`、`POST /api/fs/roots` | 文件浏览器的根白名单 = **打开过的目录历史**（默认根 = 家目录、永远第一；额外根持久化到 `config/file-roots.json`，**按最近使用排序**，重复打开只提前不重复） |
| `GET /api/fs/tree`、`GET /api/fs/content` | 列目录 / 读文件（**resolve 后必须落在已注册根内**，越权 403） |
| `GET /api/fs/browse` | 目录选择器专用：任意路径只列子目录名（不读文件） |

### 5.1 路径里用的是 **id**（不是可改的显示名）

- 目录名 = URL 里那一段 = **id**，必须是稳定 slug：`^[a-z0-9][a-z0-9-]{0,63}$`（例：`lifeosagent`）。
- `name` 是**显示名**（可中文、可随时改），只用于界面展示，不进 URL、不被会话/配置引用。
- 不用"id 或 name 二选一解析"：两义性会带来改名后的歧义与冲突。

## 6 构建与命令

| 命令 | 做什么 |
|---|---|
| `pnpm dev` | 开发 supervisor（`scripts/dev-supervisor.mjs`）：监听 `src/`，改动后先排空、等运行中的回合结束，再重启后端（默认 43120）；**不会在回合中途杀进程**。启动时先跑隔离自检（保留号 / 共用用户家目录 / 主 worktree / 共享日志 / 端口被占），不通过就 `exit 2` 不重试 |
| `pnpm dev:web` | 前端 Vite dev（5173，代理 `/api` 到后端）。Vite 监听 `[::1]`，端口占用探测要同时看 IPv4/IPv6 |
| `node scripts/dev-port.mjs claim/list/release` | 开发实例的端口分配与登记（`~/.lifeos/state/dev-ports.json`，全局唯一不跟 `LIFEOS_HOME`）；保留号 43120/5173 永不分配，号段后端 43130-43199 / 前端 5174-5199 |
| `pnpm build` | 后端 esbuild → `dist/server.mjs`；前端 → `frontend/dist` |
| `pnpm start` | `node dist/server.mjs`（同时托管 `frontend/dist` 静态文件） |
| `pnpm verify` | 门禁：typecheck + lint:tokens + test + test:ui |
| `pnpm stop` | 按端口优雅结束开发/发布进程（`--port=` 可指定） |

**端口保留（事实，Task 0016）**：主实例固定后端 `43120` / 前端 `5173`，属用户所有；开发实例从 `dev-port` 取号，不得占保留号。

## 7 依赖

- 保留：`@earendil-works/pi-*`（agent-core / ai / coding-agent）、`hono` + `@hono/node-server`；前端自己的 react/vite/tailwind 走 `frontend/package.json`。
- `undici`（^8，与 Pi 自带版本对齐）：只用于出站代理装配，见 §11。为什么不能用 Pi 的：那个函数没从包里导出。

## 8 验收

- 行为级：`pi/packages/evals`（Pi 自带，按需使用）。
- 真链路：浏览器 + `curl`，每一步给出命令与数字；前端另有四道闸（token / primitive / UI 契约 / 截图基线），见 [`frontend-spec.md`](../../specs/frontend-development/frontend-spec.md) §9。

## 9 明确不做

- 不做登录、不多用户（本机个人系统）；公网访问的身份门在部署层（Cloudflare Access），见 [`remote-access.md`](./remote-access.md)。
- 不在后端做页面渲染。
- 不复用旧前端组件与旧设计数值（界面参考见 [`reference-baseline.md`](../reference-baseline.md)）。
- 不做多客户端接入（等真要做时再设计，见 [`todo.md`](../../todo/todo.md)）。

## 10 事件流（现状）

- **一条全局流承载所有 Agent**：`GET /api/events`（任务 0007）。回合级事件全连接可见，细节级只给焦点（`PUT /api/events/focus`）。
- **接上先给快照**（`snapshot`：`connectionId`、基线 `seq`、跨 Agent 运行列表、服务端未读）；不回放历史；过载即断线，客户端重连重取快照。
- **发消息是命令，不是订阅**：`POST …/sessions/:sid/messages` 返回 `202 { accepted: true }`，输出只走事件流（运行与传输解耦）。
- **运行注册表**在服务端按 `sessionId` 记录运行状态（running/done/error），供快照与列表使用。

## 11 出站 HTTP 与代理（现状）

**要解决什么问题**：模型端点（如 `amr-link.open-design.ai`，走 Cloudflare）在部分网络环境下**直连不可达**，TCP 握手根本发不出去。不处理的话，每次模型调用都会卡到超时（实测每次正好 **10.5 秒**），对话完全不可用，而日志里只有一句 `Request timed out.`，看不出是网络层。

### 11.1 出站链路（事实）

```text
pi-ai → openai SDK → Shims.getDefaultFetch() → globalThis.fetch → undici 的全局 dispatcher
```

openai SDK 取 fetch 的实现只有一句（`openai/internal/shims.mjs`）：

```js
if (typeof fetch !== 'undefined') return fetch;   // 直接用 globalThis.fetch
```

**它自己不判断代理，一切交给全局 fetch 背后的 dispatcher。**

### 11.2 为什么 `NODE_USE_ENV_PROXY=1` 不够（这是踩过的坑）

Node 的 `NODE_USE_ENV_PROXY=1` 只让**内置 fetch 的默认 dispatcher** 读代理变量。而 `pi-ai` 用的 openai SDK 走的是**内置 undici 的 dispatcher**，两者是不同的实现 —— 所以那个开关对它无效。

实测证据（2026-11-03，后端进程环境里 `HTTPS_PROXY` 与 `NODE_USE_ENV_PROXY=1` 都在）：

```text
lsof -a -p <后端> -iTCP
  node  TCP 192.168.225.50:60262 -> 104.21.45.58:443 (SYN_SENT)   ← 直连卡死
                                                                   ← 一条到 127.0.0.1:7897 的连接都没有
```

每次请求 `durationMs` 都是 10505–10540ms（整数倍 = 连接超时特征），`stopReason=error`，`errorMessage="Request timed out."`。

**教训**：只验证"代理可达"（`node -e 'fetch(...)'` 拿到 401）**不等于**"后端真的走了代理"。那天就是因为只做了前者，误判成已修复，隔两周又犯一次。正确验证必须落在 **`lsof` 里出现到代理端口的连接** 上。

### 11.3 我们的做法（`src/http-proxy.ts`）

与 Pi CLI 的 `pi/packages/coding-agent/src/core/http-dispatcher.ts` 同一套机制：

```ts
undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent({ httpProxy, httpsProxy, noProxy }));
undici.install?.();   // 把 globalThis.fetch 换成与 dispatcher 配套的那份
```

- **必须在 `src/main.ts` 最早执行**：要早于任何出站请求。
- **`undici.install()` 不能省**：只换 dispatcher 不换 fetch，两者不配套（压缩响应会解压失败，Pi 那边的注释写明过这点）。
- **只在检测到代理变量时才做**：`HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`（大小写都认）任一存在才装；没有就整段跳过，**连 `undici` 都不 import**，行为与未改动前完全一致。
- **启动日志会明说装没装**：`出站代理已按环境变量启用：…` 或 `出站未配置代理（没有 … 环境变量）`。

### 11.4 不这样设计会遇到什么问题

| 不做的后果 | 表现 |
|---|---|
| 直连不可达的端点 | 每次请求卡 10.5 秒后失败，对话不可用 |
| 只设环境变量不装 dispatcher | 变量看起来"配好了"，实际仍直连（就是上面 11.2 的坑） |
| 只换 dispatcher 不 `install()` | 压缩响应解压失败，报错难懂 |
| 无条件 `install()` | 没代理时也替换全局 fetch，引入不必要的差异风险 |
| 依赖用户开 TUN 模式 | 换机器/换网络就得重配，Agent 自己起实例时也会踩 |

### 11.5 不用代理时会不会冲突

不会。`EnvHttpProxyAgent` 是"按环境变量决定"的：变量没了就直连，`NO_PROXY` 命中的地址也直连（本项目的 `NO_PROXY=127.0.0.1,localhost` 保证 Vite → 后端的本地请求不被代理接管）。清掉代理变量重启，代码走的就是"不安装"分支。

### 11.6 实现位置与验证

- 实现：`src/http-proxy.ts`（`installProxyIfConfigured` / `proxyUrlOf`），入口 `src/main.ts`。
- 测试：`test/http-proxy.test.mjs`（6 条）。关键的 `T0021-3` 断言 **HTTPS 请求以 `CONNECT` 真的打到了假代理端口**，而不是"函数被调用过"；`T0021-5` 断言 `NO_PROXY` 命中时直连；`T0021-6` 断言清空变量后不再安装。
- **测代理必须用 HTTPS**：明文 HTTP 走"绝对 URI 转发"（域名解析在代理端完成），用不可达域名测会得到"代理没收到请求"的假失败；HTTPS 走 `CONNECT` 隧道，连接目标直接写在请求行里。生产场景（模型端点）也都是 HTTPS。
- 端到端实测（2026-11-03，独立端口 + 真实家目录）：
  - 改动前：`-> 104.21.45.58:443 (SYN_SENT)`，会话 `error` / 10506ms；
  - 改动后：`-> 127.0.0.1:7897 (ESTABLISHED)`，同一会话 `toolUse` 成功回复。
- **依赖**：`undici@^8`（与 Pi 自带的 8.x 对齐）。Pi 的 `configureHttpDispatcher` 没有从包里导出（`ERR_PACKAGE_PATH_NOT_EXPORTED`），Node 内置模块也没暴露 `EnvHttpProxyAgent`，所以必须自己持有这个依赖。
- **坑（会静默失败）**：`EnvHttpProxyAgent` 的构造参数是**驼峰** `httpProxy` / `httpsProxy` / `noProxy`，不是 `HTTP_PROXY` 那种大写下划线。传错名字不会报错，只是代理装不上。
