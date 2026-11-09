/**
 * 工作指示行（"正在干什么"）—— Task 0008 · P3 从 `Message.tsx` 抽出来。
 *
 * 为什么抽：P3 把它从底部状态条搬进 ResponseBar，而 ResponseBar 又被 `Message.tsx` import。
 * 留在 Message.tsx 里就形成 `Message → ResponseBar → Message` 的**循环依赖**
 * （ESM 能跑，但热更新与 tree-shaking 会把模块初始化顺序变成隐式契约，随时炸）。
 * 抽成叶子模块后依赖是单向的：Message → ResponseBar → working-row。
 */
import { useEffect, useRef, useState } from "react";
import { Spinner } from "./design/ui";
import type { Phase } from "./stream-blocks";
import { elapsedSeconds, retryRemainingSeconds, turnStepText, type TurnStep } from "./working";

/** 秒表：整轮生成期间每秒 +1（只在工作指示行里用，卸载即停）。
 *
 * `startedAtMs`（Task 0015 · P3）：本轮的**开始时刻**（服务端 `running[].startedAt` 或本会话发起时的时刻）。
 * 不给 = 组件**挂载时刻**（ResponseBar 的行为不变：从 0 数起）。
 * 为什么要能指定：以前切会话再切回来，秒数从 0 重数——同一个回合两个数字。
 */
function useWorkingSeconds(active: boolean, startedAtMs?: number): number {
  const mountedAt = useRef(Date.now());
  const [seconds, setSeconds] = useState(() => elapsedSeconds(startedAtMs ?? mountedAt.current));
  useEffect(() => {
    if (!active) return;
    const tick = () => setSeconds(elapsedSeconds(startedAtMs ?? mountedAt.current));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [active, startedAtMs]);
  return seconds;
}

const PHASE_LABEL: Record<Phase, string> = {
  waiting: "等待模型响应…",
  thinking: "思考中…",
  tool: "正在执行工具…",
  text: "输出中…",
};

/** 工作指示行：转圈 + 现在在干什么 + 已用秒数。 */
export function WorkingRow({ step, phase, activeTool, retry, startedAtMs }: {
  step: TurnStep;
  phase: Phase; activeTool?: string;
  retry?: { attempt: number; maxAttempts: number; delayMs: number; message: string; startedAt: number };
  /** 本轮开始时刻（毫秒时间戳）；不给 = 挂载时刻（ResponseBar 保持原行为） */
  startedAtMs?: number;
}) {
  const total = useWorkingSeconds(true, startedAtMs);
  // 状态区分（2026-10-19）：请求刚发出 = 连接中；超过 3s 还没首个事件 = 等待模型响应
  // 重试（2026-10-20）：倒计时逐秒减少（Pi CLI 的 RetryStatusIndicator 同款），不再是静态 "Ns"
  const label = retry !== undefined
    ? `模型调用失败，${retryRemainingSeconds(retry.delayMs, Date.now() - retry.startedAt)}s 后重试（${retry.attempt}/${retry.maxAttempts}）：${retry.message}`
    : phase === "tool" && activeTool !== undefined && activeTool !== "" ? `正在执行 ${activeTool}…`
    : phase === "waiting" && total < 3 ? "正在连接模型…" : PHASE_LABEL[phase];
  return (
    <div className={`flex flex-wrap items-center gap-2 py-0.5 text-meta ${retry !== undefined ? "text-danger" : "text-ink-500"}`}>
      <Spinner size={14} className={retry !== undefined ? "text-danger" : "text-accent"} />
      <span className="font-medium text-ink-700">{turnStepText(step)}</span>
      {step === 3 && <span className="animate-text-breathe">{label}</span>}
      <span className="tabular-nums text-micro text-ink-500" title="本轮耗时">{total}s</span>
    </div>
  );
}
