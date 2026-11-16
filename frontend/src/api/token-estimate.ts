/**
 * Token 估算（对齐 Pi Web 的既有做法，不另发明）：
 * `pi-web/components/MessageView.tsx` 的 estimateTokens —— CJK 约 1 token/字，其余约 4 字符/token。
 * 用途：单块 token 的**相对分布**；总量一律用 provider 回报的真实 `usage`，并用真实值归一化。
 */
const CJK = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}\uac00-\ud7af]/u;

export function estimateTokens(text: string): number {
  let cjk = 0;
  let rest = 0;
  for (const char of text) {
    if (CJK.test(char)) cjk += 1;
    else rest += 1;
  }
  return Math.round(cjk + rest / 4);
}

/**
 * 把若干块的估算值归一到真实总量。
 * 护栏：只有估算与真实在同一量级（0.5×–2×）才缩放——provider 有时只报可见输出，
 * 硬缩放会把"思考 200 字"算成 3 token，反而误导。
 */
export function normalizeTo(total: number, estimates: number[]): number[] {
  const sum = estimates.reduce((acc, value) => acc + value, 0);
  if (sum === 0) return estimates.map(() => 0);
  if (total <= 0) return estimates;
  const ratio = total / sum;
  if (ratio < 0.5 || ratio > 2) return estimates;   // 不同量级 → 保留估算，调用方标「≈」
  const factor = ratio;
  const scaled = estimates.map((value) => Math.round(value * factor));
  // 把四舍五入的零头补到最后一块，保证加总 == 真实值
  const diff = total - scaled.reduce((acc, value) => acc + value, 0);
  if (scaled.length > 0) scaled[scaled.length - 1] = Math.max(0, (scaled[scaled.length - 1] ?? 0) + diff);
  return scaled;
}

/** 估算值与真实总量是否同量级（不同量级时 UI 要给「≈」而不是假装精确）。 */
export function isSameScale(total: number, estimates: number[]): boolean {
  const sum = estimates.reduce((acc, value) => acc + value, 0);
  if (sum === 0 || total <= 0) return false;
  const ratio = total / sum;
  return ratio >= 0.5 && ratio <= 2;
}

export function formatTokens(value: number): string {
  return value >= 10000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return "—";
  const percent = (part / whole) * 100;
  if (percent > 0 && percent < 0.1) return "<0.1%";
  return `${percent.toFixed(percent >= 10 ? 0 : 1)}%`;
}
