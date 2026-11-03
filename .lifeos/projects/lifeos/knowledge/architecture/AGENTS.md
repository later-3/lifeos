# knowledge/architecture/

系统事实：组件、数据流、边界、实现位置。按主题一份文档。

| 文档 | 内容 |
|---|---|
| `agent.md` | Agent 的结构与配置 |
| `agent-memory.md` | 记忆体系 |
| `conversation.md` | 会话与回合 |
| `directory-structure.md` | 家目录结构 |
| `foundation.md` | 技术底座 |
| `identifiers.md` | 实体 id 规则（url 类 ASCII / fs 类可读名；不再静默生成随机 id） |
| `remote-access.md` | 跨设备访问 |
| `session-list-rendering.md` | 会话列表的渲染规模：实测规模/成本、折叠与行级 patch 的目标、**虚拟滚动的计划与触发条件**（当前暂不实施） |
| `tasks.md` | Task 生命周期：何时创建默认 Task、绑定链路、界面可见性、失败回滚 |
