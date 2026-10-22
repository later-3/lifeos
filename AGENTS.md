# Life OS Development Rules

## 参考基线与自举

- 新增机制/命名前，先在 `docs/standards/reference-baseline.md` 找到对应场景行；找不到就先补行——**不许用"行业惯例"当依据**。
- 我们开发 Life OS 的过程按交互 harness 走：落点与每轮动作见 `docs/standards/development-harness.md`。

## 文档与结构

- 目录结构以 `docs/architecture/directory-structure.md` 为准；技术底座以 `docs/architecture/foundation.md` 为准。
- 文档入口与标签见 `docs/README.md`（按场景进入；每份文档开头标 `角色 / 类型 / 状态`；`目标`不等于已发布）；每类文档的作用、边界与更新规则见 `docs/AGENTS.md`。
- **未实现的东西不写进正式文档**：一句话登记在 `docs/todo.md`（背景 / 是什么 / 要做什么）；实现后删掉登记，把事实写进对应文档。
- 协作规范与资产（概念空间、飞轮、正反案例、每日记录、Todo）在用户的交互 harness 目录 `~/.lifeos/interaction-harness/`，**不在仓库里复制副本**。
  - **做事前**：读该目录的 `AGENTS.md`（本层指引：角色与责任、阅读顺序、部件与关系、七个板块协议、版本控制）、`protocol.md`，以及 `task-types/` 中与当前任务相关的细则。
  - **每轮结束（交付回复之前，不可跳过）**：新正反例 → `cases.md`；可复用结论 → `flywheel.md`；当天记录 → **当前工作项目**下 `daily/<今天>.md`（默认 = `~/.lifeos/agents/<agent>/projects/workspace/`；打开外部项目后 = 该项目 `projects/<pid>/`；**追加**，时间戳由程序生成）；遗留事项 → 同目录 `todo/`。

## 模型配置

- 格式：与 Pi Agent 一致（`https://github.com/earendil-works/pi`）
- 存放位置：`~/.lifeos/config/models.json`

## 工程原则

- **只放现在要用的目录与文件**；未来演进到了再建（见目录结构文档的"不建"清单）。不为设想中的需求预建空壳。
- 优先复用 Pi 公开接口与默认数据结构（`pi/` 子模块），不在 Life OS 重复实现 Session、Agent、Tool 或 ResourceLoader；修改 `pi/` 前完整阅读并遵守 `pi/AGENTS.md`。
- 命名一律写全：**交互 harness**（代码/文件用 `interaction-harness`），不单独说 harness。
- 先读相关设计与现有实现，再改统一入口；不为单个需求旁路既有框架。
- 模块职责单一、接口窄、数据流明确；不用抽象掩盖简单逻辑，不把简单问题扩展成新子系统。
- TypeScript 保持严格类型，不用 `any` 规避设计问题；不忽略输入校验、路径边界、并发与持久化错误。
- 运行数据写入必须具备原子性或明确的冲突保护；不把凭据、Cookie、Token、模型密钥或正式数据提交进 Git。
- 保留用户已有改动；不使用 `git reset --hard`、`git clean -fd`、`git checkout .` 等破坏工作区的命令。
- 不创建无归属的备份文件；不写"仅历史"的残留说明——不要的东西直接删。

## 前端开发流程

- **任何前端改动**（页面、布局、交互、响应式、视觉）先读 `docs/standards/frontend-development.md`，按固定四步走：核对规范 → 缺口补规范（参考证据 + 断言）→ 按规范开发 → 复盘。
- 没有规范覆盖表、参考证据和用户拍板，不写代码；桌面规范不能直接套手机；同一用户对象的信息/动作保持整体（如 TurnStatusBar）。
- 会话类前端对照当前 Pi TUI 基线；已知差距登记 `docs/todo.md`，不以“前端更丰富”为理由缺失。

## 验证

- 前后端改动完成后运行 `pnpm test` 与 `pnpm build`（这两条命令在实现第一步落地，落地前以实际存在的命令为准）。
- 前端改动先读 `docs/design/frontend-spec.md` 和当前页面文档（`docs/design/<page>.md`），再走四道闸：`pnpm verify`（typecheck + lint:tokens + test + test:ui）。数值/颜色只在 `frontend/src/design/tokens.css`，控件只在 `frontend/src/design/`，布局宽度只改 `design/layout.ts`；视觉变化必须回应截图基线 diff（`pnpm test:ui:update` + 人眼确认）。
- 针对性测试覆盖真实场景与边界，不能只断言实现细节；测试通过不代表架构正确，提交前还要核对文档、配置与真实行为是否一致。

## Git

- 只暂存当前任务明确修改的文件，不使用 `git add .` 或 `git add -A`。
- 未经用户明确要求，不提交、不推送、不部署。
- `pi/` 是固定 Commit 的 Submodule；父仓库记录的 Commit 才是部署事实。
