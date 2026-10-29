// 请求体上限解析（Task 0012 · P1）：把"这次能发多大的 body"变成数据，而不是常量。
//
// 三层优先级（02-design §3.4）：
//   1. model.inputLimits.maxRequestBytes      —— 显式声明（Pi 原生位置）
//   2. config/payload-limits.json 的 provider 默认 —— Life OS 自己的配置（D5；Pi 没有 provider 级 inputLimits）
//   3. state/payload-limits.json 的观测值      —— 只有失败过才知道的墙（上界 ×0.8）
//   4. 都没有                                  —— undefined（不启用淘汰，回落到 token 压缩）
//
// 硬规则：本文件不出现任何 provider 名、不出现具体网关数值（数字只允许出现在常量表达式里）。
//
// 单位一律用**十进制字节**，与网关 413 文案（"3.5 MB"）和文档里的 MB 对齐；
// 不用 KiB，否则 3.5MB 减两个 512KiB 会得到 2.34MB，与已拍板的 2.5MB 对不上。

/** 我方固定开销预算：系统提示 + 工具 schema + 文本 + JSON 转义（实测 ≈0.35MB，留 0.5MB）。 */
export const RESERVE_BYTES = 500_000;
/** 安全垫：不把 trigger 顶到上限。 */
export const SLACK_BYTES = 500_000;
/**
 * 迟滞带宽（产品参数，与 provider 无关）：一轮"看图评审"通常新增的图量。
 * 带宽固定 ⇒ 网关越大只会淘汰越少，不会淘汰更频繁。
 */
export const BAND_BYTES = 1_300_000;
/** 最近几张永不淘汰：当前版 + 上一版。 */
export const KEEP_RECENT_IMAGES = 2;

export type LimitSource = "model" | "provider" | "observed";

export type PayloadLimit = { maxRequestBytes: number; source: LimitSource };

export type Budget = {
  /** 解析出的请求体上限（字节） */
  limit: number;
  source: LimitSource;
  triggerBytes: number;
  targetBytes: number;
  /** 硬线 = limit − reserve：保护可以拖延淘汰，但**不能越过它**（02-design §4.2 R5 修订） */
  hardBytes: number;
  keepRecent: number;
  /** 上限小到连 reserve+slack+band 都装不下：淘汰无法回到安全区，需要人工调参而不是静默降级 */
  undersized: boolean;
};

export type PayloadLimitsConfig = {
  schemaVersion: 1;
  providers: Record<string, { maxRequestBytes?: number }>;
};

/**
 * 观测值。只用两条事实：
 * - 成功发出去过 → 上限 ≥ 该字节数（下界，用于解释"为什么这次没触发"）
 * - 被拒过 → 上限 ≤ 该字节数（上界，用于推算出可用值）
 */
export type PayloadLimitsState = {
  schemaVersion: 1;
  observed: Record<string, { maxBodyBytes?: number; minRejectedBytes?: number; updatedAt?: string }>;
};

const emptyConfig = (): PayloadLimitsConfig => ({ schemaVersion: 1, providers: {} });
const emptyState = (): PayloadLimitsState => ({ schemaVersion: 1, observed: {} });

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 解析 config/payload-limits.json；坏输入一律当空（不猜、不抛）。 */
export function parseConfig(raw: unknown): PayloadLimitsConfig {
  if (!isRecord(raw) || !isRecord(raw.providers)) return emptyConfig();
  const providers: PayloadLimitsConfig["providers"] = {};
  for (const [id, entry] of Object.entries(raw.providers)) {
    if (id === "" || !isRecord(entry)) continue;
    const limit = positiveInt(entry.maxRequestBytes);
    if (limit !== undefined) providers[id] = { maxRequestBytes: limit };
  }
  return { schemaVersion: 1, providers };
}

