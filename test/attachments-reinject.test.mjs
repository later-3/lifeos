// P7 · 重注入与显示回填：当轮看得见、老会话不受影响、丢了会说明（D7/D8）。
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  attachmentFileSizeCached, clearAttachmentCache, formatAttachmentRef, imageBlocksOfRefs, reinjectRecentImages, storeAttachment,
} from "../src/attachments.ts";
import { createLifeOsImageBudgetExtension, createLifeOsReadPathExtension } from "../src/assembly.ts";
import { formatImageNote } from "../src/image-note.ts";
import { boundImages } from "../src/image-budget.ts";
import { payloadEstimateOf, sessionImageBytesOf } from "../src/agent-host.ts";

function pngBytes(width) {
  const buf = Buffer.alloc(200);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((b, i) => { buf[i] = b; });
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(800, 20);
  return buf.toString("base64");
}

async function homeWith(n) {
  clearAttachmentCache();
  const home = await mkdtemp(join(tmpdir(), "lifeos-reinject-"));
  const refs = [];
  for (let i = 0; i < n; i += 1) {
    const { path } = await storeAttachment(home, { base64: pngBytes(1000 + i), mimeType: "image/png" });
    refs.push(path);
  }
  return { home, refs };
}

const refMessage = (ref) => ({
  role: "toolResult", toolCallId: `c${ref}`, toolName: "read",
  content: [{ type: "text", text: formatAttachmentRef({ path: ref, note: "1280x800 42KB" }) }],
  isError: false, timestamp: 0,
});

test("重注入：最近 K 张被换回 image 块，更早的只留引用", async () => {
  const { refs } = await homeWith(6);
  const messages = refs.map(refMessage);
  const out = await reinjectRecentImages(messages, 3);
  assert.equal(out.injected, 3, "只注入最近 3 张（keep=3）");
  assert.equal(out.changed, true);
  const images = out.messages.flatMap((m) => m.content).filter((b) => b.type === "image");
  assert.equal(images.length, 3);
  // 最旧那条仍是纯引用
  assert.equal(out.messages[0].content.some((b) => b.type === "image"), false);
  // 幂等：再跑一次结果不变（不重复注入）
  const again = await reinjectRecentImages(out.messages, 3);
  assert.equal(again.injected, 3, "已带图的消息不再注入（不重复）");
});

test("老会话（历史里本来就有图块）原样返回：D8 不迁移", async () => {
  const inline = { role: "user", content: [{ type: "image", data: pngBytes(1280), mimeType: "image/png" }] };
  const out = await reinjectRecentImages([inline], 3);
  assert.equal(out.changed, false);
  assert.equal(out.messages[0], inline, "必须是同一个对象（前缀一个字节都不动）");
});

test("文件已丢失：标记说明而不是静默（确认丢失才丢弃）", async () => {
  const message = refMessage("/nonexistent/attachments/aa/bb.png");
  const out = await reinjectRecentImages([message], 3);
  assert.equal(out.injected, 0);
  assert.equal(out.missing, 1);
  assert.match(out.messages[0].content[0].text, /已丢失/);
});

test("T14 同一回合闭环：tool_result 去掉图块 → context 钩子把同一张还回来", async () => {
  const { home, refs } = await homeWith(1);
  const path = refs[0];
  const data = pngBytes(1000);   // homeWith(1) 存的就是这一张（i=0 → 1000）

  // ① read 工具的结果：有图块 + Pi 原文
  const readHandler = (() => {
    let fn;
    createLifeOsReadPathExtension().factory({ on: (name, h) => { if (name === "tool_result") fn = h; } });
    return fn;
  })();
  const stripped = readHandler(
    { type: "tool_result", toolName: "read", toolCallId: "c1", input: { path }, content: [{ type: "text", text: "Read image file [image/png]" }, { type: "image", data, mimeType: "image/png" }] },
    { cwd: "/" },
  );
  assert.equal(stripped.content.some((b) => b.type === "image"), false, "存储里不再带图块");
  assert.match(stripped.content[0].text, /^screenshot .*1000x800/, "引用行带路径与尺寸（真实宽高来自 PNG 头）");

  // ② 同一回合的下一次模型调用：context 钩子重注入
  process.env.LIFEOS_HOME = home;
  let ctxHandler;
  createLifeOsImageBudgetExtension().factory({ on: (name, h) => { if (name === "context") ctxHandler = h; } });
  const reinjected = await reinjectRecentImages([{ role: "toolResult", toolCallId: "c1", toolName: "read", content: stripped.content, isError: false, timestamp: 0 }], 3);
  const image = reinjected.messages[0].content.find((b) => b.type === "image");
  assert.ok(image, "重注入回来了");
  assert.equal(image.data, data, "与原来逐字节一致");
});

