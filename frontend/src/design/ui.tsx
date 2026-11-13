import { useRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * 基础控件（前端开发路径 · 闸 2：页面只允许组装 primitive，不许自己画控件）。
 * 所有数值来自 design/tokens.css；这里出现任何 text-[..]/#rgb 都是 bug。
 */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "ghost-danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent-solid text-white hover:brightness-95 disabled:bg-hover disabled:text-ink-500",
  secondary: "bg-surface text-ink-700 ring-1 ring-line hover:bg-hover hover:text-ink-900 disabled:text-ink-500",
  ghost: "text-ink-700 hover:bg-hover hover:text-ink-900 disabled:text-ink-500",
  // ghost-danger（Task 0010）：信息卡里的危险次级动作 —— 文字用 danger 色、无实底，
  // hover 才染 danger-soft。与实底 danger（主危险钮）分级：卡片主体是信息，危险动作退居次级。
  "ghost-danger": "text-danger hover:bg-danger-soft disabled:text-ink-500",
  danger: "bg-danger text-white hover:brightness-95 disabled:bg-hover disabled:text-ink-500",
};

const SIZE: Record<Size, string> = {
  sm: "h-11 gap-1 px-2.5 text-meta sm:h-7",
  md: "h-11 gap-1.5 px-3.5 text-body sm:h-9",
};

export function Button({ variant = "secondary", size = "md", className = "", children, ...rest }: {
  variant?: Variant; size?: Size; children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" data-variant={variant} {...rest}
      className={`inline-flex shrink-0 items-center justify-center rounded-control font-medium transition-colors disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${className}`}>
      {children}
    </button>
  );
}

/** 图标按钮：28×28 起（命中区下限），lg=32。tone 决定"主操作"是否用品牌色。 */
export function IconButton({ label, active = false, tone = "default", size = "md", className = "", children, ...rest }: {
  label: string; active?: boolean; tone?: "default" | "accent" | "solid"; size?: "sm" | "md" | "lg" | "xl"; children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title">) {
  const box = size === "xl" ? "h-11 w-11" : size === "lg" ? "h-11 w-11 sm:h-8 sm:w-8" : "h-11 w-11 sm:h-7 sm:w-7";
  const look = tone === "solid"
    ? "bg-accent-solid text-white hover:bg-accent-solid disabled:bg-hover disabled:text-ink-500"
    : active ? "bg-accent-soft text-accent" : "text-ink-500 hover:bg-hover hover:text-ink-900";
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      className={`inline-flex shrink-0 items-center justify-center rounded-control transition-colors disabled:cursor-not-allowed ${box} ${look} ${className}`}>
      {children}
    </button>
  );
}

/**
 * composer 发送/停止钮：触达 44（主操作档，frontend-spec §2），视觉圆 32（≈2.1× 输入文字 15px，
 * 三家 A 级参考 2.0–2.5 比例区间的中值，见 reference-baseline "composer 视觉"行；用户拍板 Task 0002 a）。
 * 视觉小圆与触达解耦：内圈直径 32，外圈命中 44。
 */
