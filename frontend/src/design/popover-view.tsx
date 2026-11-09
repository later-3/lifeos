/**
 * Popover primitive（**浮层的唯一实现**）。
 *
 * 为什么有这个文件（2026-11-09 用户：「后续的前端都要有一套统一的规范，不会乱套」）：
 * 仓里有 4 处各写一套浮层定位 + 关闭逻辑（显示设置弹层、检视预览气泡、快捷键弹窗、Toast），
 * 每处都漏了点东西：有的没接 Esc、有的没做贴边平移、有的点外面关不掉。
 * 对照参考项目（difit 用 `@floating-ui/react`：`offset(6)` + `flip()` + `shift({padding:8})`），
 * 定位算法在本项目已有纯函数 `design/popover.ts:placePopover`（可穷举单测），
 * **缺的只是把它包成一个可复用组件** —— 这个文件就是那层包装。
 *
 * 它负责四件事（缺一都会让"浮层"变成半成品）：
 *  1. **定位**：贴锚点下方 6px、放不下翻上方、左右贴视口平移 8px（都来自 placePopover）；
 *  2. **关闭**：点外面（pointerdown）、Esc、锚点再点一次；
 *  3. **焦点**：打开时把焦点交给第一个可聚焦元素，关闭时**还给锚点**（键盘用户不会丢位置）；
 *  4. **外观**：从 `SURFACE.popover` 取（圆角/边界/阴影/内距），层级用 `LAYER.popover`。
 *
 * 非模态（`aria-modal` 不写）：Popover 打开时背景仍可交互是刻意的 ——
 * 显示设置这类"边调边看"的场景必须能一边拖滑块一边看正文。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { placePopover, type RectLike } from "./popover";
import { LAYER, LAYER_CLASS, SURFACE } from "./surface";

export type PopoverProps = {
  /** 是否打开（受控） */
  open: boolean;
  /** 关闭：点外面 / Esc / 锚点再点。调用方负责把 open 置 false。 */
  onClose: () => void;
  /** 锚点元素（定位依据）。传 ref 而不是 Rect：窗口滚动/缩放时要重算。 */
  anchorRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  /** 宽度（px）。不传则由内容决定（会先渲染一次再量）。 */
  width?: number;
  /** 无障碍名（读屏用）。 */
  label: string;
  /** 初始焦点：默认给面板本身（tabIndex=-1），避免自动聚焦到某个滑块导致键盘用户困惑 */
  align?: "end" | "start";
};

const GAP = 6;   // 与 design/popover.ts 的 POPOVER_GAP 同值（那里是唯一来源，这里只是布局兜底）

export function Popover({ open, onClose, anchorRef, children, width, label, align = "end" }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; side: "below" | "above" } | undefined>();

  /** 量锚点与面板，算出 fixed 定位（placePopover 是纯函数，边界与翻转都在里面）。 */
  const place = () => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (anchor === null || panel === null) return;
    const anchorRect = anchor.getBoundingClientRect();
    const anchorLike: RectLike = {
      top: anchorRect.top, left: anchorRect.left, right: anchorRect.right,
      bottom: anchorRect.bottom, width: anchorRect.width, height: anchorRect.height,
    };
    const size = { width: panel.offsetWidth, height: panel.offsetHeight };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const placed = placePopover(anchorLike, size, viewport);
    // align="start" 时左缘对齐锚点左缘（placePopover 默认右缘对齐，适合行末图标）
    const left = align === "start"
      ? Math.min(Math.max(anchorRect.left, 8), Math.max(8, viewport.width - size.width - 8))
      : placed.left;
    setPosition({ top: placed.top, left, side: placed.side });
  };

  // 打开时先量一次（layout effect：避免"先在左上角出现再跳到锚点"的一帧闪烁）
  useLayoutEffect(() => {
    if (!open) { setPosition(undefined); return; }
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, width, align]);

  // 窗口变化时重算（滚动也重算：fixed 定位不会跟随锚点）
  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => place();
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 关闭：Esc + 点外面（pointerdown 比 click 早，避免"点外面先触发别的按钮再关"）
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (panelRef.current?.contains(target) === true) return;
      if (anchorRef.current?.contains(target) === true) return;   // 锚点自己负责 toggle，不重复关
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const recipe = SURFACE.popover;
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      // 非模态：背景仍可交互（"边调边看"必须能做到）
      data-popover-side={position?.side ?? "below"}
      data-testid="popover"
      style={{
        position: "fixed",
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width,
        zIndex: LAYER.popover,
        boxShadow: recipe.shadow,
        // 定位完成前不可见，避免在 (0,0) 闪一帧
        visibility: position === undefined ? "hidden" : "visible",
      }}
      className={`${recipe.radius} ring-1 ring-line bg-surface ${recipe.padding} ${LAYER_CLASS.popover}`}>
      {/* 小箭头：让"从哪弹出来的"一眼可见（参考 difit 的 popover 有 tail） */}
      <span aria-hidden data-popover-caret
        className={`absolute h-2 w-2 rotate-45 border-l border-t border-line bg-surface ${
          position?.side === "above" ? "-bottom-1 border-b border-r border-l-0 border-t-0" : "-top-1"
        }`}
        style={{ [align === "start" ? "left" : "right"]: 16 }} />
      {children}
    </div>
  );
}

/** 供调用方计算箭头预留的间距（内容不应贴到箭头）。 */
export const POPOVER_CARET_SPACE = GAP;
