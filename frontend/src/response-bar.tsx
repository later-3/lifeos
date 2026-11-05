/**
 * ResponseBar（Task 0008 · P3）—— 一轮回复的**元信息条**：正文下方，固定不被冲掉。
 *
 * 用户 2026-11-04 定的形态：
 *  - "每个 agent 的回复就有两个关联的信息，一个是 response bar，一个是标记信息 bar"；
 *  - 与头像**同时出现**（用户发消息的瞬间，不等第一个块）；
 *  - **不被思考和工具调用冲掉**（ProcessBar 原来挂在正文之前，流式时位置被推着走）；
 *  - 等待回复时有**呼吸效果**；
 *  - TurnStatusBar 的时间/token/速度等指标**挪进来，不重复**（底部 dock 不再是状态区）；
 *  - 折叠状态**按 session 持久**（"只要折叠了就一直折叠……不要一会儿开一会儿关"）。
 *
 * 与旧组件的关系：
 *  - `ProcessBar`：过程展开区（children）保留，但它从"正文之前"移到 ResponseBar **内部**；
 *  - `TurnStatusBar`：指标渲染搬进来；底部 composer dock 不再渲染它。
 */

import { useId } from "react";
import { IconChevronRight, IconInfoCircle } from "@tabler/icons-react";
import { IconButton } from "./design/ui";
import { useToast } from "./design/toast";
import { processDetail, processSummary, type ProcessStats } from "./process-stats";
import { processOpenOf } from "./response-fold";
import { payloadStatusText, type PayloadStat } from "./payload-status";
import { WorkingRow } from "./working-row";
import type { Phase } from "./stream-blocks";
import { compactTokens, type TurnStep } from "./working";

/** 与 TurnStatusBar 相同的指标形状（直接搬过来，避免跨组件耦合）。 */
type Retry = { attempt: number; maxAttempts: number; delayMs: number; message: string; startedAt: number };
type Metrics = { output: number; ttftSeconds: number; tokPerSecond: number };
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; totalTokens: number };
type Context = { percent: number | null; window: number };

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

export type ResponseBarProps = {
  /** 过程统计（工具/思考）；`undefined` = 纯聊天轮（没有可折叠的过程，只显示指标行）。 */
  stats?: ProcessStats;
  /** 这一轮还在跑：live 时 bar 显示进行中状态。 */
  live?: boolean;
  /** 等待首个回复块（用户刚发消息）：呼吸态。 */
  waiting?: boolean;
  /** 过程展开区（工具/思考块）。 */
  children?: React.ReactNode;
  /** ── 从 TurnStatusBar 挪进来的指标 ── */
  step?: TurnStep;
  phase?: Phase;
  activeTool?: string;
  retry?: Retry;
  status?: { text: string };
  metrics?: Metrics;
  usage?: Usage;
  context?: Context | null;
  payload?: PayloadStat;
  turnId?: string;
  /**
   * 过程区的展开态（受控，per-session 持久由调用方做——sessionId 在 App 层才有）。
   * undefined = 未受控，内部用 live 决定（旧 ProcessBar 行为）。
   */
  processOpen?: boolean;
  onToggleProcess?: () => void;
};