export function ComposerButton({ label, tone = "solid", disabled = false, onClick, children }: {
  label: string; tone?: "solid"; disabled?: boolean; onClick?: () => void; children: ReactNode;
}) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="group inline-flex h-11 w-11 shrink-0 items-center justify-center justify-self-end rounded-full disabled:cursor-not-allowed">
      {/*
        solid 的底 = `ink-900`（正文最深色）+ `text-surface` 反白——**主题不变量**。
        之前用 `accent-solid`：主色被调成低饱和/浅色时（0018 用户实测），它与 composer 底
        几乎同色，生成中的停止钮直接"隐形"、hover 才出现。正文对比度是主题系统保证的
        不变量（≥4.5，换任何主题都成立），实心钮的可见性押在它上面，不再押在主色巧不巧深。
        hover 仍闪 `accent`（主操作提示）；disabled 有 bg-hover 兜底。
      */}
      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors group-hover:[&:not(:disabled)]:bg-accent/85 group-disabled:bg-hover group-disabled:text-ink-500 ${tone === "solid" ? "bg-ink-900 text-surface" : ""}`}>
        {children}
      </span>
    </button>
  );
}

/** 分区小标签（列头、模态分节）——11px + 加字距，和正文拉开层级。 */
/**
 * 列头 / 字段标签（meta 档）。
 *
 * `tone="nav"` 给导航列用：列底是 `nav-bg`，`ink-500` 在它上面只有 4.48:1（差 0.02 不达 AA），
 * 换成 `nav-muted` 是 5.27:1。这不是"随手调色"——导航层自成一层，辅助色也得跟着换
 * （design-language D17；Task 0006 实测）。
 */
export function Label({ children, tone = "default", className = "" }: {
  children: ReactNode; tone?: "default" | "nav"; className?: string;
}) {
  const color = tone === "nav" ? "text-nav-muted" : "text-ink-500";
  return <span className={`text-micro font-medium tracking-wide ${color} ${className}`}>{children}</span>;
}

/** 表单行：标签 + 控件 + 提示。 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-meta text-ink-700">{label}</span>
      {children}
      {hint !== undefined && <span className="block text-micro text-ink-500">{hint}</span>}
    </label>
  );
}

/** 输入类控件的统一外观（input / textarea / select 共用）。 */
export const controlClass =
  "w-full rounded-control bg-surface px-2.5 text-body text-ink-900 ring-1 ring-line transition-shadow placeholder:text-ink-300 focus:ring-accent disabled:bg-hover disabled:text-ink-500";

/**
 * 列表行（Task 0006 重做选中语言）。
 *
 * 旧：选中 = 白卡 + `shadow-sm` + `ring-1 ring-line`，未选中 = 透明 —— 问题三个：
 * 1. 白卡（#fff）压在列底（#fafafa）上只差 ΔL* 1.7，比 hover（3.1）**还弱**，主次颠倒；
 * 2. 用阴影做深度 —— 阴影是「浮起层」的词汇，列表行不是浮层（design-language D18）；
 * 3. 助手行与会话行用同一套但会话行带 `font-medium`、助手行不带，同类对象两种语言。
 *
 * 现在：选中 = `nav-selected` 填充（ΔL* 4.9）+ `font-medium`；hover = `nav-accent`（ΔL* 2.8）。
 * 两者比例 1.75 与 A 级参考一致：LobeHub `NavItem` 选中 `variant="filled"`（fill .06）/
 * hover（fill .03）→ 5.2 / 2.8（`src/features/NavPanel/components/NavItem.tsx:157`，
 * 底色来自 `colorFillSecondary` / `colorFillTertiary`）。
 * 不用阴影（D18），也不加第二通道（左色条）—— 选中的底色差已经比旧实现强 2.9 倍。
 */
export function Row({ selected = false, className = "", children, onClick, testId, actions, status }: {
  selected?: boolean; className?: string; children: ReactNode; onClick?: () => void; testId?: string;
  /**
   * 行内动作（hover 出现的图标按钮）。
   *
   * **必须**通过这个 prop 传，由 Row 把它们渲染成"主点击区的**兄弟**"而不是子节点 ——
   * 行本身是 `role="button"`，里面再放 `<button>` 是非法结构（axe `nested-interactive`：
   * 读屏与键盘会出现两个可点目标叠在一起）。2026-11-09 axe 审计一次报了 34 处。
   *
   * **hover 才出现，不占常驻空间**（2026-11-10 用户：助手行的「配置/删除」两钮常驻显示，
   * 「整个 Agent 的列表显得莫名其妙地有点长」）：动作区与 `status` 叠在同一个栅格格里，
   * hover 时状态淡出、动作淡入——与会话行同款（`groups-panel.tsx SessionRow`）。
   * 键盘焦点与触屏有覆盖分支（`group-has-[:focus-visible]` / `@media(hover:none)`），
   * 不需要在自己的使用点重复写任何可见性分支（规范 2.3：同类第二次出现 → 容器统一）。
   */
  actions?: ReactNode;
  /**
   * 行尾常驻的槽内容（数量徽标、时间这类“状态”）。
   * 与 actions 叠在同一格：hover 时淡出给动作区让位，不与动作争位。
   */
  status?: ReactNode;
}) {
  const interactive = onClick !== undefined;
  return (
    <div className={`group/row relative flex h-11 w-full items-center rounded-row text-body transition-colors sm:h-8 ${
      selected ? "bg-nav-selected font-medium text-ink-900" : "text-ink-700"
    } ${className}`}>
      <div
        {...(interactive
          ? {
            role: "button" as const,
            tabIndex: 0,
            onClick,
            onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick?.(); }
            },
          }
          : {})}
        data-testid={testId}
        aria-current={selected ? "true" : undefined}
        className={`flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 ${
          selected ? "" : "hover:bg-nav-accent"
        }`}>
        {children}
      </div>
      {/* 动作是主点击区的**兄弟**：不嵌套、不抢行的点击（各自 stopPropagation 也不再必需） */}
      {actions !== undefined && (
        // 槽 + 覆盖层（与 SessionRow 同款）：状态与动作叠在同一格，格宽 = 两者较宽者 ——
        // 状态和按钮都不会“额外占一个固定空间”；hover 时状态淡出、动作淡入。
        <span className="relative grid justify-items-end">
          {status !== undefined && (
            <span className="col-start-1 row-start-1 flex min-w-0 items-center pr-1 transition-opacity
              group-hover/row:opacity-0 group-has-[:focus-visible]/row:opacity-0
              [@media(hover:none)]:group-focus-within/row:opacity-0">{status}</span>
          )}
          <span className={`relative col-start-1 row-start-1 flex items-center gap-0.5 pr-1 rounded-control opacity-0 pointer-events-none transition-opacity
            group-hover/row:opacity-100 group-hover/row:pointer-events-auto
            group-has-[:focus-visible]/row:opacity-100 group-has-[:focus-visible]/row:pointer-events-auto
            [@media(hover:none)]:group-focus-within/row:opacity-100 [@media(hover:none)]:group-focus-within/row:pointer-events-auto
            ${selected ? "bg-nav-selected" : "bg-nav-accent"}`}>
            {actions}
          </span>
        </span>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }: {
  icon?: ReactNode; title: string; hint?: string; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      {icon !== undefined && <span className="text-ink-300">{icon}</span>}
      <p className="text-body text-ink-700">{title}</p>
      {hint !== undefined && <p className="max-w-64 text-meta text-ink-500">{hint}</p>}
      {action !== undefined && <div className="mt-1">{action}</div>}
    </div>
  );
}

/**
 * 工作指示（全站唯一的旋转件）：淡轨道 + 弧。颜色跟 currentColor，尺寸只给三种。
 * 时长/缓动来自 tokens.css 的 --animate-arc（系统开启减少动态效果时自动停转）。
 */
export function Spinner({ size = 14, className = "" }: { size?: 12 | 14 | 16; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`animate-arc shrink-0 ${className}`}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.18" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-1.5 px-2 py-1" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-7 animate-pulse rounded-control bg-hover" />
      ))}
    </div>
  );
}


/**
 * Tabs：真正的 tab 语义（APG）：tablist/tab/tabpanel、aria-selected、方向键/Home/End。
 * 与 Segmented 区分：Segmented 是“模式切换”，Tabs 是“分区切换”；两者命中区都至少 28px。
 */
export function Tabs<T extends string>({ value, options, onChange, label, idPrefix, block = false }: {
  value: T; options: { value: T; label: string }[]; onChange: (next: T) => void;
  label: string; idPrefix: string; block?: boolean;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (index: number) => {
    const next = options[index];
    if (next === undefined) return;
    onChange(next.value);
    requestAnimationFrame(() => refs.current[index]?.focus());
  };
  return (
    <div role="tablist" aria-label={label} aria-orientation="horizontal"
      className={`inline-flex h-11 shrink-0 items-center rounded-control bg-hover ${block ? "w-full" : ""}`}>
      {options.map((option, index) => (
        <button key={option.value} type="button" role="tab"
          id={`${idPrefix}-tab-${option.value}`}
          aria-controls={option.value === value ? `${idPrefix}-panel-${option.value}` : undefined}
          aria-selected={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          ref={(element) => { refs.current[index] = element; }}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") { event.preventDefault(); select((index + 1) % options.length); }
            else if (event.key === "ArrowLeft") { event.preventDefault(); select((index - 1 + options.length) % options.length); }
            else if (event.key === "Home") { event.preventDefault(); select(0); }
            else if (event.key === "End") { event.preventDefault(); select(options.length - 1); }
          }}
          className={`h-11 rounded-control px-2.5 text-body transition-colors ${block ? "flex-1" : ""} ${
            option.value === value ? "bg-surface text-ink-900 shadow-sm" : "text-ink-700 hover:text-ink-900"
          }`}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 分段控件（渲染/源码、模式切换）：容器单色底，选中项浮白。 */
export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (next: T) => void;
}) {
  return (
    <div className="inline-flex shrink-0 items-center rounded-control bg-hover p-0.5">
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)}
          className={`rounded-inner px-2 py-0.5 text-micro transition-colors ${
            option.value === value ? "bg-surface text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"
          }`}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
