#!/usr/bin/env node
/**
 * README 演示家目录：造一套**干净、可复现**的示例数据（3 个 Agent、2 个项目、几条有内容的会话）。
 *
 * 为什么不用真实数据截图：主实例里全是测试残留（标题是 `草稿契约-1793599187754` 这类），
 * 放进 README 等于把调试垃圾当宣传材料；而且每次重拍都会漂。
 *
 * 原则：
 * - 只写会话 JSONL 与 agent.json / task.md 这类**由程序读的文件**，格式照 Pi 的 session v3；
 * - 绝不写用户真实家目录：目标必须是 `LIFEOS_HOME` 且路径里含 `readme`，否则直接退出；
 * - 幂等：目录已存在就只清 sessions/ 重建，不动模板（模板由 `pnpm home:install` 生成）。
 *
 * 用法：
 *   LIFEOS_HOME=~/.lifeos-readme node --experimental-strip-types src/install.ts   # 先装模板
 *   LIFEOS_HOME=~/.lifeos-readme node scripts/readme-demo-home.mjs                # 再造数据
 */
import { existsSync, mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = process.env.LIFEOS_HOME ?? "";
if (!HOME.includes("readme")) {
  console.error("拒绝执行：LIFEOS_HOME 必须显式指向一个含 readme 的演示目录（例如 ~/.lifeos-readme）。");
  process.exit(1);
}
if (!existsSync(join(HOME, "install-receipt.json"))) {
  console.error(`家目录未安装：${HOME}\n先运行：LIFEOS_HOME=${HOME} node --experimental-strip-types src/install.ts`);
  process.exit(1);
}

const now = Date.now();
const iso = (offsetMinutes) => new Date(now - offsetMinutes * 60_000).toISOString();
const ms = (offsetMinutes) => now - offsetMinutes * 60_000;

/** ULID 风格的会话 id（照真实数据的形态：时间前缀 + 随机）。 */
let counter = 0;
function sessionId(offsetMinutes) {
  const base = 1_791_000_000_000 + (offsetMinutes * -60_000);
  const time = Math.floor(base).toString(32).padStart(10, "0");
  counter += 1;
  const rand = (counter * 2654435761 % 0xffffffff).toString(32).padStart(6, "0");
  return `${time}${rand}${"0".repeat(10)}`;
}

/** 一条 assistant 消息（带 usage / 思考 / 工具调用，形状照真实会话文件）。 */
function assistant({ text, thinking, tools = [], offset, durationMs = 8_400, input = 24_600, output = 420 }) {
  const content = [];
  if (thinking !== undefined) {
    content.push({
      type: "thinking",
      thinking,
      thinkingSignature: JSON.stringify([{ index: 0, type: "reasoning.text", text: thinking }]),
    });
  }
  for (const tool of tools) {
    content.push({ type: "toolCall", id: `call_${Math.random().toString(36).slice(2, 10)}`, name: tool.name, arguments: tool.arguments });
  }
  content.push({ type: "text", text });
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "demo",
    model: "demo-model",
    usage: {
      input, output, cacheRead: input * 0.8, cacheWrite: 0, reasoning: 0,
      totalTokens: input + output,
      cost: { input: 0.0049, output: 0.0000, cacheRead: 0.0001, cacheWrite: 0, total: 0.005 },
    },
    stopReason: tools.length > 0 && text === "" ? "toolUse" : "stop",
    timestamp: ms(offset),
    responseId: `chatcmpl-${Math.random().toString(36).slice(2, 14)}`,
    rawStopReason: tools.length > 0 && text === "" ? "tool_calls" : "stop",
    durationMs,
    thinkingLevel: "medium",
  };
}

function toolResult(tool, offset, text) {
  return { role: "toolResult", toolCallId: tool.id, toolName: tool.name, content: [{ type: "text", text }], timestamp: ms(offset), durationMs: 120 };
}

function systemMessage(offset, sections) {
  return {
    role: "system",
    content: "",
    sections,
    timestamp: ms(offset),
    toolsAdded: Object.keys(sections).length,
  };
}

