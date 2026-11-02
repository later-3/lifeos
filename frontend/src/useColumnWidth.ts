import { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { DEFAULT_WIDTHS, dragWidth, layout, type Folded, type Widths } from "./design/layout";

// 列宽与拖拽（数值全部走 design/layout.ts 的唯一计算入口）：
// - 持久化；旧格式（无 c4t）整体重置为默认，避免历史坏值把树钳死；
// - 拖“右边缘”= 正号；c4 把手在面板左缘 → 取反（右拉=面板变小）；
// - 组件不再自己声明宽度，折叠成本、面板上限、聊天保底全部由 layout() 决定。

const WIDTH_KEY = "lifeos.columnWidths";
/**
 * 宽度格式版本（Task 0015 · T15）。
 *
 * 为什么必须升版本：面板合并改变了 `c2` 的**语义**（旧 = 项目列 216，新 = 合并列 300，范围 240–440）。
 * 老用户的 localStorage 里存着 `c2: 216`，直接合并到默认值会让合并列一直是 216
 * ——比新下限 240 还窄，表现为"合并了但没变宽"。这是升级期的一次性迁移，不是常态分支。
 */
const WIDTH_VERSION = 2;

type StoredWidths = { version?: number; widths?: Partial<Widths> };

function loadWidths(): Widths {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (raw === null) return DEFAULT_WIDTHS;
    const parsed = JSON.parse(raw) as Partial<Widths> & Partial<StoredWidths>;
    // 旧格式（无 version）→ 整份重置：c1/c4/c4t/c5 都是用户拖过的，但 c2 语义变了，
    // 与其猜哪些还适用，不如回到默认（这些值用户都能再拖一次）。
    if (parsed.version !== WIDTH_VERSION) return DEFAULT_WIDTHS;
    const stored = parsed.widths;
    if (stored === undefined) return DEFAULT_WIDTHS;
    return { ...DEFAULT_WIDTHS, ...stored };
  } catch {
    return DEFAULT_WIDTHS;
  }
}

export function useColumnWidth(input: { folded: Folded; panelOpen: boolean; historyOpen?: boolean }) {
  const [widths, setWidths] = useState<Widths>(loadWidths);
  const [viewport, setViewport] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => { localStorage.setItem(WIDTH_KEY, JSON.stringify({ version: WIDTH_VERSION, widths })); }, [widths]);

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
