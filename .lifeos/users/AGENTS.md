# 用户层（`users/`）

使用者的空间容器（协议 §4.2.1）。**一个家目录只有一个使用者**，所以这里只有一个 `<uid>/` 目录。

- `AGENTS.md`：这份说明；
- `<uid>/`：使用者本人（`user.json` + 自己的项目空间）；每个 `projects/<pid>/` 下只有 `AGENTS.md` +
  `knowledge/`、`daily/`、`todo/`、`tools/` 四样；**没有 `sessions/`、`tasks/`、`task-types/`、`memory/`**；
- `<uid>/projects/workspace/`：默认项目的对应物（**在 `projects/` 下**，因为 `workspace` 本身就是全局项目）；
- `<uid>/projects/<pid>/`：每个全局项目一份，目录名 = `projects/<pid>/project.json` 的 `id`。

## 这里没有什么

- **不是 Agent 列表**：Agent 在 `agents/` 下。用户不是 Agent —— 没有对话能力，没有 `sessions/`。
- **不是登录/多租户**：一个家目录一个使用者，接口不带 userId、无鉴权。
- **不要扫目录取 uid**：uid 只从 `src/profile.ts` 的两个导出取 ——
  `currentUserId`（**读**，实体不存在时派生）与 `existingUserId`（**建**，`user.json` 真在才给）。
  `readdir(users/)` 取第一个是"碰巧只有一个"，不是"结构上只有一个"。
