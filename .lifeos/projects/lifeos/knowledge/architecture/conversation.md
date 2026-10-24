# 会话与过程状态架构

> 角色：架构　类型：设计　状态：实施中（2026-10-22；消息分段已落地）

## 1 现状与差距

### 当前 Life OS

- 前端：消息列表在滚动区；`WorkingRow` 也在滚动区（会随消息滚走）；header meta 只有 `Agent · project · 模型`；没有 token/速度/上下文；
- 后端：`sessionMeta()` 返回 `model/thinkingLevel/running/modelOverridden/activeTaskId`；`stream-events.ts` 映射 message 边界、thinking/text/tool call/result、tool execution start/update/end、retry；
- 数据其实已有：Pi `AssistantMessage.usage`、session entries、`AgentSession.getContextUsage()`；只是没有送到前端。

### 当前代码证据

- `frontend/src/App.tsx:167-170`：`endRef.scrollIntoView({ behavior: "smooth" })`；流式 delta 密集时 smooth 追不上，容易抖/落后；
- `WorkingRow` 渲染在 `<main>` 滚动容器内（`App.tsx:1047`），没有固定状态层；
- `frontend/src/Message.tsx`：用户消息 `bg-ink-900`、助手无背景；思考和工具块都用 `bg-sunken`，工具成功/失败主要靠文字色；没有 `data-message-kind`；
- `src/stream-events.ts` 已映射 `message_start/end`、`tool_execution_start/update/end`；`message_end.usage`、`turn_start/end` 仍不进入 UI 数据流（usage 走会话 meta/文件）。

### Pi Agent TUI 的可复用设计

| Pi TUI | 位置/行为 | 我们怎么借 |
|---|---|---|
| `FooterComponent`（`components/footer.ts`） | 固定底部；`↑in ↓out Rcache Wcache CH% $cost`、上下文 `% / window`、模型/思考级别；每帧重算 | 固定状态条右侧：tokens/context/model |
| `StatusIndicator`（`components/status-indicator.ts`） | 编辑器内/状态容器；spinner + 当前阶段；`RetryStatusIndicator` 逐秒倒计时 | 固定状态条左侧：步骤/子状态/计时 |
| `AssistantMessageComponent` / theme（`theme/dark.json`） | 用户 `userMessageBg`、思考 `thinkingText`、工具 `toolPendingBg`/`toolSuccessBg`/`toolErrorBg`、错误 `error` | 消息类型颜色 tokens：user/thinking/tool/error |
| viewport 组合（`interactive-mode.ts`） | document / pending / status / editor / footer 分层；状态和 footer 不跟消息滚 | 聊天列：scroll / TurnStatusBar / composer 分层 |

**结论**：TUI 已经把数据与位置分开了；我们缺的是 Web 端的状态条 + usage 数据通道，不是重写消息系统。

## 2 设计原则

1. **会话 JSONL 是事实源**；实时状态只是投影，完成后以文件为准重读；
2. **状态条是独立层**，不放进消息滚动区，不随消息数量改变位置；
3. **精确/估算必须标清**：usage 没有就 `—`，速度估算标 `≈`，不造假；
4. **状态条计时器隔离**：不触发消息列表 re-render；
5. 颜色只用 tokens；不新增页面级颜色。

## 3 数据模型

### TurnStatus（前端运行时）

```ts
type TurnStep = 1 | 2 | 3 | 4;   // 发送 / 受理 / 模型处理 / 完成
type TurnSubstate = "connecting" | "waiting" | "thinking" | "tool" | "output" | "retrying";

type TurnStatus = {
  step: TurnStep;
  substate?: TurnSubstate;
  startedAt: number;          // 发送
  firstTokenAt?: number;      // 首个 thinking/text delta
  completedAt?: number;
  retry?: { attempt: number; maxAttempts: number; delayMs: number; startedAt: number };
  liveChars: number;          // 运行中估算用
  usage?: Usage;              // 完成/已有 usage
  context?: ContextUsage;
};
```

