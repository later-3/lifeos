# Life OS 文档入口

> 角色：总入口　类型：索引　状态：现状

三条规矩（用户 2026-10-18 定）：

1. **只写现在的事实**：文档与代码不一致时以代码为准，并且**当场**把文档改对或删掉；写不进代码依据的话不写。
2. **没实现的东西不进正式文档**：一句话登记在 [`todo.md`](./todo.md)（背景 / 是什么 / 要做什么），实现后再把事实写进对应文档。
3. 每份文档开头标 `角色 / 类型 / 状态`；`目标` 不等于已发布。

| 位置 | 管什么 |
|---|---|
| [`architecture/agent.md`](./architecture/agent.md) | Agent 是什么、由什么组成、每部分落在哪 |
| [`architecture/directory-structure.md`](./architecture/directory-structure.md) | 仓库与家目录的目录结构（只放现在要用的） |
| [`architecture/foundation.md`](./architecture/foundation.md) | 技术底座：家目录、接口面、前后端边界 |
| [`architecture/agent-memory.md`](./architecture/agent-memory.md) | 记忆：四种记忆（项目共享 / 用户 / Agent / Agent×项目私有）、读写权限、隔离与工具约定（设计稿） |
| [`design/frontend-structure.md`](./design/frontend-structure.md) | 前端界面结构与各区域规则 |
| [`design/frontend-path.md`](./design/frontend-path.md) | 前端开发路径（三道闸：token / primitive / 契约） |
| [`design/file-browser.md`](./design/file-browser.md) | 文件浏览器 |
| [`design/references.md`](./design/references.md) | 外观与交互的参考项目清单 |
| [`standards/development-harness.md`](./standards/development-harness.md) | 开发 Life OS 时怎么遵守交互 harness（自举） |
| [`standards/reference-baseline.md`](./standards/reference-baseline.md) | 参考基线：每个场景照谁做、借什么、不借什么 |
| [`standards/review.md`](./standards/review.md) | 代码检视与缺陷分级：四类检视、缺陷/质量/架构三分、交互交付四问、门禁 |
| [`todo.md`](./todo.md) | 未实现功能的登记（一句话） |
