# 架构规范

> 角色：架构 / 开发　类型：规范（架构）　状态：现行（2026-10-24）
>
> 场景与入口见仓库根 `AGENTS.md`；架构**现状**（实现位置、数据流）见 `knowledge/architecture/`；本文只写约束。

## 怎么用

新增机制/模块时先对照 §2；改 `.lifeos` 模板或协议结构时按 runbook 顺序走结构闸（`pnpm home:check` + `test/doc-links.test.mjs` + `test/home.test.mjs`）；违反 = 架构缺陷。

## 2 条文

### 2.1 模板 = 唯一事实源：家目录结构与目录说明来自 `.lifeos` 模板

- 规则：安装与启动只复制/校验，不解析生成；通用目录说明以 `interaction-harness/skeleton/` 为唯一来源；代码不另写第二份结构清单。
- 依据：案例 C001/C002/C109；机器检查：`pnpm home:check` + `test/home.test.mjs`。

### 2.2 协议 = 结构源：改结构先改协议/模板再落码

- 规则：`.lifeos` 模板/家目录结构/装配文件集任何变化必须同轮更新协议条文与对应测试；"协议不变、代码改结构"是违规并视为缺陷。
- 依据：案例 C109（协议四处对账）；用户裁决"结构即事实、协议不写悬念"。

### 2.3 Pi SDK 复用白名单：先找 SDK 公开接口再自写

- 规则：会话（SessionManager）、模型（ModelRuntime）、设置（SettingsManager）与事件名沿用 Pi；不自研会话/模型/事件命名；用 Pi 新能力先读类型声明 `node_modules/@earendil-works/*/dist/*.d.ts`（与运行时同版本）与 `node_modules/@earendil-works/pi-coding-agent/docs/`（42 篇包内文档）。
- 依据：底座约束（`knowledge/architecture/directory-structure.md`/`foundation.md`）；用户拍板（方案 E：Pi 的 tools/rules 原样回填）。
- 2026-11-25 更新：Pi 由 submodule 改为 **npm 依赖 1.6.0**（`b662503`），依据是 fork 无定制、上游 API 全兼容、npm 包自带 `dist/providers/data`（43 JSON，消除网络依赖）。查 API 一律指向已安装包的 `dist/*.d.ts` —— 它与运行时**同版本**，比源码仓更不会说谎。

### 2.4 装配每轮重读会话指针；Task 切换只影响下一轮

- 规则：扩展每次在 `before_agent_start` 从会话指针重新装配；当前这一轮已装配的内容不改；会话对 Task 的引用以 ID（NNNN）为准，切换不重建会话。
- 依据：案例 C098/C110（"假切换"）。机器检查：`pnpm test`（before_agent_start 用例）。

### 2.5 TypeScript 无 any；跨文件契约（补丁/流事件）有纯函数与类型层

- 规则：不用 any 规避设计问题；prompt 补丁、流事件映射、模型裁决写成纯函数并穷举测试。
- 依据：案例 C071/C106/C110/C111（纯函数化后的回归覆盖都抓到了返工）。机器检查：`pnpm typecheck`（any 0 处）+ `pnpm test`。

### 2.6 密级边界：密钥只进 `config/`；机器特定内容只进 `runbook/`；公开机制进 `knowledge/`

- 规则：知识按"能否定位/登录/干扰系统"判密；本机运维记录不入仓库模板；架构/需求/页面设计命名入 `knowledge/`。
- 依据：2026-10-21 远程访问文档判密（项目 task 0001/0002 系列）＋`knowledge/architecture/remote-access.md` 的边界行。

### 2.7 「从这个 Task 读哪一份文档」只有一个实现，校验器与业务层共用（必须）

- 场景：任何需要拿到 Task 的 `task.md` / `AGENTS.md` / 各文档的代码——装配、列表、`ensureDailyShard`、
  结构校验（`pnpm home:check`）。
- 规则：
  - **必须** 只经由 `src/task-doc-path.ts` 的 `taskDocRootOf(taskDir, scope, dirName)` 得到读根，
    再由它拼文件名；**必须不** 在别的模块里自己 `join(taskDir, "task.md")`。
  - **必须** 判据是"工作区里那份 `task.md` 在不在"（协议 §3.7「读侧能穿透」），
    **必须不** 用"`home/` 目录存不存在"当代替——工作区可能建了一半。
  - **必须** 让结构校验也走这条判定，并在两个根上都检查：文档树读工作区，
    `evidence/` 这类不进版本控制的读主区。
- 为什么：2026-11-19 实测（Task 0029）——`home-check.ts` 自己拼 `join(dir, "task.md")`，
  于是 42 条"Task 缺少 task.md / 缺少 AGENTS.md"、20 条 Task 骨架缺失、2 条"缺少默认 Task"
  全是假阳性（工作区里一直都有）。这类漂移**不会报错**：读主区读到的是"上次合并的版本"或空，
  校验器把"我看不到"当成"不存在"。
- 同族条文：`specs/code/api/api.md` 2.7（同一个对象只有一个形状、一处实现）。
- 机器检查：`test/home-check-worktree.test.mjs`（T-A 工作区形态不报、T-A 活性：工作区里真缺时必须报；
  把 `checkTask` 改回读主区 → 必红）。
