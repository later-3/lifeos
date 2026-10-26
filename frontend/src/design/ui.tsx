import { useRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * 基础控件（前端开发路径 · 闸 2：页面只允许组装 primitive，不许自己画控件）。
 * 所有数值来自 design/tokens.css；这里出现任何 text-[..]/#rgb 都是 bug。
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-white hover:brightness-95 disabled:bg-hover disabled:text-ink-500",
  secondary: "bg-surface text-ink-700 ring-1 ring-line hover:bg-hover hover:text-ink-900 disabled:text-ink-500",
  ghost: "text-ink-700 hover:bg-hover hover:text-ink-900 disabled:text-ink-500",
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
    ? "bg-accent text-white hover:bg-accent disabled:bg-hover disabled:text-ink-500"
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
      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors group-hover:[&:not(:disabled)]:bg-accent/85 group-disabled:bg-hover group-disabled:text-ink-500 ${tone === "solid" ? "bg-accent text-white" : ""}`}>
        {children}
      </span>
    </button>
  );
}

/** 分区小标签（列头、模态分节）——11px + 加字距，和正文拉开层级。 */
export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`text-micro font-medium tracking-wide text-ink-500 ${className}`}>{children}</span>;
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

/** 列表行：32px 高，右侧元信息固定槽位（hover 时图标原地显隐，不造成位移）。 */
export function Row({ selected = false, className = "", children, onClick, testId }: {
  selected?: boolean; className?: string; children: ReactNode; onClick?: () => void; testId?: string;
}) {
  return (
    <div role={onClick !== undefined ? "button" : undefined} tabIndex={onClick !== undefined ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick === undefined ? undefined : (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); }
      }}
      data-testid={testId} className={`group flex h-11 w-full cursor-pointer items-center gap-2 rounded-control px-2 text-body transition-colors sm:h-8 ${
        selected ? "bg-surface font-medium text-ink-900 shadow-sm ring-1 ring-line" : "text-ink-700 hover:bg-hover"
      } ${className}`}>
      {children}
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
