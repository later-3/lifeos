# 后端代码规范

> 角色：架构 / 开发　类型：规范（代码）　状态：现行（2026-10-24）
>
> 场景与入口见仓库根 `AGENTS.md`；接口与事件**事实**见 `knowledge/architecture/agent.md`、`conversation.md`；本文只写代码写法。

## 怎么用

新增/修改路由、写实现、工具外壳时对照 §2；检视时逐条核对并给 `file:line` 证据。

## 2 条文

### 2.1 写操作的界面闭环在共享写实现里广播，入口不各自 notify

- 规则：HTTP 与 Pi 工具两条入口都调同一个共享模块；写成功由写层 `publish/broadcast` 事件，调用方不做通知；消灭"每个新入口都要记得传回调"的漏写。
- 依据：案例 C070（项目工具重构；事件总线/运行态拆模块）。机器检查：`pnpm test`（广播用例）。

### 2.2 骨架/初始化必须走共享 `ensure*`（create-only），多入口共用

- 规则：结构补齐（AGENTS.md、目录、索引）只写在共享模块（`src/project-skeleton.ts`）；新建与"读取时补"都调它；已存在文件永不覆盖。
- 依据：案例 C081/C082/C083（两入口缺一必漏；目录自解释）。机器检查：`test/project-registry.test.mjs`。

### 2.3 声明式创建一律幂等 create-or-return

- 规则：以稳定键（name/path/id）重复调用返回已有实体，不造第二个；不能复用的情况报错误 code，错误信息可行动。
- 依据：agent 工具真实重试事故（见 `src/agents.ts` createAgent 注释）；kubectl apply 语义（`knowledge/reference-baseline.md` 场景行）。

### 2.4 写文件 tmp+rename 原子；目录 0700、文件 0600；不覆盖已有

- 规则：持久层写入要么原子替换、要么有明确并发保护；家目录权限收敛按安装器同规则；"已存在"是正常分支不是异常。
- 依据：现行实现（`src/home.ts`、`src/project-skeleton.ts`）+ 案例 C001（安装一次性、启动只校验）。

### 2.5 新接口先写失败路径：存在/鉴权/非法入参各一条非 2xx 且断言原因

- 规则：接口交付之前其在错误时的响应已定义（资源不在→404 not_found；模板/参数→400/409；正在跑→409 等）；错误 body 必须含 code + message，不做"找不到"式掩盖。
- 依据：案例 C050（`No API key` 变 404"找不到"；每类缺陷的非 2xx 断言，`test/api.test.mjs`）。

### 2.6 业务动作只在共享模块，Pi 工具与 HTTP 都是外壳

- 规则：tools 调共享模块（同 HTTP），两外壳不再各写分支；工具 description 写权限与副作用，prompt 是补充不是唯一。
- 依据：现有分层（`agent-tools.ts` 头注、`tasks.ts`/`projects.ts` 单写实现）；案例 C074/C075（删除权限与描述要单独过一遍）。

### 2.7 参数解析/权限判定抽纯函数，可穷举

- 规则：scope/projectId→角色与边界、Task ID→目录等纯判定出独立模块，跨项目写/删等拒绝路径用穷举测试守住；业务模块不内嵌条件分支。
- 依据：案例 C080（记忆 resolve.ts 穷举）。机器检查：`test/memory-resolve.test.mjs`。

### 2.8 会话/轮次状态按"这一轮是否还在跑"推断，live 优先于结果有无

- 规则：没有结果≠已失败；挂起态用 running 判定，结束未果=未完成；工具结果只按 toolCallId 精确配对，不做"最后没有结果的"兜底。
- 依据：案例 C063/C065（工具块永久转圈、任务配错）。机器检查：`test/tool-state.test.mjs`。

### 2.9 错误必须可见：新代码不得静默吞错

- 规则：catch 要么处理、要么升级为可观察（日志/广播/返回错误结构）；存量静默 catch 按模块逐步消除。
- 依据：`specs/review/review.md` §7 存量缺口（迁自 review）。

### 2.10 运行日志前后端一致；只写事实/ID，不写正文/凭据

