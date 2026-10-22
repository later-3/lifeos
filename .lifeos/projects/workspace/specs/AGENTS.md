# specs/（共享 workspace 规范层）

一个主题一个目录；`index.json` 是本层索引。所有 Agent 都加载本层规范。

- 目录名用英文（`agent-collaboration`、`frontend-development`）；
- 只写“具体场景下必须怎么做”，可执行、可检查；
- 规范正文只有一份；被提升时移动正文并在原处留指针；
- 本层不放 Life OS 专属规范；Life OS 的规范在项目 `lifeos` 的 specs。
