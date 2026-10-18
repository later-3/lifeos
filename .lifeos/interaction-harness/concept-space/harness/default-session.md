# 默认会话

- **是什么**：随家目录模板出厂预置的一条会话（`agents/lifeosagent/projects/workspace/sessions/<ts>_<id>.jsonl`），第一条消息是 Life OS Agent 的打招呼与说明书；打开系统加载即显示。
- **不是什么**：不是运行时生成的（没有触发条件、没有写入动作、没有角标——就是一条普通会话）；第一句不是模型输出、也不是用户消息；不是常驻提示，只属于这一条会话。
- **归属**：文件驱动，只随 Life OS Agent 的模板装入；其他 Agent 没有默认会话。设计动机与机制见协议 §15.2。
- **显示名**：出厂预置为 `welcome to lifeos`（`session_info` name，可改名）；显示链 `name ‖ 首条用户消息（UI 截 50）`，无兜底——界面不显示“默认会话”。
