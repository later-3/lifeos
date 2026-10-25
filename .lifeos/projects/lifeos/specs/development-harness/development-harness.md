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

## 7 并行开发与交付切换（Life OS 专属）

> 起因（2026-10-24）：Coder 在共享 worktree 上开发 Life OS，改前端导致用户页面白屏/语法错误，跑 build/test 触发重启——**开发实例与用户实例必须分开**。

### 7.1 两类实例（必须分离）

| | 用户实例（你正在用的） | 开发实例（Coder 等） |
|---|---|---|
| 代码 | 主 worktree `/Users/xulater/Code/lifeos` | 独立 worktree，如 `~/Code/lifeos-dev/<agentId>`（`git worktree add`） |
| 数据 | `~/.lifeos` | 独立 `LIFEOS_HOME=~/.lifeos-dev/<agentId>` |
| 后端 | 43120 | 43130（`--port`） |
| 前端 | 5173，或主仓 `frontend/dist` | 5174（`VITE_DEV_API=http://127.0.0.1:43130 pnpm dev:web --port 5174`） |

- **必须** 开发 Life OS 时使用独立实例；**禁止** 与用户实例共用 worktree、`LIFEOS_HOME`、端口。
- **必须** 开发实例首次从模板安装独立家目录，不复制用户真实会话（避免写坏真实数据，见 C117）。
- **应该** 把 worktree 路径、home、端口写进当前 Task 的 `log.md`，便于交接与排查。

### 7.2 开发实例的启动与验证（应该）

```bash
# 1) 独立 worktree（一次）
git worktree add ~/Code/lifeos-dev/<agentId> -b dev/<agentId>

# 2) 独立家目录（一次）
cd ~/Code/lifeos-dev/<agentId>
LIFEOS_HOME=~/.lifeos-dev/<agentId> pnpm home:install

# 3) 开发实例（两个进程；改源码只重启这一个）
#    后端：pnpm 需要用 -- 透传端口（实测 pnpm run dev -- --port=43130 可用）
LIFEOS_HOME=~/.lifeos-dev/<agentId> pnpm run dev -- --port=43130
#    前端：vite 用 exec 传端口（实测可用）；它绑定 localhost，用 http://localhost:5174 访问
VITE_DEV_API=http://127.0.0.1:43130 pnpm --dir frontend exec vite --port 5174
```

- **应该** 在开发实例里跑 `pnpm verify`、手测、截图对比；
- **必须** 不在主 worktree 跑 `pnpm build`、`pnpm test:ui:update`、`pnpm home:install`。

### 7.3 交付与切换（必须走流程）

1. **必须** 开发实例验证通过（测试回执 + 手测证据）；
2. **必须** 给出变更摘要 + 验证证据 + 预览地址（43130 / 5174）；
3. **必须** 等用户确认；
4. **必须** 再合并到主 worktree（merge / cherry-pick），不在主 worktree 里边改边跑；
5. **应该** 在用户同意的时间窗重建并重启用户实例（43120）；
6. **必须** 切换后复验（首页、会话、关键路径），失败按回滚方案退回；
7. **必须** 把"改了什么、验证了什么、何时切换"记进 Task 的 `log.md`。

### 7.4 禁止项（必须）

- **禁止** 在用户实例运行期间修改主 worktree 的 `src/**`、`frontend/**`；
- **禁止** 在主 worktree 执行 `pnpm build`、`pnpm test:ui:update`、`pnpm home:install`；
- **禁止** 重启或 kill 用户实例、修改用户 `~/.lifeos` 数据；
- **禁止** 把"开发中"的状态当成"已交付"。

### 7.5 例外（可以）

- **可以** 在用户明确说"直接改当前实例"时按用户指示执行；**必须** 在 `log.md` 记录授权与影响范围。

### 7.6 其它运行环境约束（沿用）

- **应该** 不在有真实网页会话运行时 live-edit 服务端源码（案例 C116）。自 2026-10-25 起 `pnpm dev` 已改为 supervisor：有改动时先排空、等在跑的回合结束再重启，工具保证了这条；但重启前仍要确认没有人在关键回合里（supervisor 会等，不会打断）。
- **必须** 区分运行实例与开发实例：用户实例用 `pnpm start`（构建产物、不带热更新）或既有服务入口；`pnpm dev`（supervisor）只允许在开发实例使用，且**禁止绕过 supervisor 直接用 `node --watch` 起后端**（那会在回合中途杀进程，2026-10-25 事故）。
- **应该** 替换**被进程持有的**数据文件前先停后端：会话 JSONL（`sessions/*.jsonl`）被旧进程追加时用陈旧叶 id，写断 parent 链（案例 C117），顺序：停服务 → 备份 → 重装 → 起服务。**只改文档/知识类文件（如 `knowledge/`、`specs/` 下的 `.md`）不需要停服务，直接 `cp` 同步后 `diff` 验证（依据 Task 0002，2026-10-24）。
- **应该** 中断后先看 `logs/` 与 JSONL 尾条，用 `turns/last` 对账；不要把"没在跑"当"已完成"。

**依据**：C116（live-edit 杀回合）、C117（重装写断分支）、C118（Coder 共享 worktree 影响用户实例）。
