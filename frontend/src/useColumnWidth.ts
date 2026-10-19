import { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { DEFAULT_WIDTHS, dragWidth, layout, type Folded, type Widths } from "./design/layout";

// 列宽与拖拽（数值全部走 design/layout.ts 的唯一计算入口）：
// - 持久化；旧格式（无 c4t）整体重置为默认，避免历史坏值把树钳死；
// - 拖“右边缘”= 正号；c4 把手在面板左缘 → 取反（右拉=面板变小）；
// - 组件不再自己声明宽度，折叠成本、面板上限、聊天保底全部由 layout() 决定。

const WIDTH_KEY = "lifeos.columnWidths";

function loadWidths(): Widths {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<Widths>;
      if (typeof parsed.c4t === "number") return { ...DEFAULT_WIDTHS, ...parsed };
    }
  } catch { /* 损坏则用默认 */ }
  return DEFAULT_WIDTHS;
}

export function useColumnWidth(input: { folded: Folded; panelOpen: boolean; historyOpen?: boolean }) {
  const [widths, setWidths] = useState<Widths>(loadWidths);
  const [viewport, setViewport] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => { localStorage.setItem(WIDTH_KEY, JSON.stringify(widths)); }, [widths]);

  const box = layout({ viewport, widths, requested: input.folded, panelOpen: input.panelOpen, historyOpen: input.historyOpen === true });

  function beginDrag(key: keyof Widths, event: ReactMouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widths[key];
    // 方向来自把手位置（design/layout.ts HANDLE_SIGN），不在调用处判断
    const move = (moveEvent: MouseEvent) => {
      const next = dragWidth(key, startWidth, moveEvent.clientX - startX);
      setWidths((prev) => ({ ...prev, [key]: next }));
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return { widths, viewport, box, beginDrag };
}
