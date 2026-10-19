import assert from "node:assert/strict";
import { test } from "node:test";
import { applyStreamEvent, argPreview, blocksOfStream, createStreamState, textOfBlocks } from "../frontend/src/stream-blocks.ts";

/**
 * 归并判据：一条助手消息里的块顺序 == 模型输出的顺序（思考/文本/工具交替），
 * 不能用"往最后一个文本块追加"糊过去——工具调用之后的文本会串到工具之前。
 */

const run = (events) => events.reduce((state, event) => applyStreamEvent(state, event), createStreamState());

test("思考 → 文本 → 工具调用 → 工具结果 → 文本：块按 contentIndex 有序，文本不串段", () => {
  const state = run([
    { type: "thinking", index: 0, text: "先看目录" },
    { type: "thinking", index: 0, text: "，再读文件" },
    { type: "delta", index: 1, text: "我看看" },
    { type: "tool_call", index: 2, id: "call_1", name: "read", arguments: { path: "a.md" } },
    { type: "tool_result", id: "call_1", isError: false, text: "文件内容", truncated: false, durationMs: 800 },
    { type: "delta", index: 3, text: "结论是好的" },
  ]);
  const blocks = blocksOfStream(state);
  assert.deepEqual(blocks.map((block) => block.type), ["thinking", "text", "toolCall", "text"]);
  assert.equal(blocks[0].text, "先看目录，再读文件");
  assert.equal(blocks[1].text, "我看看");
  assert.equal(blocks[3].text, "结论是好的");
  assert.equal(textOfBlocks(blocks), "我看看结论是好的");
  assert.equal(blocks[2].result, "文件内容");
  assert.equal(blocks[2].durationMs, 800);
});

test("晚到的低槽位插到前面（不为到达顺序改动模型顺序）", () => {
  const state = run([
    { type: "delta", index: 3, text: "结尾" },
    { type: "thinking", index: 0, text: "开头" },
    { type: "delta", index: 1, text: "中间" },
  ]);
  assert.deepEqual(blocksOfStream(state).map((block) => block.type), ["thinking", "text", "text"]);
  assert.deepEqual(blocksOfStream(state).map((block) => block.text), ["开头", "中间", "结尾"]);
});

test("阶段与 activeTool 跟着事件走：工具结果回来后回到“等模型”", () => {
  assert.equal(createStreamState().phase, "waiting");
  assert.equal(run([{ type: "thinking", index: 0, text: "x" }]).phase, "thinking");
  assert.equal(run([{ type: "delta", index: 0, text: "x" }]).phase, "text");
  const runningTool = run([{ type: "tool_call", index: 1, id: "c1", name: "bash", arguments: { command: "ls" } }]);
  assert.equal(runningTool.phase, "tool");
  assert.equal(runningTool.activeTool, "bash");
  const done = applyStreamEvent(runningTool, { type: "tool_result", id: "c1", isError: false, text: "ok", truncated: false });
  assert.equal(done.phase, "waiting");
  assert.equal(done.activeTool, undefined);
});

test("找不到对应调用的 tool_result 不改状态（不凭空造块）", () => {
  const before = run([{ type: "tool_call", index: 0, id: "c1", name: "read", arguments: {} }]);
  const after = applyStreamEvent(before, { type: "tool_result", id: "unknown", isError: false, text: "x", truncated: false });
  assert.equal(after, before);
});

test("工具参数摘要取自 Pi 各工具的真实字段（不是猜测）", () => {
  assert.equal(argPreview("bash", { command: "pnpm test", timeout: 60 }), "pnpm test");
  assert.equal(argPreview("read", { path: "docs/README.md" }), "docs/README.md");
  assert.equal(argPreview("grep", { pattern: "TODO", path: "src" }), "TODO @ src");
  assert.equal(argPreview("find", { pattern: "*.md" }), "*.md");
  assert.equal(argPreview("edit", { path: "a.ts", edits: [{}, {}] }), "a.ts · 2 处");
  assert.equal(argPreview("write", { path: "b.md", content: "12345" }), "b.md · 5 字符");
  assert.equal(argPreview("unknown-tool", {}), "");
});
