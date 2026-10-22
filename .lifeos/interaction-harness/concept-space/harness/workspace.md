# workspace

**是什么**：一个**特殊作用域**，不是普通用户项目。有两个同名层：

- 共享 workspace：`~/.lifeos/projects/workspace/`，所有 Agent 都加载；放 `specs/` 与共享记忆；**没有 path**，不对应一个用户目录。
- Agent 私有 workspace：`~/.lifeos/agents/<agentId>/projects/workspace/`，是该 Agent 的默认项目；放会话、daily、cases、todo、tasks。

**不指什么**：不是“所有数据共享”；私有记录仍只属于单个 Agent。也不把共享层改名为 `shared`：两层都叫 `workspace`，靠位置区分。