### Usage（来自 Pi）

```ts
type Usage = {
  input: number; output: number;
  cacheRead: number; cacheWrite: number;
  cost: number; totalTokens: number;
};
type ContextUsage = { percent: number | null; contextWindow: number };
```

- `AssistantMessage.usage` → 本轮；
- session entries 中 assistant/toolResult/compaction 的 usage 累加 → 会话；
- `AgentSession.getContextUsage()` → `{percent, contextWindow}`；
- 注意：一次 `turn` 可能有多个 assistant message（工具后续写），本轮 usage 要按本轮全部 assistant/toolResult 求和。

## 4 事件与接口

### 现有

- 前端发送 → `POST …/messages` 202；SSE `message_start/message_end`、`thinking/delta/tool_call/tool_start/tool_update/tool_result`、`retrying/retry_end`；`done/error`；
- `GET …/sessions/:id` 返回 `messages` + meta。

### 需要补

1. **`sessionMeta` 扩展**：
   ```ts
   { model, thinkingLevel, running, modelOverridden,
     usage: UsageTotals, context: { percent, window } }
   ```
   从 session entries / `getContextUsage()` 计算；打开/切换会话即有。
2. **`done` 事件带本轮 usage**：
   ```ts
   { type: "done", sessionId, usage?: Usage, context?: ContextUsage, startedAt, completedAt }
   ```
   后端在 `runTurn` 开始记录时间，收尾读取本轮 assistant usage。
3. **可选 `usage` 事件**：如果 provider 在流中给 usage（不保证），映射后前端更新；没有就只在 done 给。
4. **步骤事件不强制新增**：
   - 1/4 前端发送；2/4 收到 202；3/4 受理后 250ms / 首个事件；4/4 done/error；这些前端能推。
   - 若以后要精确“模型请求开始”，再用 Pi `turn_start` 钩子，不影响 m=4。

### 4.1 Pi SDK 事实（已核源码）

Pi SDK 的事件和“能知道什么”决定了状态条能显示什么，不能靠 UI 猜。

| 事件/接口 | 事实 | 用途 | 限制 |
|---|---|---|---|
| `agent_start` / `agent_end` | 一次运行开始/结束 | 4/4 收尾；运行边界 | 不是“任务计划” |
| `turn_start` / `turn_end` | 一次 assistant 响应 + 工具调用/结果为 turn | 3/4 内部计数；工具后续写 | 核心 `AgentEvent.turn_start` 没有 turnIndex（扩展事件才有）；**没有总 turn 数** |
| `message_start/update/end` | assistant 消息流式；`message_update.contentIndex` 是消息内块序号 | thinking/text/tool 块 | 不是全局步骤；usage 在 message 结束时才有 |
| `tool_execution_start/update/end` | 工具真实执行；`end` 有 result/isError/durationMs | 工具 running/done/error | 已映射 start/update/end；running 不再由整轮 busy 推断 |
| `auto_retry_start/end` | attempt/maxAttempts/delayMs/errorMessage | 重试倒计时 | 只覆盖重试，不是任务步骤 |
| `AssistantMessage.usage` | input/output/cacheRead/cacheWrite/cost/totalTokens | 精确 tokens/成本 | **不是逐 token 流式给**；只能在 message_end 后读 |
| `AgentSession.getContextUsage()` | context percent/window | 上下文占比 | 依赖最近 assistant usage；压缩后可能未知 |
| session entries | assistant/toolResult/compaction 的 usage | 会话累计 | 需要后端汇总 |
| `agent_start/end` + frontend 202 | 4 步产品状态机 | 1/4 发送、2/4 202、3/4 运行、4/4 done | m=4 是产品定义，不是 SDK 字段 |

**结论**：

- n/4 的前 1、2、4 由前端/HTTP 定；3 是“模型处理”区间，内部可跨多个 Pi turn；工具/思考/输出是 3 的子状态；
- token 精确值只能在 message_end/turn_end 后拿；运行中速度只能 `≈` 或 TTFT；
- 自动滚动是纯前端行为，和 SDK 无关；SDK 只提供“内容变化”的事件。

