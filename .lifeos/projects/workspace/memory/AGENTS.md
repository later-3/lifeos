# memory/（共享 workspace）

所有 Agent 都可读/写/删的共享记忆（MemOS 本地存储）。

- 由记忆工具读写，**不要手改数据库文件**；
- 空目录正常：第一次写入时才创建 SQLite；
- 不放某个 Agent 的私有记录（会话、daily、cases、todo、tasks）。
