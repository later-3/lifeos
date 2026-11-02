/**
 * 实体 id 的唯一生成规则（Task 0015 · T10）。
 *
 * 为什么需要这一层（现状是三套规则，用户看不懂 `agent-3909`）：
 * - **Agent** 走严格 slug，非 ASCII 名字转不出 → 随机后缀 `agent-3909`；
 * - **Project** 走 `sanitizeSegment`（允许中文）——但它同样会进 URL；
 * - **Task** 用编号 + 可读标题。
 *
 * 一套逻辑（07-id-normalization.md）：
 * 1. 每个实体两个东西：`id`（唯一、稳定、只内部引用、**不给人看**）+ `name`（给人看、可改）；
 * 2. id 形态由「**会不会进 URL**」决定，只有两种 kind：
 *    - `url`：会进 URL → 必须 ASCII（Agent / Project / User）；
 *    - `fs` ：只在文件系统里遍历、不进 URL → 可读名（Task 目录名）；
 * 3. **不再静默生成随机后缀**：转不出 ASCII 就返回错误，让调用方要求用户给英文名。
 *    随机后缀正是"用户看不懂"的根源（`agent-3909`）。
 *
 * 注意：`fs` kind 就是现有的 `sanitizeSegment()`，没有第二套规则。
 */

/** 目录名清洗（**不进 URL** 的实体用：Task 目录名 / 项目目录名）：允许中文。 */
export function sanitizeSegment(name: string): string {
  const cleaned = name
    .replace(/[\/\:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^[.\-]+|[.\-]+$/g, "")
    .slice(0, 60);
  return cleaned === "" ? "unnamed" : cleaned;
}

/** `url` kind 的合法 id：小写 ASCII，仅字母数字与连字符（与 Agent 既有规则一致）。 */
const URL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type IdKind = "url" | "fs";
export type EntityIdResult =
  | { ok: true; id: string; /** 是否由用户的名字直接得出（false = 名字不可转，需要人给英文名） */ derived: boolean }
  | { ok: false; reason: "needs_ascii_name"; message: string };

/**
 * 生成实体 id。
 *
 * `kind = "url"`（Agent / Project / User）：
 * - 全 ASCII 名字 → 转小写、非字母数字折成 `-`；
 * - 纯数字 / 空 / 含中文等非 ASCII → **失败**，提示调用方要么让用户给英文/拼音名，
 *   要么由创建界面把 id 作为可见字段让用户确认（推荐：id 由用户参与决定，就不是黑盒）。
 *
 * `kind = "fs"`（Task 目录名等）：直接 `sanitizeSegment`。
 */
export function entityId(name: string, kind: IdKind): EntityIdResult {
  const trimmed = (name ?? "").trim();
  if (kind === "fs") return { ok: true, id: sanitizeSegment(trimmed), derived: true };

  if (trimmed === "") {
    return { ok: false, reason: "needs_ascii_name", message: "名字为空，无法生成 id" };
  }
  // eslint-disable-next-line no-control-regex
  const hasNonAscii = /[^\x00-\x7F]/.test(trimmed);
  if (hasNonAscii) {
    return {
      ok: false,
      reason: "needs_ascii_name",
      message: `"${trimmed}" 含非 ASCII 字符（如中文），无法生成 URL 安全的 id。请给一个英文或拼音名字（id 一旦生成就稳定，改名不变）。`,
    };
  }
  const base = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  if (base === "" || !URL_ID.test(base)) {
    return {
      ok: false,
      reason: "needs_ascii_name",
      message: `"${trimmed}" 转不出合法 id（需要以字母数字开头、只含字母数字与连字符）。请给一个英文或拼音名字。`,
    };
  }
  return { ok: true, id: base, derived: true };
}

/** `url` kind 的 id 校验（读侧用：判断一个已有目录名是否合法）。 */
export function isUrlSafeId(id: string): boolean {
  return URL_ID.test(id);
}

/**
 * 在已占用的 id 集合里取一个不冲突的（同名加 `-2`、`-3`）。
 * 与 `projects.ts` 的 `uniqueSegment` 同一语义，但**由调用方给集合**（纯函数，可穷举测）。
 */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base.slice(0, 58)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
