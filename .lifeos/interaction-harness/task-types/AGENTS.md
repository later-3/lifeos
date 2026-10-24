# task-types/（协议默认的任务类型模板）

每种类型一个子目录，内含：

- `template.json`：机器读（类别、必需文件、骨架）；
- `TEMPLATE.md`：给人读的说明；
- `AGENTS.md`：这一类 Task 的规则（承载什么、怎么维护）。

当前类型：`daily`（日常，默认 Task）、`development`（开发）、`general`（普通）。
选择顺序：Agent × 项目 → 共享项目 → 协议默认（协议 §3.7）；同一类型只用第一份。