/** 解析 state/payload-limits.json；坏输入一律当空。 */
export function parseState(raw: unknown): PayloadLimitsState {
  if (!isRecord(raw) || !isRecord(raw.observed)) return emptyState();
  const observed: PayloadLimitsState["observed"] = {};
  for (const [id, entry] of Object.entries(raw.observed)) {
    if (id === "" || !isRecord(entry)) continue;
    const maxBodyBytes = positiveInt(entry.maxBodyBytes);
    const minRejectedBytes = positiveInt(entry.minRejectedBytes);
    if (maxBodyBytes === undefined && minRejectedBytes === undefined) continue;
    observed[id] = {
      ...(maxBodyBytes !== undefined ? { maxBodyBytes } : {}),
      ...(minRejectedBytes !== undefined ? { minRejectedBytes } : {}),
      ...(typeof entry.updatedAt === "string" ? { updatedAt: entry.updatedAt } : {}),
    };
  }
  return { schemaVersion: 1, observed };
}

/** 观测上界 ×0.8：留 20% 余量，避免贴着墙反复触发。 */
export function observedLimit(entry: PayloadLimitsState["observed"][string] | undefined): number | undefined {
  const rejected = entry?.minRejectedBytes;
  if (rejected === undefined) return undefined;
  return Math.floor(rejected * 0.8);
}

/**
 * 拒绝观测的有效期。hermes 用"413 就压缩到能发"的每次动作解决，我们用观测值收紧——
 * 但网关/套餐会变，**过期的拒绝必须作废**，否则升级后会被旧观测永久压小（02-design §4.2 R7）。
 */
export const OBSERVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 该 provider 是否还有"新鲜"的拒绝观测（决定要不要用来收紧上限）。 */
export function hasFreshRejection(
  entry: PayloadLimitsState["observed"][string] | undefined,
  now: number = Date.now(),
): boolean {
  if (entry?.minRejectedBytes === undefined) return false;
  const at = entry.updatedAt === undefined ? Number.NaN : Date.parse(entry.updatedAt);
  // 没写时间戳 = 手工写的观测（写盘路径总会带时间戳）→ 视为新鲜，用户的手改要生效
  return !Number.isFinite(at) || now - at <= OBSERVATION_TTL_MS;
}

/**
 * 三层解析。返回 undefined = 没有任何来源 ⇒ 不启用淘汰（宁可回落到 token 压缩，也不猜）。
 * `modelLimit` 传 0 或负数视为未声明。
 */
export function resolveLimit(input: {
  modelLimit?: number | undefined;
  providerId: string;
  config?: PayloadLimitsConfig;
  state?: PayloadLimitsState;
  /** 注入时间点，便于测试观测 TTL */
  now?: number;
}): PayloadLimit | undefined {
  const config = input.config ?? emptyConfig();
  const state = input.state ?? emptyState();
  const entry = state.observed[input.providerId];
  // **事实优先于声明**：真实被拒过是事实，声明只是预期。新鲜的拒绝观测**只收紧、不放松**，
  // 哪怕上限来自模型/配置（否则"声明了 3.5MB 却撞了 413"这条自救链永远走不通）。
  const fromObserved = hasFreshRejection(entry, input.now) ? observedLimit(entry) : undefined;

  const fromModel = positiveInt(input.modelLimit);
  if (fromModel !== undefined) {
    return fromObserved !== undefined && fromObserved < fromModel
      ? { maxRequestBytes: fromObserved, source: "observed" }
      : { maxRequestBytes: fromModel, source: "model" };
  }

  const fromProvider = positiveInt(config.providers[input.providerId]?.maxRequestBytes);
  if (fromProvider !== undefined) {
    return fromObserved !== undefined && fromObserved < fromProvider
      ? { maxRequestBytes: fromObserved, source: "observed" }
      : { maxRequestBytes: fromProvider, source: "provider" };
  }

  if (fromObserved !== undefined) return { maxRequestBytes: fromObserved, source: "observed" };
  return undefined;
}

/**
 * 由上限推导迟滞预算（02-design §3.4）：
 *   trigger = limit − reserve − slack
 *   target  = trigger − band
 * `undersized` = 上限连 reserve+slack+band 都放不下：此时 target 取 0（只保留最近几张），并让调用方告警。
 */
