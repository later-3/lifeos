# Life OS Development Rules

## 开始之前（每个任务）

- 交互 harness 协议常驻注入（装配层 `src/assembly.ts`：协议正文 + 当前 Task 的 `AGENTS.md` / `task.md` / 类型规则）；要讨论协议本身，读 `~/.lifeos/interaction-harness/protocol.md`。
- Life OS 的开发建设是一个项目（全局 id = `lifeos`）：**项目内容的事实源 = 仓库 `.lifeos/projects/lifeos/`**；安装副本 = `~/.lifeos/projects/lifeos/`。改了模板仓库文件后 `pnpm home:install` 重装（保留 `~/.lifeos/config/`），`pnpm home:check` 校验结构。
- 每个目录的说明文件 `AGENTS.md` 是协议条文（协议 §5.2）：背景与目的 · 里面有什么 · 什么时候读 · 怎么用；建目录即写说明，说明文字的通用模板在 `~/.lifeos/interaction-harness/skeleton/`。

## 场景入口地图（按顺序读）

| 场景 | 按顺序读（相对仓库根） |
|---|---|
| 前端改动 | `.lifeos/projects/lifeos/specs/frontend-development/process.md`（固定四步）→ `.lifeos/projects/lifeos/specs/frontend-development/frontend-spec.md` →（碰手机时）`.lifeos/projects/lifeos/specs/frontend-mobile/mobile.md` → `.lifeos/projects/lifeos/knowledge/design/<页面>.md` → `.lifeos/projects/lifeos/specs/code/frontend/code.md` |
| 后端 / 会话改动 | `.lifeos/projects/lifeos/knowledge/architecture/agent.md`、`.lifeos/projects/lifeos/knowledge/architecture/conversation.md`（先读事实）→ `.lifeos/projects/lifeos/specs/code/backend/code.md` |
| 接口 / 事件改动 | `.lifeos/projects/lifeos/knowledge/architecture/agent.md`、`.lifeos/projects/lifeos/knowledge/architecture/conversation.md`（先读事实）→ `.lifeos/projects/lifeos/specs/code/api/api.md` |
| 测试用例 | `.lifeos/projects/lifeos/specs/code/testing/testing.md`；检视时的证据规则见 `.lifeos/projects/lifeos/specs/review/review.md` |
| 检视 / 评审 | `.lifeos/projects/lifeos/specs/review/review.md` → 按范畴核对 `.lifeos/projects/lifeos/specs/code/` 对应条文 |
| 架构 / 底座 | `.lifeos/projects/lifeos/knowledge/architecture/directory-structure.md`、`.lifeos/projects/lifeos/knowledge/architecture/foundation.md`（事实现状）→ `.lifeos/projects/lifeos/specs/code/architecture/architecture.md`（约束） |
| 家目录结构 / 安装 | `.lifeos/projects/lifeos/knowledge/architecture/directory-structure.md` → `.lifeos/projects/lifeos/knowledge/architecture/foundation.md` → `pnpm home:check` |
| 记忆 | `.lifeos/projects/lifeos/knowledge/architecture/agent-memory.md` + `.lifeos/projects/lifeos/knowledge/requirements/agent-memory.md` |
| 新参考场景 | `.lifeos/projects/lifeos/knowledge/reference-baseline.md`：找不到场景行先补行，**不许用"行业惯例"当依据** |
| 远程访问 | 公开机制 `.lifeos/projects/lifeos/knowledge/architecture/remote-access.md`；本机运维记录 `~/.lifeos/projects/lifeos/runbook/`（仅本机，不进仓库） |
| 还没实现的东西 | `.lifeos/projects/lifeos/todo/todo.md` 一句话登记；实现后删除登记，把事实写进对应文档 |
| Task / 协作机制 | 协议 §3.7（Task 与类型）、§7（会话与指针）、§11（提升与维护）；类型规则在 `~/.lifeos/interaction-harness/task-types/<类型>/AGENTS.md` |
| 代码规范总目录 | `.lifeos/projects/lifeos/specs/code/AGENTS.md`（五环节归口边界；按上表各行分别进入对应正文） |

> 场景入口地图只回答"读哪份、什么顺序"；条文本身在对应正文里维护，本文件不复制条文。

## 工程原则（摘要；详细条文归 `.lifeos/projects/lifeos/specs/code/`）

- TypeScript 保持严格类型，不用 `any` 规避设计问题；不忽略输入校验、路径边界、并发与持久化错误。
- **以 Pi SDK 为底座**：复用它的公开接口与默认数据结构，不重复实现 Session、Agent、Tool；修改 `pi/` 前完整阅读并遵守 `pi/AGENTS.md`；`pi/` 是固定 Commit 的 Submodule。
- 运行数据写入必须具备原子性或明确的冲突保护；不把凭据、Cookie、Token、模型密钥或正式数据提交进 Git。
- **只放现在要用的目录与文件**；不为设想中的需求预建空壳；目录含义由该目录的 `AGENTS.md` 说明。
- 保留用户已有改动；不使用 `git reset --hard`、`git clean -fd`、`git checkout .` 等破坏工作区的命令；只暂存当前任务明确修改的文件，不使用 `git add .`。
- **未经用户明确要求，不提交、不推送、不部署。**

## 模型配置

- 格式：与 Pi Agent 一致（`https://github.com/earendil-works/pi`）
- 存放位置：`~/.lifeos/config/models.json`（含密钥，永不进 Git）

## 验证

- `pnpm typecheck`、`pnpm test` 为基础门禁；前端改动按前端行的顺序走四步后再过 `pnpm verify`（typecheck + lint:tokens + test + test:ui）。
- 家目录或模板结构改动后运行 `pnpm home:check`（结构不符合协议即失败）。
- 数值/颜色只在 `frontend/src/design/tokens.css`，控件只在 `frontend/src/design/`，布局宽度只改 `design/layout.ts`；视觉变化必须回应截图基线 diff（`pnpm test:ui:update` + 人眼确认）。