const HARNESS_SECTION = `<lifeos_interaction_harness>
以下是用户与该项目的交互 harness（协作规范与资料），本轮按作用域装配。

## 协议正文
（协议 §1–§12：角色、Task、会话、规范层级、记忆、提升与维护……）

## 当前 Task
- ID: 0001 · 类型 daily · 状态 进行中
- 本任务遵守：协议 / 类型规则 / 共享 workspace 规范 / Agent × 项目规范

## 规范索引
- specs/code/frontend/code.md · specs/code/backend/code.md · specs/code/api/api.md
- specs/review/review.md · specs/frontend-development/process.md
</lifeos_interaction_harness>`;

const SECTIONS = {
  preamble: "<lifeos_identity>\n# Life Agent\n\n我是 Life OS 的默认 Agent：负责把用户的想法落成可追溯的 Task，并在他不在时继续推进。\n</lifeos_identity>",
  skills: "<skills>\nThe following skills provide specialized instructions for specific tasks.\n- agent-reach\n- pi-subagents\n</skills>",
  cwd: `<cwd>\n${HOME}\n</cwd>`,
  tools: "<tools>\n- read · bash · edit · write\n- lifeos_task_create · lifeos_task_list · lifeos_task_enter\n- lifeos_project_add · lifeos_project_list\n- lifeos_memory_search · lifeos_memory_record · lifeos_memory_delete\n- lifeos_ask · lifeos_send · lifeos_agent_list · lifeos_ask_list\n</tools>",
  rules: "<rules>\n- 默认中文回复；先给结论与数字证据。\n- 未经用户明确要求不提交、不推送、不部署。\n</rules>",
  lifeos_interaction_harness: HARNESS_SECTION,
};

/**
 * 写一条会话文件。
 * entries: [{ at, ... }] 按时间升序；`at` 是"几分钟前"。
 */
function writeSession(agentId, projectId, { id, title, entries, peer, taskId = "0001" }) {
  const dir = join(HOME, "agents", agentId, "projects", projectId, "sessions");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const firstAt = entries[0].at;
  const stamp = iso(firstAt).replace(/[:.]/g, "-");
  const file = join(dir, `${stamp}_${id}.jsonl`);
  const lines = [JSON.stringify({ type: "session", version: 3, id, timestamp: iso(firstAt), cwd: HOME })];
  lines.push(JSON.stringify({ type: "model_change", id: "m1", parentId: null, timestamp: iso(firstAt), provider: "demo", modelId: "demo-model" }));
  lines.push(JSON.stringify({ type: "thinking_level_change", id: "t1", parentId: "m1", timestamp: iso(firstAt), thinkingLevel: "medium" }));
  lines.push(JSON.stringify({ type: "custom", customType: "lifeos_active_task", data: { taskId, at: iso(firstAt) }, id: "c1", parentId: "t1", timestamp: iso(firstAt) }));
  if (peer !== undefined) {
    lines.push(JSON.stringify({
      type: "custom", customType: "lifeos_peer",
      data: { peerAgentId: peer, targetAgentId: agentId, initiatorTaskId: taskId, projectId, at: iso(firstAt) },
      id: "c2", parentId: "c1", timestamp: iso(firstAt),
    }));
  }
  lines.push(JSON.stringify({ type: "session_info", id: "s1", parentId: peer === undefined ? "c1" : "c2", timestamp: iso(firstAt), name: title }));
  let parentId = peer === undefined ? "c1" : "c2";
  parentId = "s1";
  for (const entry of entries) {
    const id = Math.random().toString(16).slice(2, 10);
    const node = entry.message !== undefined
      ? { type: "message", id, parentId, timestamp: iso(entry.at), message: entry.message }
      : { type: "custom", id, parentId, timestamp: iso(entry.at), customType: entry.customType, data: entry.data };
    lines.push(JSON.stringify(node));
    parentId = id;
  }
  writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  return file;
}

/* ---------------------------------- 数据 ---------------------------------- */