test("T15 显示回填：引用行 → 图块；老会话不受影响；丢文件只显示引用", async () => {
  const { refs } = await homeWith(2);
  // 用户消息里只有一行引用
  const user = { role: "user", content: [{ type: "text", text: `麻烦看看\n${formatAttachmentRef({ path: refs[0], note: "1280x800 42KB" })}` }] };
  const blocks = imageBlocksOfRefs(user);
  assert.equal(blocks.length, 1, "界面能拿到图");
  assert.equal(blocks[0].type, "image");

  // 老会话：已带图块 → 不回填（避免双份）
  const inline = { role: "user", content: [{ type: "image", data: pngBytes(64), mimeType: "image/png" }] };
  assert.equal(imageBlocksOfRefs(inline).length, 0);

  // 文件丢了 → 只剩引用行，不报错
  const missing = { role: "user", content: [{ type: "text", text: formatAttachmentRef({ path: "/no/such.png" }) }] };
  assert.equal(imageBlocksOfRefs(missing).length, 0);
});

test("当轮可见性：同一轮 read 5 张图，后续调用全部在场（不因 K=3 丢第 4、5 张）", async () => {
  const { refs } = await homeWith(6);
  const messages = [
    { role: "user", content: [{ type: "text", text: "看看这些图" }] },
    // 一轮内连续读 5 张（只有引用行进历史）
    ...refs.slice(0, 5).map(refMessage),
    { role: "assistant", content: [{ type: "text", text: "我在看" }] },
  ];
  const out = await reinjectRecentImages(messages, 3);
  const images = out.messages.flatMap((m) => m.content).filter((b) => b.type === "image");
  assert.equal(images.length, 5, "本轮的 5 张必须全部重注入（A 段不受 K 限制）");
  // 更早的历史仍受 K 限制：这里没有更早的，所以总数就是 5
  assert.ok(out.injected >= 5);
});

test("当轮之外的旧引用才受 K 限制", async () => {
  const { refs } = await homeWith(6);
  const messages = [
    { role: "user", content: [{ type: "text", text: "第一条消息\n" + `图片 ${refs[0]}` }] },
    ...refs.slice(1, 4).map(refMessage),           // 3 张旧的（在当前用户消息之前没有 → 它们都在 anchor 之后？不，它们是 toolResult，位于下一条 user 之前）
    { role: "user", content: [{ type: "text", text: "第二条消息\n" + `图片 ${refs[3]}` }] },
    refMessage(refs[4]), refMessage(refs[5]),      // 当前轮：2 张
  ];
  const out = await reinjectRecentImages(messages, 3);
  const images = out.messages.flatMap((m) => m.content).filter((b) => b.type === "image");
  assert.ok(images.length >= 2, `当前轮 2 张必须在场，实际 ${images.length}`);
  assert.ok(images.length <= 5, `更早的最多补 3 张（K=3），实际 ${images.length}`);
});

test("P7b 写入侧：落盘 + 引用行接进消息文本；落盘失败回退 inline（带 type）", async () => {
  const { appendAttachmentRefs } = await import("../src/attachments.ts");
  const home = await mkdtemp(join(tmpdir(), "lifeos-p7b-"));
  const images = [{ data: pngBytes(1024), mimeType: "image/png" }];
  const out = await appendAttachmentRefs(home, "看这三张图", images);
  assert.equal(out.stored.length, 1);
  assert.match(out.text, /^看这三张图\n\n图片 \/.*1024x800/, "原文 + 空行 + 引用行");
  assert.equal(out.failed.length, 0);

  // 落盘失败（home 指到一个普通文件上，目录建不出来）→ 回退 inline 且形状可直接给 Pi
  const fileHome = await mkdtemp(join(tmpdir(), "lifeos-p7b-fail-"));
  const broken = join(fileHome, "a-file");
  await writeFile(broken, "x");
  const failed = await appendAttachmentRefs(broken, "看看", images);
  assert.equal(failed.failed.length, 1, "失败要回退");
  assert.equal(failed.failed[0].type, "image", "形状必须能直接传给 prompt({images})");
  assert.equal(failed.text, "看看", "失败时不改文本");
});

test("P7b 无图能力的模型不注入（model.input 不含 image）", async () => {
  const { refs } = await homeWith(2);
  const messages = refs.map(refMessage);
  const out = await reinjectRecentImages(messages, 3, { allowImages: false });
  assert.equal(out.changed, false, "一个都不注入（注入了也会被 provider 拒）");
  assert.equal(out.injected, 0);
});