export function deriveBudget(limit: PayloadLimit): Budget {
  const triggerBytes = Math.max(0, limit.maxRequestBytes - RESERVE_BYTES - SLACK_BYTES);
  const targetBytes = Math.max(0, triggerBytes - BAND_BYTES);
  return {
    limit: limit.maxRequestBytes,
    source: limit.source,
    triggerBytes,
    targetBytes,
    hardBytes: Math.max(0, limit.maxRequestBytes - RESERVE_BYTES),
    keepRecent: KEEP_RECENT_IMAGES,
    undersized: targetBytes === 0 && triggerBytes < BAND_BYTES,
  };
}

/** 一步到位：解析 + 推导。无来源 → undefined。 */
export function resolveBudget(input: {
  modelLimit?: number | undefined;
  providerId: string;
  config?: PayloadLimitsConfig;
  state?: PayloadLimitsState;
  now?: number;
}): Budget | undefined {
  const limit = resolveLimit(input);
  return limit === undefined ? undefined : deriveBudget(limit);
}

/** 记账（P3 起在真实请求出结果时调用）：成功记下界，被拒记上界。纯函数，返回新的 state。 */
export function recordObservation(
  state: PayloadLimitsState,
  event: { providerId: string; bodyBytes: number; outcome: "ok" | "too_large"; at?: string },
): PayloadLimitsState {
  const bytes = positiveInt(event.bodyBytes);
  if (bytes === undefined || event.providerId === "") return state;
  const prev = state.observed[event.providerId] ?? {};
  const next = event.outcome === "ok"
    // 成功发出去的比"曾经被拒的"还大 → 那堵墙已经不在了（网关换了/套餐变了），拒绝记录作废
    ? {
        ...(prev.minRejectedBytes !== undefined && bytes >= prev.minRejectedBytes ? {} : { minRejectedBytes: prev.minRejectedBytes }),
        maxBodyBytes: Math.max(prev.maxBodyBytes ?? 0, bytes),
      }
    : { ...prev, minRejectedBytes: Math.min(prev.minRejectedBytes ?? Number.MAX_SAFE_INTEGER, bytes) };
  return {
    schemaVersion: 1,
    observed: { ...state.observed, [event.providerId]: { ...next, updatedAt: event.at ?? new Date().toISOString() } },
  };
}

// ===== 文件读取（唯一与 IO 有关的入口；解析仍是纯函数） =====

/** 配置文件名（家目录下）：provider 级默认，用户/我们手写，不进仓库。 */
export const CONFIG_RELATIVE_PATH = "config/payload-limits.json";
/** 观测状态文件名（家目录下）：我们写，随真实请求收敛。 */
export const STATE_RELATIVE_PATH = "state/payload-limits.json";

/** 读一个 JSON 文件；不存在或坏了都当"没有"（不抛：配置缺失不应让会话不可用）。 */
async function readJsonFile(path: string): Promise<unknown> {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** 读家目录下的配置与观测值（一次读两个文件，坏文件各自当空）。 */
export async function readLimits(home: string): Promise<{ config: PayloadLimitsConfig; state: PayloadLimitsState }> {
  const { join } = await import("node:path");
  const [config, state] = await Promise.all([
    readJsonFile(join(home, CONFIG_RELATIVE_PATH)),
    readJsonFile(join(home, STATE_RELATIVE_PATH)),
  ]);
  return { config: parseConfig(config), state: parseState(state) };
}

/** 把一次观测落到 state 文件（原子写）；没有变化就不写（避免每回合都动盘）。 */
export async function recordObservedToFile(
  home: string,
  event: { providerId: string; bodyBytes: number; outcome: "ok" | "too_large"; at?: string },
): Promise<"written" | "unchanged" | "skipped"> {
  if (event.providerId === "") return "skipped";
  const { state } = await readLimits(home);
  const next = recordObservation(state, event);
  if (JSON.stringify(next) === JSON.stringify(state)) return "unchanged";
  const { writeTextAtomic } = await import("./atomic-file.ts");
  const { join } = await import("node:path");
  await writeTextAtomic(join(home, STATE_RELATIVE_PATH), `${JSON.stringify(next, null, 2)}\n`);
  return "written";
}
