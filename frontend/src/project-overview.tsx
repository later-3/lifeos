/**
 * 项目概览卡（Task 0010）—— 分组头计数药丸点开的浮层。
 *
 * 形态 = gitea 仓库 About 卡同构（身份区 → 统计区 → 动作区；
 * `~/Code/reference/gitea templates/repo/home_sidebar_top.tmpl:15-35` / `home_sidebar_bottom.tmpl:12-27`），
 * 并抽为正式模式 `knowledge/design/patterns/detail-card.md`（用户 2026-11-13：不再每个功能自创一张卡）。
 * 数据口径（02-design §3）：
 *  - **对话数 = 分组头同一份行数据**（调用方传入；后端不重算 —— api 2.10：一个事实一个来源）；
 *  - 任务/进行中、知识库/案例/工具/规范 = `GET /api/agents/:id/projects/:pid/overview` 一次性返回；
 *  - **无假入口**：项目空间工作台页落地前不渲染入口（设计见 `knowledge/design/im/project-space.md`）；
 *  - 移除项目从这里走（低频危险动作离开行尾；确认弹窗由调用方给）。
 *
 * 四态（testing 2.3）：加载骨架 / 失败 + 重试 / 成功；计数 0 是真实数据照常显示（没有"空态"）。
 * 浮层本体 = `design/popover-view.tsx`（定位/Esc/点外关闭/焦点归还是基建）。
 */
import { useEffect, useState } from "react";
import { IconCheck, IconCopy, IconFolder, IconTrash } from "@tabler/icons-react";
import { Popover } from "./design/popover-view";
import { Button, IconButton } from "./design/ui";
import { copyText } from "./clipboard";

/** `GET .../overview` 的响应（唯一形状；与 src/projects.ts 的 ProjectOverview 对齐）。 */
type Overview = {
  path: string | null;
  isDefault: boolean;
  tasks: { total: number; running: number };
  assets: { knowledge: number; cases: number; tools: number; specs: number };
};

type FetchState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "data"; data: Overview };

export function ProjectOverviewCard({ open, onClose, anchorRef, agentId, projectId, name, sessionCount, onRemove }: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  agentId: string;
  projectId: string;
  name: string;
  /** 对话数：分组头同一份行数据（不在此重取，同一事实一个来源）。 */
  sessionCount: number;
  /** 仅外部项目有（默认工作区不可移除）。 */
  onRemove?: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<FetchState>({ kind: "loading" });
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");

  // 打开即取、关闭即弃（readdir 便宜，不缓存；重开永远是新事实）。
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setState({ kind: "loading" });
    setCopyState("idle");
    fetch(`/api/agents/${agentId}/projects/${projectId}/overview`)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => undefined);
          const message = typeof (body as { error?: { message?: unknown } } | undefined)?.error?.message === "string"
            ? (body as { error: { message: string } }).error.message
            : `加载失败（${response.status}）`;
          throw new Error(message);
        }
        return response.json() as Promise<Overview>;
      })
      .then((data) => { if (alive) setState({ kind: "data", data }); })
      .catch((error: unknown) => {
        if (alive) setState({ kind: "error", message: error instanceof Error ? error.message : "加载失败" });
      });
    return () => { alive = false; };
  }, [open, agentId, projectId, attempt]);

  const copyPath = async () => {
    if (state.kind !== "data" || state.data.path === null) return;
    try {
      await copyText(state.data.path);
      setCopyState("ok");
    } catch {
      setCopyState("fail");   // 复制失败必须可见（frontend-spec §5：失败给原因和出口）
    }
    window.setTimeout(() => setCopyState("idle"), 1500);
  };

  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} width={300} label={`${name} 项目概览`}>
      <div className="flex flex-col gap-3" data-testid="project-overview" data-project-id={projectId}>
        {/* 身份区：图标 + 项目名 + 路径（可复制）。默认工作区没有外部路径，写清楚它是什么。 */}
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-nav-accent text-ink-500">
            <IconFolder size={16} />
          </span>
          <span className="min-w-0 truncate text-body font-medium text-ink-900">{name}</span>
        </div>
        {state.kind === "data" && state.data.path !== null && (
          <div className="flex items-center gap-1">
            <code title={state.data.path}
              className="min-w-0 flex-1 truncate rounded-control bg-sunken px-1.5 py-1 font-mono text-micro text-ink-700">
              {state.data.path}
            </code>
            <IconButton size="sm" label="复制项目路径" onClick={() => void copyPath()}>
              {copyState === "ok" ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </IconButton>
            {copyState !== "idle" && (
              <span role="status" aria-live="polite"
                className={`shrink-0 text-micro ${copyState === "ok" ? "text-success" : "text-danger"}`}>
                {copyState === "ok" ? "已复制" : "复制失败"}
              </span>
            )}
          </div>
        )}
        {state.kind === "data" && state.data.path === null && (
          <p className="text-micro text-nav-muted">默认工作区 · 家目录（没有外部路径）</p>
        )}
        {state.kind === "loading" && (
          <p className="text-micro text-nav-muted" data-testid="overview-loading">正在读取项目信息…</p>
        )}
        {state.kind === "error" && (
          <div className="flex items-center justify-between gap-2" data-testid="overview-error">
            <p className="min-w-0 truncate text-micro text-danger" title={state.message}>{state.message}</p>
            <Button variant="secondary" size="sm" onClick={() => setAttempt((value) => value + 1)}>重试</Button>
          </div>
        )}
        {/* 统计区：label 上、count 下；一格一个数字一种含义（frontend 2.15）。
            对话数不在格里——它就在行上的药丸里，重复一次没有信息增量。 */}
        <dl className="grid grid-cols-3 gap-2" data-testid="overview-stats">
          {STAT_ITEMS.map((item) => {
            const value = state.kind === "data" ? item.value(state.data) : undefined;
            return (
              <div key={item.label} className="rounded-control bg-sunken px-2 py-1.5">
                <dt className="text-micro text-nav-muted">{item.label}</dt>
                {value === undefined
                  ? <dd className="mt-0.5 h-3.5 w-8 animate-pulse rounded-control bg-hover" aria-hidden="true" />
                  : <dd className="text-meta font-medium tabular-nums text-ink-900">{value}</dd>}
              </div>
            );
          })}
        </dl>
        {/* 动作区：只放真正的低频动作；与上方数据用细线隔开（用户 2026-11-13：基本信息与删除分开）。
            移除 = 危险次级动作：ghost-danger（文字 danger 色、无实底，hover 染 danger-soft），
            confirm 在调用方。 */}
        {onRemove !== undefined && (
          <div className="border-t border-line pt-2">
            <Button variant="ghost-danger" size="sm" className="w-full" onClick={onRemove}>
              <IconTrash size={14} /> 移除项目
            </Button>
          </div>
        )}
      </div>
    </Popover>
  );
}

/** 统计格清单（唯一来源；value 从 overview 取数，loading 时统一骨架）。 */
const STAT_ITEMS: Array<{ label: string; value: (data: Overview) => number }> = [
  { label: "任务", value: (data) => data.tasks.total },
  { label: "进行中", value: (data) => data.tasks.running },
  { label: "知识库", value: (data) => data.assets.knowledge },
  { label: "案例", value: (data) => data.assets.cases },
  { label: "工具", value: (data) => data.assets.tools },
  { label: "规范", value: (data) => data.assets.specs },
];
