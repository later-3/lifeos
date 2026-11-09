// 「已看」进度的持久化（G10）：**存服务端**，不存 localStorage。
//
// 为什么不像 difit 那样只存 localStorage（`useViewedFiles.ts` → `StorageService`）：
//  1. 换设备/换浏览器就丢（用户在手机上看了一半，回桌面全不记得）；
//  2. **Agent 读不到**——"哪些文件用户已经看过"是检视状态的合法一部分，
//     与评论同一取舍（D22：数据属于检视对象，不属于某个浏览器）；
//  3. 与评论共用一个落盘目录（`state/review-comments/`）不如分开清晰，所以单开
//     `state/review-viewed/<slug>.json`（同模式：`writeTextAtomic` + 目录 AGENTS.md `wx`）。
//
// 与 difit 一致的**语义**：记录里带 `hash`（diff 内容哈希）。文件内容变了 → 状态自动变成
// `changed`（需要重看），而不是继续显示"已看"（`frontend/src/review-viewed.ts#viewedStatusOf`）。
//
// 并发：同一 Task 串行写（进程内 promise 链，与 comments 同款）。
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeTextAtomic } from "./atomic-file.ts";
import { resolveHome } from "./home.ts";

/** 结构版本：形状变了就 +1（旧版本整批丢弃——已看进度是可重建的低价值数据，不值得写迁移）。 */
export const VIEWED_SCHEMA_VERSION = 1;
export const VIEWED_DIR = join("state", "review-viewed");
/** 每个 Task 最多记多少条（= 该 Task 的文件数上限量级；超出丢最旧）。 */
export const MAX_VIEWED_PER_TASK = 500;

const VIEWED_NOTE = `# review-viewed · 检视「已看」进度

- 背景：检视模式里用户对每个文件点「已看」（GitHub Files changed / difit 同款心智）。
- 内容：<slug>.json，每行一个 Task。结构 \`{ version, taskId, records: [{ path, viewedAt, hash }] }\`。
- 关键：记录带 diff **内容哈希**——文件改了之后状态自动变成"变了，需要重看"，不会骗人。
- 何时读：排查"已看进度为什么不显示 / 为什么文件改了还显示已看"。
- 怎么用：不要手改（原子替换，手改会被覆盖）；删掉某个文件 = 清空该 Task 的进度。不入库。
`;

export type ViewedRecord = {
  /** 相对路径（与 diff 的 `path` 一致） */
  path: string;
  /** ISO 时间 */
  viewedAt: string;
  /** 标记时的 diff 内容哈希（前端 `diffContentHash` 计算） */
  hash: string;
};

type StoredFile = { version: number; taskId: string; records: unknown[] };

const isString = (v: unknown): v is string => typeof v === "string";

/** Task 目录 → 文件名（与 `review-comments.ts#taskSlugOf` 同算法，两个目录各自独立）。 */
export function viewedSlugOf(taskDir: string): string {
  const base = taskDir.replace(/\/+$/, "").split("/").pop() ?? "task";
  const readable = base.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const hash = createHash("sha1").update(taskDir).digest("hex").slice(0, 8);
  return `${readable === "" ? "task" : readable}-${hash}`.slice(0, 64);
}

export function viewedFileOf(taskDir: string): string {
  return join(resolveHome(), VIEWED_DIR, `${viewedSlugOf(taskDir)}.json`);
}

export function toViewedRecord(raw: unknown): ViewedRecord | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (!isString(r.path) || r.path === "") return undefined;
  if (!isString(r.hash) || r.hash === "") return undefined;
  const viewedAt = isString(r.viewedAt) && r.viewedAt !== "" ? r.viewedAt : new Date().toISOString();
  return { path: r.path, viewedAt, hash: r.hash };
}

/** 读某 Task 的已看记录。任何异常降级成空数组（进度丢了能重建，接口不能 500）。 */
export async function readViewed(taskDir: string): Promise<ViewedRecord[]> {
  let text: string;
  try {
    text = await readFile(viewedFileOf(taskDir), "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const shape = parsed as Partial<StoredFile>;
  if (shape.version !== VIEWED_SCHEMA_VERSION || !Array.isArray(shape.records)) return [];
  return shape.records.map(toViewedRecord).filter((record): record is ViewedRecord => record !== undefined);
}

const chains = new Map<string, Promise<void>>();
function serialize(key: string, work: () => Promise<void>): Promise<void> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(work, work).catch(() => undefined);
  chains.set(key, next);
  return next;
}

async function writeViewed(taskDir: string, taskId: string, records: readonly ViewedRecord[]): Promise<void> {
  const valid = records.map(toViewedRecord).filter((record): record is ViewedRecord => record !== undefined);
  // 上限裁剪：丢最旧（按 viewedAt 升序取尾部）
  const trimmed = valid.length <= MAX_VIEWED_PER_TASK
    ? valid
    : [...valid].sort((a, b) => a.viewedAt.localeCompare(b.viewedAt)).slice(valid.length - MAX_VIEWED_PER_TASK);
  const file = viewedFileOf(taskDir);
  const dir = join(file, "..");
  const body: StoredFile = { version: VIEWED_SCHEMA_VERSION, taskId, records: trimmed };
  await serialize(file, async () => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeTextAtomic(file, JSON.stringify(body, null, 2) + "\n");
    await writeFile(join(dir, "AGENTS.md"), VIEWED_NOTE, { flag: "wx", mode: 0o600 }).catch(() => undefined);
  });
}

/**
 * 标记/取消标记一个文件。
 *
 * - `viewed = true`：写入或更新记录（同一路径只保留一条，最新的 hash/viewedAt 覆盖）；
 * - `viewed = false`：删掉该路径的记录。
 *
 * @returns 更新后的全部记录（调用方直接用，不必再读一次）
 */
export async function setFileViewed(
  taskDir: string,
  taskId: string,
  path: string,
  hash: string,
  viewed: boolean,
  now: string = new Date().toISOString(),
): Promise<ViewedRecord[]> {
  const all = await readViewed(taskDir);
  const rest = all.filter((record) => record.path !== path);
  const next = viewed ? [...rest, { path, hash, viewedAt: now }] : rest;
  await writeViewed(taskDir, taskId, next);
  return next;
}

/**
 * 批量标记（勾选目录 = 一次标多个）。**一次写盘**，不是 N 次。
 *
 * @param entries 每个文件的 `{ path, hash }`
 * @returns 更新后的全部记录
 */
export async function setFilesViewed(
  taskDir: string,
  taskId: string,
  entries: readonly { path: string; hash: string }[],
  viewed: boolean,
  now: string = new Date().toISOString(),
): Promise<ViewedRecord[]> {
  const all = await readViewed(taskDir);
  const touched = new Set(entries.map((entry) => entry.path));
  const rest = all.filter((record) => !touched.has(record.path));
  const next = viewed ? [...rest, ...entries.map((entry) => ({ path: entry.path, hash: entry.hash, viewedAt: now }))] : rest;
  await writeViewed(taskDir, taskId, next);
  return next;
}

/** 清空某 Task 的已看进度（测试/排障）。 */
export async function clearViewed(taskDir: string): Promise<void> {
  await rm(viewedFileOf(taskDir), { force: true });
}
