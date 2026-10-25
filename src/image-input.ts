/**
 * 图片输入的约束与校验（纯函数，无 IO）。
 *
 * 所有数字的来源见 docs/design/image-input.md 的"约束表"；该表由 test/image-input-doc.test.mjs
 * 与这里的导出常量逐项比对，改数字不改文档会直接让测试失败。
 *
 * 依据级别（协议 3.3）：
 * - A 源码：pi-web upstream/main e533d9b 的同名实现
 * - B 官方：Anthropic Vision 页
 * - C 实测：本机网关与文件尺寸测量（见任务 0010 的 evidence）
 */

/** 单张原图上限（A：pi-web `lib/image-attachments.ts:1` MAX_ATTACHED_IMAGE_BYTES；用户 2026-10-25 拍板） */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 单条消息张数上限（A：pi-web `lib/image-attachments.ts:2` MAX_ATTACHED_IMAGES；LibreChat 示例 fileLimit: 10） */
export const MAX_IMAGES_PER_MESSAGE = 10;

/**
 * 一个会话里图片总字节的预算（C：网关实测 32MB 通过、64MB 断开，预算取一半留文本与工具输出余量）。
 * 不是张数上限：参考产品都不按张数限制会话（见 evidence G）。
 */
export const MAX_SESSION_IMAGE_BYTES = 16 * 1024 * 1024;

/** 允许的图片类型（A：pi-web `lib/tool-result-images.ts:3-9` 同一组 mime） */
export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/** Pi prompt 的图片内容块（与 `ImageContent` 同形） */
export interface ImageAttachment {
  type: "image";
  data: string;
  mimeType: ImageMimeType;
}

export type ImageRejection =
  | { code: "invalid_request"; message: string }
  | { code: "too_many_images"; message: string }
  | { code: "image_too_large"; message: string }
  | { code: "unsupported_image_type"; message: string }
  | { code: "invalid_image"; message: string }
  | { code: "session_image_budget_exceeded"; message: string };

export type ImageValidation =
  | { ok: true; images: ImageAttachment[] }
  | ({ ok: false } & ImageRejection);

function startsWith(bytes: Uint8Array, offset: number, pattern: readonly number[]): boolean {
  if (bytes.length < offset + pattern.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    if (bytes[offset + i] !== pattern[i]) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

/**
 * 按文件头判断真实类型：不信任客户端声明的 mimeType。
 * 内容与声明不一致时拒绝，避免把非图片（或伪装成图片的脚本）送进模型。
 */
export function sniffImageMime(bytes: Uint8Array): ImageMimeType | undefined {
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 4) === "GIF8") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (startsWith(bytes, 0, [0x42, 0x4d])) return "image/bmp";
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return undefined;
}

/** base64 解码，长度先做上界检查（避免为超限输入分配内存）。 */
export function decodeBase64Image(data: string): Uint8Array | undefined {
  if (data === "" || data.length % 4 !== 0) return undefined;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return undefined;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const estimated = (data.length / 4) * 3 - padding;
  if (estimated > MAX_IMAGE_BYTES) return undefined;
  const decoded = Buffer.from(data, "base64");
  return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
}

/** base64 字符串对应的字节数（不分配）。 */
export function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/**
 * 校验一组图片附件。
 * @param value 请求体里的 images 字段（未知类型，需校验）
 * @param sessionImageBytes 该会话历史里已有的图片总字节（用于预算）
 */
export function validateImages(value: unknown, sessionImageBytes = 0): ImageValidation {
  if (value === undefined || value === null) return { ok: true, images: [] };
  if (!Array.isArray(value)) {
    return { ok: false, code: "invalid_request", message: "images 必须是数组" };
  }
  if (value.length === 0) return { ok: true, images: [] };
  if (value.length > MAX_IMAGES_PER_MESSAGE) {
    return {
      ok: false,
      code: "too_many_images",
      message: `一条消息最多 ${MAX_IMAGES_PER_MESSAGE} 张图片`,
    };
  }
  const images: ImageAttachment[] = [];
  let added = 0;
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, code: "invalid_request", message: "images 的每一项必须是 { data, mimeType }" };
    }
    const record = item as { data?: unknown; mimeType?: unknown };
    if (typeof record.data !== "string" || typeof record.mimeType !== "string") {
      return { ok: false, code: "invalid_request", message: "images 的每一项必须包含 data 与 mimeType 字符串" };
    }
    const declared = record.mimeType as ImageMimeType;
    if (!(IMAGE_MIME_TYPES as readonly string[]).includes(declared)) {
      return {
        ok: false,
        code: "unsupported_image_type",
        message: `不支持的图片类型：${declared}（支持 ${IMAGE_MIME_TYPES.join("、")}）`,
      };
    }
    const bytes: Uint8Array | undefined = decodeBase64Image(record.data);
    if (bytes === undefined || bytes.byteLength === 0) {
      // 可能是非 base64，也可能超过单张上限：分开给原因，界面才能说清楚
      const declaredBytes = base64ByteLength(record.data);
      if (declaredBytes > MAX_IMAGE_BYTES) {
        return {
          ok: false,
          code: "image_too_large",
          message: `单张图片最大 ${MAX_IMAGE_BYTES / (1024 * 1024)}MB`,
        };
      }
      return { ok: false, code: "invalid_image", message: "图片数据不是合法的 base64" };
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        code: "image_too_large",
        message: `单张图片最大 ${MAX_IMAGE_BYTES / (1024 * 1024)}MB`,
      };
    }
    const sniffed = sniffImageMime(bytes);
    if (sniffed === undefined) {
      return { ok: false, code: "invalid_image", message: "无法识别的图片格式（按文件头判断）" };
    }
    if (sniffed !== declared) {
      return {
        ok: false,
        code: "invalid_image",
        message: `图片实际格式是 ${sniffed}，与声明的 ${declared} 不一致`,
      };
    }
    added += bytes.byteLength;
    images.push({ type: "image", data: record.data, mimeType: sniffed });
  }
  if (sessionImageBytes + added > MAX_SESSION_IMAGE_BYTES) {
    return {
      ok: false,
      code: "session_image_budget_exceeded",
      message: `本会话图片总大小已达上限 ${MAX_SESSION_IMAGE_BYTES / (1024 * 1024)}MB，请新建会话继续发图`,
    };
  }
  return { ok: true, images };
}

/** 模型是否声明支持图片输入：读 models.json 的 `input` 数组。未声明时返回 undefined（不拦）。 */
export function declaredImageSupport(input: unknown): boolean | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.includes("image");
}
