// 工具读图时的说明文字（Task 0012 · P4）：把 Pi 的 `Read image file [image/png]` 换成**带路径**的一行。
//
// 为什么必须带路径（D3 已拍板 = 方案 A）：
// - 历史图片被淘汰后，占位里只有路径能让模型"指得回去"（`read` 同一路径拿回同一张图）；
// - 参考 codex `codex-rs/protocol/src/models.rs:1830-1843`：`<image name="[Image #1]" path="…">`。
//
// 我们**不改 Pi 子模块**：Pi 的 `tool_result` 扩展事件允许替换 `content`
// （`pi/packages/coding-agent/src/core/extensions/types.ts:1267-1300,1483-1489`），在这里改写即可。
//
// 纯函数、无 IO：尺寸解析只读内存里的字节，不碰文件系统。

/** 头部能认出的图片格式（与 `src/image-input.ts` 的白名单同一组，去掉 avif/bmp 的尺寸解析）。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function decodeBase64(value: string): Uint8Array | undefined {
  try {
    return Uint8Array.from(Buffer.from(value, "base64"));
  } catch {
    return undefined;
  }
}

/** PNG 的宽高在第 16..24 字节（IHDR 的 width/height，大端）。其它格式返回 undefined。 */
export function pngSizeOf(bytes: Uint8Array | undefined): { width: number; height: number } | undefined {
  if (bytes === undefined || bytes.length < 24) return undefined;
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/** 图片在请求体里的字节数 = base64 字符串长度（不是解码后的字节，见 02-design §7）。 */
export function encodedBytesOf(base64: string): number {
  return base64.length;
}

function humanBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)}KB`;
  return `${bytes}B`;
}

/**
 * 一行说明：`screenshot <绝对路径> [<w>x<h>] <大小>`
 *
 * 例：`screenshot /tmp/demo/shot-3.png 1280x800 42KB`
 * 尺寸只在能从文件头认出时写（PNG 目前）；认不出就只写路径与大小——**路径才是关键信息**。
 */
export function formatImageNote(input: { path: string; base64: string; mimeType?: string | undefined }): string {
  const bytes = encodedBytesOf(input.base64);
  const size = pngSizeOf(decodeBase64(input.base64));
  const dimension = size === undefined ? "" : ` ${size.width}x${size.height}`;
  return `screenshot ${input.path}${dimension} ${humanBytes(bytes)}`;
}

/** 判断一行文本是不是本模块产出的（用于避免重复改写）。 */
export function isImageNoteText(text: string): boolean {
  return text.startsWith("screenshot ") || text.startsWith("Read image file");
}

/**
 * 文本里**所有**引用行的路径（按行扫描）。
 *
 * 为什么要按行：用户消息里「说话 + 多张图的引用」通常在**同一个文本块**里，
 * 只认"整块以引用开头"会全部漏掉（P7 实测过这个坑）。两种历史格式都认：
 *   `图片 /abs/x.png 1280x800 42KB`（P7 新）与 `screenshot /abs/x.png …`（P4）。
 */
export function parseImageRefs(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("图片 ") && !trimmed.startsWith("screenshot ")) continue;
    const rest = trimmed.slice(trimmed.indexOf(" ") + 1).trim();
    if (rest === "") continue;
    const path = rest.split(/\s+/)[0];
    if (path !== undefined && path !== "" && !out.includes(path)) out.push(path);
  }
  return out;
}

/** 尺寸（能从 PNG 头认出时）+ 大小：给引用行用的后缀，如 `1280x800 42KB`。 */
export function imageNoteSuffix(base64: string): string {
  const bytes = encodedBytesOf(base64);
  const size = pngSizeOf(decodeBase64(base64));
  return size === undefined ? humanBytes(bytes) : `${size.width}x${size.height} ${humanBytes(bytes)}`;
}

/** 从多行文本里去掉引用行（保留用户自己的话）——图被淘汰时用，避免留下"指向已删图"的行。 */
export function stripRefLines(text: string): string {
  const kept = text.split("\n").filter((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith("图片 ") && !trimmed.startsWith("screenshot ");
  });
  return kept.join("\n").replace(/\n+$/, "");
}

/** 首个引用路径（单值场景的便捷入口）。 */
export function parseImageRef(text: string): string | undefined {
  return parseImageRefs(text)[0];
}
