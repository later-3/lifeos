// 文件浏览器后端：根白名单 + 列目录 / 读文件 / 选择器浏览。
// 安全边界（docs/design/file-browser.md P1）：
//  - tree/content 只允许“resolve 后落在已注册根内”的路径（../ 越权一律 403）；
//  - browse 是选择器专用通道：只列子目录名、不读文件——它是“打开任意目录”的入口，不构成读取面。
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { resolveHome } from "./home.ts";

/** 树/内容读取的最大尺寸：超过则截断并标记（性能红线，P1.3）。 */
export const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

export type TreeEntry = { name: string; isDir: boolean };
export type FsError = { code: string; message: string; status: 400 | 403 | 404 };

function rootsFilePath(): string {
  return join(resolveHome(), "config", "file-roots.json");
}

/** 已注册根：默认根 = 家目录（永远有效）+ config/file-roots.json 里用户选择过的根。 */
export async function readRoots(): Promise<string[]> {
  const roots = new Set<string>([resolve(resolveHome())]);
  try {
    const data = JSON.parse(await readFile(rootsFilePath(), "utf8")) as { roots?: unknown };
    if (Array.isArray(data.roots)) {
      for (const item of data.roots) if (typeof item === "string" && item.trim() !== "") roots.add(resolve(item));
    }
  } catch { /* 无文件/损坏 → 仅默认根 */ }
  return [...roots];
}

/** 注册一个额外根（选择目录时调用）：必须存在且是目录。 */
export async function registerRoot(path: string): Promise<{ roots: string[] } | FsError> {
  const target = resolve(path.trim());
  const info = await stat(target).catch(() => undefined);
  if (info === undefined) return { code: "not_found", message: "目录不存在", status: 404 };
  if (!info.isDirectory()) return { code: "not_a_directory", message: "不是目录", status: 400 };
  // 白名单 = 打开过的目录历史：**最近使用在前**（MRU），家目录始终排在第一位且不写进 extras。
  // 参照 VS Code「Open Recent」与 Pi Web 的 recent-projects（按最近排序、不另存历史）。
  const home = resolve(resolveHome());
  const extra = (await readRoots()).filter((root) => root !== home && root !== target);
  extra.unshift(target);
  await writeFile(rootsFilePath(), JSON.stringify({ schemaVersion: 1, roots: extra }, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  return { roots: await readRoots() };
}

/** 越权检查：resolve 之后必须等于某个根或在其前缀内。 */
function guardWithinRoots(path: string, roots: string[]): string | FsError {
  const target = resolve(path);
  for (const root of roots) {
    if (target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)) return target;
  }
  return { code: "path_not_allowed", message: "路径不在已注册的根内", status: 403 };
}

/** 列目录（树用）：目录优先、字母序、含点文件。 */
export async function listTree(path: string): Promise<{ path: string; entries: TreeEntry[] } | FsError> {
  const roots = await readRoots();
  const target = guardWithinRoots(path, roots);
  if (typeof target !== "string") return target;
  const info = await stat(target).catch(() => undefined);
  if (info === undefined) return { code: "not_found", message: "路径不存在", status: 404 };
  if (!info.isDirectory()) return { code: "not_a_directory", message: "不是目录", status: 400 };
  const names = await readdir(target).catch(() => [] as string[]);
  const entries: TreeEntry[] = [];
  for (const name of names) {
    const isDir = await stat(join(target, name)).then((s) => s.isDirectory(), () => false);
    entries.push({ name, isDir });
  }
  entries.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
  return { path: target, entries };
}

/** 读文件（查看器用）：截断 / 二进制检测（P1.3）。 */
export async function readContent(path: string): Promise<
  { path: string; fileName: string; content: string; size: number; truncated: boolean; isBinary: boolean } | FsError
> {
  const roots = await readRoots();
  const target = guardWithinRoots(path, roots);
  if (typeof target !== "string") return target;
  const info = await stat(target).catch(() => undefined);
  if (info === undefined) return { code: "not_found", message: "文件不存在", status: 404 };
  if (info.isDirectory()) return { code: "not_a_directory", message: "是目录，不是文件", status: 400 };
  const buffer = await readFile(target);
  const probe = buffer.subarray(0, 8192);
  const isBinary = probe.includes(0);
  const truncated = info.size > MAX_CONTENT_BYTES;
  const body = buffer.subarray(0, MAX_CONTENT_BYTES);
  return {
    path: target,
    fileName: target.slice(target.lastIndexOf(sep) + 1),
    content: isBinary ? "" : body.toString("utf8"),
    size: info.size,
    truncated,
    isBinary,
  };
}

/** 选择器专用：任意路径只列**子目录名**（不读文件、不校验根——它是注册根的入口）。 */
export async function browse(path?: string): Promise<{ path: string; parent: string | null; dirs: string[] } | FsError> {
  const target = resolve((path ?? "").trim() === "" ? resolveHome() : path!);
  const info = await stat(target).catch(() => undefined);
  if (info === undefined) return { code: "not_found", message: "路径不存在", status: 404 };
  if (!info.isDirectory()) return { code: "not_a_directory", message: "不是目录", status: 400 };
  const names = await readdir(target, { withFileTypes: true }).catch(() => []);
  const dirs: string[] = [];
  for (const entry of names) if (entry.isDirectory()) dirs.push(entry.name);
  dirs.sort((a, b) => a.localeCompare(b));
  const parent = dirname(target) === target ? null : dirname(target);
  return { path: target, parent, dirs };
}
