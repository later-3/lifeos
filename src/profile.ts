/**
 * 用户实体：**你本人**的身份（Task 0015 · T9，2026-11-02 用户拍板"user 也要建实体"）。
 *
 * 关键区别（不要再搞混）：
 * - **Agent** 有 `agent.json`，是"同事"；存 `~/.lifeos/agents/<id>/`；
 * - **用户**（= 使用者本人）不是 Agent，**有自己的实体**：`~/.lifeos/users/<id>/user.json` + `avatar.*`。
 *
 * 为什么从"一个 config/profile.json"升级成实体（代码事实 + 用户诉求）：
 * - 记忆层**早已**在用 `userId` 并落了真实目录（`src/memory/roles.ts` 的 `~/.lifeos/memory/user/<id>/`），
 *   而档案层只有一个**无 id** 的 JSON —— 两半各走一半，参与者无法引用"用户"；
 * - 用户明确："后面可能还会涉及邮箱、年龄、性别、GitHub、微信，后期还要接谷歌/微信登录"。
 *   但**本轮只做最小字段**（id / name / avatar / createdAt），其余等有消费方再加。
 *
 * 三条约定：
 * 1. **id 稳定、可读、不进界面**：id 由 `entityId(name, "url")` 生成（ASCII），改名字不改 id；
 * 2. **一个家目录一个使用者**（Obsidian 式）：`users/` 下只有一个，API 不带 userId，无登录无鉴权；
 * 3. **读时容忍未知字段**：将来加 `email` / `identities` 是纯新增，不破坏任何读取方。
 *
 * 兼容：老的 `config/profile.json` 仍然可读（迁移回落），且**不删除**（留作回滚点）。
 */
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, join } from "node:path";
import { entityId } from "./segments.ts";

const run = promisify(execFile);

/** 头像图片的允许类型（与图片输入白名单同源，头像只留静态图）。 */
export const PROFILE_AVATAR_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
export type ProfileAvatarMime = (typeof PROFILE_AVATAR_MIME)[number];

/** 用户实体（`users/<id>/user.json`）。字段刻意最少：只放现在有消费方的。 */
export type UserProfile = {
  /** 唯一 id（= 目录名；只用于内部引用与参与者写法，不给人看）。 */
  id: string;
  /** 显示名（消息上显示在你头像旁）。 */
  name: string;
  /** 头像：没设 = undefined（界面用首字母色块） */
  avatar?: { kind: "image"; file: string; revision: number };
  /** 创建时间（与 agent.json / project.json 同构，最便宜的审计字段）。 */
  createdAt?: string;
};

/** 用户实体的根目录（相对家目录）。 */
export const USERS_RELATIVE_DIR = "users";
/** 头像文件名前缀（只删我们自己命名的文件）。 */
const AVATAR_PREFIX = "avatar";
/** 旧档案（兼容读取，不再写）。 */
export const PROFILE_RELATIVE_PATH = "config/profile.json";
/** 旧头像目录（兼容读取）。 */
export const PROFILE_AVATAR_DIR = "config";

/** 名字长度上限：头像旁显示，太长会挤掉时间戳。 */
export const MAX_PROFILE_NAME = 32;

const usersRoot = (home: string) => join(home, USERS_RELATIVE_DIR);
const userDir = (home: string, id: string) => join(usersRoot(home), id);
const userJson = (home: string, id: string) => join(userDir(home, id), "user.json");

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
    if (full !== "") return full.slice(0, MAX_PROFILE_NAME);
  } catch { /* Linux 上没有 id -F：回落 */ }
  return (fromEnv !== undefined && fromEnv.trim() !== "" ? fromEnv.trim() : "我").slice(0, MAX_PROFILE_NAME);
}

export function normalizeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed === "") return undefined;
  return trimmed.slice(0, MAX_PROFILE_NAME);
}

export function sniffAvatarMime(bytes: Uint8Array): ProfileAvatarMime | undefined {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  const RIFF = (i: number) => b[i] === 0x52 && b[i + 1] === 0x49 && b[i + 2] === 0x46 && b[i + 3] === 0x46;
  const WEBP = (i: number) => b[i] === 0x57 && b[i + 1] === 0x45 && b[i + 2] === 0x42 && b[i + 3] === 0x50;
  if (RIFF(0) && WEBP(8)) return "image/webp";
  return undefined;
}

/** 头像扩展名（由真实格式决定，不听客户端声明）。 */
const EXT_OF_MIME: Record<ProfileAvatarMime, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
};

const parseAvatar = (value: unknown): UserProfile["avatar"] | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { kind?: unknown; file?: unknown; revision?: unknown };
  if (record.kind !== "image" || typeof record.file !== "string" || record.file === "") return undefined;
  // 只接受裸文件名：防止 ../ 把读取引到实体目录之外
  if (basename(record.file) !== record.file) return undefined;
  return { kind: "image", file: record.file, revision: typeof record.revision === "number" ? record.revision : 0 };
};

/**
 * 解析 user.json。
 * `fallbackName` / `fallbackId` 用于老数据（没有 id / name）——不伪造别的字段，只补最小的两个。
 */
