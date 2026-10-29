// 附件外置（Task 0012 · P7）：hash 幂等、可解析性语义、读回一致、引用行唯一格式。
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  attachmentPathOf, attachmentRelativePath, contentHashOf, formatAttachmentRef,
  isResolvable, readAttachment, storeAttachment,
} from "../src/attachments.ts";

const PNG_HEADER = (() => {
  const buf = Buffer.alloc(24);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((b, i) => { buf[i] = b; });
  buf.writeUInt32BE(1280, 16);
  buf.writeUInt32BE(800, 20);
  return buf.toString("base64");
})();

test("内容 hash 决定路径：同一张图永远同一个文件（写入幂等）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-attach-"));
  const a = await storeAttachment(home, { base64: PNG_HEADER, mimeType: "image/png" });
  const b = await storeAttachment(home, { base64: PNG_HEADER, mimeType: "image/png" });
  assert.equal(a.created, true);
  assert.equal(b.created, false, "第二次必须复用，不产生第二份");
  assert.equal(a.path, b.path);
  assert.match(attachmentRelativePath({ base64: PNG_HEADER }), /^attachments\/[0-9a-f]{2}\/[0-9a-f]{32}\.png$/);
  assert.equal(contentHashOf(PNG_HEADER), contentHashOf(PNG_HEADER), "hash 确定");
  const other = (() => { const b = Buffer.from(PNG_HEADER, "base64"); b.writeUInt32BE(640, 16); return b.toString("base64"); })();
  assert.notEqual(contentHashOf(PNG_HEADER), contentHashOf(other), "内容变则 hash 变");
});

test("读回与写入逐字节一致；目录/文件权限收紧", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-attach-"));
  const { path } = await storeAttachment(home, { base64: PNG_HEADER, mimeType: "image/png" });
  assert.equal(await readAttachment(path), PNG_HEADER);
  const dir = await stat(join(home, "attachments"));
  assert.equal(dir.mode & 0o777, 0o700, "附件目录 0700");
  const file = await stat(path);
  assert.equal(file.mode & 0o777, 0o600, "附件文件 0600");
});

test("isResolvable：只有确认丢失才 false（codex 语义）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-attach-"));
  const { path } = await storeAttachment(home, { base64: PNG_HEADER });
  assert.equal(await isResolvable(path), true);
  assert.equal(await isResolvable(join(home, "attachments", "zz", "never-existed.png")), false);
  assert.equal(await isResolvable(join(home, "attachments", "no-such-dir")), false);
  // 目录当文件：存在但不是文件 → 视为不可用
  assert.equal(await isResolvable(join(home, "attachments")), false);
});

test("引用行只有一种格式（显示回填与重注入共用）", () => {
  assert.equal(formatAttachmentRef({ path: "/tmp/a.png" }), "图片 /tmp/a.png");
  assert.equal(formatAttachmentRef({ path: "/tmp/a.png", note: "1280x800 42KB" }), "图片 /tmp/a.png 1280x800 42KB");
});

test("孤儿清理：被引用的留、新的留、7 天前的无人引用才删", async () => {
  const { gcAttachments, ORPHAN_MAX_AGE_MS } = await import("../src/attachments.ts");
  const { mkdir, writeFile, utimes, readFile } = await import("node:fs/promises");
  const home = await mkdtemp(join(tmpdir(), "lifeos-gc-"));

  // ① 有会话引用的
  const referenced = await storeAttachment(home, { base64: PNG_HEADER, mimeType: "image/png" });
  const dir = join(home, "agents", "a1", "projects", "workspace", "sessions");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "s.jsonl"), JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: `看图\n${formatAttachmentRef({ path: referenced.path, note: "1280x800 536B" })}` }] } }) + "\n");

  // ② 新的孤儿（刚上传、还没落进会话文件）
  const freshOrphan = await storeAttachment(home, { base64: pngBytesFresh(), mimeType: "image/png" });

  // ③ 老的孤儿（30 天前）
  const oldOrphan = await storeAttachment(home, { base64: pngBytesOld(), mimeType: "image/png" });
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await utimes(oldOrphan.path, thirtyDaysAgo, thirtyDaysAgo);

  const result = await gcAttachments(home);
  assert.equal(result.removed, 1, "只删老孤儿");
  assert.equal(result.kept, 2, "被引用的 + 新孤儿都留下");
  assert.equal(await isResolvable(referenced.path), true, "被引用的必须在");
  assert.equal(await isResolvable(freshOrphan.path), true, "刚上传的不能删（年龄门槛）");
  assert.equal(await isResolvable(oldOrphan.path), false, "老孤儿删掉了");

  // 复制一份"20 天前"的 → 仍应保留（门槛是 7 天）
  const mid = await storeAttachment(home, { base64: pngBytesMid(), mimeType: "image/png" });
  const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
  await utimes(mid.path, twentyDaysAgo, twentyDaysAgo);
  const second = await gcAttachments(home);
  assert.equal(second.removed, 1, "20 天前的孤儿也在 7 天门槛之外 → 应被删");
  assert.equal(await isResolvable(mid.path), false);
  void ORPHAN_MAX_AGE_MS;
});

test("孤儿清理：扫不到会话目录 → 什么都不删（安全兜底）", async () => {
  const { gcAttachments } = await import("../src/attachments.ts");
  const { utimes } = await import("node:fs/promises");
  const home = await mkdtemp(join(tmpdir(), "lifeos-gc-safe-"));
  const orphan = await storeAttachment(home, { base64: pngHeaderSafe(), mimeType: "image/png" });
  const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  await utimes(orphan.path, longAgo, longAgo);
  // 没有 agents/ 目录（或读失败）→ 结果全是 0，文件不动
  const result = await gcAttachments(home);
  assert.equal(result.removed, 0, "扫不到就不删");
  assert.equal(await isResolvable(orphan.path), true);
});

/** 三张内容互不相同的图（hash 不同 → 三个文件）。 */
function pngBytesFresh() { const b = Buffer.from(PNG_HEADER, "base64"); b.writeUInt32BE(640, 16); return b.toString("base64"); }
function pngBytesOld() { const b = Buffer.from(PNG_HEADER, "base64"); b.writeUInt32BE(800, 16); return b.toString("base64"); }
function pngBytesMid() { const b = Buffer.from(PNG_HEADER, "base64"); b.writeUInt32BE(1024, 16); return b.toString("base64"); }
function pngHeaderSafe() { return PNG_HEADER; }
