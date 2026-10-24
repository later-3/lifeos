# backend/（后端代码规范）

> 角色：架构 / 开发　类型：规范索引　状态：现行（2026-10-24；条文见 `code.md`）

- **管**：Hono 路由写法；数据写入（原子替换、create-only、权限收敛）；共享写实现（广播/骨架在同一层做，入口不各自 notify）；Pi SDK 复用锚点。
- **不管**：接口事实清单与会话事实（`knowledge/architecture/agent.md`、`conversation.md`）；会话事件映射的实现说明（`src/stream-events.ts` 注释）。
- **正文**：`code.md`（现行 2026-10-24）。
- **检查**：`pnpm typecheck` · `pnpm test`。