## 4.2 流式块顺序：三实现对照（2026-10-22 修正）

用户看到的“上面思考一直转、下面工具在跑、中间又出文本、下面又有工具”，不是单一原因，至少有三层事实要分开：

### 事实 1：一次 turn 有多个 assistant message，contentIndex 会重置

真实会话 JSONL 里，一次工具调用会形成：

```text
assistant message A（thinking + toolCall）→ message_end
toolResult → toolResult
assistant message B（contentIndex 又从 0 开始：thinking/toolCall/text）→ ...
```

`contentIndex` 是**消息内块序号**，不是整轮全局序号。`.lifeos/projects/lifeos/knowledge/architecture/conversation.md` §4.1 已记录这个 Pi SDK 事实。

### 三实现对照

| 维度 | Life OS 当前 | Pi Web | Pi Agent TUI |
|---|---|---|---|
| 消息边界 | `src/stream-events.ts` 映射 `message_start/end`（段键 = assistant timestamp）；`frontend/src/stream-blocks.ts` 用 segments，段内 `contentIndex` 排块，段间按到达顺序 | `lib/streaming-message.ts`：`streamingMessage` 只代表当前 assistant message；`start/snapshot/delta/end` 按消息生命周期更新 `contentIndex` | `interactive-mode.ts`：`message_start` 新建一个 `AssistantMessageComponent`，`message_end` 结束并清 streaming；下一条 assistant message 是新的 component |
| 工具与消息关系 | `tool_call` 进入当前段；`tool_execution_start/update/end` 按 id 原地更新，工具结果不改变消息边界 | `toolCall` 留在当前 message content；`toolResults` 按 toolCallId 配对；工具结果不改变消息边界 | toolCall 创建独立 `ToolExecutionComponent` 追加在 chat；`tool_execution_end` 原地更新，不塞回 assistant 文本 |
| thinking 的 live | 每个 thinking 块带 `live`；`message_end`/`thinking_end` 立即收口，旧段不再转圈 | `ThinkingBlock` 没有 turn-level spinner；只显示 thinking 文本/耗时，`isStreaming` 只用于文本/空块处理 | thinking 作为内容渲染/折叠；没有“每个 thinking 块整轮转圈”的状态 |
| 工具 running | 每个 toolCall 带 `running`；由 `tool_execution_start/update/end` 驱动，`message_end` 不会误导为“未完成” | `ToolCallBlock` 看 result 是否存在；`rawInput` 区分参数流式；phase 由 `tool_execution_*` 单独维护 | `ToolExecutionComponent` 由 `tool_execution_start/end/update` 驱动；结束即更新为完成/错误 |
| 最终输出 | `finalTextOfStream` 取最后一段 text；过程块仍按段顺序可见 | `splitFinalAssistantBlocks` 把最后一段 text/image 作为 answer，之前作为 process；`ProcessDetailsGroup` 可折叠 | 按消息/工具组件顺序渲染；最终 assistant text 自然在最后 |

### 这解释了用户看到的错乱

1. **工具后的下一条 assistant message contentIndex 从 0 开始**，但 Life OS 把 0 当成整轮同一个槽位：
   - 下一条的 thinking/text 会插入/覆盖前面 index 0 的块；
   - 后段 text 可能跑到前面，后段工具/文本顺序被改；
   - 所以“中间出文本、下面又工具”不一定是模型乱，而是前端把不同消息的槽位拼错了。
2. **thinking spinner 是整轮 `busy` 驱动**：任何思考块在整轮结束前都显示“思考中…”，即使它早已结束；用户看到“上面一直转、下面在跑工具”。
3. **工具 running 也靠整轮 `busy`**：没有映射 `tool_execution_start`，只靠结果有没有回来；结果事件丢/晚时，旧工具会一直转。
4. 模型在一条 turn 内**合法地**可以 thinking → text → tool → text；TUI/Pi Web 也接受这种顺序。问题不是“必须只有最后才有 text”，而是“不同消息的块不能被合并，running 必须按当前段/工具，而不是整轮”。

