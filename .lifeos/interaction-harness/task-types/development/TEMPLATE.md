# 任务模板（development）

> 协议在固定路径下，不存在"版本"概念。

**这是"功能开发"这类任务的基础内容**：一份任务清单（`task.md`）的字段骨架，加三个类别各自要哪些文档。
**只放基础内容**；具体子类型（design / feature / refactor / protocol / research / review / fix）的细化模板，
遇到真实需求时再加，不提前做。

## 1 任务清单 `task.md`（每个任务目录一份）

```md
# <任务名>

类型：development          ← 任务领域（对应项目声明的 taskTypes）
类别：A 改产品行为          ← A 改产品行为 / B 改协作规范 / C 只出结论
状态：进行中（P3 5/9）      ← 与 unit 卡一致；只在这里写状态，别处只引用
负责人：<agentId> ｜ 记录者：<agentId>
日期：YYYY-MM-DD            ← 平铺目录 + 字段；不建日期目录
默认：否                   ← 当天 Agent×Project 的默认 Task 写“是”
目标：一句话（可验收）
必需文档：01-background · 02-design · 03-phase · 04-plan · phases/
当前指针：下一步做什么 / 卡在哪
```

## 2 按类别放文档（基础）

| 类别 | 判据 | 必需文档 | 最小骨架 |
|---|---|---|---|
| **A 改产品行为** | 用户可观察的行为、配置、接口、界面会变 | `01-background` · `02-design` · `03-phase` · `04-plan` · `phases/Pn/units/NN-*.md` | 背景写现状事实与完成标准；设计写抽象定义 + 逐项链路；阶段按设计对象端到端拆；unit 写目标/输入/输出/自检/状态 |
| **B 改协作规范** | 只改"怎么协作/怎么做事"，产品行为不变 | `01-background` · `02-plan` | background 写触发案例；plan 写变更点、影响面、生效与回滚 |
| **C 只出结论** | 不改产品也不改协作，只回答一个问题 | `01-background` · `02-plan`（或单文件） | 结论前置 + 依据（文件/命令/实测）+ 未验证项 |

## 3 与其它层的引用关系

- **机器模板**：同目录 `template.json` 定义类别与必需文档；`TEMPLATE.md` 只解释给人看；项目可在 `task-types/development/` 覆盖（四层选一份，不合并）；
- **规范**：本任务适用的规范在共享 workspace / 项目 / Agent / Task 的 `specs/`；做取舍引用规范，不在这里复制；
- **概念**：用词以 `concept-space.md` 为准；
- **项目级**：项目自己的规范在项目仓库里（**不属于 harness**）；本 Agent 对该项目的记录与指引在 `~/.lifeos/agents/<agentId>/projects/<projectId>/`；
- **Agent 专属**：`~/.lifeos/agents/<agentId>/`（项目内私有：`.../projects/<projectId>/`）。
