import { useRef } from "react";
import { AppIcon } from "./icons";
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

/**
 * 开关芯片（S4 · 自绘收敛）：带 `aria-pressed` 的单选/多选小片
 * （外观模式、字体候选、主色圆点、徽标强度、语气选择…）。
 *
 * 为什么单列：这一族在设置页出现过 8 次以上，每次都是
 * `<button aria-pressed={on} className={on ? "选中样式" : "未选样式"}>`；
 * 差异只在尺寸/形状，用一个 `shape` 变体覆盖即可（规范 2.3：第二次出现立容器）。
 * 语义：button + aria-pressed（不是 role=radio —— 那是有互斥组时才需要的语义，
 * 由调用方用 role="group" 包一层即可）。
 */
export function ToggleChip({ pressed, shape = "pill", className = "", children, ...rest }: {
  pressed: boolean;
  shape?: "pill" | "dot" | "card";
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = shape === "dot"
    ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
    : shape === "card"
      ? "rounded-control px-2.5 py-1.5 text-left text-meta transition-colors"
      : "flex h-7 shrink-0 items-center rounded-control px-2.5 text-meta transition-colors";
  const look = shape === "dot"
    ? pressed ? "border-ink-900" : "border-transparent"
    : pressed ? "bg-nav-selected text-ink-900 ring-1 ring-accent" : "bg-surface text-ink-700 ring-1 ring-line hover:bg-hover";
  return (
    <button type="button" aria-pressed={pressed} {...rest} className={`${base} ${look} ${className}`}>
      {children}
    </button>
  );
}

/**
 * 可点行（S4 · 自绘收敛）：整行可点击的容器（历史回合、分组头、目录选择、列表项）。
 *
 * 为什么单列：这些用法在页面里出现过 6 次以上，每次都手写
 * `<button className="flex w-full items-center gap-2 ...">` ——第二次出现就该立容器（规范 2.3）。
 * 它的语义是"一行是一个动作"，不是"一个按钮"，但 DOM 上仍是 button（键盘可达）。
 */
export function ClickableRow({ className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest}
      className={`flex w-full min-w-0 items-center gap-2 rounded-control text-left transition-colors hover:bg-hover max-sm:min-h-11 ${className}`}>
      {children}
    </button>
  );
}

/**
 * 微按钮（S4 · 自绘收敛）：密集区域的小按钮（评审面板的展开/折叠、diff 导航、
 * 行内次要动作）。为什么单列一档而不是用 Button size="sm"：
 * 这里的高度 ~20px、字号 micro，比 Button 的 sm（28）更紧凑——但**命中区**由
 * 外层 padding 补足（评审面板的行高足够），不牺牲可点性。
 * 命中性上它与 Button 同级（都是真 <button> + disabled/focus 语义）。
 */
export function MicroButton({ tone = "quiet", className = "", children, ...rest }: {
  tone?: "quiet" | "accent" | "danger";
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const look = tone === "accent"
    ? "bg-surface text-accent ring-1 ring-line hover:bg-hover"
    : tone === "danger"
      ? "text-ink-500 hover:bg-hover hover:text-danger"
      : "text-ink-500 hover:bg-hover hover:text-ink-900";
  return (
    <button type="button" {...rest}
      className={`shrink-0 rounded-inner px-1.5 py-0.5 text-micro transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${look} ${className}`}>
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
          className={`min-h-7 rounded-inner px-2 text-micro transition-colors ${
            option.value === value ? "bg-surface text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"
          }`}>
          {option.label}
        </button>
      ))}
    </div>
  );
}


/**
 * 会话行（收编自 groups-panel.tsx，Task 0015 · A2：跨文件使用的行组件归 design/ 注册表）。
 *
 * 结构（2026-11-09 两次审计的实证修正，迁移原样保留）：
 * - 双行 56：第一行只有标题；第二行 `[参与者头像] 对端 · Task · 状态`；
 * - 外层容器只管底色与 hover 分组；主点击区与动作区是**兄弟**（axe `nested-interactive`）；
 * - 状态槽与动作区叠同一格（槽宽 = 动作区 w-21）：hover 状态淡出、动作淡入，几何不随 hover 变；
 * - 副行用 nav-muted（ink-500 在 nav-accent/nav-selected 上不达 AA）；
 * - 内联重命名（Enter 提交 / Esc / 失焦取消）。
 */
/**
 * 会话行（双行 56）。
 *
 * 第一行：**只有标题**（"是哪件事"）——头像已移到第二行，
 * 因为它属于元信息，且左边 Agent 列已经表达了"和谁"。
 * 第二行：`[参与者小头像] 对端 · Task · 状态`（"和谁、属于什么、现在怎样"）。
 */