### 应该怎么显示（建议规则）

- **消息边界优先**：每个 `message_start/end` 是一个独立 assistant 段；段内按 `contentIndex` 排序，段间按消息顺序；禁止跨段共用槽位。
- **thinking**：只对**当前正在流的那一段**显示 spinner；旧段显示“思考过程”（可折叠），不在整轮结束前继续转。
- **工具**：由 `tool_execution_start/update/end` 驱动 running/done/error；不要用 turn busy 推断所有工具的运行状态。
- **文本/工具顺序**：保留模型真实顺序；允许中间 text 是 commentary；**最终回答是最后一段 text**。如果需要降低噪音，可像 Pi Web 一样把 process 折叠成一组，但不能改变顺序或把后段 text 塞到前面。
- **验收**：新增多 assistant message（工具后 contentIndex 重置）测试：
  1. 段 A thinking/toolCall；
  2. toolResult；
  3. 段 B thinking/text；
  4. 断言段顺序、工具状态、thinking 不再 live、最终 text 在最后。

### 实现（2026-10-22）

- `src/stream-events.ts`：assistant `message_start/end` → 段事件；`message_update` 带段键；`tool_execution_start/update/end` → tool_start/update/result。
- `frontend/src/stream-blocks.ts`：`segments` + 段内 `slots`；`message_end` 关闭段；`thinking_end` 关闭思考；tool running 独立于段。
- `frontend/src/Message.tsx`：thinking 看块级 `live`，tool 看块级 `running`；不再把所有块绑定到整轮 `busy`。
- `frontend/src/App.tsx`：监听新事件；`finalTextOfStream` 作为最后一段答案；最终仍以会话 JSONL 刷新为准。
- 验收：`test/stream-blocks.test.mjs` 覆盖 A thinking/tool → result → B thinking/text；`test/stream-events.test.mjs` 覆盖边界与 tool start/update/end。

## 5 前端结构

```text
ChatColumn
├─ ChatHeader（标题、模型/思考级别）
├─ MessageScroll（消息列表；自动跟随）
├─ TurnStatusBar（固定；步骤/计时/usage/speed/model）
└─ Composer（输入框）
```

- `TurnStatusBar` 内部用 `useNow(1000)` 只更新自己；
- `useTurnStatus` reducer 消费发送/202/SSE/done；
- 消息列表按 message 引用 memo；
- 状态条内容：
  - 左：`3/4 · 模型处理 · 执行 read…`
  - 中：`16s`（不写“本轮”；工具耗时由工具块 durationMs 表达）
  - 右：`⚡73.7 tok/s · ↑1.2k ↓3.4k · ◔42%`（符号均有 tooltip；`↑` 输入、`↓` 输出、`◔` 上下文、`⚡` 速度）
  - 组件：`TurnStatusBar` 容器 + `WorkingRow`（左侧本轮状态）+ 右侧 meta（速度/会话累计/上下文）；同一个 bar 内分组，不做多条独立状态栏。参考 Codex/Claude/Gemini status line 与 LobeHub TokenTag 的“符号 + 数字 + tooltip/详情”。
  - 间距层级：图标↔数值 4px；`↑/↓` 同组 8px；不同指标组 12px；不用平均 gap。
  - 窄屏：两行；tokens 可省略 cost/cache。

### 完成态

- 4/4 完成后保留一行摘要：`4/4 · 完成 · 19s · ⚡73.7 tok/s`；会话累计 `↑1.2k ↓3.4k ◔42%` 在右侧；
- 失败：`4/4 · 失败 · 类别`，原始错误在消息/展开区；
- 切换会话时重置，不残留。

## 6 消息类型与颜色

