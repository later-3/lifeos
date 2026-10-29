// 工具读图说明文字（Task 0012 · P4）：路径必须出现在说明里，否则淘汰后模型指不回去。
import assert from "node:assert/strict";
import test from "node:test";
import { formatImageNote, isImageNoteText, pngSizeOf } from "../src/image-note.ts";
import { boundImages } from "../src/image-budget.ts";
import { createLifeOsReadPathExtension } from "../src/assembly.ts";

/** 造一个只有文件头（含 IHDR 宽高）的 PNG，够解析尺寸用。 */
function pngHeader(width, height, pad = 0) {
  const buf = Buffer.alloc(24 + pad);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((byte, index) => { buf[index] = byte; });
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf.toString("base64");
}

test("pngSizeOf：认 PNG 宽高；非 PNG 返回 undefined", () => {
  assert.deepEqual(pngSizeOf(Buffer.from(pngHeader(1280, 800), "base64")), { width: 1280, height: 800 });
  assert.equal(pngSizeOf(Buffer.from("not a png at all, really not", "utf8")), undefined);
  assert.equal(pngSizeOf(undefined), undefined);
});

test("formatImageNote：路径 + 尺寸 + 大小；尺寸认不出时只写路径与大小", () => {
  const png = formatImageNote({ path: "/tmp/demo/shot-3.png", base64: pngHeader(1280, 800, 400_000) });
  assert.match(png, /^screenshot \/tmp\/demo\/shot-3\.png 1280x800 /);
  assert.match(png, /KB$/);

  const other = formatImageNote({ path: "/tmp/demo/a.jpg", base64: "A".repeat(2_000_000), mimeType: "image/jpeg" });
  assert.equal(other, "screenshot /tmp/demo/a.jpg 2.0MB", "JPEG 认不出尺寸，但路径与大小要在");
});

test("isImageNoteText：能认出 Pi 原文与我们自己的格式", () => {
  assert.equal(isImageNoteText("Read image file [image/png]"), true);
  assert.equal(isImageNoteText("screenshot /tmp/a.png 1280x800 42KB"), true);
  assert.equal(isImageNoteText("hello"), false);
});

test("tool_result 接线：相对路径按 ctx.cwd 解析成绝对路径；**存储里只留引用**（D7，图由 context 钩子重注入）", () => {
  const extension = createLifeOsReadPathExtension();
  let handler;
  extension.factory({ on: (name, fn) => { if (name === "tool_result") handler = fn; } });
  assert.equal(typeof handler, "function");

  const image = { type: "image", data: pngHeader(1280, 800, 100_000), mimeType: "image/png" };
  const out = handler(
    { type: "tool_result", toolName: "read", toolCallId: "c1", input: { path: "demo/shot.png" }, content: [{ type: "text", text: "Read image file [image/png]" }, image], isError: false },
    { cwd: "/tmp/work" },
  );
  assert.ok(out?.content);
  const text = out.content.find((block) => block.type === "text").text;
  assert.match(text, /^screenshot \/tmp\/work\/demo\/shot\.png 1280x800 /);
  // D7：图块**不进历史**——文件本来就在磁盘上，当轮可见性由重注入保证（attachments-reinject 的 T14）
  assert.equal(out.content.some((block) => block.type === "image"), false, "存储里不再带图块");
  assert.equal(out.content.length, 1, "只剩这一行引用");

  // 非 read 工具 → 不动
  assert.equal(handler({ type: "tool_result", toolName: "bash", toolCallId: "c2", input: {}, content: [{ type: "text", text: "ok" }], isError: false }, { cwd: "/tmp" }), undefined);
});

test("闭环：说明里的路径 → 淘汰占位里的路径（同一个路径）", () => {
  const path = "/tmp/work/demo/shot.png";
  const note = formatImageNote({ path, base64: pngHeader(1280, 800, 200_000) });
  const messages = [
    { role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: note }, { type: "image", data: pngHeader(1280, 800, 200_000), mimeType: "image/png" }], isError: false, timestamp: 0 },
    { role: "user", content: [{ type: "image", data: "A".repeat(1_000_000), mimeType: "image/png" }] },
    { role: "user", content: [{ type: "image", data: "A".repeat(1_000_000), mimeType: "image/png" }] },
  ];
  const result = boundImages(messages, { triggerBytes: 1_200_000, targetBytes: 500_000, keepRecent: 1 });
  assert.ok(result.droppedCount >= 1, "旧图必须被淘汰");
  const placeholder = result.messages[0].content[0].text;
  assert.match(placeholder, /图片已移除/, "说明文字被换成占位");
  assert.ok(placeholder.includes(path), `占位里必须带同一个路径：${placeholder}`);
});
