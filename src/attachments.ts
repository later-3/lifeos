// 图片附件外置（Task 0012 · P7 / D7）：图片按**内容 hash** 落盘，会话历史里只留一行引用。
//
// 为什么（02-design §8）：我们不拥有 Pi 的压缩入口（`compaction.ts:621-641` 走 pi-ai 层的
// `completeSimple`，我们两个钩子都在 coding-agent 的 agent 流上）→ 只能**让存储里没有大 base64**，
// 压缩读到的自然就小；顺带解决「用户图取不回」与「JSONL 越滚越大」。
//
// 参考：
// - opencode `packages/core/src/session/blob.ts`（按 hash 存 base64）+ `prompt.ts:95`（历史留 `media:` 引用）；
// - codex `codex-rs/attachment-store/src/lib.rs:32-46`：`upload / resolve / is_resolvable`，
//   且**默认保留引用，只有确认文件丢失才丢弃**——本模块的 `isResolvable` 采同样语义。
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { imageNoteSuffix, parseImageRefs } from "./image-note.ts";

/** 附件目录名（相对家目录）。 */
export const ATTACHMENTS_DIR = "attachments";

const MIME_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
  "image/gif": "gif", "image/bmp": "bmp", "image/avif": "avif",
};

function extensionOf(mimeType: string): string {
  return MIME_EXT[mimeType.toLowerCase()] ?? "bin";
}

/** 内容 hash（sha256 前 32 位 hex）：同一张图永远同一个文件名，写入天然幂等。 */
export function contentHashOf(base64: string): string {
  return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex").slice(0, 32);
}

/** 相对家目录的附件相对路径：`attachments/<hash前2位>/<hash>.<ext>`。 */
export function attachmentRelativePath(input: { base64: string; mimeType?: string }): string {
  const hash = contentHashOf(input.base64);
  const ext = extensionOf(input.mimeType ?? "image/png");
  return `${ATTACHMENTS_DIR}/${hash.slice(0, 2)}/${hash}.${ext}`;
}

/** 绝对路径。 */
export function attachmentPathOf(home: string, input: { base64: string; mimeType?: string }): string {
  return join(home, attachmentRelativePath(input));
}

/**
 * 落盘（幂等）。文件名由内容决定 → 重复写同一个图不会产生第二个文件；
 * 已存在直接返回同一路径（read 之后再存的场景）。
 */
export async function storeAttachment(
  home: string,
  input: { base64: string; mimeType?: string },
): Promise<{ path: string; created: boolean }> {
  const relative = attachmentRelativePath(input);
  const path = join(home, relative);
  if (await stat(path).then(() => true, () => false)) return { path, created: false };
  const buffer = Buffer.from(input.base64, "base64");
  await mkdir(join(home, ATTACHMENTS_DIR, relative.split("/")[1] ?? ""), { recursive: true, mode: 0o700 });
  // 先写临时文件再改名：半截文件不会被后来的读取看到
  const tmp = `${path}.tmp`;
  await writeFile(tmp, buffer, { mode: 0o600 });
  await rename(tmp, path);
  return { path, created: true };
}

/**
 * 引用是否有效（codex `is_resolvable` 语义）。
 * **只有"确认丢失"才返回 false**：文件不存在 = 丢失；读取失败（权限等）= 后端错误，引用保留。
 */
export async function isResolvable(absolutePath: string): Promise<boolean> {
  const info = await stat(absolutePath).catch(() => undefined);
  return info !== undefined && info.isFile();
}

/** 取回 base64（模型重看时用）。读不到返回 undefined，由调用方决定占位文案。 */
export async function readAttachment(absolutePath: string): Promise<string | undefined> {
  try {
    const buffer = await readFile(absolutePath);
    return buffer.toString("base64");
  } catch {
    return undefined;
  }
}

/** 引用行：显示回填与重注入都靠这一行识别（唯一格式，单一事实源）。 */
export function formatAttachmentRef(input: { path: string; note?: string }): string {
  return input.note === undefined ? `图片 ${input.path}` : `图片 ${input.path} ${input.note}`;
}

/**
 * 进程内缓存。附件由内容 hash 决定 → **写入后不可变**，同一路径永远同一字节 → 可以永久缓存。
 * （每次 LLM 调用都要读 K 张图，避免每轮磁盘 IO。）
 */
