# 用户在项目下的空间（`users/<uid>/projects/<pid>/`）

用户在这个项目下的空间（协议 §4.2.1、§5.1）。**它只有四类内容**，不是协作层的完整拷贝。

- 目录名 `<pid>` = 全局项目 `projects/<pid>/project.json` 的 `id`（与 Agent 侧绑定的同一个 pid，§5.3）；
- `knowledge/`：成文笔记；
- `daily/`：日记（用户层没有 Task，所以这类内容落在层上）；
- `todo/`：用户自己的待办；
- `tools/`：用户的工具登记。

`workspace` 也是一个 `<pid>`（它本身就是全局项目），所以这份说明对 `users/<uid>/projects/workspace/` 同样成立。

## 这里没有什么（每一条都有理由，别"照着 Agent 层抄"就加回来）

- **没有 `sessions/`**：用户层不提供对话能力。对话在 `agents/<id>/projects/<pid>/sessions/`；
- **没有 `tasks/`、`task-types/`**：Task 属于 Agent × project（§3.7）；
- **没有 `memory/`**：用户记忆的物理位置仍是 `memory/user/<uid>/`（§3.11），再放一份 = 第二处事实源；
- **没有 `specs/`、`cases/`、`flywheel.md`、`concept-space.md`**：它们的作用是"被装配 / 被加载"，
  而用户层不参与 §4.3 的装配——放一份没人读的正是架构规范的陷阱。

## 什么时候读

需要读写"用户自己在这个项目下的东西"时（笔记、日记、待办、工具登记）。
目录名与全局 pid 对不上就是缺陷（`pnpm home:check` 会报）。
