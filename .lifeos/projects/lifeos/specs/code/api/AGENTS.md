# api/（前后端交互规范）

> 角色：架构 / 开发　类型：规范索引　状态：现行（2026-10-24；条文见 `code.md`）

- **管**：响应包裹（列表 `{items}`）、错误结构（`{error:{code,message}}`）、SSE 事件名=事件类型、状态码语义（资源存在但操作失败的类别与原因字段）。
- **不管**：每个接口的实际清单（事实，`knowledge/architecture/agent.md`）；前端对事件的消费方式（`knowledge/architecture/conversation.md`）。
- **正文**：`api.md`（现行 2026-10-24）。
- **检查**：`pnpm test`（接口测试至少一条非 2xx 且断言原因）。