const attachmentCache = new Map<string, string>();

/** 带缓存的读取：命中直接返回；未命中读盘并入缓存（读不到返回 undefined 且不缓存）。 */
export async function readAttachmentCached(absolutePath: string): Promise<string | undefined> {
  const cached = attachmentCache.get(absolutePath);
  if (cached !== undefined) return cached;
  const data = await readAttachment(absolutePath);
  if (data !== undefined) attachmentCache.set(absolutePath, data);
  return data;
}

/** 仅测试/热重载用：清空缓存。 */
export function clearAttachmentCache(): void {
  attachmentCache.clear();
}

export type ReinjectResult = {
  messages: AgentMessage[];
  injected: number;
  /** 是否真的改了数组（调用方据此决定要不要交回新 messages） */
  changed: boolean;
  /** 引用了但文件已不存在的条目数（codex 语义：确认丢失才丢弃） */
  missing: number;
};

const MISSING_MARK = "（该图片文件已丢失：附件可能被清理，请重新发送或重新截图）";

/**
 * 重注入：把历史里的引用从磁盘换回 image 块，让模型当轮看得见（Task 0012 · P7 / D7）。
 *
 * 分两段（2026-10-29 补：只按"全局最近 K 张"会让**同一轮里 read 第 4 张图**在后续调用中不可见）：
 *   A. **最后一条用户消息之后**的引用 → **全部**重注入（这一段是"本轮正在发生的事"，必须全在场；
 *      字节仍由后面的预算兜底，不会因此越墙）；
 *   B. 更早的引用 → 从新到旧最多 `keepRecent` 个（相当于 hermes `_MAX_KEEP_IMAGES=3` 的最新性保护）。
 *
 * 其它约束：历史里本来就带 image 块的老会话原样返回（D8 不迁移）；文件丢失 → 在请求副本标记；
 * 不改会话文件，只返回新数组（R9：这里的 IO 是读附件，不是读会话）。
 */
export async function reinjectRecentImages(
  messages: AgentMessage[],
  keepRecent: number,
  /** 模型没有 image 输入能力时必须 false：注入了也会被 provider 拒（0010 的门控同款判据）。 */
  options?: { allowImages?: boolean },
): Promise<ReinjectResult> {
  if (keepRecent < 0 || options?.allowImages === false) return { messages, injected: 0, missing: 0, changed: false };
  let injected = 0;
  let missing = 0;
  let changed = false;

  const isUser = (message: AgentMessage): boolean => (message as { role?: string }).role === "user";
  // 本轮 = 最后一条用户消息之后（Pi 的 prompt 必定先落一条 user；找不到 → 没有"本轮"，
  // 退化成只按 K 注入，保守不放大）
  let anchor = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message !== undefined && isUser(message)) { anchor = i; break; }
  }

  const next: AgentMessage[] = new Array(messages.length);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message === undefined) continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) { next[i] = message; continue; }
    // 老格式（含 image 块）→ 原样返回（D8：不迁移、不重复内联）
    if (content.some((block) => (block as { type?: string }).type === "image")) { next[i] = message; continue; }
    const inCurrentTurn = i >= anchor;
    if (!inCurrentTurn && injected >= keepRecent) { next[i] = message; continue; }

    const rebuilt: unknown[] = [];
    let messageChanged = false;
    for (const block of content) {
      const part = block as { type?: string; text?: unknown };
      const refs = part.type === "text" && typeof part.text === "string" ? parseImageRefs(part.text) : [];
      if (refs.length === 0) { rebuilt.push(block); continue; }
      if (!inCurrentTurn && injected >= keepRecent) { rebuilt.push(block); continue; }
      let text = part.text as string;
      const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
      for (const ref of refs) {
        if (!inCurrentTurn && injected >= keepRecent) break;
        const data = await readAttachmentCached(ref);
        if (data === undefined) {                       // 确认丢失 → 请求副本里标记（每次结果一致 → 前缀稳定）
          missing += 1;
          if (!text.includes("已丢失")) text = `${text.replace(/\s*$/, "")}${MISSING_MARK}`;
          continue;
        }
        const ext = ref.toLowerCase();
        images.push({
          type: "image",
          data,
          mimeType: /\.jpe?g$/.test(ext) ? "image/jpeg" : /\.webp$/.test(ext) ? "image/webp" : "image/png",
        });
        injected += 1;
      }
      rebuilt.push(text === (part.text as string) ? block : { type: "text", text });
      for (const image of images) rebuilt.push(image);
      if (text !== (part.text as string) || images.length > 0) messageChanged = true;
    }
    if (messageChanged) { next[i] = { ...(message as Record<string, unknown>), content: rebuilt } as AgentMessage; changed = true; }
    else next[i] = message;
  }
  // 兜底：任何分支未赋值的槽位用原消息补上
  for (let i = 0; i < next.length; i += 1) {
    const original = messages[i];
    if (next[i] === undefined && original !== undefined) next[i] = original;
  }
  return { messages: changed ? next : messages, injected, missing, changed };
}

