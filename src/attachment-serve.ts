// 会话图片的**只读取回**（Task 0016 · P3-S1）。
//
// 目的：让前端能用 `<img src="/api/attachment?path=…">` 按需取图，而不是让
// `GET /sessions/:sid` 把每张图 base64 内联（实测单会话 33.58 MB 图片 → 上行 4.1 s）。
//
// ## 为什么不能"有路径就读"
//
// 引用行来自会话文件，而会话文件里可以有**任意绝对路径**（`read` 工具读 `/tmp/x.png`、
// 用户项目里的图、甚至 `/etc/...` 若曾被读过）。端点对外暴露，必须自己做边界：
//
//   · 只允许图片扩展名（`mimeTypeOfImagePath`）——非图片一律 400，不做"猜"；
//   · resolve 后必须落在**已注册的根**内（复用 `src/fs.ts` 的 `readRoots()`，与文件浏览器同一套边界）；
//   · 必须是常规文件、且不超过 `MAX_SERVE_BYTES`（与工具图同一上限 `MAX_TOOL_IMAGE_BYTES`）。
//
// 这三道与 `specs/code/api/api.md` 2.5（按已注册根与目录边界过滤、越权 403）一致。
//
// ## 为什么不复用 `/api/fs/content`
//
// 那个端点返回 **JSON**（文本内容，`content: string`），图片会被当二进制/截断处理；
// 而且它没有 `Cache-Control`。图片是**不可变字节**（内容决定路径），应当直接 `c.body()`
// + 长缓存。两者语义不同，硬合会两边都不对。
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { readFile } from "node:fs/promises";
import { readRoots } from "./fs.ts";
import { MAX_TOOL_IMAGE_BYTES } from "./stream-events.ts";

/** 图片扩展名 → MIME。不在表里的一律不当作图片（不做内容嗅探：那会给任意文件开一条读通道）。 */
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

/** 路径的图片 MIME；不是图片返回 undefined（纯函数，可离线穷举）。 */
export function mimeTypeOfImagePath(path: string): string | undefined {
  return MIME_BY_EXT[extname(path).toLowerCase()];
}

export type ServeError = { code: string; message: string; status: 400 | 403 | 404 | 413 };

/** 越权检查：resolve 之后必须等于某个根或在其前缀内（与 `fs.ts` 的 `guardWithinRoots` 同一条规则）。 */
export function withinRoots(target: string, roots: readonly string[]): boolean {
  const absolute = resolve(target);
  for (const root of roots) {
    const normalized = resolve(root);
    if (absolute === normalized) return true;
    if (absolute.startsWith(normalized.endsWith(sep) ? normalized : normalized + sep)) return true;
  }
  return false;
}

/**
 * 判定一次取回是否允许（**不读文件内容**，只 stat）。
 *
 * 返回 `{ path, mimeType }` 表示可以读；返回 `ServeError` 表示拒绝，调用方直接映射成状态码。
 */
export async function resolveServeTarget(
  rawPath: string | undefined,
  roots: readonly string[],
): Promise<{ path: string; mimeType: string } | ServeError> {
  if (rawPath === undefined || rawPath.trim() === "") {
    return { code: "invalid_request", message: "需要 path 参数", status: 400 };
  }
  // NUL / 换行等控制字符：路径合法性先按"不像路径就拒"处理，避免奇怪的日志与错误信息
  if (/[\u0000\r\n]/.test(rawPath)) {
    return { code: "invalid_attachment_path", message: "路径包含非法字符", status: 400 };
  }
  const mimeType = mimeTypeOfImagePath(rawPath);
  if (mimeType === undefined) {
    return { code: "not_an_image", message: "只支持图片（png/jpg/webp/gif/bmp/avif）", status: 400 };
  }
  if (!withinRoots(rawPath, roots)) {
    return { code: "path_not_allowed", message: "路径不在已注册的根内", status: 403 };
  }
  const info = await stat(rawPath).catch(() => undefined);
  if (info === undefined || !info.isFile()) {
    return { code: "attachment_not_found", message: "图片不在了（可能被清理或已移动）", status: 404 };
  }
  if (info.size > MAX_TOOL_IMAGE_BYTES) {
    return { code: "attachment_too_large", message: `图片超过 ${MAX_TOOL_IMAGE_BYTES / (1024 * 1024)}MB`, status: 413 };
  }
  return { path: rawPath, mimeType };
}

/** 读字节（只在 `resolveServeTarget` 通过后调用）。 */
export async function readServeBytes(path: string): Promise<Buffer | undefined> {
  return await readFile(path).catch(() => undefined);
}

/** 供端点用的一步式：判定 + 读取。 */
export async function loadAttachmentForServe(
  rawPath: string | undefined,
): Promise<{ bytes: Buffer; mimeType: string; path: string; mtimeMs: number } | ServeError> {
  const roots = await readRoots();
  const target = await resolveServeTarget(rawPath, roots);
  if ("code" in target) return target;
  const bytes = await readServeBytes(target.path);
  if (bytes === undefined) return { code: "attachment_not_found", message: "图片读取失败", status: 404 };
  const info = await stat(target.path).catch(() => undefined);
  return { bytes, mimeType: target.mimeType, path: target.path, mtimeMs: info?.mtimeMs ?? 0 };
}
