# 默认 Task 与 activeTask

**默认 Task**：每个 Agent × Project × 日期有一个默认 Task（`daily-YYYY-MM-DD`，general/G）。当天普通会话自动使用/创建它，是沉淀与迭代的落点。

**activeTask**：会话通过 `activeTaskId` **引用**当前 Task，不是绑定；同一 Task 可被多个会话引用，会话可切换。旧会话没有该引用时，不伪造 Task。

**日期**：任务目录平铺 `tasks/<NNNN>-<标题>/`，日期写 `task.md` 的 `日期：YYYY-MM-DD`；不建日期物理目录。
