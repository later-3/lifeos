# 会话状态：点、数字与它们的来源

> 角色：架构　类型：设计　状态：**现行**（2026-11-05，Task 0005）
> 本文回答一件事：**界面上每一个"状态迹象"从哪来、什么时候变**。排查"数字对不上"从这里开始，不要从代码猜。

## 1 三个概念，别混用

| 概念 | 是什么 | 存在哪 | 会不会消失 |
|---|---|---|---|
| **运行** | 这个会话此刻有一个回合在跑 | 内存（`session-runtime.ts`），**不落盘** | 回合结束就没了 |
| **终态** | 最近一次回合是怎么结束的（成功/失败） | `state/session-views.json` 的 `completedAt` / `lastState` / `failureAt` | 不消失（是历史） |
| **已读** | 用户看过"这次结束"没有 | 同上的 `viewedAt` / `failureSeenAt` | 看过就置位 |

**未读 = 有终态 且 还没看过。** 它只有一种概念，但有两个结果：正常结束、异常结束。**两者规则完全相同**（看过就消失），不因为结果不同而用两套规则——这是 2026-11-04 用户裁决，此前"点看已读、数字不看"的中间版本会导致"点进去红点没了但数字还在"。

## 2 四个显示位置，各自的唯一来源

```
┌ 助手列 ─────────────┐  ┌ 会话面板 ────────────────────────────┐
│ coder        ① 1 2 3 │  │ ▾ workspace            ④ 1 2 3      │
│ Life Agent            │  │   ┃ 标题…                     ② ●  │
└──────────────────────┘  │   ┃ 0008 批注面板…           ② ●  │
                          └───────────────────────────────────┘
```

| # | 位置 | 显示什么 | 唯一来源 | 变化时机 |
|---|---|---|---|---|
| ① | 助手行徽标 | 该 Agent **所有项目**的三数之和 | 前端 `sessionSlots`（状态机）数出来的 | 收到 `row` 补丁 / 快照重建 |
| ② | 会话行的点 | 这一条的四态之一 | 行对象 `activity.state`（`rowActivityOf()`）；实时更新靠 `row` 补丁 | 同上 |
| ③ | （同一行的 meta 文案） | 运行耗时 / 失败类别 | `activity.running.since` / `activity.failure` | 耗时前端每秒本地算 |
| ④ | 项目行徽标 | 该项目下该 Agent 的三数 | 同 ①，按 `projectId` 分桶 | 同 ① |

**①④ 与 ② 必须永远同步。** 同步的实现是"同一个状态机"：每条会话在 `running` / `unreadDone` / `unreadError` 三个槽里最多占一格，数字是**数出来的**，不是加减出来的（见 §4）。

### 2.1 三个徽标各自的颜色与呼吸

| 徽标 | 含义 | 配色 | 呼吸 |
|---|---|---|---|
| `running` | 有回合在跑 | `--color-running` 蓝，薄底 `--color-running-soft` | **有**：`scale 1↔1.12` + 扩散环，2.4s |
| `unreadDone` | 正常结束、还没看 | `--color-success` 绿，薄底 `--color-success-soft` | 无 |
| `unreadError` | 异常结束、还没看 | `--color-danger` 红，薄底 `--color-danger-soft` | 无 |

**为什么 running 是蓝不是绿**（2026-11-05 用户裁决 P1）：running 与 unreadDone 原来都用 `--color-success`，两个 14px 色块的 ΔRGB = **0**，只靠"有没有呼吸"区分；`prefers-reduced-motion` 关掉动画后彻底分不出。换蓝后 ΔRGB：run↔done **152**、run↔err **248**、done↔err **198**（<60 时小色块上分不出）。橙/绿/红因 run↔err 只有 32 被淘汰，灰/绿/红因"不表达进行中"被淘汰。

### 2.2 四种点（会话行右缘槽，四态互斥）

| 点 | 含义 | 实现 |
|---|---|---|
| 蓝点（呼吸） | 正在执行 | `bg-running animate-dot-breathe`，`title="生成中"` |
| 绿点 | 完成、未读 | `bg-success`，`title="完成未读（查看后消失）"` |
| 红点 | 失败、未读 | `bg-danger`，`title="失败：<类别>"` |
| 无点（显示时间） | 空闲 / 已看过 | 不渲染点，显示 `timeAgo(lastActivityAt)` |

优先级 `running > failure > unread > idle`，**只在 `src/row-activity.ts` 的 `rowActivityOf()` 一处实现**（零依赖，前后端共用）。

## 3 一条会话的状态变化，谁在什么时候推

```
用户发消息
  └→ POST …/messages → runTurn()
       ├ markRunning()                              ← 内存：在跑
       ├ publish({type:"turn", state:"running"})     ← 回合级事件（所有连接）
       └ rowPatches().pushRunning()                  ← 行补丁 { running: { since, phase } }

回合中（每次 phase/tool 变化）
  └ rowPatches().pushRunning({ phase, tool })
       节流：值没变不发；每会话 ≥1000ms 一条；尾随发送保最后一次

回合结束（成功 / 失败 / 被打断）
  ├ finishTurn()
  ├ recordCompletion()  ← 写 completedAt / lastState / failureAt（终态，落盘）
  ├ rowPatches().pushTerminal({ unread, failure?, lastActivityAt })
  └ publish({type:"done"|"error"})                   ← 所有连接

用户点开会话
  └ PUT /api/events/focus
       ├ setFocusOf()                                ← 细节事件路由
       └ markSessionViewed(agentId, sessionId, at, projectId)
            ├ 没有未读 → **什么都不推**（关键，见 §5）
            └ 有未读   → 写 viewedAt / failureSeenAt + pushNow({ unread: null })

删除会话
  └ pushNow({ removed: true, was, projectId })
```

