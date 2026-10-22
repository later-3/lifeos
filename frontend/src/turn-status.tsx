import { IconInfoCircle } from "@tabler/icons-react";
import { WorkingRow } from "./Message";
import { IconButton } from "./design/ui";
import { useToast } from "./design/toast";
import type { Phase } from "./stream-blocks";
import { compactTokens, type TurnStep } from "./working";

type Retry = { attempt: number; maxAttempts: number; delayMs: number; message: string; startedAt: number };
type Metrics = { output: number; ttftSeconds: number; tokPerSecond: number };
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; totalTokens: number };
type Context = { percent: number | null; window: number };

/** 单个指标：符号与数值必须是同一组，内部 4px，不允许贴死。 */
function StatusMetric({ symbol, value, label, title, tone = "text-ink-500" }: {
  symbol: string; value: string; label: string; title: string; tone?: string;
}) {
  return (
    <span data-status-metric data-label={label} title={title}
      className="inline-flex items-center gap-1 tabular-nums">
      <span data-status-icon aria-hidden="true" className={tone}>{symbol}</span>
      <span data-status-value>{value}</span>
    </span>
  );
}

/**
 * 统一状态条：左侧本轮步骤/阶段/耗时，右侧紧凑指标。
 * 间距层级：图标↔数值 4px；输入↔输出 8px；不同指标组 12px。
 * 符号均有 tooltip；参考 Codex/Claude/Gemini status line、LobeHub TokenTag、Pi TUI footer。
 */
export function TurnStatusBar({ busy, step, phase, activeTool, retry, status, metrics, usage, context }: {
  busy: boolean;
  step: TurnStep;
  phase: Phase;
  activeTool?: string;
  retry?: Retry;
  status?: { text: string };
  metrics?: Metrics;
  usage?: Usage;
  context?: Context | null;
}) {
  const toast = useToast();
  const hasUsage = usage !== undefined && usage.totalTokens > 0;
  if (!busy && status === undefined && metrics === undefined && !hasUsage) return null;
  return (
    <div className="mx-auto flex min-h-7 w-full max-w-reading flex-wrap items-center gap-x-3 gap-y-1"
      data-testid="turn-status-content"
      title="↑ 会话输入 tokens · ↓ 会话输出 tokens · ◔ 上下文占用 · ⚡ 上一轮输出速度">
      <div className="flex min-w-0 flex-wrap items-center">
        {busy ? (
          <WorkingRow step={step} phase={phase} {...(activeTool !== undefined ? { activeTool } : {})} {...(retry !== undefined ? { retry } : {})} />
        ) : status !== undefined ? (
          <span className="text-meta text-ink-500" data-testid="turn-status">{status.text}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-ink-500">
        {metrics !== undefined && (
          <StatusMetric symbol="⚡"
            value={`${metrics.tokPerSecond.toFixed(1)} tok/s`} label="速度"
            title={`上一轮输出速度；输出 ${compactTokens(metrics.output)} tokens${metrics.ttftSeconds > 0 ? `，首字 ${metrics.ttftSeconds.toFixed(1)}s` : ""}`} />
        )}
        {hasUsage && (
          <span className="inline-flex items-center gap-2" data-status-group="tokens">
            <StatusMetric symbol="↑" value={compactTokens(usage.input)} label="输入" title="会话累计输入 tokens" />
            <StatusMetric symbol="↓" value={compactTokens(usage.output)} label="输出" title="会话累计输出 tokens" />
          </span>
        )}
        {context !== undefined && context !== null && context.window > 0 && (
          <StatusMetric symbol="◔"
            value={context.percent === null ? "?" : `${context.percent.toFixed(1)}%`} label="上下文"
            title={`上下文占用 ${context.percent === null ? "未知" : `${context.percent.toFixed(1)}%`} / ${compactTokens(context.window)}`} />
        )}
        <IconButton label="状态条说明" size="sm"
          onClick={() => toast("↑ 输入 tokens · ↓ 输出 tokens · ◔ 上下文占用 · ⚡ 上一轮输出速度")}>
          <IconInfoCircle size={14} />
        </IconButton>
      </div>
    </div>
  );
}
