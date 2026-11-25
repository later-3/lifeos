# 用户层（`users/<uid>/`）

这里是**使用者本人**的空间（协议 §4.2.1）。用户不是 Agent：有自己的项目，但**没有对话能力**。

- `user.json`：用户实体（`id` / `name` / `avatar` / `createdAt`）；身份的唯一来源（`src/profile.ts`）；
- `avatar-<rev>.<ext>`：头像（有就落在这一层，不是子目录）；
- `AGENTS.md`：这份说明；
- `projects/<pid>/`：用户给 Agent 添加的每一个全局项目，各有一份（**含 `workspace`**），
  见 `layer-user-project.md`。

## 这里没有什么（每一条都有理由）

- **没有 `sessions/`**：用户层不提供对话能力。对话只发生在 `agents/<id>/projects/<pid>/sessions/`。
- **没有 `tasks/`、`task-types/`**：Task 属于 Agent × project。
- **没有 `memory/`**：用户记忆的物理位置仍是 `memory/user/<uid>/`（§3.11）。
- **没有 `specs/`、`cases/`、`flywheel.md`、`concept-space.md`**：用户层不参与 §4.3 的装配，
  放一份没人读的是陷阱。

## 什么时候读

- 需要在"用户自己的项目空间"里读写东西时（笔记、日记、待办、工具登记）；
- 需要回答"用户在这个项目下有什么"的时候。

## 怎么用

- `projects/<pid>/` 的目录名 = 全局项目 `projects/<pid>/project.json` 的 `id`，与 Agent 侧的绑定目录名一致；
- 需要 `uid` 时**从"读当前用户"那一条路径取**（`src/profile.ts` 的 `readProfile`），
  **不要**扫 `users/` 目录再取第一个 —— 那是"碰巧只有一个"，不是"结构上只有一个"。