/**
 * 显示侧用的同步读（`messagesOf` 是同步的）：先查缓存，未命中再读盘。
 * 缓存命中后不再碰文件系统；附件不可变，因此缓存永不失效。
 */
export function readAttachmentCachedSync(absolutePath: string): string | undefined {
  const cached = attachmentCache.get(absolutePath);
  if (cached !== undefined) return cached;
  try {
    const data = readFileSync(absolutePath).toString("base64");
    attachmentCache.set(absolutePath, data);
    return data;
  } catch {
    return undefined;
  }
}

/** 把消息里的引用行还原成 image 块（给 `messagesOf` 的显示回填用）；命中不了就返回空。 */
export function imageBlocksOfRefs(message: unknown): Array<{ type: "image"; data: string; mimeType: string }> {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const hasInline = content.some((block) => (block as { type?: string }).type === "image");
  if (hasInline) return [];                       // 老会话：本来就有图块（D8）
  const out: Array<{ type: "image"; data: string; mimeType: string }> = [];
  for (const block of content) {
    const part = block as { type?: string; text?: unknown };
    if (part.type !== "text" || typeof part.text !== "string") continue;
    for (const ref of parseImageRefs(part.text)) {
      if (out.length >= 4) break;
      const data = readAttachmentCachedSync(ref);
      if (data === undefined) continue;           // 确认丢失 → 界面只显示引用行
      if (out.some((block) => block.data === data)) continue;
      const mimeType = /\.jpe?g$/i.test(ref) ? "image/jpeg" : /\.webp$/i.test(ref) ? "image/webp" : "image/png";
      out.push({ type: "image", data, mimeType });
    }
  }
  return out;
}

/** 附件文件大小（字节，二进制——入站 16MB 准入预算与 inline 图同口径）。内容不可变 → 永久缓存。 */
const attachmentSizeCache = new Map<string, number>();
export function attachmentFileSizeCached(absolutePath: string): number {
  const cached = attachmentSizeCache.get(absolutePath);
  if (cached !== undefined) return cached;
  try {
    const size = statSync(absolutePath).size;
    attachmentSizeCache.set(absolutePath, size);
    return size;
  } catch {
    return 0;              // 丢失 → 计 0（只影响准入宽紧，不影响安全性）
  }
}

/**
 * 用户图落盘并把引用行接进消息文本（Task 0012 · P7b / D7）。
 *
 * 返回新文本（原文 + 空行 + 每张图一行引用）；落盘失败的图**回退成 inline**（由调用方处理），
 * 保证"磁盘出问题时功能降级但不丢图"。
 */
export async function appendAttachmentRefs(
  home: string,
  text: string,
  images: readonly { data: string; mimeType: string }[],
): Promise<{
  text: string;
  lines: string[];
  stored: string[];
  /** 落盘失败回退 inline：保持 Pi 的 `ImageContent` 形状（带 `type: "image"`） */
  failed: Array<{ type: "image"; data: string; mimeType: string }>;
}> {
  const lines: string[] = [];
  const stored: string[] = [];
  const failed: Array<{ type: "image"; data: string; mimeType: string }> = [];
  for (const image of images) {
    const result = await storeAttachment(home, { base64: image.data, mimeType: image.mimeType }).catch(() => undefined);
    if (result === undefined) { failed.push({ type: "image", data: image.data, mimeType: image.mimeType }); continue; }
    stored.push(result.path);
    lines.push(formatAttachmentRef({ path: result.path, note: imageNoteSuffix(image.data) }));
  }
  if (lines.length === 0) return { text, lines, stored, failed };
  const base = text.replace(/\s+$/, "");
  return { text: `${base}\n\n${lines.join("\n")}`, lines, stored, failed };
}

