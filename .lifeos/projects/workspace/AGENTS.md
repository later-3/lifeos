# 共享 workspace（项目层）

这是**所有 Agent 共享**的特殊项目，id = `workspace`。
它与每个 Agent 私有的 `~/.lifeos/agents/<agentId>/projects/workspace/` **同名但不同层**：

| 位置 | 作用 |
|---|---|
| `~/.lifeos/projects/workspace/` | 跨 Agent 共享：`specs/`、共享记忆；所有 Agent 都加载 |
| `~/.lifeos/agents/<agentId>/projects/workspace/` | 该 Agent 的私有 workspace：会话、daily、cases、todo、tasks |

## 这里放什么

- `specs/`：所有 Agent 都应遵守的规范（按主题分目录；索引 `specs/index.json`）；
- `memory/`：共享记忆（由记忆工具读写，不要手改数据库）；
- 不放任何 Agent 的会话、daily、cases、todo 或任务；这些在私有 workspace。

## 边界

- 正文只放一份；需要项目专属规范时放 `~/.lifeos/projects/<projectId>/specs/`；
- 规则变化改原文件，不建平行第二份；被提升/移动时在原处留指针；
- 不把凭据、Token、Cookie、私钥写进本层。
