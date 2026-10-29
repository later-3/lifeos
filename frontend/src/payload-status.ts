/**
 * 请求体字节 → 状态条文案（Task 0012 · P5）。
 *
 * 为什么要有：界面一直只有"上下文百分比"，而 413 是**字节**撞的墙——13.8% 的会话照样发不出去。
 * 这个数字必须与"上下文 %"并列，且**上限未知时只显示用量**（不编分母）。
 *
 * 纯函数：不读 DOM、不取时间，便于单测（test/payload-status.test.mjs）。
 */
export type PayloadStat = { estimated: number; limit: number | null };

/** 十进制单位，与网关 413 文案（"3.5 MB"）和文档中的 MB 一致。 */
export function formatPayloadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0";
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)}KB`;
  return `${Math.round(bytes)}B`;
}

/** 状态条要显示的值：有上限 `1.9/3.0MB`，没上限 `1.9MB`，没有数据 undefined。 */
export function payloadStatusText(payload: PayloadStat | undefined): string | undefined {
  if (payload === undefined) return undefined;
  const used = payload.estimated;
  if (!Number.isFinite(used) || used <= 0) return undefined;
  const limit = payload.limit;
  if (limit === null || !Number.isFinite(limit) || limit <= 0) return formatPayloadBytes(used);
  return `${formatPayloadBytes(used)}/${formatPayloadBytes(limit)}`;
}