// ================= 孤儿清理（Task 0012 · P8①） =================
//
// 附件按**内容 hash** 命名 → 同一张图可能被多个会话、多个消息共用，
// 所以"删会话就删附件"必然误删别的会话还在用的图。
// 采用 opencode blob 表的思路但不引入引用计数表（表要和写入同事务，复杂度不值）：
//   **扫所有会话的 JSONL 找引用 → 只删"无人引用"且"足够老"的文件**。
// 年龄门槛是关键：`runTurn` 落盘的图可能要等这条消息落盘后才出现在 JSONL 里，
// 不设年龄就会误删"正在用、只是还没写进文件"的图。

/** 会话文本里附件路径的形状（`attachments/<hh>/<hash>.<ext>`，绝对前缀可能因 HOME 不同而异）。 */
const ATTACHMENT_REF = /attachments\/[0-9a-f]{2}\/[0-9a-f]{32}\.[a-z0-9]+/g;

/** 默认：只清 7 天前的孤儿（留给消息落盘的时间绰绰有余）。 */
export const ORPHAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function listJsonlFiles(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });   // 失败向上抛 → 视为"扫描失败"
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listJsonlFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(path);
  }
  return out;
}

/** 扫全部会话 JSONL，收集被引用的附件相对路径。失败返回 undefined（调用方必须据此"什么都不删"）。 */
export async function collectReferencedAttachments(home: string): Promise<Set<string> | undefined> {
  try {
    const { stat } = await import("node:fs/promises");
    const agentsDir = join(home, "agents");
    // 根目录不存在 → 视为"扫描失败"而不是"零引用"：宁可不清理，也不能把全盘当孤儿删掉
    if (!(await stat(agentsDir).then((info) => info.isDirectory(), () => false))) return undefined;
    const files = await listJsonlFiles(agentsDir);
    const refs = new Set<string>();
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(ATTACHMENT_REF)) refs.add(match[0]);
    }
    return refs;
  } catch {
    return undefined;
  }
}

export type GcResult = { removed: number; kept: number; removedBytes: number; scannedRefs: number };

/**
 * 清理孤儿附件。安全三原则：
 * ① 扫描失败 → 什么都不删；② 被任何会话引用 → 保留；③ 太新的文件（默认 7 天内）→ 保留。
 */
export async function gcAttachments(
  home: string,
  options?: { maxAgeMs?: number; now?: number },
): Promise<GcResult> {
  const maxAgeMs = options?.maxAgeMs ?? ORPHAN_MAX_AGE_MS;
  const now = options?.now ?? Date.now();
  const refs = await collectReferencedAttachments(home);
  if (refs === undefined) return { removed: 0, kept: 0, removedBytes: 0, scannedRefs: 0 };

  const { readdir, unlink, stat } = await import("node:fs/promises");
  const root = join(home, ATTACHMENTS_DIR);
  const result: GcResult = { removed: 0, kept: 0, removedBytes: 0, scannedRefs: refs.size };
  let subdirs;                                      // 不标注类型：readdir 的重载会退到 Buffer 版本
  try {
    subdirs = await readdir(root, { withFileTypes: true });
  } catch {
    return result;                                  // 没有附件目录
  }
  for (const sub of subdirs) {
    if (!sub.isDirectory()) continue;
    const files = await readdir(join(root, sub.name), { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || file.name.endsWith(".tmp")) continue;
      const relative = `${ATTACHMENTS_DIR}/${sub.name}/${file.name}`;
      const path = join(root, sub.name, file.name);
      if (refs.has(relative)) { result.kept += 1; continue; }
      const info = await stat(path).catch(() => undefined);
      if (info === undefined) continue;
      if (now - info.mtimeMs < maxAgeMs) { result.kept += 1; continue; }   // 新的可能正等着落盘
      await unlink(path).catch(() => undefined);
      attachmentCache.delete(path);
      attachmentSizeCache.delete(path);
      result.removed += 1;
      result.removedBytes += info.size;
    }
  }
  return result;
}
