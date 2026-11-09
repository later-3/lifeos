/**
 * SessionBar（Task 0008 · P3 修订）—— 会话**累计**事实条，位于输入框上方（滚动区外）。
 *
 * 用户 2026-11-05 的要求：
 * > "现在的 turnstat bar，就可以把一些信息换为**累计**的信息，比如共计多少轮次，
 * >  共计多少工具调用，时间，token 消耗，平均速度，图片那个可以融入到 turnstatusbar 了，
 * >  或不叫 turnstatusbar？换一个名字。"
 *
 * 所以这里和 `TurnStatusBar` 的三点不同：
 * 1. **口径从"这一轮"换成"整个会话"**（轮次/工具调用/耗时/token/平均速度，见 `session-totals.ts`）；
 * 2. **添加图片**并进这一行（底部不再有独立的一行工具槽）；
 * 3. **改名**：`TurnStatusBar` → `SessionBar`（名字里不再有 turn —— 它已经不是回合级的了）。
 *
 * 进行中的状态（发送/受理/模型处理/工具执行/等待秒数）**不在这里**：那是回合级事实，
 * 归回复自己的 ResponseBar（在正文上方，与头像同时出现）。
 */
import { IconInfoCircle, IconPhoto } from "@tabler/icons-react";
import { IconButton } from "./design/ui";
import { useToast } from "./design/toast";
import { payloadStatusText, type PayloadStat } from "./payload-status";
import { formatDuration } from "./process-stats";
import { compactTokens } from "./working";
import type { SessionTotals } from "./session-totals";

function Metric({ symbol, value, label, title, tone = "text-ink-500" }: {
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

export type SessionBarProps = {
  totals: SessionTotals;
  /** 上下文占用（会话级） */
  context?: { percent: number | null; window: number } | null;
  /** 请求体（Task 0012 · P5）：`1.9/3.0MB`，上限未知时只显示用量 */
  payload?: PayloadStat;
  /** 最近一轮的短 id（报障=排障共用的键） */
  turnId?: string;
  /** 添加图片（用户 2026-11-05："图片那个可以融入到 turnstatusbar 了"） */
  onAttachImage?: () => void;
};

export function SessionBar({ totals, context, payload, turnId, onAttachImage }: SessionBarProps) {
  const toast = useToast();
  const payloadText = payloadStatusText(payload);
  const hasTokens = totals.tokens > 0;
  const duration = formatDuration(totals.durationMs);
  const hasAnything = totals.turns > 0 || hasTokens || duration !== undefined;

  /*
   * 没有任何指标时**整条不渲染**（2026-11-09 审核发现）：旧实现即使空会话也要占 36px，
   * 输入框上方于是飘着一条空白 + 一个孤零零的图片按钮，看着像"加载失败"。
   * 但「添加图片」不能丢（用户 2026-11-05 要求并进这一条）——所以空会话时把图片按钮
   * 交给 composer 自己（手机本来就在那儿），桌面这一条直接不出现。
   */
  const isEmpty = !hasAnything && payloadText === undefined
    && (context === undefined || context === null || context.window <= 0)
    && (turnId === undefined || turnId === "");
  if (isEmpty) return null;

  return (
    <div data-testid="session-bar" data-shot-mask="session-bar"
      className="flex min-h-7 w-full flex-wrap items-center gap-x-3 gap-y-1 py-1">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-micro text-ink-500">
        {/* 空会话不显示一堆 0：没内容就什么都不写 */}
        {/* 空会话什么都不写（用户 2026-11-04："空就是空，不要画蛇添足"），只有右侧的添加图片 */}
        {hasAnything ? (
          <>
            {totals.turns > 0 && (
              <Metric symbol="◎" value={`${totals.turns} 轮`} label="轮次"
                title={`本会话共 ${totals.turns} 轮（一条用户消息 = 一轮）`} />
            )}
            {totals.toolCalls > 0 && (
              <Metric symbol="⌗" value={`${totals.toolCalls} 次工具`} label="工具调用"
                title={`本会话累计 ${totals.toolCalls} 次工具调用`} />
            )}
            {duration !== undefined && (
              <Metric symbol="◷" value={duration} label="生成耗时"
                title={`本会话所有回复的生成耗时合计 ${duration}（不含挂机等待时间）`} />
            )}
            {hasTokens && (
              <span className="inline-flex items-center gap-2" data-status-group="tokens">
                <Metric symbol="↑" value={compactTokens(totals.input)} label="输入" title="会话累计输入 tokens（含重发的历史）" />
                <Metric symbol="↓" value={compactTokens(totals.output)} label="输出" title="会话累计输出 tokens" />
              </span>
            )}
            {totals.avgTokPerSecond !== undefined && (
              <Metric symbol="⚡" value={`${totals.avgTokPerSecond.toFixed(1)} tok/s`} label="平均速度"
                title={`会话平均输出速度 = 累计输出 tokens ÷ 累计生成耗时`} />
            )}
          </>
        ) : null}
        {payloadText !== undefined && (
          <Metric symbol="▲" value={payloadText} label="请求体"
            title={`当前请求体 ${payloadText}（含历史图片；超过上限会被网关 413 拒绝）`} />
        )}
        {context !== undefined && context !== null && context.window > 0 && (
          <Metric symbol="◔"
            value={context.percent === null ? "?" : `${context.percent.toFixed(1)}%`} label="上下文"
            title={`上下文占用 ${context.percent === null ? "未知" : `${context.percent.toFixed(1)}%`} / ${compactTokens(context.window)}`} />
        )}
        {turnId !== undefined && turnId !== "" && (
          <span data-testid="turn-id" title={turnId}
            className="inline-flex cursor-copy items-center text-micro tabular-nums text-ink-500"
            onClick={() => { void navigator.clipboard?.writeText(turnId).catch(() => undefined); }}>
            #{turnId.replace("turn-", "").slice(-6)}
          </span>
        )}
        {hasAnything && (
          <IconButton label="状态条说明" size="sm"
            onClick={() => toast("◎ 轮次 · ⌗ 工具调用 · ◷ 生成耗时合计 · ↑↓ 会话累计 tokens · ⚡ 平均输出速度 · ▲ 当前请求体 · ◔ 上下文占用")}>
            <IconInfoCircle size={14} />
          </IconButton>
        )}
      </div>
      {onAttachImage !== undefined && (
        <div data-testid="composer-tools" className="flex shrink-0 items-center gap-1">
          <IconButton label="添加图片" onClick={onAttachImage} data-testid="attach-image" className="shrink-0">
            <IconPhoto size={16} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
