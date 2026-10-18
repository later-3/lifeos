import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * 基础控件（前端开发路径 · 闸 2：页面只允许组装 primitive，不许自己画控件）。
 * 所有数值来自 design/tokens.css；这里出现任何 text-[..]/#rgb 都是 bug。
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-white hover:brightness-95 disabled:bg-hover disabled:text-ink-300",
  secondary: "bg-surface text-ink-700 ring-1 ring-line hover:bg-hover hover:text-ink-900 disabled:text-ink-300",
  ghost: "text-ink-700 hover:bg-hover hover:text-ink-900 disabled:text-ink-300",
  danger: "bg-danger text-white hover:brightness-95 disabled:bg-hover disabled:text-ink-300",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 gap-1 px-2.5 text-meta",
  md: "h-9 gap-1.5 px-3.5 text-body",
};

export function Button({ variant = "secondary", size = "md", className = "", children, ...rest }: {
  variant?: Variant; size?: Size; children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest}
      className={`inline-flex shrink-0 items-center justify-center rounded-control font-medium transition-colors disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${className}`}>
      {children}
    </button>
  );
}

/** 图标按钮：28×28 起（命中区下限），lg=32。tone 决定"主操作"是否用品牌色。 */
export function IconButton({ label, active = false, tone = "default", size = "md", className = "", children, ...rest }: {
  label: string; active?: boolean; tone?: "default" | "accent" | "solid"; size?: "sm" | "md" | "lg"; children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title">) {
  const box = size === "lg" ? "h-8 w-8" : "h-7 w-7";
  const look = tone === "solid"
    ? "bg-accent text-white hover:bg-accent disabled:bg-hover disabled:text-ink-300"
    : active ? "bg-accent-soft text-accent" : "text-ink-500 hover:bg-hover hover:text-ink-900";
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      className={`inline-flex shrink-0 items-center justify-center rounded-control transition-colors disabled:cursor-not-allowed ${box} ${look} ${className}`}>
      {children}
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
export function Row({ selected = false, className = "", children, onClick }: {
  selected?: boolean; className?: string; children: ReactNode; onClick?: () => void;
}) {
  return (
    <div role={onClick !== undefined ? "button" : undefined} tabIndex={onClick !== undefined ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick === undefined ? undefined : (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); }
      }}
      className={`group flex h-8 w-full cursor-pointer items-center gap-2 rounded-control px-2 text-body transition-colors ${
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

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-1.5 px-2 py-1" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-7 animate-pulse rounded-control bg-hover" />
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
