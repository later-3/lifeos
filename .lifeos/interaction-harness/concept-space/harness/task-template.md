# 任务模板覆盖

**是什么**：创建 Task 时选一份模板，优先级：Agent×项目 → 项目共享 → Agent workspace → 协议默认（`task-types/<type>/`）。

**不指什么**：不是把四层模板合并；不是规范加载（规范逐层追加、不覆盖）。机器可读部分是 `template.json`，`TEMPLATE.md` 是给人读的说明。
