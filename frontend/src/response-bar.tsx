/**
 * ResponseBar（Task 0008 · P3 创建，Task 0015 · P5 重定边界）—— 一轮回复的**过程入口**，在正文**上方**。
 *
 * 用户 2026-11-05 定了位置：
 * > "我还是希望像现在这样 response bar 是在正式回复**上面**的，就跟我们当前的主线的页面一样。
 * >  而在正式回复**下面**的是 markbar"
 * 所以：`header → ResponseBar → 正文 → MarkBar`。
 *
 * ## Task 0015 · P5（2026-11-07）为什么砍掉"进行中状态"
 *
 * 用户同一句话里给了两条要求：
 * > "response bar 里面的东西关于**动态的**东西，就是状态呈现的这一块，还是直接放到下面来吧，
 * >  放到 session bar 里面，这样也别做两套了。只是每一次 response bar **完成之后**，
 * >  他自己的信息自己给他那儿展示，在正在完成的过程当中，就还是显示在 session bar"
 * > "我们其实只是需要衔接 agent 在开始显示工具调用和思考的信息前，有一个过渡就好，不要复杂化了。
 * >  就还是做成正在等待模型回复……的呼吸效果也还可以。"
 *
 * 于是本组件只剩三件事：
 * 1. **等待过渡**：还没有任何块时，一行呼吸的「正在等待模型回复…」（衔接头像与首个工具/思考块）；
 * 2. **过程块**：工具/思考块渲染在 bar 内部（所以 bar 自己的位置不会被它们挤走）；
 * 3. **完成后的摘要**：`N 次工具 · 墙钟时长 · tokens` + 展开/收起。
 *
 * **不再有**「第几步 / 阶段文案 / 本轮秒数 / 重试倒计时」——那些统一在 `SessionBar` 的
 * 「当前回合」里（一处显示，`SessionBar` 在滚动区外，任何时候都看得见）。
 * 之前两处各有一套秒表，口径还不一样（一个用服务端 startedAt、一个用组件挂载时刻），
 * 用户截图抓到 13s vs 17s（案例 C004）—— 砍成一处就不会再漂。
 */
import { useId } from "react";
import { IconChevronRight } from "@tabler/icons-react";
import { processDetail, processSummary, type ProcessStats } from "./process-stats";
import { processOpenOf } from "./response-fold";

export type ResponseBarProps = {
  /** 过程统计（工具/思考）；`undefined` = 纯聊天轮（没有可折叠的过程）。 */
  stats?: ProcessStats;
  /** 这一轮还在跑。 */
  live?: boolean;
  /** 还没有任何块（用户刚发消息）：显示等待过渡。 */
  waiting?: boolean;
  /** 过程展开区（工具/思考块）。 */
  children?: React.ReactNode;
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
  stats, live = false, waiting = false, children, status, processOpen, onToggleProcess,
}: ResponseBarProps) {
  const panelId = useId();
  // 受控优先；未受控（组件单独使用时）回落到 live
  const open = processOpen ?? processOpenOf(undefined, live);
  const hasProcess = stats !== undefined && (stats.tools > 0 || stats.thinking > 0);
  const summary = stats !== undefined ? processSummary(stats) : "";

  // ① 等待过渡（用户 2026-11-07："衔接……有一个过渡就好"）：只有头像没有内容的空窗期
  if (waiting) {
    return (
      <div data-testid="response-bar" className="rounded-panel motion-safe:animate-response-waiting">
        <div className="flex min-h-7 items-center py-1">
          <span data-testid="response-waiting" className="text-meta text-ink-500">正在等待模型回复…</span>
        </div>
      </div>
    );
  }

  // ② 摘要行**始终存在**（它是过程的开关，生成中收起来也要能点开）。
  //    生成中它只写"几次工具"（那是过程统计，不是动态状态）；**秒数与 tokens 只在完成后写**——
  //    进行中的秒数归 SessionBar 的「当前回合」，两处都写就是 "同样的信息太多地方在显示"。
  const summaryRow = hasProcess;
  // 什么都没有就不渲染（空就是空，不留一条 28px 的空白行 —— 用户 2026-11-04："不要画蛇添足"）
  if (!hasProcess && status === undefined) return null;

  return (
    <div data-testid="response-bar" className="rounded-panel">
      {/*
        摘要行 `select-none`（Task 0013）：它是"这一轮做了几次工具、多久、多少 token"的**界面统计**，
        不是对话内容。不加的话从摘要行往下拖选会把「36 次工具 · 8 分 44 秒 · 200.2k tokens · 查看过程」
        一起复制进剪贴板（实测）。
        **只能加在这一行，不能加在根节点**：过程区 `process-body` 是根的子节点，
        加在根上会连工具/思考正文一起禁选 —— 而那正是用户要能复制的部分。
      */}
      {(summaryRow || status !== undefined) && (
        <div className="flex min-h-7 select-none flex-wrap items-center gap-x-3 gap-y-1 py-1"
          {...(hasProcess && stats !== undefined ? { title: processDetail(stats) } : {})}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {status !== undefined && (
              <span data-testid="turn-status" className="text-meta text-ink-500">{status.text}</span>
            )}
            {summaryRow ? (
              <button type="button"
                aria-expanded={open}
                aria-controls={panelId}
                title={processDetail(stats!)}
                onClick={onToggleProcess}
                /* 命中区 ≥28（闸 3）：文字行只有 18px，靠 min-h-7 顶到 28；触屏 44 保底同旧 ProcessBar */
                className="group flex min-h-7 items-center gap-1.5 text-left text-meta text-ink-500 transition-colors hover:text-ink-900 max-sm:min-h-11">
                <IconChevronRight size={14} aria-hidden="true"
                  className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
                <span data-testid="response-summary" className="min-w-0 truncate tabular-nums">{summary}</span>
                <span className="shrink-0 whitespace-nowrap text-micro text-ink-500 group-hover:text-ink-700">
                  {open ? "收起过程" : "查看过程"}
                </span>
              </button>
            ) : null}
          </div>
        </div>
      )}
      {/* 过程展开区（工具/思考块）：在 bar **内部**，所以 bar 自己不会被它们挤走 */}
      {hasProcess && open && (
        <div id={panelId} data-testid="process-body" className="flex flex-col gap-2 pb-2">
          {children}
        </div>
      )}
    </div>
  );
}
