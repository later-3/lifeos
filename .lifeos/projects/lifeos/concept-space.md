# 概念空间（lifeos 项目层）

> 角色：概念　类型：定义　状态：现行（空）

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
