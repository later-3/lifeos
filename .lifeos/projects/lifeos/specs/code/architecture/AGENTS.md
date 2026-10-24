# architecture/（架构规范）

> 角色：架构 / 开发　类型：规范索引　状态：现行（2026-10-24；条文见 `code.md`）

- **管**：以 Pi SDK 为底座的复用约束（不自研会话/模型/事件）；`.lifeos` 模板=家目录结构与目录说明的唯一事实源；协议=结构源（改结构必过 `pnpm home:check`）；装配每轮重读会话指针；TypeScript 与类型基线。
- **不管**：架构现状与实现位置（`knowledge/architecture/`）；目录树本身（那个是事实，不是条文）。
- **正文**：`architecture.md`（现行 2026-10-24）。
- **检查**：`pnpm home:check` · `pnpm test`。
