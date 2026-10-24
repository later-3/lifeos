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
