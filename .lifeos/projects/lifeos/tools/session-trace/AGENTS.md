# session-trace/

单条会话的**交互时间线**核对。回答"这一轮为什么跑不了 / 谁发起的 / 被拒过什么"。

## 背景与目的

2026-11-07 的现场：用户报"这条会话发不出消息、界面也不说为什么"。真因藏在六层里：

| 层 | 在哪 |
|---|---|
| 1 会话来源（谁发起的） | 会话文件里的 `lifeos_peer` 条目 |
| 2 每一轮谁发起 | 会话文件里的 `lifeos_turn_origin` 条目（Task 0014 新增） |
| 3 每一轮结果 | 最后一条 assistant 的 `stopReason` / `durationMs` |
| 4 当前在不在跑 | `/api/runtime`（服务端内存） |
| 5 回合账本 | `/api/agents/:a/sessions/:s/turns/last` |
| 6 **被拒的请求** | `~/.lifeos/logs/backend-<date>.jsonl` 的 http 行 |

第 6 层最容易被忽略：请求被服务端拒绝了，会话里根本不会有记录 —— 所以"只看会话文件"永远看不出为什么发不出去。
当时靠人工拼这六层花了十几轮工具调用；这个工具把它变成一条命令。

## 什么时候用

- 用户说"这条会话发不出消息 / 不知道卡在哪"；
- 想知道"这一轮是谁发起的"（用户还是哪个 Agent）；
- 排查"失败到底是上游、是凭据、还是我们的守卫"；
- 写完修完自查：六层是否一致。

## 用法

```bash
pnpm trace --agent frontend-developer --session 01a1b478
pnpm trace --agent coder --session 01a1b4a4 --json
pnpm trace --session 01a1b478 --base http://127.0.0.1:43138   # 不给 agent 就在所有 Agent 里找
```

`--session` 接受**前缀**（完整 uuid 太长）。`--base` 默认 `http://127.0.0.1:43120`。
`LIFEOS_HOME` 决定看哪个家目录（开发实例要显式给）。

## 输出四段

1. **会话身份**：sessionId / Agent / 项目 / 文件路径 / 标题 / **来源**（`lifeos_peer` 或"用户"）/ 当前 Task；
2. **逐轮时间线**：每轮的发起方（`用户` / `Coder（lifeos_send）` / `用户(推断)`）、状态（done/error/aborted/未落盘）、耗时、失败原文；
3. **被拒的请求**：从日志里读 4xx/5xx 的 `messages`/`abort`/`retry` 请求（带错误码）；
4. **当前运行态 + 第一处不一致**：session-runtime / 回合账本 / `meta.running` / 完整性，然后按穷举规则给出结论。

## 退出码

- `0`：六层一致，没有发现不一致；
- `1`：发现不一致（可用于巡检）；
- `2`：会话找不到（明确报错，不静默返回空）。

## 纪律

- **只读**：不发消息、不点会话（点开会把未读标成已看，毁现场）、不写任何文件；
- 不新增日志：它读已有的 `logs/backend-<date>.jsonl`；
- 与 `session-state` 分工：那个管"**徽标数字**为什么不对"，这个管"**这一轮**为什么跑不了 / 谁发起的"。

## 实现与测试

- 实现：`scripts/session-trace.mjs`（仓库脚本区，与 `session-state.mjs` 同构）
- 测试：`test/session-trace.test.mjs`（7 条，全部打桩不调模型）
- 入口：`pnpm trace`
