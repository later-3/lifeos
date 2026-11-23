import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button, IconButton } from "./ui";
import { useIsMobile } from "../use-mobile";
import { LAYER_CLASS, surfaceStyle } from "./surface";
import { AppIcon } from "./icons";

/**
 * 模态与确认框（前端开发路径 · 闸 3：键盘断言依赖这里的焦点陷阱 / aria-modal / Esc）。
 * 之前两个模态是裸 div：Tab 出得去、Esc 要先点一下才生效、无 aria 语义。
 */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * 打开着的对话框栈（**唯一事实源**：谁在最上面）。
 *
 * 为什么需要它（Task 0023 · 修正批 4 实测）：`Esc` 的处理是挂在 `document` 上的**捕获**监听，
 * 同一节点上的多个监听按**注册顺序**触发 —— 外层表面（手机工作台全屏表面）先注册，
 * 于是"详情浮层按 Esc"会**先把外层表面关掉**，浮层随之一起消失：用户看到的是
 * "按一下 Esc 整屏都没了"，而且焦点归还到不可见的元素上。
 * 这不只影响本任务：手机上的设置页、检视面板里再开一个 Modal 都会撞同一件事。
 *
 * 做法：每个 `useDialogFocus` 挂载时把自己压栈，**只有栈顶**处理 Esc / Tab 循环。
 * 栈在卸载时按身份移除（不用 pop —— 关的顺序不必是开的逆序）。
 */
const dialogStack: object[] = [];

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
    /** 本实例在栈里的身份（关闭时按身份移除，不假设顺序）。 */
    const token = {};
    dialogStack.push(token);
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const list = () => [...(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const preferred = initialFocus?.current;
    if (preferred !== undefined && preferred !== null) preferred.focus();
    else if (node !== null && !node.contains(document.activeElement)) (list()[0] ?? node)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      // 只有**最上面那一层**响应（否则 Esc 会一次关掉两层，见 dialogStack 的注释）
      if (dialogStack[dialogStack.length - 1] !== token) return;
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
      const at = dialogStack.indexOf(token);
      if (at >= 0) dialogStack.splice(at, 1);
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
    <div className={`fixed inset-0 ${LAYER_CLASS.modal} flex items-center justify-center bg-ink-900/35 backdrop-blur-[2px] ${full ? "p-0" : "p-3"}`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        style={{ maxWidth: full ? undefined : width, maxHeight: full ? "100dvh" : "calc(100dvh - 24px)", ...surfaceStyle("modal") }}
        className={`flex w-full flex-col overflow-hidden bg-surface ring-1 ring-ink-900/10 ${full ? "h-full rounded-none" : "rounded-panel"}`}>
        <header className={`flex shrink-0 items-center gap-3 border-b border-line bg-sunken px-5 py-3 ${full ? "pt-safe" : ""}`}>
          {icon}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-body font-semibold text-ink-900">{title}</h2>
            {subtitle !== undefined && <p className="truncate text-micro text-ink-500">{subtitle}</p>}
          </div>
          <IconButton label="关闭" onClick={onClose}><AppIcon name="x" size={16} /></IconButton>
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
