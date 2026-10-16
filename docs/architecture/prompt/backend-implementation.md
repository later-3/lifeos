# 后端实现：从用户发消息到 Pi SDK 请求

> 角色：架构 / 开发　类型：参考　状态：现状

本文是 Prompt 的**第一层（后端实现）**：前端用户发一条消息后，后端到底做了什么，在哪一步进入 Pi SDK。
定义与分层见 [Prompt 定义](./README.md) §1–§2；交互 harness 的注入见 [注入契约](./interaction-harness.md)。

## 1 一句话

后端**不自己拼请求**：它把消息受理成一轮耐久 Turn，在出队时按"Long Agent 定义 + 项目 + 会话/本轮"解析内容，
交给**唯一的装配工厂** `createLife OSPiAgentSession`，由该工厂调用 Pi SDK 的 `createAgentSession()` 创建 AgentSession，
再用 `session.prompt(text)` 发出；请求的所有字节由 **Pi** 组装并发送。

## 2 逐步链路（含代码锚点）

```text
① 前端 POST /api/long-agents/:id/turns                 src/routes/api/long-agents/[longAgentId]/turns.post.ts
② 受理 acceptLongAgentTurn                              src/long-agents/turn-queue.ts:34
③ 出队 drainLongAgentTurns（每 Session 一个串行 worker）  src/long-agents/turn-queue.ts:304
④ 执行 executeAcceptedLongAgentTurn                      src/long-agents/runtime.ts
⑤ 装配 prepareLongAgentAssembly（唯一解析点）             src/long-agents/assembly.ts
⑥ 工厂 createLife OSPiAgentSession（唯一装配入口）            src/agents/pi-agent-session.ts
⑦ Pi SDK createAgentSession(...)                        src/agents/pi-agent-session.ts:386（Pi 公开 API）
⑧ 发送 created.session.prompt(text, { images })          src/long-agents/runtime.ts:334
⑨ Pi → provider HTTP（onPayload 闸门即最终发送内容）        pi/ 内部
```

### ① 入口（HTTP 合同）

- 路由：`POST /api/long-agents/:longAgentId/turns`；严格字段：`schemaVersion:1`、`requestId`、`text`、
  未知字段直接拒绝（`turns.post.ts:22-33`）。
- 返回 **202 + 执行引用**，**不等待模型**；worker 属于 Backend，不属于浏览器连接
  （`void drainLongAgentTurns(...)`，`turns.post.ts:55-56`）。

### ② 受理（耐久，先落盘再执行）

`acceptLongAgentTurn`（`turn-queue.ts:34`）在同一状态文件里写入 `AcceptedTurn`：`turnId/requestId/payloadHash/
sequence/status=queued/source/contextProjectId/sessionId/date/timeZone/seed` 等。
**幂等**：同 `requestId` 且 `payloadHash` 相同 → 返回原 Turn（重复提交不会重复执行）；载荷不同 → 冲突。

### ③ 出队（同一 Session 串行）

`drainLongAgentTurns`（`turn-queue.ts:304`）在 `globalThis` 上按 `lifeosHome + longAgentId/sessionId` 维护一个
最小 `sequence` 轮，claim 成 `running`，然后：

- 主题节点轮：先写 `markTopicRoundRunning`（`turn-queue.ts:293`）再执行；
- 否则（默认回合）：`executeAcceptedLongAgentTurn`（`runtime.ts`）。

异常与取消：`cancelRequested` 优先于错误 → 记 `cancelled`，不伪装成成功/失败（`turn-queue.ts:365-372`）。

### ④–⑤ 装配（解析点唯一）

`executeAcceptedLongAgentTurn`（`runtime.ts`）：

- 复用冻结快照：`readAssemblySnapshot(lifeosSession.manager, turnId)`；有快照时用 `frozen.agent` / `frozen.projectId`
  → **同一轮重试不重新解析配置**（`runtime.ts:278-282`）；
- 调用 `prepareLongAgentAssembly`（`assembly.ts`）解析：内容配置（默认→会话）、身份、交互 harness、长期记忆、
  项目上下文、工具与资源；产出 `prepared`（含 `promptConfig`、`identityInstructions`）。

### ⑥–⑧ 唯一的 Pi 装配与发送

`createLife OSPiAgentSession`（`pi-agent-session.ts`）是本系统**唯一**的 Pi 装配入口，内部调用 Pi 公开 API：

```ts
const created = await createAgentSession({          // pi-agent-session.ts:386
  cwd, agentDir,                                    // 工作目录 / Agent 资源根
  sessionManager,                                   // Pi 原生会话（消息与 CustomEntry 都落这里）
  settingsManager,                                  // 模型/压缩等设置（会话级策略用 in-memory 副本）
  resourceLoader,                                   // Skill / Extension / Prompt 资源
  customTools, modelRuntime, model, thinkingLevel,   // 能力与运行参数
  providerRequestGate,                              // ★ 请求闸门：B5 编辑层在这里改写最终 payload
  tools | noTools | excludeTools,                   // 工具授权（模型可见工具集）
  transformContext,                                 // 上下文投影（B5 消息级编辑）
  appendSystemPromptOverride,                       // ★ Life OS 自定义区域在这里追加（pi-agent-session.ts:222）
  agentsFilesOverride,                              // 工作区上下文文件（pi-agent-session.ts:180）
});
...
await created.session.prompt(text, images ? { images: [...images] } : undefined);   // runtime.ts:334
```