export function SessionRow({ selected, title, titleFallback, participants, meta, status, onSelect, onRename, onHistory, onDelete, renameValue, renaming, onRenameChange, onRenameCommit, onRenameCancel, testId }: {
  selected: boolean;
  title: string;
  titleFallback: boolean;
  /** 第二行开头的参与者头像（`ParticipantToken`）。 */
  participants: ReactNode;
  meta: ReactNode;
  status: ReactNode;
  onSelect: () => void;
  onRename: () => void;
  onHistory: () => void;
  onDelete: () => void;
  testId?: string;
  renaming: boolean;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameCommit: (value: string) => void;
  onRenameCancel: () => void;
}) {
  /*
   * 结构：外层是**容器**（只负责底色与 hover 分组），主点击区与动作区是它的两个**兄弟**。
   *
   * 2026-11-09 axe `nested-interactive`：行原本是 `role="button"`，里面放着三个 IconButton
   * （真 `<button>`）→ 交互元素嵌套，读屏与键盘会出现"两个目标叠在一起"。
   * 拆成兄弟之后：点行 = 选中会话；点图标 = 该动作；两者互不嵌套。
   */
  return (
    <div data-testid={testId} aria-current={selected ? "true" : undefined}
      className={`group/session flex h-14 w-full items-center rounded-row transition-colors ${
        selected ? "bg-nav-selected font-medium text-ink-900" : "text-ink-700 hover:bg-nav-accent"
      }`}>
      <div role="button" tabIndex={0} onClick={onSelect}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }}
        // 主点击区不侵入状态槽（槽宽 = 动作区宽 = 3×28）：`pr-0`，两行文字自己会在槽前截断。
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-row pl-2 pr-0">
      <span className="flex min-w-0 flex-1 flex-col">
        {renaming ? (
          <input autoFocus value={renameValue}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => onRenameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); onRenameCommit(event.currentTarget.value); }
              if (event.key === "Escape") { event.preventDefault(); onRenameCancel(); }
            }}
            onBlur={onRenameCancel}
            onClick={(event) => event.stopPropagation()}
            className="min-w-0 rounded-control bg-surface px-1 text-body text-ink-900 ring-1 ring-accent" />
        ) : (
          <span className={`truncate text-body ${titleFallback ? "font-mono text-nav-muted" : "text-ink-900"}`}
            data-fallback={titleFallback ? "id" : undefined}
            title={titleFallback ? "这条会话还没有标题（显示的是会话 id）" : undefined}>{title}</span>
        )}
        {/* 副行用 nav-muted 而不是 ink-500：ink-500 在 nav-accent / nav-selected 上只有 4.10 / 4.03，
            低于 AA 4.5（导航层专用色 nav-muted 为 4.90 / 4.65）。 */}
        <span className="flex min-w-0 items-center gap-1.5 text-micro text-nav-muted">
          {participants}
          <span className="min-w-0 truncate">{meta}</span>
        </span>
      </span>
      {/*
        * 状态槽宽度 = 时间串的真实宽度（11px 下的"13小时前"约 40px）+ 呼吸余量。
        *
        * 2026-11-09 审核实测的缺陷：槽只有 64px，而 hover 出现的动作区（历史/重命名/删除）
        * 三个 28px 图标 = 84px，绝对定位后会**向左溢出 20px、压住标题 12px**。
        * 现在把两种宽度分开：槽按内容自适应（min-w），动作区宽度由自己决定并覆盖在槽上，
        * 且 hover 时标题侧的两行**收窄**到同一右边界，不再被盖。
        */}
      {/*
        * 槽宽 = **动作区宽度**（3 个 28px 图标 = 84 = w-21），不是时间串宽度。
        *
        * 2026-11-09 审核实测的缺陷：槽宽 64（时间"13小时前"够用），hover 出现的
        * 动作区 84px 绝对定位后向左溢出 20px、压住标题 12px，两串字叠在一起。
        * 试过的另一种修法（hover 时给标题加 pr-92）会把标题挤到 67px，且行内宽度随 hover 变=抖动。
        * 现在让槽位本身就按动作区定宽：时间右对齐落在同一格里，hover 只换内容不换几何。
        */}
      {/*
        * 动作区与状态槽**都是主点击区的兄弟**（2026-11-09 axe `nested-interactive`）：
        * 行是 role=button，里面再放 IconButton 就是嵌套交互元素（读屏/键盘会串）。
        * 布局不变：槽 84px（动作区宽度），hover 时动作区覆盖在槽上、给实底。
        */}
      </div>
      <span className="relative flex w-21 shrink-0 items-center justify-end group/slot">
        <span className="flex items-center transition-opacity group-hover/session:opacity-0 group-has-[:focus-visible]/slot:opacity-0 [@media(hover:none)]:group-focus-within/session:opacity-0">{status}</span>
        <span className="absolute right-0 flex items-center rounded-control bg-nav-accent opacity-0 pointer-events-none transition-opacity group-hover/session:bg-nav-selected group-hover/session:opacity-100 group-hover/session:pointer-events-auto group-has-[:focus-visible]/slot:opacity-100 group-has-[:focus-visible]/slot:pointer-events-auto [@media(hover:none)]:group-focus-within/session:opacity-100 [@media(hover:none)]:group-focus-within/session:pointer-events-auto">
          <IconButton label="会话历史" size="sm" onClick={(event) => { event.stopPropagation(); onHistory(); }}><AppIcon name="history" size={14} /></IconButton>
          <IconButton label="重命名会话" size="sm" onClick={(event) => { event.stopPropagation(); onRename(); }}><AppIcon name="pencil" size={14} /></IconButton>
          <IconButton label="删除会话" size="sm" onClick={(event) => { event.stopPropagation(); onDelete(); }}><AppIcon name="trash" size={14} /></IconButton>
        </span>
      </span>
    </div>
  );
}