const AGENTS = [
  { id: "lifeosagent", name: "Life Agent", description: "Life OS 的默认 Agent：把想法落成 Task，并在你不在时继续推进。", defaultProjectId: "workspace" },
  { id: "architect", name: "Architect", description: "架构师：需求调研与分析、方案设计，产出开发与测试方案。", defaultProjectId: "lifelab" },
  { id: "coder", name: "coder", description: "资深全栈开发 Agent：强代码质量与性能意识，从项目整体做开发决策。", defaultProjectId: "lifelab" },
  { id: "reviewer", name: "Reviewer", description: "独立复核：只看证据与边界，不复述实现者的说法。", defaultProjectId: "lifelab" },
];

const PROJECTS = [
  { id: "workspace", name: "workspace" },
  { id: "lifelab", name: "lifelab" },
];

for (const agent of AGENTS) {
  const dir = join(HOME, "agents", agent.id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "agent.json"), `${JSON.stringify({ schemaVersion: 1, ...agent }, null, 2)}\n`, { mode: 0o600 });
  // Agent × 项目骨架：只补 tasks 与 sessions（其余目录由协议模板提供时就复用）
  for (const project of PROJECTS) {
    const projectDir = join(dir, "projects", project.id);
    mkdirSync(join(projectDir, "tasks"), { recursive: true, mode: 0o700 });
    const defaultTask = join(projectDir, "tasks", "0001-default");
    mkdirSync(defaultTask, { recursive: true, mode: 0o700 });
    if (!existsSync(join(defaultTask, "task.md"))) {
      writeFileSync(join(defaultTask, "task.md"), `# 默认\n\nID: 0001\n类型：daily\n类别：D 日常\n状态：进行中\n负责人：${agent.name}\n目标：没有明确 Task 时的交互都归到这里。\n`, { mode: 0o600 });
    }
    // 演示用的第二个 Task：让截图里能看见 Task 编号与标题
    if (project.id === "lifelab") {
      const task = join(projectDir, "tasks", "0002-支付重构");
      mkdirSync(task, { recursive: true, mode: 0o700 });
      writeFileSync(join(task, "task.md"), `# 支付重构\n\nID: 0002\n类型：development\n类别：A 改产品行为\n状态：进行中\n负责人：${agent.name}\n目标：把支付链路的状态机收敛为 4 个态，回调幂等。\n必需文档：01-background · 02-design · 03-phase · 04-plan · phases/\n`, { mode: 0o600 });
    }
  }
}

for (const project of PROJECTS) {
  const dir = join(HOME, "projects", project.id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "project.json"), `${JSON.stringify({ schemaVersion: 1, ...project }, null, 2)}\n`, { mode: 0o600 });
}