export function parseProfile(raw: unknown, fallbackName: string, fallbackId?: string): UserProfile {
  const record = (raw ?? {}) as Record<string, unknown>;
  const name = normalizeName(record.name) ?? fallbackName;
  const generated = entityId(name, "url");
  const id = typeof record.id === "string" && record.id !== ""
    ? record.id
    : (fallbackId ?? (generated.ok ? generated.id : "user"));
  const avatar = parseAvatar(record.avatar);
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : undefined;
  return {
    id,
    name,
    ...(avatar !== undefined ? { avatar } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
  };
}

/** 现有用户目录名（不校验内容，只看目录）。 */
async function listUserIds(home: string): Promise<string[]> {
  const entries = await readdir(usersRoot(home), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
}

/** 读某个用户实体（不存在 → undefined）。 */
async function readUserEntity(home: string, id: string): Promise<UserProfile | undefined> {
  const text = await readFile(userJson(home, id), "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    return parseProfile(JSON.parse(text), id, id);
  } catch {
    return undefined;
  }
}

/** 写用户实体（原子：tmp + rename；目录 0700、文件 0600）。 */
async function writeUserEntity(home: string, profile: UserProfile): Promise<void> {
  const dir = userDir(home, profile.id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = userJson(home, profile.id);
  const body = JSON.stringify({ schemaVersion: 1, ...profile }, null, 2);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${body}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

/**
 * 读当前用户（单用户：`users/` 下第一个）。
 *
 * 三级回落（不在读时写盘——读操作不产生副作用）：
 * 1. `users/<id>/user.json` 存在 → 用它；
 * 2. 老 `config/profile.json` 存在 → 读它（**产物仍带 id**，id 由名字派生）；
 * 3. 都没有 → 只带默认名字与派生 id 的档案（第一次写盘时才真正建目录）。
 */
export async function readProfile(home: string): Promise<UserProfile> {
  const fallbackName = await defaultProfileName();

  const ids = await listUserIds(home);
  const first = ids[0];
  if (first !== undefined) {
    const entity = await readUserEntity(home, first);
    if (entity !== undefined) return entity;
  }

  const legacyText = await readFile(join(home, PROFILE_RELATIVE_PATH), "utf8").catch(() => undefined);
  if (legacyText !== undefined) {
    try {
      return parseProfile(JSON.parse(legacyText), fallbackName);
    } catch { /* 坏 JSON：按"没设过"处理 */ }
  }

  return parseProfile({}, fallbackName);
}

/**
 * 写当前用户实体。
 *
 * 有 id 就写那个实体；没有（老调用只传 name/avatar）时按名字派生一个。
 * 若 `users/` 下已有一个实体，**沿用它的 id**——单用户场景下改名不该换 id（id 稳定是硬约定）。
 */
export async function writeProfile(home: string, profile: Omit<UserProfile, "id"> & { id?: string }): Promise<UserProfile> {
  const existingIds = await listUserIds(home);
  const generated = entityId(profile.name, "url");
  const id = profile.id !== undefined && profile.id !== ""
    ? profile.id
    : (existingIds[0] ?? (generated.ok ? generated.id : undefined));
  if (id === undefined || typeof id !== "string") {
    throw new Error(generated.ok ? "无法确定用户 id" : generated.message);
  }
  const next: UserProfile = {
    id,
    name: profile.name,
    ...(profile.avatar !== undefined ? { avatar: profile.avatar } : {}),
    createdAt: profile.createdAt ?? new Date().toISOString(),
  };
  await writeUserEntity(home, next);
  return next;
}

/**
 * 存头像：按真实格式落盘到 `users/<id>/`，文件名带 revision（避免浏览器缓存旧头像）。
 *
 * @returns 新的 avatar 描述；格式不认识 → undefined（调用方报 400，不静默存垃圾）
 */
export async function storeProfileAvatar(home: string, base64: string): Promise<UserProfile["avatar"] | undefined> {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength === 0) return undefined;
  const mime = sniffAvatarMime(new Uint8Array(bytes));
  if (mime === undefined) return undefined;
  const profile = await readProfile(home);
  const dir = userDir(home, profile.id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const revision = Date.now();
  const file = `${AVATAR_PREFIX}-${revision}.${EXT_OF_MIME[mime]}`;
  const path = join(dir, file);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, bytes, { mode: 0o600 });
  await rename(tmp, path);
  // 旧头像清掉：只删**我们自己命名的**文件（avatar-* 前缀），绝不扫删目录里别的东西
  await pruneOldAvatars(dir, file);
  return { kind: "image", file, revision };
}

/** 删掉除 keep 之外的旧头像（前缀匹配 + 只认静态图扩展）。失败不阻断（新头像已经存好）。 */
async function pruneOldAvatars(dir: string, keep: string): Promise<void> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (entry === keep) continue;
    if (!/^avatar-\d+\.(png|jpg|webp)$/.test(entry)) continue;
    await rm(join(dir, entry), { force: true }).catch(() => undefined);
  }
}

/** 头像的绝对路径（实体目录；老的 `config/profile-avatar-*` 也认）。 */
function avatarPath(home: string, profile: UserProfile): string {
  const file = profile.avatar?.file ?? "";
  // 老档案里的头像还在 config/ 下：按文件名前缀判断，不做"猜路径"
  if (file.startsWith("profile-avatar-")) return join(home, PROFILE_AVATAR_DIR, file);
  return join(userDir(home, profile.id), file);
}

/** 读头像字节（供 GET /api/profile/avatar）。不存在 → undefined。 */
export async function readProfileAvatar(home: string, profile: UserProfile): Promise<Buffer | undefined> {
  if (profile.avatar === undefined) return undefined;
  return readFile(avatarPath(home, profile), ).catch(() => undefined);
}

/** 头像文件大小上限：头像显示在 24–32px，1MB 已远超需要。 */
export const MAX_AVATAR_BYTES = 1024 * 1024;

/** 该头像文件是否真的存在（避免档案里挂着已删除的文件）。 */
export async function avatarExists(home: string, profile: UserProfile): Promise<boolean> {
  if (profile.avatar === undefined) return false;
  const info = await stat(avatarPath(home, profile)).catch(() => undefined);
  return info !== undefined && info.isFile();
}
