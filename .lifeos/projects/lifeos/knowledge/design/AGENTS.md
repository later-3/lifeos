# knowledge/design/

单个页面的设计：背景、数据与关系、交互、状态、范围外。一个页面一份文档；跨页面规则放在 `specs/frontend-development/frontend-spec.md`。

| 文档 | 内容 |
|---|---|
| `chat.md` | 对话页：布局、消息、输入框、状态 |
| `file-browser.md` | 文件浏览器 |
| `agent-config.md` | 助手配置弹窗 |
| `image-input.md` | 图片输入：支持情况、约束表（唯一事实源）、错误码、实测记录 |
| `review-panel.md` | **检视面板**：入口、数据与关系、交互（起意见/回复/关闭/复制）、布局、六种状态、范围外 |
| `im/` | **IM 版界面（v2 目标设计）**：设计语言 + 5 份页面文档；落地时取代上面同名页面文档，见 `im/AGENTS.md` |
| `layout-model.md` | **前端布局模型（统一路线）**：三层骨架、rail 双语义、设置骨架、可拖宽列契约（`ResizeColumn` / `data-resize-key` / 上限规则 / 机器检查） |
| `frontend-architecture-audit.md` | **前端架构自检**（2026-11-09）：分层现状、与对标项目的可核对优势、差距清单、代码质量项、规范刷新记录 |
| `theme-systems/` | **三个参考产品的主题系统源码级分析**（LobeHub / LibreChat / novu）+ 横向择优决策表；改主题或布局前先读，见 `theme-systems/AGENTS.md` |