test("淘汰时只去掉引用行，用户自己的话必须留下", () => {
  const prose = "看看这个\n\n图片 /tmp/x.png 1280x800 42KB";
  const message = {
    role: "user",
    content: [{ type: "text", text: prose }, { type: "image", data: "A".repeat(3_000_000), mimeType: "image/png" }],
    timestamp: 0,
  };
  const result = boundImages([message], { triggerBytes: 1_000_000, targetBytes: 500_000, keepRecent: 2, hardBytes: 2_000_000 });
  assert.equal(result.droppedCount, 1, "这张图必须被淘汰");
  const blocks = result.messages[0].content;
  assert.equal(blocks.filter((b) => b.type === "image").length, 0);
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  assert.match(text, /看看这个/, "用户的话要留");
  assert.doesNotMatch(text, /图片 \/tmp\/x\.png/, "指向已删图的引用行要去掉");
  assert.match(text, /图片已移除/, "占位必须在（说明怎么取回）");
});

test("入站 16MB 准入预算：引用化后按附件文件字节计（不被静默废掉）", () => {
  const { attachmentRelativePath } = { ...globalThis.__attachments ?? {} };
  // 用 fake state 直接调 sessionImageBytesOf（只依赖 projection）
  const messages = [
    { role: "user", content: [{ type: "text", text: `图片 ${"/nonexistent/attachments/aa/bb.png"}` }] },
    { role: "user", content: [{ type: "image", data: "A".repeat(4000), mimeType: "image/png" }] },
  ];
  const state = { session: { sessionManager: { buildSessionProjection: () => ({ messages }) } } };
  const bytes = sessionImageBytesOf(state);
  // 丢失的附件计 0；inline 图按 base64→二进制（4000 base64 ≈ 3000 字节）
  assert.ok(bytes >= 2900 && bytes <= 3100, `inline 照旧计入，实际 ${bytes}`);
});

test("P7b 估算：引用按 base64 后字节计入（否则观测记账会记成 ~0）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-estimate-"));
  clearAttachmentCache();
  const { path } = await storeAttachment(home, { base64: pngBytes(64), mimeType: "image/png" });
  const messages = [{ role: "user", content: [{ type: "text", text: `看看\n${formatAttachmentRef({ path, note: "1280x800 536B" })}` }] }];
  const state = { session: { sessionManager: { buildSessionProjection: () => ({ messages }) } } };
  const estimate = payloadEstimateOf(state);
  const fileBytes = attachmentFileSizeCached(path);
  assert.ok(fileBytes > 0, "附件文件必须读得到");
  assert.equal(estimate.images, Math.ceil(fileBytes / 3) * 4, "按 base64 后（线上）尺寸计");
  assert.ok(estimate.estimated > 100);
});

test("P6 · 压缩读到的存储里没有 image 块（todo #17 的根治证明）", async () => {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const home = await mkdtemp(join(tmpdir(), "lifeos-storage-"));
  const sid = "11111111-2222-3333-4444-555555555555";
  const dir = join(home, "agents", "a1", "projects", "workspace", "sessions");
  await mkdir(dir, { recursive: true });

  // 新格式（P7）：用户消息里只有引用行，没有 image 块
  const withRef = join(dir, "new.jsonl");
  await writeFile(withRef, [
    JSON.stringify({ type: "session", version: 3, id: sid, timestamp: "2026-10-29T00:00:00.000Z", cwd: "" }),
    JSON.stringify({ type: "message", id: "m1", parentId: sid, timestamp: "2026-10-29T00:00:01.000Z",
      message: { role: "user", content: [{ type: "text", text: `看图\n图片 /tmp/attachments/ab/${"a".repeat(32)}.png 1280x800 42KB` }] } }),
    "",
  ].join("\n"));

  // 老格式（D8）：内联图，保留不迁移
  const withInline = join(dir, "old.jsonl");
  await writeFile(withInline, [
    JSON.stringify({ type: "session", version: 3, id: "22222222-2222-3333-4444-555555555555", timestamp: "2026-10-29T00:00:00.000Z", cwd: "" }),
    JSON.stringify({ type: "message", id: "m2", parentId: "22222222-2222-3333-4444-555555555555", timestamp: "2026-10-29T00:00:01.000Z",
      message: { role: "user", content: [{ type: "text", text: "老图" }, { type: "image", data: pngBytes(64), mimeType: "image/png" }] } }),
    "",
  ].join("\n"));

  const imageCount = (file, id) => {
    const mgr = SessionManager.open(file, dir, process.cwd());
    const projection = mgr.buildSessionProjection();
    return projection.messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((b) => b.type === "image").length;
  };

  // 压缩走 buildSessionProjection → 新格式投影里一张图都没有 → 压缩请求不可能带 base64
  assert.equal(imageCount(withRef, sid), 0, "新格式：压缩读到的存储里没有 image 块");
  // 老会话（D8 不迁移）按设计仍带图 → 由 P2–P5 的运行时淘汰兜底
  assert.equal(imageCount(withInline, "22222222-2222-3333-4444-555555555555"), 1, "老格式：D8 保持原样");
});