- 日志落 `~/.lifeos/logs/{backend,frontend}-<YYYY-MM-DD>.jsonl`（启动建目录，>14 天滚动）；逐行 JSON `{ts,level,module,fn,sessionId,turnId,agentId,projectId,msg,details?}`；
- 大模块清单（后端）：http / agent-host / assembly / tasks / registry / fs / sse（fn 为辅行）；前端另立文件，大模块：transport / run / ui；
- `debug` 静默默认，`info` 起可读；**正文与凭据零出现**——会话正文在会话 JSONL，密钥永不入日志；
- 每次 HTTP 常驻一条请求行（method/path/status/millis/requestId）；每回合终态一行 turn 事件（受理/完成/错误/丢失），便于事后按 turnId 单轮回放。

### 2.11 "默认跟随"必须覆盖模型与思考级别，显式覆盖必须落标记

- 规则：Agent 默认的模型与思考级别是同一套语义——未被用户显式覆盖的会话（含恢复的旧会话）必须跟随最新默认；显式覆盖必须写 Pi 自定义条目（`lifeos_model_override` / `lifeos_thinking_override`），不得靠"值相等"猜。
- 依据：2026-10-24 C120（lifeosagent 配 `max`，旧会话仍是 `medium`）。机器检查：`test/model-follow.test.mjs`。

### 2.12 事件分两级投递；过载即断线，绝不静默丢；快照与订阅同一同步块

- 规则：全局事件流中，**回合级**（turn/done/error/agents_changed）发给所有连接（不做焦点过滤）；**细节级**（delta/thinking/tool_*/retrying…）只发给焦点连接。每个连接按字节积压计数，超过上限或写入失败 → 摘除并关闭，客户端重连拿新快照；**不得静默丢弃**任何事件。快照与订阅必须在同一个同步块里生成（之后才允许 await），否则快照与缓冲会重复一条终态。
- 依据：2026-10-25 C122（参考项目的丢事件契约与 Open WebUI 的全量广播各有缺陷，取其正确部分）。机器检查：`test/event-bus.test.mjs`（T30–T36）、`test/bounded-sink.test.mjs`（T37–T38）、`test/sse-endpoint.test.mjs`（T43–T46）。

### 2.13 运行数据目录也必须有说明文件，检查器必须覆盖它们

- 规则：程序写入的运行目录（`logs/`、`state/`、`memory/data/` 等）由**创建者**写入 `AGENTS.md`（已存在不覆盖，`wx` 写入）；`home:check` 对存在的运行目录强制检查（不存在不报错）。
- 依据：2026-10-25 C122/C121 的排查中发现 `logs/` 与 `state/` 长期没有说明文件，而检查器对它们沉默。机器检查：`test/home-runtime-notes.test.mjs`（T58）。

### 2.14 长连接必须有客户端可见的心跳（具名事件），不能只靠注释帧

- 规则：服务端的心跳必须是具名事件（客户端可以监听并据此判断陈旧），不能只发注释帧（浏览器 EventSource 看不见）；心跳间隔与客户端陈旧阈值成对设定（阈值 ≥ 2 倍间隔）。
- 依据：2026-10-25 C124（注释心跳无法检测断开，页面假活着）。机器检查：`test/sse-endpoint.test.mjs`（心跳与连接契约）。

### 2.15 运行与未读事实必须携带会话归属（agentId / projectId），并能回填与清理

- 规则：运行快照、未读快照、回合级事件都必须带 `projectId`（前端的项目层聚合依赖它）；未读记录缺 `projectId` 时启动回填；回填不到或会话已不存在的记录清理（落盘）。
- 依据：2026-10-25 C125（缺 projectId 导致无法向上聚合；删除会话残留未读）。机器检查：`test/session-views.test.mjs`（T57、T60、T65）、`test/sse-endpoint.test.mjs`（T66）。

### 2.16 用户看见的派生名称（标题）必须在用户动作发生的那一刻生效，不能等落盘

- 规则：标题等派生名称在第一条消息发出时同步写入内存会话名（与重命名同一方法）；这一步必须在 POST 返回 202 之前完成。Pi 只在助手回复后才落盘，所以"等文件出现"会让标题晚于用户动作。首轮失败时不得删除待落盘登记（否则会话从列表消失）。
- 依据：2026-10-25 C127（标题要等首个回复才出现；模型不可用时新会话隐身）。机器检查：`test/session-title.test.mjs`（T70）。
