/**
 * 工作台右栏：月历（合并了热力图）+ 三项统计（Task 0023 · S1 第 3 块）。
 *
 * 数据 = `/api/days`（S1 只有 activity 有值）；**归日只用 `Day.date`**（契约 R1：
 * log 的 at 是本地零点的 UTC，从 at 反推日期会整体错一天）。四档底色 = Memos 的
 * 相对阈值（`dayLevelOf` 纯函数）；今天 = ink-900 实底白字（对比度由 token 保证）。
 *
 * 点击有内容的格 → 当日列表就地展开（条数与该格一致——同一份 `Day.activity`，两处同源）。
 * 月切换（‹ ›）由父级改 month → 重新取数。
 */
import { useState } from "react";
import { AppIcon } from "../design/icons";
import { IconButton, Skeleton } from "../design/ui";
import { AgentAvatar } from "./agent-avatar";
import { FailureNotice } from "./workbench-failure";
import { calendarCellsOf, todayLocal, type Day } from "../api/workbench";
import type { Agent } from "../hooks/types";
import type { LoadFailure } from "../api/fetch-timeout";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** 当日列表的一行：时刻（R1：new Date 本地化）+ 类别 + 文案。 */
function ActivityRow({ entry, agents }: { entry: Day["activity"][number]; agents: Agent[] }) {
  const agent = agents.find((item) => item.id === entry.agentId);
  const time = entry.kind === "session"
    ? new Date(entry.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : undefined;   // log 没有时刻（只有日期），不编
  return (
    <div className="flex items-center gap-2 px-1 py-1" data-testid="workbench-day-row">
      <span className="w-10 shrink-0 text-micro tabular-nums text-ink-500">{time ?? "·"}</span>
      <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-hover text-ink-700`}>
        <AppIcon name={entry.kind === "session" ? "message-circle" : "pencil"} size={10} />
      </span>
      <span className="min-w-0 flex-1 truncate text-micro text-ink-900" title={entry.kind === "session" ? entry.title : entry.heading}>
        {entry.kind === "session" ? entry.title : entry.heading}
      </span>
      <AgentAvatar id={entry.agentId} name={agent?.name ?? entry.agentId}
        {...(agent?.avatar !== undefined ? { avatar: agent.avatar } : {})} size={14} />
    </div>
  );
}

export function WorkbenchCalendar({ year, month, days, today, loading, onPrevMonth, onNextMonth, agents, stats, failed, onRetry }: {
  year: number;
  month: number;
  days: Day[];
  /** 今天（本地 YYYY-MM-DD；不传就现算——测试可注入固定日）。 */
  today?: string;
  /** 数据没就绪：骨架（规范 2.32；月历不写"本月没有活动"的假结论）。 */
  loading: boolean;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  agents: Agent[];
  /** 三项统计的原始计数（项目/助手/任务；undefined = 还没就绪，画占位不写 0）。 */
  stats: { projects?: number; agents?: number; tasks?: number };
  /** 装载失败且无内容：原因 + 重试（frontend 2.33；不冒充"本月没有活动"）。 */
  failed?: LoadFailure;
  onRetry?: () => void;
}) {
  const todayStr = today ?? todayLocal();
  const [openDay, setOpenDay] = useState<string | undefined>(undefined);
  const cells = calendarCellsOf(year, month, days, todayStr);
  const openItems = openDay === undefined ? [] : (days.find((day) => day.date === openDay)?.activity ?? []);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain p-3" data-testid="workbench-calendar">
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label="上个月" size="sm" onClick={onPrevMonth}><AppIcon name="chevron-left" size={14} /></IconButton>
        <span className="min-w-0 flex-1 text-center text-body font-semibold text-ink-900">{year} 年 {month + 1} 月</span>
        <IconButton label="下个月" size="sm" onClick={onNextMonth}><AppIcon name="chevron-right" size={14} /></IconButton>
      </div>
      {failed !== undefined && onRetry !== undefined ? (
        <div className="mt-2 flex min-h-40 flex-1 flex-col">
          <FailureNotice failure={failed} onRetry={onRetry} scope="days" />
        </div>
      ) : loading ? (
        <div className="mt-2" data-testid="workbench-calendar-loading"><Skeleton rows={5} /></div>
      ) : (
        <>
          <div className="mt-2 grid shrink-0 grid-cols-7 gap-0.5 text-center text-micro text-ink-500" aria-hidden="true">
            {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          {/*
            月历网格 = **一组开关按钮**（有内容的那些格是 `aria-pressed` 的 button），不是 ARIA grid。
            用 `role="grid"` 时 axe 报 `aria-required-children` **critical**：grid 的必须子元素是
            `row`（行）→ 行里再是 `gridcell`，而这里直接放的是格子，也没有行容器。
            改成 `role="group"`：它要求"一组相关控件 + 一个可访问名"，正是这里的语义，
            且不再承诺行/格子结构（读屏会把每格当独立按钮念）。
            （Task 0023 · 终审 P1-B；实测 axe `aria-required-children` critical 1 处 → 0。）
          */}
          <div className="mt-1 grid shrink-0 grid-cols-7 gap-0.5" role="group"
            data-testid="workbench-calendar-grid"
            aria-label={`${year} 年 ${month + 1} 月活动日历（有内容的日子可点开当日列表）`}>
            {cells.map((cell, index) => {
              // date 先落 const 再进闭包：TS 的属性窄化不进函数体（const 变量的窄化才进）
              const date = cell.date;
              if (date === null) {
                return <span key={`pad-${index}`} aria-hidden className="h-7 w-7 justify-self-center" />;
              }
              if (cell.count <= 0) {
                return (
                  <span key={date} aria-hidden
                    className={`flex h-7 w-7 items-center justify-center justify-self-center text-micro tabular-nums ${cell.isToday ? "rounded-inner bg-ink-900 font-semibold text-surface" : "text-ink-500"}`}>
                    {Number(date.slice(8, 10))}
                  </span>
                );
              }
              return (
                <button key={date} type="button"
                  aria-pressed={openDay === date}
                  title={`${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日 · ${cell.count} 条`}
                  onClick={() => setOpenDay((current) => (current === date ? undefined : date))}
                  className={`flex h-7 w-7 items-center justify-center justify-self-center rounded-inner text-micro tabular-nums transition-colors ${
                    cell.isToday
                      ? "bg-ink-900 font-semibold text-surface"
                      : cell.level === 4
                        ? "bg-accent-solid font-semibold text-white"
                        : cell.level === 3
                          ? "bg-accent/40 text-ink-900"
                          : cell.level === 2
                            ? "bg-accent/22 text-ink-900"
                            : "bg-accent/10 text-ink-700 hover:bg-accent/20"
                  } ${openDay === date && !cell.isToday ? "ring-1 ring-accent" : ""}`}>
                  {Number(date.slice(8, 10))}
                </button>
              );
            })}
          </div>
          {/* 当日列表：点开的那个月格的就地展开（条数 = 该格底色来源，同一份 Day.activity） */}
          {openDay !== undefined && (
            <div className="mt-3 shrink-0 rounded-panel bg-sunken p-2 ring-1 ring-line" data-testid="workbench-day-list">
              <p className="mb-1 px-1 text-micro font-medium text-ink-700">
                {openDay} · {openItems.length} 条
              </p>
              {openItems.length === 0
                ? <p className="px-1 py-2 text-micro text-ink-500">这一天没有条目</p>
                : openItems.map((entry, index) => (
                  <ActivityRow key={`${entry.kind}-${index}`} entry={entry} agents={agents} />
                ))}
            </div>
          )}
        </>
      )}
      {/* 统计：项目 / 助手 / 任务（原始计数，不派生过滤——口径见父级传入） */}
      <StatsBlock projects={stats.projects} agents={stats.agents} tasks={stats.tasks} loading={loading} />
    </div>
  );
}

/** 统计块：三格。数字由父级给（避免这里再算第二份口径）；没就绪不显示 0（规范 2.32）。 */
function StatsBlock({ projects, agents, tasks, loading }: {
  projects?: number; agents?: number; tasks?: number; loading: boolean;
}) {
  const cells: Array<{ label: string; value?: number }> = [
    { label: "项目", value: projects },
    { label: "助手", value: agents },
    { label: "任务", value: tasks },
  ];
  return (
    <div className="mt-3 shrink-0 border-t border-line pt-3" data-testid="workbench-stats">
      <div className="grid grid-cols-3 gap-1">
        {cells.map((cell) => (
          <div key={cell.label} className="flex flex-col items-center rounded-control py-2">
            <span className="text-content font-semibold tabular-nums text-ink-900">
              {loading || cell.value === undefined ? <span className="inline-block h-4 w-6 animate-pulse rounded-inner bg-hover" aria-hidden="true" /> : cell.value}
            </span>
            <span className="mt-0.5 text-micro text-ink-500">{cell.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
