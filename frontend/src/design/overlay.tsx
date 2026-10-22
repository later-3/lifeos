import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { IconX } from "@tabler/icons-react";
import { Button, IconButton } from "./ui";
import { useIsMobile } from "../use-mobile";

/**
 * 模态与确认框（前端开发路径 · 闸 3：键盘断言依赖这里的焦点陷阱 / aria-modal / Esc）。
 * 之前两个模态是裸 div：Tab 出得去、Esc 要先点一下才生效、无 aria 语义。
 */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * 全屏表面共用的焦点契约：打开时进入、Tab 循环、Esc 关闭、锁背景滚动、关闭后还焦点。
 * Modal 和手机全屏面板共用，避免每个面板各写一套（之前 MobileNav/历史/文件各自裸 div）。
 */
export function useDialogFocus(
  panel: { current: HTMLElement | null },
  onClose: () => void,
  options?: { initialFocus?: { current: HTMLElement | null }; enabled?: boolean },
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const enabled = options?.enabled ?? true;
  const initialFocus = options?.initialFocus;
  useEffect(() => {
    if (!enabled) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const list = () => [...(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const preferred = initialFocus?.current;
    if (preferred !== undefined && preferred !== null) preferred.focus();
    else if (node !== null && !node.contains(document.activeElement)) (list()[0] ?? node)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const items = list();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      previous?.focus();
    };
    // 只在开关时建立；onClose 走 ref，避免每次渲染把焦点拽回去。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

export function Modal({ title, subtitle, icon, onClose, children, footer, width = 640, initialFocus, fullScreen = false }: {
  title: string; subtitle?: string; icon?: ReactNode; onClose: () => void;
  children: ReactNode; footer?: ReactNode; width?: number;
  /** 打开时聚焦的控件（如目录选择器的路径输入框）。不传则兜底到第一个可聚焦元素。 */
  initialFocus?: { current: HTMLElement | null };
  /** 手机上全屏 sheet（桌面仍是 width 模态）。 */
  fullScreen?: boolean;
}) {
  const mobile = useIsMobile();
  const full = fullScreen && mobile;
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel, onClose, initialFocus === undefined ? {} : { initialFocus });

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-ink-900/35 backdrop-blur-[2px] ${full ? "p-0" : "p-3"}`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        style={{ maxWidth: full ? undefined : width, maxHeight: full ? "100dvh" : "calc(100dvh - 24px)" }}
        className={`flex w-full flex-col overflow-hidden bg-surface shadow-xl ring-1 ring-ink-900/10 ${full ? "h-full rounded-none" : "rounded-panel"}`}>
        <header className={`flex shrink-0 items-center gap-3 border-b border-line bg-sunken px-5 py-3 ${full ? "pt-safe" : ""}`}>
          {icon}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-body font-semibold text-ink-900">{title}</h2>
            {subtitle !== undefined && <p className="truncate text-micro text-ink-500">{subtitle}</p>}
          </div>
          <IconButton label="关闭" onClick={onClose}><IconX size={16} /></IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-4">{children}</div>
        {footer !== undefined && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 pt-3 pb-safe sm:pb-3">{footer}</footer>
        )}
      </div>
    </div>
  );
}

/** 危险操作确认：替换 window.confirm（原生弹窗与自绘界面两套语言）。 */
export function ConfirmDialog({ title, message, confirmLabel = "确认", danger = false, onConfirm, onCancel }: {
  title: string; message: ReactNode; confirmLabel?: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel} width={420}
      footer={<>
        <Button onClick={onCancel}>取消</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
      </>}>
      <p className="text-body leading-relaxed text-ink-700">{message}</p>
    </Modal>
  );
}
