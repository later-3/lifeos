# Task 说明

这是一个 Task（协议 §3.7）：有目标、需要落盘、可追溯的工作单元。Agent 与用户的交互以 Task 为粒度。

- `task.md`：整体状态与当前指针（唯一状态源）；
- 类型细则：`task-types/<类型>/AGENTS.md`（来自协议默认或本层覆盖，选第一份）；
- 日志：开发类是 `log.md`，日常类是 `daily/`（由类型决定）；
- `concept-space.md`、`flywheel.md`、`specs/`、`cases/`、`knowledge/`、`tools/`、`todo/`：与其他协作层相同的结构。

目录内的文件按 `task.md` 与类型细则读取，不整体加载。
