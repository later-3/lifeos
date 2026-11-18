/**
 * 图片附件的纯函数：约束镜像、草稿状态、压缩判定。
 *
 * 约束值与后端 src/image-input.ts 一致，来源见 docs/design/image-input.md 的约束表。
 * 客户端压缩的参数照抄 pi-web upstream/main e533d9b 的 `components/ChatInput.tsx:427-429`：
 * 超过 1MB 才压、最长边 1024、JPEG 质量 0.85、GIF 不压、压缩结果不更小就用原图（`:433,475`）。
 *
 * 这里只放"算"的部分（判定、状态迁移、格式化），DOM 与 canvas 留在调用方，便于单测。
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 10;
export const CLIENT_COMPRESS_THRESHOLD_BYTES = 1024 * 1024;
export const CLIENT_MAX_IMAGE_SIDE = 1024;
export const CLIENT_JPEG_QUALITY = 0.85;

export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif"] as const;

export interface PendingImage {
  /** 唯一键：同一张图可以重复添加，用序号区分，不靠内容去重 */
  id: string;
  data: string;
  mimeType: string;
  /** 原始字节数（压缩前），用于界面显示 */
  sourceBytes: number;
}

export type AddImageResult =
  | { ok: true; images: PendingImage[] }
  | { ok: false; reason: "too_many" | "too_large" | "unsupported_type" | "read_failed"; message: string };

export function isImageMimeType(value: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/** 超过阈值才压缩；GIF 跳过（压成 JPEG 会丢动画）。 */
export function shouldCompressImage(size: number, mimeType: string): boolean {
  return size > CLIENT_COMPRESS_THRESHOLD_BYTES && mimeType !== "image/gif";
}

/** 按最长边等比缩放到 CLIENT_MAX_IMAGE_SIDE（不放大）。 */
export function scaledSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= CLIENT_MAX_IMAGE_SIDE || longest === 0) return { width, height };
  const scale = CLIENT_MAX_IMAGE_SIDE / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 加入一张图片：先查类型与单张大小，再查张数。
 * 顺序有意义——类型不对时不该报"太多张"。
 */
export function addImage(
  current: readonly PendingImage[],
  next: { id: string; data: string; mimeType: string },
): AddImageResult {
  if (!isImageMimeType(next.mimeType)) {
    return { ok: false, reason: "unsupported_type", message: `不支持的图片格式：${next.mimeType || "未知"}` };
  }
  const bytes = base64ByteLength(next.data);
  if (bytes === 0) return { ok: false, reason: "read_failed", message: "图片内容为空" };
  if (bytes > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "too_large", message: `单张图片最大 ${MAX_IMAGE_BYTES / (1024 * 1024)}MB` };
  }
  if (current.length >= MAX_IMAGES_PER_MESSAGE) {
    return { ok: false, reason: "too_many", message: `一条消息最多 ${MAX_IMAGES_PER_MESSAGE} 张图片` };
  }
  return { ok: true, images: [...current, { ...next, sourceBytes: bytes }] };
}

export function removeImage(current: readonly PendingImage[], id: string): PendingImage[] {
  return current.filter((image) => image.id !== id);
}

/** sourceBytes 可能缺失（例如从草稿恢复的图片），缺失时按 base64 现算，避免出现 NaN。 */
export function totalImageBytes(images: readonly PendingImage[]): number {
  return images.reduce((sum, image) => sum + (image.sourceBytes || base64ByteLength(image.data)), 0);
}

/** 发给后端的形状：只保留 data 与 mimeType，不传界面用的 id/sourceBytes。 */
export function toRequestImages(images: readonly PendingImage[]): Array<{ type: "image"; data: string; mimeType: string }> {
  return images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }));
}

/** 附件托盘摘要（无障碍与提示文案共用一份来源）。 */
export function attachmentSummary(images: readonly PendingImage[]): string {
  if (images.length === 0) return "";
  return `${images.length} 张图片 · ${formatBytes(totalImageBytes(images))}`;
}
