/**
 * 过程条（ProcessBar）—— 一轮完成后，把中间过程折成**一行统计**。
 *
 * 用户 2026-11-02 拍板的三条硬约束（照做，不要加戏）：
 * 1. **不做摘要**：只数"干了多少活"，不概括"干了什么"。摘要要额外调模型，既费 token 又把事情搞复杂；
 * 2. **极轻量**：跟 TurnStatusBar 一样，没有边框、没有底色块，就是一行浅色文字；
 * 3. **跟随对话列宽**：与正文左右边缘对齐（用户 2026-11-02 拍板）。原先与卡片共用
 *    `max-w-bubble`（720px 写死），于是正文 860、过程条 720，右侧多出一截空白阶梯；
 *    现在卡片不再有独立上限，宽度只有一个来源（对话列 + 宽度滑块）。
 *
 * 与 TurnStatusBar 的分工：那个是**进行中**的回合状态（滚动区外固定），这个是**已完成**回合的
 * 过程入口（在回复顶部，点开看完整过程）。
 *
 * 参考（`reference-baseline.md` "过程折叠"行）：GitHub Copilot 的会话把每条工具调用渲染成
 * 一行"图标 + 动作 + 目标"，末尾一个 `5s`；我们**只借"轻量单行"这个形**，不逐条列工具
 * （我们的单轮工具数可达 194，逐条列等于不折叠），也不带摘要文案。
 */
import { useId, useState } from "react";
import { IconChevronRight } from "@tabler/icons-react";
import { processDetail, processSummary, type ProcessStats } from "./process-stats";

export function ProcessBar({ stats, live = false, children }: {
  stats: ProcessStats;
  /** 这一轮还在跑：过程区始终展开，跑完才折起来（用户要"流式看得到过程"） */
  live?: boolean;
  /** 展开后的完整过程（即现有的工具/思考块渲染，不复制、不改写） */
  children: React.ReactNode;
}) {
  // 用户手动点过之后就听用户的，不再被 live 强扭（与既有 useAutoOpen 语义一致）
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(live);
  const effectiveOpen = touched ? open : live || open;
  const panelId = useId();
  const summary = processSummary(stats);

  return (
    <div data-testid="process-bar">
      {/* 命中区 ≥ 28（闸 3）：仅靠自己的行高不够，用 py-2 把高度顶到 ≥28；≥44 的触屏保底交给 max-sm:min-h-11 */}
      <button type="button"
        aria-expanded={effectiveOpen}
        aria-controls={panelId}
        title={processDetail(stats)}
        onClick={() => { setTouched(true); setOpen(!effectiveOpen); }}
        className="group flex w-full items-center gap-1.5 py-2 text-left text-meta text-ink-500 transition-colors hover:text-ink-900 max-sm:min-h-11">
        <IconChevronRight size={13} aria-hidden="true"
          className={`shrink-0 transition-transform ${effectiveOpen ? "rotate-90" : ""}`} />
        <span data-testid="process-summary" className="min-w-0 truncate tabular-nums">{summary}</span>
        {/* 这是可读文字，不能用 ink-300（对比度 2.6:1 违规范）：默认 ink-500，悬停变 ink-700 */}
        <span className="shrink-0 whitespace-nowrap text-micro text-ink-500 group-hover:text-ink-700">
          {effectiveOpen ? "收起过程" : "查看过程"}
        </span>
      </button>
      {effectiveOpen && (
        <div id={panelId} data-testid="process-body" className="flex flex-col gap-2 pt-1">
          {children}
        </div>
      )}
    </div>
  );
}
