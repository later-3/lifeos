# specs/（Agent 私有 workspace 规范层）

本层只属于当前 Agent 的 workspace；所有项目都会加载这里的规范。

- 一个主题一个目录，`index.json` 是本层索引；
- 只放该 Agent 跨项目都要遵守的规范；
- 项目专属规范放该项目的 `specs/`，不要复制到这里。
