# tasks/

任务根目录。**任务目录按需创建，不预建**：

```
tasks/<NNNN>-<标题>/task.md
```

- 编号在项目内连续（四位）；中文标题允许；
- `task.md` 是唯一状态源（类型 / 类别 / 状态 / 目标 / 必需文档 / 当前指针）；
- 模板在 `~/.lifeos/interaction-harness/task-types/<type>/`（development 分 A/B/C，general 只写背景+步骤）；
- 已完成的任务保留，不删除（除非用户明确要求）。