// 清掉可能残留的旧会话，保证重跑结果一致
for (const agent of AGENTS) {
  for (const project of PROJECTS) {
    const dir = join(HOME, "agents", agent.id, "projects", project.id, "sessions");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

/* ---- 会话 1：一轮完整的开发对话（有思考、工具调用、过程折叠、usage） ---- */
{
  const sid = sessionId(52);
  const t1 = { role: "assistant", content: [{ type: "toolCall", id: "call_a1", name: "read", arguments: { path: ".lifeos/projects/lifelab/knowledge/architecture/payment.md" } }], timestamp: ms(51), usage: { input: 24_600, output: 72, cacheRead: 20_000, cacheWrite: 0, reasoning: 0, totalTokens: 24_672, cost: { input: 0.0049, output: 0, cacheRead: 0.0001, cacheWrite: 0, total: 0.005 } }, stopReason: "toolUse", durationMs: 3_200, thinkingLevel: "medium", api: "openai-completions", provider: "demo", model: "demo-model", responseId: "r1" };
  const t2 = { role: "assistant", content: [{ type: "toolCall", id: "call_a2", name: "bash", arguments: { command: "grep -rn 'status' src/payment/*.ts | wc -l" } }], timestamp: ms(50), usage: { input: 25_100, output: 64, cacheRead: 24_000, cacheWrite: 0, reasoning: 0, totalTokens: 25_164, cost: { input: 0.005, output: 0, cacheRead: 0.0001, cacheWrite: 0, total: 0.0051 } }, stopReason: "toolUse", durationMs: 2_100, thinkingLevel: "medium", api: "openai-completions", provider: "demo", model: "demo-model", responseId: "r2" };
  writeSession("lifeosagent", "lifelab", {
    id: sid,
    title: "支付状态机收敛为 4 个态",
    taskId: "0002",
    entries: [
      { at: 52, message: systemMessage(52, SECTIONS) },
      { at: 52, message: { role: "user", content: [{ type: "text", text: "支付的状态机现在有 11 个态，太乱了。你能收敛成 4 个吗？先看代码再给结论。" }], timestamp: ms(52) } },
      { at: 51, message: t1 },
      { at: 51, message: toolResult({ id: "call_a1", name: "read" }, 51, "把支付链路的状态机收敛为 4 个态，回调幂等。\n\n## 现状\n状态枚举共 11 个：created / paying / paid / refunding / refunded / partial_refunded / closed / expired / failed / retrying / settled") },
      { at: 50, message: t2 },
      { at: 50, message: toolResult({ id: "call_a2", name: "bash" }, 50, "37") },
      { at: 49, message: assistant({
        thinking: "11 个态里有两组是同一件事的不同阶段：retrying 是 paying 的重试；settled 与 paid 只差对账。先按「钱在谁手里」分类，再删重复。",
        offset: 49, input: 26_400, output: 610, durationMs: 24_800,
        text: "可以收敛成 4 个态，依据是「钱在哪」：\n\n| 4 态 | 合并掉了 | 不变量 |\n|---|---|---|\n| `pending` | created / paying / retrying | 钱还没到 |\n| `paid` | paid / settled | 钱到了，且已对账 |\n| `refunding` | refunding / partial_refunded | 有退款在途 |\n| `closed` | refunded / closed / expired / failed | 终态，钱已回来或从未出去 |\n\n两个判断依据：\n\n1. **`retrying` 不是状态**，是 `paying` 的重试计数——现有代码 37 处读 `status`，其中 9 处只是拿它判断是否还在等钱；\n2. **`settled` 与 `paid` 的差别在对账，不在状态机**——对账是另一个维度（`reconciledAt` 字段），塞进状态机会让状态数随对账规则增长。\n\n风险：`partial_refunded` 消失后，部分退款的金额必须在 `refunds[]` 上算，不能读状态。这一处要改调用方。",
      }) },
    ],
  });
}

/* ---- 会话 2：Task 管理（短、干净，用来看头部 Task 段） ---- */
{
  writeSession("lifeosagent", "workspace", {
    id: sessionId(180),
    title: "把这周的三件事排成 Task",
    entries: [
      { at: 180, message: systemMessage(180, SECTIONS) },
      { at: 180, message: { role: "user", content: [{ type: "text", text: "这周有三件事：支付重构、把验收测试补齐、看一下图片输入的成本。帮我排成 Task。" }], timestamp: ms(180) } },
      { at: 179, message: assistant({
        offset: 179, input: 22_100, output: 380, durationMs: 6_400,
        text: "排好了，三件事都落在 lifelab 项目下：\n\n- **0002 支付重构**（开发 A）：已在做，状态「进行中」\n- **0003 补齐 0018 验收测试**（开发 A）：需要 `01-background · 02-design · 03-phase · 04-plan`\n- **0004 图片输入成本核算**（普通任务 G）：只需要背景 + 步骤，不建 phases\n\n第三件我按「普通任务」排——它不改产品行为，也不改协作规范，只是把一件事管起来。要改成开发类型就说一声。",
      }) },
    ],
  });
}

/* ---- 会话 3：Agent ↔ Agent（coder 那边存对端 = lifeosagent），用来展示参与者头像 ---- */
{
  writeSession("coder", "lifelab", {
    id: sessionId(26),
    title: "与 Life Agent 的对话",
    taskId: "0002",
    peer: "lifeosagent",
    entries: [
      { at: 26, message: systemMessage(26, SECTIONS) },
      { at: 26, message: { role: "user", content: [{ type: "text", text: "Life Agent 想确认：把 partial_refunded 合进 closed 之后，退款金额还能不能逐笔查到？回一句结论，不要改代码。" }], timestamp: ms(26) } },
      { at: 25, message: assistant({
        thinking: "先确认 refunds 是否独立列表，再看有没有地方读 partial_refunded 判断金额。",
        offset: 25, input: 23_800, output: 210, durationMs: 9_100,
        text: "能。`refunds[]` 是独立列表，每笔带 `amount` 与 `channelRefundId`；状态只决定这条订单能不能再发起退款，不承载金额。\n\n唯一要改的是 3 处读 `partial_refunded` 做展示的代码（`order-detail.tsx` 两处、`refund-badge.ts` 一处），改成按 `refunds.length > 0 && refundedAmount < amount` 判断。",
      }) },
      { at: 24, message: assistant({
        offset: 24, input: 24_200, output: 96, durationMs: 3_200,
        text: "结论：可以合并，金额查得到；调用方 3 处展示逻辑要跟着改。",
      }) },
    ],
  });
}

/* ---- 会话 4：Reviewer 的一次独立复核（有失败归因，展示失败块） ---- */
{
  writeSession("reviewer", "lifelab", {
    id: sessionId(140),
    title: "复核 0002 的契约边界",
    taskId: "0002",
    entries: [
      { at: 140, message: systemMessage(140, SECTIONS) },
      { at: 140, message: { role: "user", content: [{ type: "text", text: "复核 0002：支付四态的契约边界有没有漏。" }], timestamp: ms(140) } },
      { at: 139, message: assistant({
        offset: 139, input: 21_500, output: 420, durationMs: 11_600,
        text: "复核结果：3 条边界，2 条已覆盖，1 条漏。\n\n- ✅ 幂等键 = 订单号 + 渠道：`payment/contract.md` §2 写明\n- ✅ 退款状态只 4 个：`refunds[]` 承载金额，不新增状态\n- ❌ **并发回调**没有定义：两个渠道同时回调时谁赢没写。现在代码靠数据库行锁，但契约里没这条，换实现就会破\n\n建议补一条：`回调以 (订单号, 渠道, 版本号) 唯一，重复回调直接返回 200 且不重复记账`。",
      }) },
    ],
  });
}

/* ---- 会话 5：Architect 的方案（长一点的回复，看正文排版与代码块） ---- */
{
  writeSession("architect", "lifelab", {
    id: sessionId(320),
    title: "0002 的设计：状态机与回调",
    taskId: "0002",
    entries: [
      { at: 320, message: systemMessage(320, SECTIONS) },
      { at: 320, message: { role: "user", content: [{ type: "text", text: "给我 0002 的设计：状态机 + 回调幂等 + 迁移步骤。" }], timestamp: ms(320) } },
      { at: 318, message: assistant({
        offset: 318, input: 25_000, output: 780, durationMs: 27_400,
        text: "## 1 状态机\n\n四个态，只有一个方向能走：\n\n```\npending ──payOk──▶ paid ──refundReq──▶ refunding ──refundOk──▶ closed\n   │                  │                                          ▲\n   └────expire────────┴────────────refundFail────────────────────┘\n```\n\n**不变量**（三条，任何时刻都成立）：\n\n- `pending` 的钱一定在渠道手里，不在账上；\n- `paid` 必须同时有 `paidAt` 与 `reconciledAt`；\n- `closed` 之后 `refunds[]` 只读。\n\n## 2 回调幂等\n\n唯一键 `(orderId, channel, version)`。重复回调返回 200、不重复记账，靠唯一索引而不是应用层判断——应用层判断在并发下一定会漏。\n\n## 3 迁移步骤\n\n| 步 | 动作 | 回滚 |\n|---|---|---|\n| 1 | 加 `version` 列，双写 | 停双写 |\n| 2 | 旧状态映射到 4 态（只读视图） | 删视图 |\n| 3 | 调用方切到新字段 | 切回视图 |\n| 4 | 删旧状态列 | 从备份恢复 |\n\n第 2 步之后可停：只读视图能长期存在，不必赶着删列。",
      }) },
    ],
  });
}

console.log(`演示家目录已生成：${HOME}`);
for (const agent of AGENTS) {
  for (const project of PROJECTS) {
    const dir = join(HOME, "agents", agent.id, "projects", project.id, "sessions");
    if (!existsSync(dir)) continue;
    for (const file of (await import("node:fs")).readdirSync(dir)) {
      console.log(`  ${agent.id}/${project.id}: ${file}  ${(statSync(join(dir, file)).size / 1024).toFixed(1)} KB`);
    }
  }
}
