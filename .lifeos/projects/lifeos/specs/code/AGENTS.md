# code/（代码规范）

> 角色：架构 / 开发　类型：规范索引　状态：**现行**（2026-10-24 五份正文落地：37 条；吸收方案经用户确认）

## 背景与目的

Life OS 的开发与检视遵守同一组代码规范（前端 / 后端 / 测试 / 前后端交互 / 架构）。这里只放 Life OS 专属条文；协议与场景入口在仓库根 `AGENTS.md`。

## 归口边界（谁管什么）

| 子目录 | 管（条文唯一正文） | 不管（归口在别处，只引用） |
|---|---|---|
| `frontend/` | TypeScript、组件与状态写法、token 引用、可测性 | 视觉与交互规则 → `specs/frontend-development/frontend-spec.md`；手机 → `specs/frontend-mobile/mobile.md`；页面数据交互 → `knowledge/design/` |
| `backend/` | Hono 路由写法、数据写入（原子性/权限/create-only）、Pi SDK 复用点 | 接口事实清单 → `knowledge/architecture/agent.md`；会话事件事实 → `knowledge/architecture/conversation.md` |
| `testing/` | 测试怎么写、隔离、断言原因、门禁活性 | 检视流程与结论分级 → `specs/review/review.md` |
| `api/` | 接口设计约束：响应包裹、错误结构、SSE 事件命名、状态码语义 | 实际接口清单（事实）→ `knowledge/architecture/agent.md` |
| `architecture/` | 架构约束：模板=唯一事实源、协议=结构源、装配每轮重读、语言与类型基线 | 架构现状与实现位置 → `knowledge/architecture/` |

## 什么时候读 / 怎么用

- 开发前：读对应子目录的 `AGENTS.md` 与正文条文；检视时逐条核对并给出证据（检视流程见 `specs/review/review.md`）。
- 条文格式：规则（应该/不应该 + 一句本质）→ 依据（案例编号 / 上游文件行 / 参考项目）→ 检查（门禁命令 或 检视问题）。
- 登记：各子目录正文落地后才写进本项目的 `specs/index.json`，避免装配空条目。

## 现状

五份正文已落地（2026-10-24）：`frontend/code.md` 9 条 · `backend/code.md` 9 条 · `testing/testing.md` 7 条 · `api/api.md` 6 条 · `architecture/architecture.md` 6 条，共 37 条。每条 = 规则（本质一句）+ 依据（案例编号/上游锚点）+ 检查（命令或检视问题）。旧条文迁移与场景去重见项目 Task 0002 的 `log.md`。
