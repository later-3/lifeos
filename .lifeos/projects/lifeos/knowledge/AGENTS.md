# knowledge/

知识库：可复用的领域知识，就是文档。

- 按主题组织，不按时间；
- 每条写清出处（来源 + 日期）与失效条件；
- 来源变了，在条目里写明；过期的更新或删除。

## 怎么找（按需要读，不常驻）

这里只给目录索引；具体某份文档的内容由下一层 `AGENTS.md` 列：

| 想找什么 | 进哪 |
|---|---|
| **系统事实**：组件、数据流、边界、实现位置（如检视模式、会话、记忆、家目录结构） | [`architecture/`](./architecture/AGENTS.md) |
| **单个页面的设计**：背景、数据与关系、交互、状态（对话页、文件面板、助手配置…） | [`design/`](./design/AGENTS.md) |
| **需求**：场景、功能需求、权限、验收 | [`requirements/`](./requirements/AGENTS.md) |
| **对标项目与"借什么/不借什么"** | [`reference-baseline.md`](./reference-baseline.md)（每个场景一行；技术栈清单在共享 workspace 的 `knowledge/reference-projects.md`） |
