import { useEffect, useRef, useState } from "react";
import { IconMinus, IconPlus, IconX } from "@tabler/icons-react";
import { useDialogFocus } from "./overlay";
import {
  ZOOM_STEP, clampZoom, clampPan, displaySize, fitSize, nextZoom, zoomPercent,
} from "./image-zoom";

/**
 * 图片查看器（悬浮放大缩小）——用户 2026-10-27 要求：
 * 点图片不要新开页面，就是在当前页面浮出来，并且能放大缩小。
 *
 * 参考（动机见括号）：
 * - pi-web 上游 `components/ImagePreview.tsx`（e533d9b）：点击 → 原生 `<dialog>` 全屏浮层、
 *   Esc/点背景/关闭按钮关闭、触发器是 button（`cursor: zoom-in`）。我们照抄这部分交互契约。
 * - pi-web **没有**缩放；用户明确要求放大看细节，所以补滚轮/按钮/键盘缩放 + 拖动平移。
 *
 * 缩放数学是纯函数（`clampZoom` 等）：可穷举单测，组件只负责绑定事件（frontend 2.13）。
 */

export function ImageViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | undefined>();
  const panelRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | undefined>(undefined);

  // 焦点陷阱 + Esc 关闭 + 锁背景滚动 + 关闭后还焦点（模态契约，闸 3）
  useDialogFocus(panelRef, onClose);

  const measure = () => {
    const node = boxRef.current;
    if (node === null) return;
    setBox({ w: node.clientWidth, h: node.clientHeight });
  };
  useEffect(() => { measure(); const onResize = () => measure(); window.addEventListener("resize", onResize); return () => window.removeEventListener("resize", onResize); }, []);

  const fit = natural !== undefined ? fitSize(natural.w, natural.h, box.w, box.h) : { w: 0, h: 0 };
  const shown = displaySize(fit.w, fit.h, zoom);

  const setZoomClamped = (next: number) => {
    const z = clampZoom(next);
    setZoom(z);
    // 放大级别变了 → 平移可能越界（图片变小回不来），重新钳一次
    setPan((current) => ({
      x: clampPan(current.x, fit.w * z, box.w),
      y: clampPan(current.y, fit.h * z, box.h),
    }));
  };

  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`查看图片${alt !== "" ? `：${alt}` : ""}`}
      data-testid="image-viewer"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/90 p-6"
      // 点空白处关闭（pi-web 同款契约）
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        // useDialogFocus 负责 Esc/Tab；这里只补缩放键
        if (event.key === "+" || event.key === "=") { event.preventDefault(); setZoomClamped(nextZoom(zoom, 1)); }
        else if (event.key === "-" || event.key === "_") { event.preventDefault(); setZoomClamped(nextZoom(zoom, -1)); }
        else if (event.key === "0") { event.preventDefault(); reset(); }
      }}
    >
      <div
        ref={boxRef}
        className="relative flex h-full w-full items-center justify-center overflow-hidden p-6"
        data-testid="image-viewer-stage"
        onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
        onWheel={(event) => { event.preventDefault(); setZoomClamped(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)); }}
        onDoubleClick={() => { if (zoom !== 1) reset(); else setZoomClamped(2); }}
        onPointerDown={(event) => {
          if (zoom === 1 || event.button !== 0) return;          // 没放大就别拖，避免误触
          dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
          (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = dragRef.current;
          if (start === undefined) return;
          setPan({
            x: clampPan(start.panX + event.clientX - start.x, shown.w, box.w),
            y: clampPan(start.panY + event.clientY - start.y, shown.h, box.h),
          });
        }}
        onPointerUp={() => { dragRef.current = undefined; }}
        onPointerCancel={() => { dragRef.current = undefined; }}
      >
        <img
          src={src}
          alt={alt}
          data-testid="image-viewer-img"
          draggable={false}
          onLoad={(event) => { const image = event.currentTarget; setNatural({ w: image.naturalWidth, h: image.naturalHeight }); }}
          style={{
            width: shown.w || undefined,
            height: shown.h || undefined,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
            transition: dragRef.current === undefined ? "transform 120ms, width 120ms, height 120ms" : "none",
            cursor: zoom === 1 ? "default" : "grab",
            maxWidth: "none",
          }}
        />
      </div>

      {/* 工具条：缩放 + 位置 + 关闭。位置浮在底部，不遮图片。 */}
      <div className="absolute inset-x-0 bottom-4 flex items-center justify-center" data-testid="image-viewer-tools">
        <div className="flex items-center gap-1 rounded-full bg-ink-900/75 px-1.5 py-1 ring-1 ring-surface/20">
        <button
          type="button" data-testid="zoom-out" aria-label="缩小" title="缩小"
          onClick={() => setZoomClamped(nextZoom(zoom, -1))}
          className="h-11 w-11 sm:h-9 sm:w-9 rounded text-surface hover:bg-surface/20"
        >
          <IconMinus size={16} className="mx-auto" />
        </button>
        <button
          type="button" data-testid="zoom-reset" title="重置为适应窗口"
          onClick={reset}
          className="h-11 px-3 sm:h-9 rounded font-mono text-micro tabular-nums text-surface hover:bg-surface/20"
        >
          {zoomPercent(zoom)}
        </button>
        <button
          type="button" data-testid="zoom-in" aria-label="放大" title="放大"
          onClick={() => setZoomClamped(nextZoom(zoom, 1))}
          className="h-11 w-11 sm:h-9 sm:w-9 rounded text-surface hover:bg-surface/20"
        >
          <IconPlus size={16} className="mx-auto" />
        </button>
        <button
          type="button" data-testid="image-viewer-close" aria-label="关闭图片" title="关闭图片"
          onClick={onClose}
          className="ml-3 h-11 w-11 sm:h-9 sm:w-9 rounded text-surface hover:bg-surface/20"
        >
          <IconX size={16} className="mx-auto" />
        </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 图片触发器：谁要"点了能放大"，就把它包起来。
 * 触发器是 button 而不是 <a>（pi-web 同款）：不开新页面、有 aria-haspopup、有焦点环。
 */
export function ImageTrigger({ src, alt, className, children, testId }: {
  src: string; alt: string; className?: string; children: React.ReactNode; testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`放大查看：${alt}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="点击放大"
        data-testid={testId}
        className={`block cursor-zoom-in border-0 bg-transparent p-0 text-inherit ${className ?? ""}`}
      >
        {children}
      </button>
      {open && <ImageViewer src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