Pi 侧随后完成：System Prompt 组装（基础区 + Life OS 追加区 + context files + Skill 描述）→ `SessionManager`
取有效历史 → `convertToLlm` 转 LLM 消息 → provider 适配器构建 HTTP payload → `onPayload`
（= Life OS 传入的 `providerRequestGate`）→ 真正发出。

### ⑨ 结果、事件与记录

- 事件：`created.session.subscribe(...)` → `feedback.publish(event)` 推送增量；`message_end` 且
  `role=assistant` 时记录最终回答（`runtime.ts:322-328`）。
- 状态：`updateTurnStatus(home, turnId, "completed" | "failed" | "cancelled" | "interrupted")`（`turn-queue.ts:277`），
- 完整交互记录：`promptCapture === "on"` 时由 `session-prompt-capture.ts` 在 `onPayload` 写
  `interactions/<sid>/`（区域记录始终有）。

## 3 哪些是 Pi 提供的，哪些是 Life OS 自己写的

| 能力 | 归属 | 证据 |
|---|---|---|
| Agent 循环、System Prompt 构建、消息转换、provider 适配、HTTP、重试/压缩 | **Pi** | `pi/packages/coding-agent`、`pi/packages/ai` |
| `SessionManager`（原生消息与 CustomEntry）、`SettingsManager`、`ResourceLoader`、`convertToLlm`、`estimateTokens` | **Pi 公开 API** | 依赖 `@earendil-works/pi-coding-agent`（`package.json:56` 指向 `./pi/packages/coding-agent`） |
| 唯一装配入口 `createAgentSession()` 调用点 | **Life OS（唯一）** | `src/agents/pi-agent-session.ts:386` |
| 受理 / 耐久 Turn / 串行队列 / 幂等 / 取消 / 事件回执 | Life OS | `src/long-agents/turn-queue.ts`、`runtime.ts` |
| 内容配置解析（默认→会话）、交互 harness / 记忆 / 项目上下文装配 | Life OS | `src/long-agents/assembly.ts`、`interaction-harness.ts` |
| Life OS 自定义区域（`lifeos_identity` / `lifeos_interaction_harness` / `lifeos_long_term_memory` / 自定义指令） | Life OS（写进 Pi 的追加区） | `assembly.ts`、`pi-agent-session.ts:174-222`、区域注册表 |
| 装配快照、请求闸门编辑层、完整交互记录、前端读模型 | Life OS | `lifeos.agent-assembly-*.v1`、`src/context-edit.ts`、`src/session-prompt-capture.ts` |

**结论**：Life OS 没有自己的 Agent 运行时，也没有第二套请求拼装；它只做"受理 + 解析 + 装配调用 + 记录"。

## 4 验证状态（事实，2026-10-14）

**已有自动化覆盖**（假模型 / 受控模型，不起真实 provider）：

| 覆盖点 | 证据 |
|---|---|
| HTTP 受理与 202/幂等/去重/冲突/归属 | `test/long-agents/turn-feedback.test.mjs`、`conversation-execution-protocol.test.mjs` |
| HTTP → 原生 Pi → 事件增量、取消、引导、跨项目拒绝 | `test/long-agents/turn-feedback.test.mjs` |
| 装配与请求边界（区域在不在、同源） | `test/agents/public-assembly.test.mjs`、`prompt-config-boundary.test.mjs` |
| 每日生命周期、重启恢复、跨日总结 | `test/long-agents/daily-lifecycle.test.mjs` |
| 真实开发/生产装配链（假模型走完 completed） | `pnpm test:dev`（`scripts/dev-server.test.mjs`）、`pnpm test:built` |

**没有验证的（缺口）**：

1. **真实 provider 端到端**：用户消息 → 真实模型 API → 回包落进 Session（现有测试都用假/受控模型）。
2. **真实渠道**（Telegram / 微信）走同一条链路的端到端。
3. **"用户消息 → 请求内容"的逐字节对照**：Web 输入一句话，抓真实请求，比对 System Prompt 里各区域是否等于
   检查视图/预览所示（同源已有单元断言，但没有一次真机抓包对照）。
4. 前端到后端的真实浏览器链路（输入区 → 状态行 → 回复）在最近改动后的完整回归。

## 5 建议的验证步骤（可执行，待你确认后做）

```bash
# 1) 服务在跑
curl -s http://127.0.0.1:43110/api/health

# 2) 发一轮真实消息（会调用真实模型，产生费用）
curl -s -X POST http://127.0.0.1:43110/api/long-agents/<longAgentId>/turns \
  -H 'content-type: application/json' \
  -d '{"schemaVersion":1,"requestId":"verify-1","text":"只回复两个字：收到","contextProjectId":null}'
# 期望：202 + 执行引用；随后 GET /turns/verify-1 看到 running → completed 与 assistant 回复

# 3) 对照"实际请求内容"
#    发送前：GET /api/sessions/<sessionId>/context-preview?projectId=<p>&longAgentId=<a>
#    发送后：读该轮的完整交互记录（interactions/），比对 System Prompt 区域集合一致
```

真机验收要回答三个问题：**发得出（202）→ 跑得完（completed 且有回复）→ 请求内容与预览一致**。
在完成这一步之前，"后端已按 Pi SDK 实现"只有代码与假模型证据，**不能算已验收**。