export function ResponseBar({
  stats, live = false, waiting = false, children,
  step, phase, activeTool, retry, status, metrics, usage, context, payload, turnId,
  processOpen, onToggleProcess,
}: ResponseBarProps) {
  const panelId = useId();
  const toast = useToast();
  // 受控优先；未受控（组件单独使用时）回落到 live
  const open = processOpen ?? processOpenOf(undefined, live);
  const hasUsage = usage !== undefined && usage.totalTokens > 0;
  const hasProcess = stats !== undefined && (stats.tools > 0 || stats.thinking > 0);
  const summary = stats !== undefined ? processSummary(stats) : "";

  const busy = live || waiting;
  const payloadText = payloadStatusText(payload);
  const hasMetrics = metrics !== undefined || hasUsage || payloadText !== undefined
    || (context !== undefined && context !== null && context.window > 0);
  // 什么都不显示时**不渲染空壳**（空就是空，不留 28px 的空白行 —— 用户 2026-11-04：
  // "你不要画蛇添足"）。纯聊天轮、且不是最后一条（无会话指标）→ 这里返回 null。
  if (!hasProcess && !hasMetrics && !busy && status === undefined && (turnId === undefined || turnId === "")) return null;

  return (
    <div data-testid="response-bar"
      className={waiting ? "rounded-panel motion-safe:animate-response-waiting" : "rounded-panel"}>
      {/* 主行：过程摘要（左） + 指标（右）。等待时显示呼吸的"正在等待回复"。 */}
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 py-1"
        title={stats !== undefined ? processDetail(stats)
          : "↑ 会话输入 tokens · ↓ 会话输出 tokens · ◔ 上下文占用 · ⚡ 上一轮输出速度"}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {/* 左区按"当下最要紧"排一个：等待 → 进行中 → 回合结论文案；过程摘要是常驻入口，可与它们并存 */}
          {waiting ? (
            <span data-testid="response-waiting" className="text-meta text-ink-500">正在等待回复…</span>
          ) : busy ? (
            <span className="min-w-0">
              <WorkingRow step={step ?? 1} phase={phase ?? "waiting"} {...(activeTool !== undefined ? { activeTool } : {})} {...(retry !== undefined ? { retry } : {})} />
            </span>
          ) : status !== undefined ? (
            <span data-testid="turn-status" className="text-meta text-ink-500">{status.text}</span>
          ) : null}
          {hasProcess ? (
            <button type="button"
              aria-expanded={open}
              aria-controls={panelId}
              title={processDetail(stats)}
              onClick={onToggleProcess}
              /* 命中区 ≥28（闸 3）：文字行只有 18px，靠 min-h-7 顶到 28；触屏 44 保底同 ProcessBar */
              className="group flex min-h-7 items-center gap-1.5 text-left text-meta text-ink-500 transition-colors hover:text-ink-900 max-sm:min-h-11">
              <IconChevronRight size={13} aria-hidden="true"
                className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
              <span data-testid="response-summary" className="min-w-0 truncate tabular-nums">{summary}</span>
              <span className="shrink-0 whitespace-nowrap text-micro text-ink-500 group-hover:text-ink-700">
                {open ? "收起过程" : "查看过程"}
              </span>
            </button>
          ) : null}
          {turnId !== undefined && turnId !== "" && (
            <span data-testid="turn-id" title={turnId}
              className="inline-flex cursor-copy items-center text-meta tabular-nums text-ink-500"
              onClick={() => { void navigator.clipboard?.writeText(turnId).catch(() => undefined); }}>
              #{turnId.replace("turn-", "").slice(-6)}
            </span>
          )}
        </div>
        <div data-shot-mask="response-metrics" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-ink-500">
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
          {payloadText !== undefined && (
            <StatusMetric symbol="▲" value={payloadText} label="请求体"
              title={`本轮请求体 ${payloadText}（含历史图片；超过上限会被网关 413 拒绝）`} />
          )}
          {context !== undefined && context !== null && context.window > 0 && (
            <StatusMetric symbol="◔"
              value={context.percent === null ? "?" : `${context.percent.toFixed(1)}%`} label="上下文"
              title={`上下文占用 ${context.percent === null ? "未知" : `${context.percent.toFixed(1)}%`} / ${compactTokens(context.window)}`} />
          )}
          {hasMetrics && (
            <IconButton label="状态条说明" size="sm"
              onClick={() => toast("↑ 输入 tokens · ↓ 输出 tokens · ◔ 上下文占用 · ⚡ 上一轮输出速度")}>
              <IconInfoCircle size={14} />
            </IconButton>
          )}
        </div>
      </div>
      {/* 过程展开区（原 ProcessBar 的 children：工具/思考块，live 时展开） */}
      {hasProcess && open && (
        <div id={panelId} data-testid="process-body" className="flex flex-col gap-2 pt-1 pb-1">
          {children}
        </div>
      )}
    </div>
  );
}
