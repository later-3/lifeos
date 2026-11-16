// 媒体库（Task 0016 · P1）：头像与表情的**唯一素材来源**。
//
// 为什么需要它（都是踩过的坑）：
// - 头像现在只能"上传字节"，Agent 想换头像必须先读图再传 base64 —— 读图按 4800 字符/张进上下文
//   （`pi/packages/ai/src/utils/estimate.ts:16`），选一张图就烧掉一次预算；
// - 表情若走"工具返回 image 块"，同样吃预算（`src/stream-events.ts:45` + `openai-completions.ts:1408` 把 image 块转成
//   `image_url` 发给模型）；而真正发出去时只需要**几个字符**。
// - 素材放在 `attachments/` 会被 `gcAttachments()` 当孤儿删掉（`src/attachments.ts`：无人引用且超期即删）。
//
// 本模块只做三件事，全部纯 IO + 无模型参与：
// 1. 目录：`media/catalog.json` 记录每件素材（id / 种类 / 关键词 / 来源 / 许可 / 字节数）；
// 2. 取字节：按 id 或按"需要什么"（头像候选 / 某个心情的表情）取**已落盘**的文件；
// 3. 收入：把一个外部 URL 的图落到库里并登记（校验魔数、算 hash、记许可）。
//
// 文件落点（家目录，不进版本控制）：
//   media/catalog.json
//   media/avatar/<id>.<ext>
//   media/emoji/<id>.<ext>
//
// 工具与 HTTP 都是这层的外壳（`specs/code/backend/code.md` 2.6）。

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { resolveHome } from "./home.ts";

/** 媒体库根目录名（相对家目录）。放 `attachments/` 会被孤儿清理删掉，见文件头。 */
export const MEDIA_DIR = "media";

export type MediaKind = "avatar" | "emoji";

/** 一件素材的登记信息。`id` 是稳定键（工具与 URL 都用它），`file` 是相对 `media/` 的路径。 */
export type MediaEntry = {
  id: string;
  kind: MediaKind;
  /** 素材包名（`dicebear-shapes` / `twemoji` / `ipaslogo` …）：用于按来源分组与整体停用。 */
  pack: string;
  file: string;
  mime: string;
  bytes: number;
  /** 语义关键词：中文 + 英文都收（ipaslogo 的搜索只认英文，中文检索必须靠我们自己的表）。 */
  keywords: string[];
  /** 来历：仓库/端点 + 版本或 commit；没有它就等于"来路不明的图"。 */
  source: string;
  /** 许可（`MIT` / `CC0-1.0` / `CC-BY-4.0` …）。空字符串表示未核实——**不得**为它写"应该没问题"。 */
  license: string;
  /** 何时收入（ISO）。 */
  addedAt: string;
};

export type MediaCatalog = {
  schemaVersion: 1;
  entries: MediaEntry[];
};

const EMPTY_CATALOG: MediaCatalog = { schemaVersion: 1, entries: [] };

export const mediaRoot = (home: string = resolveHome()): string => join(home, MEDIA_DIR);
export const catalogPath = (home: string = resolveHome()): string => join(mediaRoot(home), "catalog.json");

/** 素材 id 的合法形态：小写 ASCII + 数字 + `-` + `_`（同时是 URL 段与文件名段，不能有 `..`）。 */
const MEDIA_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isMediaId(value: string): boolean {
  return MEDIA_ID.test(value);
}

export async function readCatalog(home: string = resolveHome()): Promise<MediaCatalog> {
  const text = await readFile(catalogPath(home), "utf8").catch(() => undefined);
  if (text === undefined) return EMPTY_CATALOG;
  try {
    const parsed = JSON.parse(text) as { schemaVersion?: unknown; entries?: unknown };
    if (!Array.isArray(parsed.entries)) return EMPTY_CATALOG;
    return { schemaVersion: 1, entries: parsed.entries.filter(isMediaEntry) };
  } catch {
    return EMPTY_CATALOG;          // 坏文件当空库：宁可"没有素材"，也不让整个服务起不来
  }
}

