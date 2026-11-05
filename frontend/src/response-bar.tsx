/**
 * ResponseBar（Task 0008 · P3）—— 一轮回复的**过程入口**，在正文**上方**（与主线的 ProcessBar 同位置）。
 *
 * 用户 2026-11-05 修正了 P3 第一版的位置：
 * > "我还是希望像现在这样 response bar 是在正式回复**上面**的，就跟我们当前的主线的页面一样。
 * >  而在正式回复**下面**的是 markbar"
 *
 * 所以：`header → ResponseBar → 正文 → MarkBar`。
 * 会话级的**累计**指标（轮次/工具/耗时/token/平均速度/上下文/请求体）不在这里，
 * 归输入框上方的 `SessionBar`（原来叫 TurnStatusBar，用户要求改名）；
 * 这里只说**这一轮**发生了什么：几次工具、多久、多少 token，点开看完整过程。
 *
 * 用户 2026-11-04 的其余要求仍然成立：
 *  - 与头像**同时出现**（占位消息就有它，不必等第一个块）；
 *  - **不被思考和工具调用冲掉**（过程块渲染在 bar 内部，bar 自己的位置不动）；
 *  - 等待回复时有**呼吸效果**；
 *  - 折叠状态**按 session 持久**（"只要折叠了就一直折叠……不要一会儿开一会儿关"）。
 */

import { useId } from "react";
import { IconChevronRight } from "@tabler/icons-react";
import { processDetail, processSummary, type ProcessStats } from "./process-stats";
import { processOpenOf } from "./response-fold";
import { WorkingRow } from "./working-row";
import type { Phase } from "./stream-blocks";
import type { TurnStep } from "./working";

/** 重试倒计时（与 `working.ts` 的 retryRemainingSeconds 同源）。 */
type Retry = { attempt: number; maxAttempts: number; delayMs: number; message: string; startedAt: number };

export type ResponseBarProps = {
  /** 过程统计（工具/思考）；`undefined` = 纯聊天轮（没有可折叠的过程）。 */
  stats?: ProcessStats;
  /** 这一轮还在跑。 */
  live?: boolean;
  /** 等待首个回复块（用户刚发消息）：呼吸态。 */
  waiting?: boolean;
  /** 过程展开区（工具/思考块）。 */
  children?: React.ReactNode;
  /** 进行中的步骤/阶段（只有 live 时有意义）。 */
  step?: TurnStep;
  phase?: Phase;
  activeTool?: string;
  retry?: Retry;
  /** 回合结论文案（对账成功、中断原因等）。 */
  status?: { text: string };
  /**
   * 过程区的展开态（受控，per-session 持久由调用方做——sessionId 在 App 层才有）。
   * `undefined` = 未受控，内部按 live 决定。
   */
  processOpen?: boolean;
  onToggleProcess?: () => void;
};

export function ResponseBar({
  stats, live = false, waiting = false, children,
  step, phase, activeTool, retry, status, processOpen, onToggleProcess,
}: ResponseBarProps) {
  const panelId = useId();
  // 受控优先；未受控（组件单独使用时）回落到 live
  const open = processOpen ?? processOpenOf(undefined, live);
  const hasProcess = stats !== undefined && (stats.tools > 0 || stats.thinking > 0);
  const summary = stats !== undefined ? processSummary(stats) : "";
  const busy = live || waiting;

  // 什么都没有就不渲染（空就是空，不留一条 28px 的空白行 —— 用户 2026-11-04："不要画蛇添足"）
  if (!hasProcess && !busy && status === undefined) return null;

  return (
    <div data-testid="response-bar"
      className={waiting ? "rounded-panel motion-safe:animate-response-waiting" : "rounded-panel"}>
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 py-1"
        {...(stats !== undefined ? { title: processDetail(stats) } : {})}>
        {/* 左区按"当下最要紧"排一个：等待 → 进行中 → 回合结论文案；过程摘要是常驻入口，可与它们并存 */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {waiting ? (
            <span data-testid="response-waiting" className="text-meta text-ink-500">正在等待回复…</span>
          ) : live ? (
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
              /* 命中区 ≥28（闸 3）：文字行只有 18px，靠 min-h-7 顶到 28；触屏 44 保底同旧 ProcessBar */
              className="group flex min-h-7 items-center gap-1.5 text-left text-meta text-ink-500 transition-colors hover:text-ink-900 max-sm:min-h-11">
              <IconChevronRight size={13} aria-hidden="true"
                className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
              <span data-testid="response-summary" className="min-w-0 truncate tabular-nums">{summary}</span>
              <span className="shrink-0 whitespace-nowrap text-micro text-ink-500 group-hover:text-ink-700">
                {open ? "收起过程" : "查看过程"}
              </span>
            </button>
          ) : null}
        </div>
      </div>
      {/* 过程展开区（工具/思考块）：在 bar **内部**，所以 bar 自己不会被它们挤走 */}
      {hasProcess && open && (
        <div id={panelId} data-testid="process-body" className="flex flex-col gap-2 pb-2">
          {children}
        </div>
      )}
    </div>
  );
}
