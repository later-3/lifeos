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

- 规则：会话（SessionManager）、模型（ModelRuntime）、设置（SettingsManager）与事件名沿用 Pi；不自研会话/模型/事件命名；用 Pi 新能力先读 `pi/AGENTS.md` 与对应包文档。
- 依据：底座约束（`knowledge/architecture/directory-structure.md`/`foundation.md` + 底座目录 `pi/`）；用户拍板（方案 E：Pi 的 tools/rules 原样回填）。

### 2.4 装配每轮重读会话指针；Task 切换只影响下一轮

- 规则：扩展每次在 `before_agent_start` 从会话指针重新装配；当前这一轮已装配的内容不改；会话对 Task 的引用以 ID（NNNN）为准，切换不重建会话。
- 依据：案例 C098/C110（"假切换"）。机器检查：`pnpm test`（before_agent_start 用例）。

### 2.5 TypeScript 无 any；跨文件契约（补丁/流事件）有纯函数与类型层

- 规则：不用 any 规避设计问题；prompt 补丁、流事件映射、模型裁决写成纯函数并穷举测试。
- 依据：案例 C071/C106/C110/C111（纯函数化后的回归覆盖都抓到了返工）。机器检查：`pnpm typecheck`（any 0 处）+ `pnpm test`。

### 2.6 密级边界：密钥只进 `config/`；机器特定内容只进 `runbook/`；公开机制进 `knowledge/`

- 规则：知识按"能否定位/登录/干扰系统"判密；本机运维记录不入仓库模板；架构/需求/页面设计命名入 `knowledge/`。
- 依据：2026-10-21 远程访问文档判密（项目 task 0001/0002 系列）＋`knowledge/architecture/remote-access.md` 的边界行。
