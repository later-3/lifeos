# Task 的生命周期

**角色**：系统事实 · **类型**：架构 · **状态**：现状（2026-10-25 核对源码与实测）

这份文档回答四件事：Task 什么时候被创建、默认 Task 从哪来、谁在维护它、界面上在哪能看到。

## 1 数据放在哪

| 东西 | 位置 | 说明 |
|---|---|---|
| Task 目录 | `~/.lifeos/agents/<agentId>/projects/<projectId>/tasks/<NNNN-标题>/` | 每个 Agent × 项目一份，互不共享 |
| Task 身份 | 目录名 `NNNN-标题` + `task.md` 的 `ID / 类型 / 类别 / 状态` | 编号四位，按项目内递增 |
| 会话指向哪个 Task | 会话 JSONL 里的 `ACTIVE_TASK_ENTRY` 自定义条目（`{ taskId, at }`） | **会话级**，可切换，不把会话钉死在一个 Task；反查用 `sessionsOfTask()`（全扫，不建索引，Task 0015） |
| Task 的归属与参与者 | `task.md` 的 `归属：<agentId>/<projectId>/<NNNN>` + `参与者：a, b, user` | **归属 = owner，恒 1**（必须等于目录的 agentId，可校验）；**参与者 ≥ 0**，含其他 Agent 与用户，**可以不含用户**（纯 Agent 自动建的 Task）。2026-11-02 起替掉旧的 `负责人/记录者` |
| 默认 Task 的判定 | `task.md` 的 `类型：daily`（`src/tasks.ts` `isDefault: type === "daily"`） | `daily` 是系统保留类型，手动新建会被拒（`reserved_type`），所以一个项目最多一个默认 |

## 2 默认 Task 什么时候创建（四个时机）

| # | 时机 | 位置 | 说明 |
|---|---|---|---|
| 1 | 建 Agent | `src/agents.ts` | 给它的 `workspace` 建默认 Task |
| 2 | **添加（绑定）项目** | `src/projects.ts` `bindAgentProject` | 新建绑定和重复绑定都会走，幂等 |
| 3 | 新建会话 | `src/agent-host.ts` `createSession` | 兜底：项目还没有默认 Task 时补建 |
| 4 | 恢复旧会话（文件里没有 Task 指针） | `src/agent-host.ts` `getSession` | 兜底补建；失败静默忽略，会话仍然可用 |

幂等与并发：`ensureDefaultTask` 先查 `isDefault`，有就返回；同一 Agent × 项目 的并发调用由进程内锁合并（`defaultLocks`）。

编号：默认 Task 通常拿到 `0001`，因为绑定项目时 tasks 目录还是空的；如果目录里已有 Task，就取「最大编号 + 1」。

## 3 绑定项目的完整链路

```
POST /api/agents/:id/projects { path }
  → src/projects.ts bindProject
      → registerProject                     解析路径、查重（同 path 幂等）
          → ensureGlobalProject             全局身份 projects/<id>/project.json（协议 §5.3）
          → bindAgentProject
              → ensureAgentProjectLayer     Agent 层骨架（create-only）
              → ensureDefaultTask           默认 Task（失败 = 绑定失败）
  → 返回 { project, defaultTask }
```

**默认 Task 是绑定的硬前提**：项目建不出来默认 Task，就不能正常用（下一步"新建会话"会失败）。所以失败时：

- 回滚**本次新建**的绑定目录（搬过目录的不动，里面有会话文件）；
- 返回可读错误 `422 default_task_failed`（不是 500 纯文本）；
- 项目不出现在列表里，界面看到的是"添加失败 + 原因"。

## 4 界面在哪能看到

| 位置 | 显示什么 | 备注 |
|---|---|---|
| 头部状态条 task 段 | 有会话：该会话的 Task（`0002 标题`）；无会话：项目默认 Task（`0001 默认`） | 规则在 `frontend/src/header-strip.ts` `headerTaskOf`；有会话但会话没有 Task 时不显示，不拿默认顶替 |
| 添加项目成功后的提示 | `已添加项目 X · 默认 Task 0001 默认` | 绑定即创建的**唯一显式确认** |
| 对话（唯一切换方式） | 用户说"继续 0002" / "接手那个 Task" → Agent 调 `lifeos_task_enter` 写会话指针，下一轮生效；建 Task（`lifeos_task_create`）本身就进入它 | 没有独立的 UI 切换命令 |
| Agent 的工具 | `lifeos_task_create` / `lifeos_task_list` | 给 Agent 用，不是人的面板 |

## 4.1 Task 参与者的读写

| 动作 | 位置 | 说明 |
|---|---|---|
| 解析 | `src/tasks.ts` `parseParticipants()` | 新字段优先；旧 `负责人/记录者` 兼容（记录者 != owner 时算一个参与者）；owner 永远被排除 |
| 生成 | `src/tasks.ts` `materialize()` | 新建 Task 写 `归属` + `参与者`（无参与者写 `—`） |
| 追加 | `src/tasks.ts` `addTaskParticipant()` | 幂等；只改 `参与者：` 一行；老格式没有该行时**不自动改**，等人工决定 |
| 触发 | `src/peer.ts` `deliverPeerCompletion()` | 与其他 Agent 的对话完成后，把对端写进发起方 Task 的参与者（Task 0015 · T13） |

## 5 已知边界

- **没有项目级的任务清单界面**：项目视图看不到"这个项目有哪些 Task"；查看任务靠 Agent（`lifeos_task_list`）或直接看目录。切换不需要界面——它属于对话。
- 添加项目失败会回滚绑定目录，但**全局项目身份**（`~/.lifeos/projects/<id>/`）会留下——它按路径去重，下次添加同一路径会复用，不产生重复。

## 6 相关文档

- 协议 §6.1（Task 的目录与分片）、§3.7（Task 类型）
- `knowledge/design/chat.md`（头部状态条各段含义）
- `knowledge/design/image-input.md`（图片输入，与 Task 无关但同属会话级能力）
