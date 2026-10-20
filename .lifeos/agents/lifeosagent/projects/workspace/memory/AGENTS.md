# memory/

agent 的项目记忆（私有，MemOS 本地存储）。

- 属于当前 Agent × 当前项目，别的 Agent 读不到；
- 由记忆工具读写（`lifeos_memory_search/record/delete`），**不要手改数据库文件**；
- 空目录正常：第一次写入时才创建 SQLite。