**快照（服务端全量事实）**：SSE 连接建立时发一帧 `snapshot`，含
`running[]`（内存注册表）、`unread[]`（索引里未看的，带 `state: "done"|"error"`）、
`aggregate[]`（`aggregateStatus()` 算的三数）。前端**用它重建整张状态机表**，不是累加。

## 4 状态机（不是计数器）

前端 `App.tsx` 的 `sessionSlots: Map<sessionId, { agentId, projectId?, slot }>`：

| 收到 | 动作 |
|---|---|
| `{ running: {...} }` | 设 `running` |
| `{ running: null }` | 删槽 |
| `{ unread: {...}, failure? }` | 设 `unreadError`（带 failure）或 `unreadDone` |
| `{ unread: null }` | **只清未读**：当前是 `running` 就不动；是终态才删槽 |
| `{ removed: true }` | 删槽 |
| 快照 | **整表重建**（服务端为准） |

数字 = 遍历表按 `agentId` × `projectId` 计数。**没有 +1/-1**，所以重复补丁、漏补丁、重连都不会漂移（漏的会被快照纠正）。

**为什么不能是计数器**（2026-11-04 用户点破"这不就是个状态机吗"）：计数器要求每条路径对称地减（查看/删除/重连/别的 Agent 的补丁/去重），漏一条就永久错位。历史上一共打了 5 个补丁（别的 Agent 不动、查看不减、删除不减、行滞后、覆盖又抹掉别人的），每个补丁都在给错误的模型打补丁。

`projectId` **只增不减**：某些补丁不带 projectId（focus 端点历史上就是），若直接覆盖会把数字从"某个项目"挪进"该 Agent 的无项目桶"，项目行数字消失。

## 5 踩过的坑（每条都对应一次真实误判）

| 坑 | 现象 | 根因 |
|---|---|---|
| **`{unread:null}` 语义过宽** | 点开**正在跑**的会话后，行上蓝点在呼吸，项目/助手**没有数字** | `unread:null` 被当成"这条不再有任何状态"，把 running 槽一起删了。**正确语义：只清未读** |
| **别的 Agent 的补丁被丢** | 切回当前会话后，另一个 Agent 的呼吸 1 消失 | `applyRowPatch` 开头 `agentId !== current → return`，提前返回导致状态机没更新 |
| **`prompt()` 正常返回 ≠ 回复成功** | 行上红点，数字却算进"已完成" | 模型不可用时 Pi 不抛异常，把 `stopReason:"error"` 写进会话文件。done 分支必须回头看文件最后一条 assistant 的终态 |
| **快照不更新行上的点** | 重连后"徽标说有 1 条未读、行上没有绿点" | 快照只重建了聚合，没重建 `groups` 里每行的 `activity`。现在用同一个 `rowActivityOf()` 重建 |
| **用行数据覆盖聚合** | 结束之后仍显示 running=1；别的 Agent 的数字被抹成 0 | 前端手上只有当前 Agent 的行，覆盖式实现必然错。聚合只来自状态机 |
| **`fileModifiedAt` 当活动时间** | 一条会话显示"4 天前"，实际刚聊过 | 文件 mtime 与真实活动无关。排序/显示只用 `lastActivityAt` |

## 6 怎么排查"数字对不上"

**不要读代码猜，跑工具**：

```bash
pnpm state            # 四层对照 + 指出第一处不一致
pnpm state:no-ui      # 只查前三层（快）
pnpm state --agent coder --session 01a1a583
```

四层是：

| 层 | 来源 | 回答 |
|---|---|---|
| L1 | `state/session-views.json` | 落盘事实（重启后靠它） |
| L2 | `/api/events` 快照 | **服务端此刻的真相** |
| L3 | `…/rows` 的 `activity.state` | 一次列表请求会返回什么 |
| L4 | 真浏览器 DOM | 用户实际看到什么 |

判定：L2≠L3 → 后端口径不一致；L3≠L4 → 前端渲染问题；L1≠L2（非 running）→ 落盘/内存不一致。
详见 `tools/session-state/AGENTS.md`。

**注意**：`running` 是纯内存态、**不落盘是正确设计**，所以"L1 没有 running"不是不一致。

## 7 相关代码位置

| 文件 | 职责 |
|---|---|
| `src/session-runtime.ts` | 运行注册表（内存） |
| `src/session-views.ts` | 终态 + 已读事实（落盘）；`unread()` 是未读判定唯一实现 |
| `src/row-activity.ts` | 四态判定唯一实现（前后端共用，零依赖） |
| `src/session-rows.ts` | `SessionRow` 组装（行对象唯一实现） |
| `src/row-patch.ts` | 行补丁推送 + 节流 |
| `src/agent-host.ts` | `aggregateStatus()` 服务端聚合；`markSessionViewed()`；`recordCompletion()` |
| `frontend/src/status-map.ts` | 前端把聚合数字映射到助手/项目行 |
| `frontend/src/App.tsx` | 状态机 `sessionSlots` + `applyRowPatch` / `applySlotFromPatch` / `clearUnreadSlot` |
| `scripts/session-state.mjs` | **排查入口**（四层对照） |
| `frontend/test/status-scenarios.mjs` | 打桩场景矩阵（12 组场景 / 29 条断言） |
