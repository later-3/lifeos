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
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Popover } from "./design/popover-view";
import { LAYER_CLASS } from "./design/surface";
import { useDialogFocus } from "./design/overlay";
import { Button, IconButton } from "./design/ui";
import { copyText } from "./clipboard";
import { AppIcon } from "./design/icons";

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

export function ProjectOverviewCard({ open, onClose, anchorRef, agentId, projectId, name, sessionCount, onRemove, mobile = false }: {
  open: boolean;
  onClose: () => void;
  /** 桌面用：贴这个锚点（分组头计数药丸）。手机不使用（改为全屏表面）。 */
  anchorRef: React.RefObject<HTMLElement | null>;
  /**
   * 手机形态（P7-S2）：`mobile: true` → **全屏表面**而不是贴锚点浮层。
   *
   * 为什么不能沿用 Popover：手机上没有"计数药丸"这个锚点（`leftColumns` 不渲染），
   * 而且 390px 宽下 300px 的浮层会挡住大半个内容区。`mobile.md` §2 的模型是
   * "全屏表面 + header 返回/关闭 + 滚动锁"——这就是那一支。
   */
  mobile?: boolean;
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

  /**
   * 卡片主体（两种外壳共用）。
   *
   * 抽成一个变量而不是两处复制：卡片有 6 个统计格 + 路径复制 + 移除动作，
   * 复制一份就会出现"手机上少一个格""手机上不能复制路径"这类不对称缺陷。
   */
  const card = (
    <div className="flex flex-col gap-3" data-testid="project-overview" data-project-id={projectId}>
        {/* 身份区：图标 + 项目名 + 路径（可复制）。默认工作区没有外部路径，写清楚它是什么。 */}
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-nav-accent text-ink-500">
            <AppIcon name="folder" size={16} />
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
              {copyState === "ok" ? <AppIcon name="check" size={14} /> : <AppIcon name="copy" size={14} />}
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
              <AppIcon name="trash" size={14} /> 移除项目
            </Button>
          </div>
        )}
      </div>
  );

  if (!mobile) {
    return (
      <Popover open={open} onClose={onClose} anchorRef={anchorRef} width={300} label={`${name} 项目概览`}>
        {card}
      </Popover>
    );
  }
  if (!open) return null;
  /*
   * 焦点/Esc/滚动锁用**同一个 hook**（`useDialogFocus`），不自己再写一套：
   * 全屏表面缺 Esc 与焦点陷阱是"看起来能用、键盘用户出不去"的典型缺陷
   * （`mobile.md` §2 要求：焦点循环、Esc 关闭、锁背景滚动）。
   * 注意它必须在 `open` 为真的分支里调用——hook 在条件分支里调用会破坏 hooks 顺序，
   * 所以这里拆成两个组件：`MobileSurface` 只在 open 时才挂载。
   */
  /*
   * 手机：全屏表面（mobile.md §2）。
   * - `role="dialog" aria-modal`：模态语义（背景不可达）
   * - 高度走 `--app-height`（键盘/安全区在同一套变量里）
   * - 顶部 header 有关闭按钮，44 命中
   * - 内容区自己滚（单一滚动容器）
   */
  return <MobileSurface name={name} onClose={onClose}>{card}</MobileSurface>;
}

/**
 * 手机全屏表面（P7-S2）。
 *
 * 单独一个组件是为了**能条件挂载**：`useDialogFocus` 是 hook，
 * 在 `if (!open) return null` 之后再调会破坏 hooks 顺序（React 会报错）。
 */
function MobileSurface({ name, onClose, children }: { name: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel, onClose);
  return (
    <div ref={panel} role="dialog" aria-modal="true" aria-label={`${name} 项目概览`}
      data-testid="project-overview-surface"
      className={`fixed inset-0 ${LAYER_CLASS.drawer} flex flex-col bg-surface sm:hidden`}
      style={{ height: "var(--app-height, 100dvh)" }}>
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-line px-4 pt-safe">
        <p className="min-w-0 flex-1 truncate text-body font-semibold text-ink-900">{name}</p>
        <IconButton label="关闭项目概览" onClick={onClose}><AppIcon name="x" size={18} /></IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-4">{children}</div>
    </div>
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
