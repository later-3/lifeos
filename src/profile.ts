/**
 * 用户档案：**你本人**的名字与头像（2026-11-02 用户拍板）。
 *
 * 关键区别（不要再搞混）：
 * - **Agent** 有 `agent.json` 的 `avatar`，是"同事"；存 `~/.lifeos/agents/<id>/avatar/`；
 * - **用户**（= 使用者本人）不属于任何 Agent，也不该被造成一个 Agent 实体；
 *   档案单独存 `~/.lifeos/config/profile.json`，头像存 `~/.lifeos/config/profile-avatar.*`。
 *
 * 默认值：名字取系统账号全名（`id -F` → "Xu Later"），没有就取用户名；
 * 头像没设就用首字母色块（与 AgentAvatar 同一套派生规则，观感统一）。
 *
 * 纯函数 + 两个薄 IO 封装；不读环境变量以外的系统状态。
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, join } from "node:path";

const run = promisify(execFile);

/** 头像图片的允许类型（与图片输入白名单同源，头像只留静态图）。 */
export const PROFILE_AVATAR_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
export type ProfileAvatarMime = (typeof PROFILE_AVATAR_MIME)[number];

export type UserProfile = {
  /** 显示名（消息上显示在你头像旁） */
  name: string;
  /** 头像：没设 = undefined（界面用首字母色块） */
  avatar?: { kind: "image"; file: string; revision: number };
};

/** 档案文件名（相对家目录）。 */
export const PROFILE_RELATIVE_PATH = "config/profile.json";
/** 头像文件目录（相对家目录）。 */
export const PROFILE_AVATAR_DIR = "config";

/** 名字长度上限：头像旁显示，太长会挤掉时间戳。 */
export const MAX_PROFILE_NAME = 32;

/**
 * 兜底的显示名：系统全名 → 用户名 → "我"。
 *
 * 为什么读系统账号：用户明确说"先用主系统用户名是可以的，后面他自己要改再编辑"。
 * `id -F` 在 Linux 上不存在，所以失败要能回落，不能抛。
 */
export async function defaultProfileName(): Promise<string> {
  const env = process.env;
  const fromEnv = env.USER ?? env.LOGNAME;
  try {
    const { stdout } = await run("id", ["-F"], { timeout: 2000 });
    const full = stdout.trim();
    if (full !== "") return full;
  } catch {
    // 非 macOS / 命令缺失 → 回落
  }
  if (fromEnv !== undefined && fromEnv.trim() !== "") return fromEnv.trim();
  return "我";
}

/** 清洗名字：去首尾空白、压内部空白、截断到上限；空串返回 undefined（调用方回默认）。 */
export function normalizeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned === "") return undefined;
  return cleaned.slice(0, MAX_PROFILE_NAME);
}

/** 按文件头判断头像的真实类型（不信声明的 mime，与图片输入同一原则）。 */
export function sniffAvatarMime(bytes: Uint8Array): ProfileAvatarMime | undefined {
  const starts = (offset: number, pattern: readonly number[]): boolean =>
    bytes.length >= offset + pattern.length && pattern.every((byte, index) => bytes[offset + index] === byte);
  if (starts(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  const ascii = (offset: number, length: number): string =>
    bytes.length < offset + length ? "" : String.fromCharCode(...bytes.slice(offset, offset + length));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  return undefined;
}

const EXT_OF_MIME: Record<ProfileAvatarMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * 解析档案 JSON。坏输入一律回"只有名字"的最小档案，不抛——
 * 档案坏了不该让整个界面起不来（与 payload-limits 的容错同一原则）。
 */
export function parseProfile(raw: unknown, fallbackName: string): UserProfile {
  const name = normalizeName((raw as { name?: unknown } | null | undefined)?.name) ?? fallbackName;
  const avatar = (raw as { avatar?: unknown } | null | undefined)?.avatar;
  if (typeof avatar !== "object" || avatar === null) return { name };
  const record = avatar as { kind?: unknown; file?: unknown; revision?: unknown };
  if (record.kind !== "image" || typeof record.file !== "string" || record.file === "") return { name };
  // 只接受裸文件名：防止 ../ 把读取引到档案目录之外
  if (basename(record.file) !== record.file) return { name };
  return {
    name,
    avatar: { kind: "image", file: record.file, revision: typeof record.revision === "number" ? record.revision : 0 },
  };
}

/** 读档案（不存在 → 只带默认名字的档案）。 */
export async function readProfile(home: string): Promise<UserProfile> {
  const fallback = await defaultProfileName();
  const text = await readFile(join(home, PROFILE_RELATIVE_PATH), "utf8").catch(() => undefined);
  if (text === undefined) return { name: fallback };
  try {
    return parseProfile(JSON.parse(text), fallback);
  } catch {
    return { name: fallback };
  }
}

/** 写档案（原子：先写 .tmp 再 rename；权限 0600，档案里可能有人名）。 */
export async function writeProfile(home: string, profile: UserProfile): Promise<void> {
  const path = join(home, PROFILE_RELATIVE_PATH);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const body = JSON.stringify({ schemaVersion: 1, ...profile }, null, 2);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${body}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

/**
 * 存头像：按真实格式落盘，文件名带 revision（避免浏览器缓存旧头像）。
 *
 * @returns 新的 avatar 描述；格式不认识 → undefined（调用方报 400，不静默存垃圾）
 */
export async function storeProfileAvatar(home: string, base64: string): Promise<UserProfile["avatar"] | undefined> {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength === 0) return undefined;
  const mime = sniffAvatarMime(new Uint8Array(bytes));
  if (mime === undefined) return undefined;
  const dir = join(home, PROFILE_AVATAR_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const revision = Date.now();
  const file = `profile-avatar-${revision}.${EXT_OF_MIME[mime]}`;
  const path = join(dir, file);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, bytes, { mode: 0o600 });
  await rename(tmp, path);
  // 旧头像清掉：只删**我们自己命名的**文件（profile-avatar-* 前缀），绝不扫删目录里别的东西
  await pruneOldAvatars(dir, file);
  return { kind: "image", file, revision };
}

/** 删掉除 keep 之外的旧头像（前缀匹配 + 只认静态图扩展）。失败不阻断（新头像已经存好）。 */
async function pruneOldAvatars(dir: string, keep: string): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (entry === keep) continue;
    if (!/^profile-avatar-\d+\.(png|jpg|webp)$/.test(entry)) continue;
    await rm(join(dir, entry), { force: true }).catch(() => undefined);
  }
}

/** 读头像字节（供 GET /api/profile/avatar）。不存在 → undefined。 */
export async function readProfileAvatar(home: string, profile: UserProfile): Promise<Buffer | undefined> {
  if (profile.avatar === undefined) return undefined;
  return readFile(join(home, PROFILE_AVATAR_DIR, profile.avatar.file)).catch(() => undefined);
}

/** 头像文件大小上限：头像显示在 24–32px，1MB 已远超需要。 */
export const MAX_AVATAR_BYTES = 1024 * 1024;

/** 该头像文件是否真的存在（避免档案里挂着已删除的文件）。 */
export async function avatarExists(home: string, profile: UserProfile): Promise<boolean> {
  if (profile.avatar === undefined) return false;
  const info = await stat(join(home, PROFILE_AVATAR_DIR, profile.avatar.file)).catch(() => undefined);
  return info !== undefined && info.isFile();
}
