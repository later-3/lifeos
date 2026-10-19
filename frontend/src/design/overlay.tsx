import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { IconX } from "@tabler/icons-react";
import { Button, IconButton } from "./ui";

/**
 * 模态与确认框（前端开发路径 · 闸 3：键盘断言依赖这里的焦点陷阱 / aria-modal / Esc）。
 * 之前两个模态是裸 div：Tab 出得去、Esc 要先点一下才生效、无 aria 语义。
 */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ title, subtitle, icon, onClose, children, footer, width = 640, initialFocus }: {
  title: string; subtitle?: string; icon?: ReactNode; onClose: () => void;
  children: ReactNode; footer?: ReactNode; width?: number;
  /** 打开时聚焦的控件（如目录选择器的路径输入框）。不传则兜底到第一个可聚焦元素。 */
  initialFocus?: { current: HTMLElement | null };
}) {
  const panel = useRef<HTMLDivElement>(null);
  // onClose 每次渲染都是新函数：放进 ref，effect 只在挂载时跑一次。
  // 否则每次按键/渲染都会重跑 effect → 把焦点从输入框拽回第一个可聚焦元素（之前退回"关闭按钮"，
  // 导致在目录选择器里打字/退格都落到 X 上）。参照 Pi Web DirectoryPicker：输入框 autoFocus、陷阱只处理 Tab。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const list = () => [...(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    // 初始焦点：显式指定 > 子元素自带的 autoFocus（焦点已在面板内）> 兜底第一个可聚焦元素。
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
      previous?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/35 p-3 backdrop-blur-[2px]"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        style={{ maxWidth: width, maxHeight: "calc(100dvh - 24px)" }}
        className="flex w-full flex-col overflow-hidden rounded-panel bg-surface shadow-xl ring-1 ring-ink-900/10">
        <header className="flex shrink-0 items-center gap-3 px-5 py-3">
          {icon}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-body font-semibold text-ink-900">{title}</h2>
            {subtitle !== undefined && <p className="truncate text-micro text-ink-500">{subtitle}</p>}
          </div>
          <IconButton label="关闭" onClick={onClose}><IconX size={16} /></IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer !== undefined && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>
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
