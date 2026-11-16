#!/usr/bin/env node
/**
 * 演示用的**打桩模型服务**（stub model server）。
 *
 * 为什么需要：拍素材时希望画面上出现"真实的一轮对话"——流式正文、思考段、几次工具调用、
 * 真实的 usage 数字。用真模型会带来三个问题：
 *   ① 每次出片内容不同 → 素材不可复现；
 *   ② 可能失败/限流/超时 → 拍摄中断（实测：第一版 hero 里就抓到了红色的"模型调用失败"）；
 *   ③ 花钱、慢。
 *
 * 它做的事：实现 OpenAI 兼容的 `POST /v1/chat/completions`（SSE 流式），
 * 按剧本返回固定的思考段、工具调用、正文与 usage。内容取自我们的演示家目录，讲的是同一件事。
 *
 * 用法：
 *   STUB_PORT=43140 node scripts/readme-studio/stub-model.mjs
 *   然后在演示家目录的 models.json 里把 provider.baseUrl 指向 http://127.0.0.1:43140/v1
 *
 * 边界（必须说清，不许含糊）：
 *   - **只用于拍素材**，不是产品的一部分，不进 `pnpm verify`；
 *   - 它产生的 usage/耗时是剧本值，不是真实测量值；
 *   - 因此素材里凡是"数字"都当作示意，不当作性能证据（README 里不引用这些数字）。
 */
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT ?? 43140);

/** 剧本：一次完整的开发对话（思考 → 读文件 → bash → 回答问题）。 */
const SCRIPT = [
  {
    thinking: "先看状态机现在的定义与调用方，别急着改。retrying 到底是状态还是计数，要看它被写在哪几处。",
    tools: [{ name: "read", arguments: { path: "payment/state-machine.ts" } }],
  },
  {
    tools: [{ name: "bash", arguments: { command: "grep -rn \"retrying\" src/payment | wc -l" } }],
  },
  {
    text: `可以收敛成 4 个态，依据是「钱在哪」：

| 4 态 | 合并掉了 | 不变量 |
|---|---|---|
| \`pending\` | created / paying / retrying | 钱还没到 |
| \`paid\` | paid / settled | 钱到了，且已对账 |
| \`refunding\` | refunding / partial_refunded | 有退款在途 |
| \`closed\` | refunded / closed / expired / failed | 终态，钱已回来或从未出去 |

两个判断依据：

1. **\`retrying\` 不是状态**，是 \`paying\` 的重试计数——现有代码 37 处读 \`status\`，其中 9 处只是拿它判断是否还在等钱；
2. **\`settled\` 与 \`paid\` 的差别在对账，不在状态机**——对账是另一个维度（\`reconciledAt\` 字段），塞进状态机会让状态数随对账规则增长。

风险：\`partial_refunded\` 消失后，部分退款的金额必须在 \`refunds[]\` 上算，不能读状态。这一处要改调用方。`,
  },
];

const TOOL_RESULTS = {
  read: "状态枚举共 11 个：created / paying / paid / refunding / refunded / partial_refunded / closed / expired / failed / retrying / settled",
  bash: "37",
};

let turnIndex = 0;

function sseChunk(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const server = createServer(async (request, response) => {
  if (!request.url?.endsWith("/chat/completions")) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
    return;
  }

  // 读请求体（判断是否请求流式；顺便把消息数打到日志里便于排查）
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { /* 忽略 */ }

  const stream = body.stream === true;
  const step = SCRIPT[Math.min(turnIndex, SCRIPT.length - 1)];
  turnIndex += 1;

  if (!stream) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: `stub-${Date.now()}`, object: "chat.completion", model: body.model ?? "stub-model",
      choices: [{ index: 0, message: { role: "assistant", content: step.text ?? "" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 24600, completion_tokens: 610, total_tokens: 25210 },
    }));
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const base = { id: `stub-${Date.now()}`, object: "chat.completion.chunk", model: body.model ?? "stub-model" };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 1) 思考段
  if (step.thinking !== undefined) {
    const words = step.thinking.match(/[\s\S]{1,6}/g) ?? [];
    for (const piece of words) {
      response.write(sseChunk({ ...base, choices: [{ index: 0, delta: { reasoning_content: piece } }] }));
      await wait(18);
    }
  }

  // 2) 工具调用（一串 arguments 分片，模拟真实增量）
  for (const [index, tool] of (step.tools ?? []).entries()) {
    const argText = JSON.stringify(tool.arguments);
    response.write(sseChunk({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index, id: `call_${index}`, type: "function", function: { name: tool.name, arguments: "" } }] } }] }));
    for (const piece of (argText.match(/[\s\S]{1,8}/g) ?? [])) {
      response.write(sseChunk({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: piece } }] } }] }));
      await wait(12);
    }
    await wait(120);
    // 工具结果由 Pi 侧回传；这里只把"下一步"接着演，不模拟结果本身
    response.write(`data: [DONE]\n\n`);
    response.end();
    return;
  }

  // 3) 正文（逐段吐，模拟 markdown 逐步成形）
  const pieces = (step.text ?? "").match(/[\s\S]{1,4}/g) ?? [];
  for (const piece of pieces) {
    response.write(sseChunk({ ...base, choices: [{ index: 0, delta: { content: piece } }] }));
    await wait(16);
  }

  response.write(sseChunk({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 24600, completion_tokens: 610, total_tokens: 25210,
      prompt_tokens_details: { cached_tokens: 20000 } },
  }));
  response.write("data: [DONE]\n\n");
  response.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`打桩模型服务已启动：http://127.0.0.1:${PORT}/v1（仅供拍摄素材，剧本 ${SCRIPT.length} 步）`);
});