/** 校验一条登记项的形状（读盘时用：手改过 catalog 也不该炸）。 */
function isMediaEntry(value: unknown): value is MediaEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string" && isMediaId(entry.id)
    && (entry.kind === "avatar" || entry.kind === "emoji")
    && typeof entry.pack === "string"
    && typeof entry.file === "string" && entry.file !== "" && !entry.file.includes("..")
    && typeof entry.mime === "string"
    && typeof entry.bytes === "number"
    && Array.isArray(entry.keywords) && entry.keywords.every((k) => typeof k === "string")
    && typeof entry.source === "string"
    && typeof entry.license === "string"
    && typeof entry.addedAt === "string";
}

/** 原子写 catalog（tmp + rename）：写到一半断电不会留下半截 JSON。 */
export async function writeCatalog(home: string, catalog: MediaCatalog): Promise<void> {
  await mkdir(mediaRoot(home), { recursive: true, mode: 0o700 });
  const path = catalogPath(home);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify({ schemaVersion: 1, entries: sortEntries(catalog.entries) }, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

/** 稳定顺序：kind → pack → id。写入顺序与插入先后无关，diff 里只有真实变化。 */
function sortEntries(entries: readonly MediaEntry[]): MediaEntry[] {
  return [...entries].sort((a, b) =>
    a.kind !== b.kind ? a.kind.localeCompare(b.kind)
    : a.pack !== b.pack ? a.pack.localeCompare(b.pack)
    : a.id.localeCompare(b.id));
}

/** 按 id 取一件。 */
export function findEntry(catalog: MediaCatalog, id: string): MediaEntry | undefined {
  return catalog.entries.find((entry) => entry.id === id);
}

export type MediaQuery = { query?: string | undefined; kind?: MediaKind | undefined; pack?: string | undefined; limit?: number | undefined };

/**
 * 按关键词查素材。
 *
 * 匹配规则：查询串按空白切词，**每个词都要命中**（AND），命中任意关键词即算（关键词包含查询词）。
 * 大小写不敏感；中文按子串匹配（中文不分词，`海豹` 直接命中关键词 `海豹`）。
 * 没有查询串时返回该种类的前 `limit` 条（按包与 id 排序，稳定）。
 */
export function searchEntries(catalog: MediaCatalog, query: MediaQuery = {}): MediaEntry[] {
  const limit = query.limit !== undefined && query.limit > 0 ? Math.floor(query.limit) : 20;
  const terms = (query.query ?? "").trim().toLowerCase().split(/\s+/).filter((term) => term !== "");
  const pool = catalog.entries.filter((entry) =>
    (query.kind === undefined || entry.kind === query.kind)
    && (query.pack === undefined || entry.pack === query.pack));
  if (terms.length === 0) return sortEntries(pool).slice(0, limit);
  const scored: Array<{ entry: MediaEntry; score: number }> = [];
  for (const entry of pool) {
    const words = [entry.id, ...entry.keywords].map((word) => word.toLowerCase());
    let total = 0;
    let allHit = true;
    for (const term of terms) {
      const hits = words.filter((word) => word.includes(term)).length;
      if (hits === 0) { allHit = false; break; }
      total += hits;
    }
    if (allHit) scored.push({ entry, score: total });
  }
  // 命中词数相同时按 id 排：结果稳定，Agent 重复调用拿到同样的顺序
  scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  return scored.slice(0, limit).map((item) => item.entry);
}

/** 素材文件的绝对路径。不校验存在（调用方自己处理 ENOENT，保持纯字符串运算）。 */
export function mediaFilePath(home: string, entry: MediaEntry): string {
  return join(mediaRoot(home), entry.file);
}

/** 读素材字节。文件被外部删掉 → undefined（调用方给 404，不猜）。 */
export async function readMediaBytes(home: string, entry: MediaEntry): Promise<Buffer | undefined> {
  return readFile(mediaFilePath(home, entry)).catch(() => undefined);
}

/** 从图片头认格式（与 `sniffImage` 同一组；AVIF/BMP 不在白名单内，见 `src/image-input.ts`）。 */
export function sniffMediaImage(buffer: Buffer): { ext: string; mime: string } | undefined {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (buffer.length >= 6 && buffer.toString("ascii", 0, 3) === "GIF") return { ext: "gif", mime: "image/gif" };
  // SVG 不做（`<script>` 在里面 → 同源 XSS）；要矢量就换 rastor 或以后加净化。
  return undefined;
}

/** 素材文件的相对路径：`<kind>/<id>.<ext>`。 */
export function mediaFileOf(kind: MediaKind, id: string, ext: string): string {
  return `${kind}/${id}.${ext}`;
}

/** 内容 hash 前 16 位：同一张图永远同一个名字，重复收入天然幂等（与 `attachments.ts` 同思路）。 */
export function contentIdOf(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

export type AddEntryInput = {
  id: string;
  kind: MediaKind;
  pack: string;
  buffer: Buffer;
  keywords: readonly string[];
  source: string;
  license: string;
  ext?: string | undefined;
  mime?: string | undefined;
  /** 覆盖登记时间（种子脚本用；缺省 = 现在）。 */
  addedAt?: string | undefined;
};

export type AddEntryResult =
  | { ok: true; entry: MediaEntry }
  | { ok: false; code: "invalid_media_id" | "invalid_image"; message: string };

/**
 * 把一张图收入库并登记。
 *
 * - id 不合法 / 不是认得的图片格式 → 拒绝（不落盘、不登记）；
 * - 同 id 重复收入 → **覆盖**（种子脚本可重跑）；`file` 按扩展名算，扩展名变了会清掉旧文件。
 */
export async function addEntry(home: string, input: AddEntryInput): Promise<AddEntryResult> {
  if (!isMediaId(input.id)) {
    return { ok: false, code: "invalid_media_id", message: `素材 id 只能用 [a-z0-9-_]：${input.id}` };
  }
  const sniffed = input.ext !== undefined && input.mime !== undefined
    ? { ext: input.ext, mime: input.mime }
    : sniffMediaImage(input.buffer);
  if (sniffed === undefined) {
    return { ok: false, code: "invalid_image", message: "只支持 png/jpg/webp/gif" };
  }

  const catalog = await readCatalog(home);
  const previous = findEntry(catalog, input.id);
  const file = mediaFileOf(input.kind, input.id, sniffed.ext);
  const absolute = join(mediaRoot(home), file);
  await mkdir(join(mediaRoot(home), input.kind), { recursive: true, mode: 0o700 });

  const tmp = `${absolute}.tmp`;
  await writeFile(tmp, input.buffer, { mode: 0o600 });
  await rename(tmp, absolute);

  const entry: MediaEntry = {
    id: input.id,
    kind: input.kind,
    pack: input.pack,
    file,
    mime: sniffed.mime,
    bytes: input.buffer.length,
    keywords: [...new Set(input.keywords.map((word) => word.trim()).filter((word) => word !== ""))],
    source: input.source,
    license: input.license,
    addedAt: input.addedAt ?? new Date().toISOString(),
  };
  const entries = catalog.entries.filter((item) => item.id !== input.id);
  entries.push(entry);
  await writeCatalog(home, { schemaVersion: 1, entries });

  // 扩展名变了（png → webp）时旧文件会留下：显式删掉，别让目录越滚越大
  if (previous !== undefined && previous.file !== file) {
    const { rm } = await import("node:fs/promises");
    await rm(join(mediaRoot(home), previous.file), { force: true }).catch(() => undefined);
  }
  return { ok: true, entry };
}

export type MediaStats = { avatar: number; emoji: number; totalBytes: number; packs: string[] };

export async function mediaStats(home: string = resolveHome()): Promise<MediaStats> {
  const catalog = await readCatalog(home);
  let avatar = 0;
  let emoji = 0;
  let totalBytes = 0;
  const packs = new Set<string>();
  for (const entry of catalog.entries) {
    if (entry.kind === "avatar") avatar += 1; else emoji += 1;
    totalBytes += entry.bytes;
    packs.add(entry.pack);
  }
  return { avatar, emoji, totalBytes, packs: [...packs].sort() };
}

/** 目录里有没有登记之外的文件（种子脚本与排查用：能看出"磁盘上多出来的东西"）。 */
export async function strayFiles(home: string = resolveHome()): Promise<string[]> {
  const catalog = await readCatalog(home);
  const known = new Set(catalog.entries.map((entry) => entry.file));
  const out: string[] = [];
  for (const kind of ["avatar", "emoji"] as const) {
    const names = await readdir(join(mediaRoot(home), kind)).catch(() => [] as string[]);
    for (const name of names) {
      if (name.endsWith(".tmp")) continue;
      const relative = `${kind}/${name}`;
      if (!known.has(relative)) out.push(relative);
    }
  }
  return out.sort();
}

/** 素材目录的说明文件（协议 §5.2：程序写入的运行目录也必须有说明）。已存在不覆盖。 */
const MEDIA_NOTE = `# media — 媒体库（头像与表情素材）

程序写入的运行目录，**不进版本控制**。

## 里面有什么

- \`catalog.json\`：每件素材的登记（id / 种类 avatar·emoji / 素材包 / 文件 / 字节数 / 关键词 / 来源 / 许可 / 收入时间）；
- \`avatar/<id>.<ext>\`：头像候选图；
- \`emoji/<id>.<ext>\`：表情图。

## 什么时候读

要给某个 Agent 换头像、或要让 Agent 发一个表情时。**不要用 read 去读这里的图**——
读图会按 4800 字符/张进入上下文（\`pi/packages/ai/src/utils/estimate.ts\`）。用目录查、按 id 取。

## 怎么用

- 查：\`lifeos_media_catalog { kind, query }\`（中英文关键词都能搜）；
- 换头像：\`lifeos_media_avatar_set { agentId, mediaId }\`（模型全程不接触图片字节）；
- 发表情：正文里写 \`:shortcode:\`（如 \`:blush:\`），前端渲染成图；短码表用 \`lifeos_media_catalog { kind: "emoji" }\` 查。

## 纪律

- **必须**每件素材都登记 \`source\` 与 \`license\`；来源不明或没有许可的图不许收进来。
- **必须**用 \`scripts/media-seed.mjs\` 收入素材（它保证校验、去重与登记）；手工往目录里放图会变成"登记之外的孤儿"。
- **不应该**把这里当成用户上传附件的仓库——附件在 \`attachments/\`，由 \`gcAttachments\` 自动清理。
`;

export async function ensureMediaDir(home: string = resolveHome()): Promise<void> {
  await mkdir(join(mediaRoot(home), "avatar"), { recursive: true, mode: 0o700 });
  await mkdir(join(mediaRoot(home), "emoji"), { recursive: true, mode: 0o700 });
  // `wx` = 已存在就失败：说明文件一旦写过就不再覆盖（用户手改的内容不能被程序盖掉）
  await writeFile(join(mediaRoot(home), "AGENTS.md"), MEDIA_NOTE, { flag: "wx", mode: 0o600 }).catch(() => undefined);
  const info = await stat(join(mediaRoot(home), "AGENTS.md")).catch(() => undefined);
  if (info === undefined) {
    await writeFile(join(mediaRoot(home), "AGENTS.md"), MEDIA_NOTE, { mode: 0o600 }).catch(() => undefined);
  }
}