| 类型 | 视觉（token） | 说明 |
|---|---|---|
| 用户 | `message-user-bg`（深色气泡） | 右侧/深色，与助手区分 |
| 助手 | 无背景/正文 | 阅读列 |
| 思考 | `message-thinking-bg` + `thinkingText` 弱化/斜体 | 可折叠；流式中可见 |
| 工具执行中 | `message-tool-running-bg` + spinner | 与成功/失败不同 |
| 工具成功 | `message-tool-done-bg` | 结果可展开 |
| 工具失败 | `message-tool-error-bg` | 图标/文字/背景三重 |
| 运行失败/重试 | `danger` / `warning` | 状态条和消息一致 |
| 系统/压缩 | `sunken` + muted | 不抢主对话 |

- 每个消息块根节点 `data-message-kind`；颜色值只进 `tokens.css`；不把 Pi 的 okhsl 原样搬进页面；
- 颜色不是唯一信息：文字/图标/状态词同时存在。

## 7 自动跟随（可验证实现）

```ts
// MessageScroll
const follow = useRef(true);
const onScroll = () => {
  const el = scrollRef.current!;
  follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
};

useLayoutEffect(() => {
  const el = scrollRef.current;
  if (el === null || !follow.current) return;
  // 流式期间不要 smooth：smooth 会追不上 delta，产生“抖/落后”
  el.scrollTop = el.scrollHeight;
}, [messages, lastBlockText]);
```

- 发送时 `follow.current = true`；
- 上翻后不写 `scrollTop`；滚动容器外的 `TurnStatusBar` 不受影响；
- 新消息只在贴底时跟随；用户主动上翻后保持当前位置；
- 可加“回到最新”按钮（后续可选）。

**测试证明**（Playwright）：

1. 打开会话，滚动 500px；记录状态条 `top`；追加 50 个 delta；断言 `scrollTop` 未变、状态条 `top` 未变；
2. 滚回底部；追加 delta；断言 `scrollHeight - scrollTop - clientHeight <= 2`；
3. 各 `data-message-kind` 的 computed background 两两不同；axe 对比度通过。

## 8 失败与边界

| 情况 | 处理 |
|---|---|
| provider 不给 usage | 显示 `—`；不要用字符数冒充精确 token |
| 无流式/首 token 很晚 | TTFT 完成时补算；运行中显示等待 |
| 重试 | 子状态 retry，倒计时；本轮计时继续，usage 暂不增加 |
| 中断/失败 | 4/4 失败/中断；本轮 usage 保留已收到部分 |
| 压缩后 context 未知 | `?`；下一次响应后恢复 |
| 切换会话 | 状态条重建；运行中不打断原会话 |
| 长会话 | 状态条不随消息增长；context 预警变色 |

## 9 性能

- 状态条计时器在组件内，React 只重渲染状态条；
- 消息列表 `memo`，流式只更新末尾消息；
- SSE 事件按帧/批次合并；不在 render 读布局；
- usage 累加只在 done/切换会话时算，不在每 token 算。

## 10 落地顺序

1. **第一步**：固定 `TurnStatusBar` + 4 步 + 本轮计时 + 完成后 4/4 摘要；
2. **第二步**：后端 `sessionMeta`/`done` usage + context；状态条显示 tokens/context；速度精确值；
3. **第三步**：消息类型颜色 tokens + 自动跟随/回到最新；
4. **第四步**：历史恢复、窄屏、性能/截图门禁。

## 11 验证

- 纯函数：step/substate/timer/speed/usage 格式化；
- 后端：usage 汇总（多 assistant/toolResult）、context、done 事件；
- Playwright：固定位置（滚动 500px 后仍同一 y）、上翻不跟随/贴底跟随、步骤顺序、计时、usage、切换会话、375/768 不溢出；消息 kind 背景两两不同；
- 截图：运行中/完成/失败/重试/窄屏；
- 不写真实家目录：route mock / 临时 home。

## 12 开放决策

1. 状态条位置：输入框上方（建议）还是 header 下？
2. 本轮 tokens 显示分列还是总量？
3. 运行中速度显示 `≈` 估算，还是只显示 TTFT？
4. 会话累计 usage 默认显示还是 tooltip？
