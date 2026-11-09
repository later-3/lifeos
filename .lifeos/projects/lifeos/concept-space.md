# 概念空间（lifeos 项目层）

> 角色：概念　类型：定义　状态：现行（2026-11-09 加入检视模式一组词）

本项目特有的词写在这里；通用的词在共享 workspace 的概念空间里，不在此重复（协议 §3.2）。

| 词 | 是什么 | 在具体场景下是什么 | 不是什么 |
|---|---|---|---|
| 回合（turn） | 一次用户消息对应的完整推理与响应（发起→完成/中断） | 状态条里的"4 步"就是它的呈现；`turnId` 是给它广播的稳定编号 | 不是会话（多个回合发生在一个会话里）；不是请求 |
| 回合账本 (turn ledger) | 服务端内存中每一次回合终态（running/done/error/lost） | `GET …/turns/last` 就是在读它；丢失兜底=读会话 JSONL 尾条 | 不是会话文件本身；不是消息列表 |
| 对账 (reconcile) | 前端断流/心跳判丢后，向服务端确认"最后一轮到底完成了吗" | 三分支：完成 / 丢失 / 恢复中 | 不是重发；不是轮询 |
| 运行事实 (run-facts) | 前端从事件流派生的每层运行状态（per-session 运行中/未读/排队） | 三态列表、状态条、未来的通知全部只消费它 | 不是 React state 的别名；不是消息 log |
| 回合终态 (turn outcome) | 这一轮**跑完了吗**，只有 `done` / `lost`。唯一判据 `src/turn-state.ts` | `stopReason=stop/length/error` → done；`toolUse/pending/deferred/aborted` 或没有 assistant → lost | 不是"成功/失败"：`error`（模型报错）也是 done —— 跑完了，只是结果不好 |
| 接下来能做什么 (next action) | 一轮结束后界面该给用户的动作：`resend` / `fix-*` / `none`。唯一判据 `src/next-action.ts` | 网络/超时/5xx/429/空回复 → resend；额度/鉴权/413 → fix（可执行出口）；正常完成/截断 → none | 不是回合终态的分支，是**另一个正交维度**（问「能做什么」，不问「跑完了吗」） |
| 自动重试 (auto retry) | Pi 自己的机制：`error` 且判定可重试时按指数退避重发整个 assistant 回合，默认 3 次（`settings-defaults.ts:20`） | `auto_retry_start` / `auto_retry_end` 事件；重试期间状态条显示「7s 后重试（1/3）」，Esc 只取消重试 | 不是用户的"重新发送"（前者系统自动、用户无感；后者手动触发一轮） |
| 重新发送 (resend) | 用户动作：把最后一条用户消息**再发一次**，形成新的一轮 | 动作挂在**被重发的那条用户消息**上，不挂在助手失败块下 | 不是 Pi 的 regenerate（Pi 没有这个 API）；不是自动重试 |
| 不可重试错误 | Pi 明确不自动重试、且重发也不改变结果的错误 | 额度耗尽 / 401 鉴权 / 413 请求体过大；判据 `pi/packages/ai/src/utils/retry.ts:7-28` | 不是临时故障（网络/超时/5xx/429 都是可重试的） |
| 完成未读 (unread) | 回合结束你还没打开看那个会话 | 会话列表的"绿点未读" | 不是"运行中"（运行是呼吸点） |
| 排队/插话 (queue/steer) | Pi 的两种"生成中进消息"方式：排队=followUp（本轮结束后自动下一轮），插话=steer（下一模型步前插入） | LibreChat 同语义；Idle 时服务端直接拒绝我们 enqueue | 不发"新回合"复用（空转时前端会改发新回合） |
| **检视模式（review mode）** | 一个 Task 的改动在合入前的**共同检视流程**：用户与 Agent 对着同一份 diff 看「项目 worktree 的改动」+「`~/.lifeos` 的 Task 文档改动」 | 用户说"检视 task 0010"（或界面自选 Task）→ 面板加载两组源 → 用户批注/回复 → Agent 在同一份数据上回应 → 用户关闭评论 | 不是"通过后合入 main"（零 git 写操作）；不是代码 diff 的代名词（md 文档同等对待） |
| **检视对象（review target）** | 一次检视的**被检视物**：一个 Task，展开成 `{ taskDir, sources: [worktree, Task 文档] }` | 面板顶部那两行：`worktree …/evidence/worktree · dev/x · @abc1234` / `Task 文档 …/tasks/0001-default @dd236c2` | 不是"这次对话"（对话可换、可关；检视对象不随对话变）；不是 git diff 文本（diff 是算出来的结果） |
| **检视候选（review candidate）** | 当前 Agent × 项目下，**哪些 Task 有东西可检视** | 「检视对象」下拉里带 `●`（有实质改动）或 `（仅日常）`（只有 daily 分片）的那些行 | 不是"全部 Task 列表"（`/tasks` 是任务管理视图，候选额外算了改动与评论数） |
| **检视评论（review comment）** | 挂在 diff 行范围上的一条意见，**绑定检视对象**而不是对话 | `README.md:L5-L7` 上那条"这几行能不能合并" | 不是消息批注（那个锚在消息文本上、随消息走）；不是对话的一部分（换会话仍在） |
| **评论线程（comment thread）** | 一条根评论 + 若干回复 | 卡片展开后的回复列表；回复缩进一层 | 不是消息列表（它属于检视对象，不属于会话） |
| **交棒（handoff / awaiting）** | 线程"现在等谁"：`user` / `agent` / `null` | Agent 回复后 badges 变「等你回复」；你回复后变「等 Agent」 | 不是状态（三态才是状态：draft/open/resolved）；已关闭的线程不再等谁 |
| **已看（viewed）** | 用户对某个文件"我看过了"的标记，**带内容指纹** | 文件卡右侧 `○ 未看 / ✓ 已看 / ↻ 已变`；顶部 `N/M 已看` | 不是"打开过"（打开不算看过）；内容改了会自动降级成"已变"（进度只算 ✓） |
| **词级 diff（word diff）** | 成对的增删行里，**哪几个词**被改了 | `sum` → `acc` 那两个小色块 | 不是整行标色（整行说明"这行改了"，词级说明"改了哪几个字"） |
| **渲染态 diff（md preview diff）** | 把 md 渲染成文档后，**按块**标出改动 | 段控「渲染」档：标题红/绿边、列表是真列表、代码围栏内逐行标色 | 不是源码行级 diff（那是对照档，默认）；不是富文本编辑器 |
| **检视 TODO（review todo）** | 未闭环的评论线程，对某个责任方而言就是他的待办 | Agent 侧 `lifeos_review_comments({pendingForMe:true})`；用户侧候选列表的 `N 条等你` | 不是项目 `todo/` 文件（那个是任务级待办）；两者口径独立 |
