import { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

// 列宽与拖拽（从 App 拆出，2026-10-17 坏味道清理）：
// - 持久化 + 旧格式迁移（无 c4t 即整体重置，面板合并改版的一次性迁移）；
// - 拖拽方向规则：拖“右边缘”= 正号；c4 把手在面板**左**缘 → 取反（右拉=面板变小）；
// - 面板宽度 = 视口驱动（用户要求“往左拖更宽”：不再有 760 硬顶，上限 = 视口剩余 − 聊天保底）。

export type ColumnKey = "c1" | "c2" | "c3" | "c4" | "c4t";

const WIDTH_KEY = "lifeos.columnWidths";
const DEFAULT_WIDTHS: Record<ColumnKey, number> = { c1: 232, c2: 216, c3: 272, c4: 600, c4t: 240 };
/** c4 上限只作粗护栏（1600）；真正的最大宽度由视口与 MIN_CHAT 决定。 */
const WIDTH_LIMITS: Record<ColumnKey, [number, number]> = {
  c1: [180, 440], c2: [160, 400], c3: [200, 560], c4: [320, 1600], c4t: [160, 560],
};
/** 聊天保底：头部/输入不被面板挤没（窄于此面板自动收起）。 */
export const MIN_CHAT = 300;
/** 面板低于此宽度没有意义（树+查看器放不下）。 */
export const MIN_PANEL = 320;
/** 树与查看器之间的查看器保底（含 6px 把手）。 */
const MIN_VIEWER = 206;

function loadWidths(): Record<ColumnKey, number> {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<Record<ColumnKey, number>>;
      // 旧格式迁移：没有 c4t（面板合并改版前）→ 整体重置为新默认，避免旧值把树钳死。
      if (typeof parsed.c4t === "number") return { ...DEFAULT_WIDTHS, ...parsed };
    }
  } catch { /* 损坏则用默认 */ }
  return DEFAULT_WIDTHS;
}

export function useColumnWidth(visible: { nav: boolean; projects: boolean; sessions: boolean }) {
  const [widths, setWidths] = useState(loadWidths);
  const [viewport, setViewport] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => { localStorage.setItem(WIDTH_KEY, JSON.stringify(widths)); }, [widths]);

  /** 拖拽：夹紧区间内即时更新；松手由 widths effect 持久化。 */
  function beginDrag(key: ColumnKey, event: ReactMouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widths[key];
    const [min, max] = WIDTH_LIMITS[key];
    const sign = key === "c4" ? -1 : 1;   // c4 把手在面板左缘：往右拉 = 面板变小
    const move = (moveEvent: MouseEvent) => {
      const next = Math.min(max, Math.max(min, startWidth + sign * (moveEvent.clientX - startX)));
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

  // 视口挤压保护：左列收起越多，面板可拖得越宽（上限 = 视口 − 左侧固定宽 − 聊天保底）。
  const fixedWidth = (visible.nav ? widths.c1 + 6 : 20)
    + (visible.projects ? widths.c2 + 6 : 20)
    + (visible.sessions ? widths.c3 + 6 : 20);
  const maxPanel = viewport - fixedWidth - 6 - MIN_CHAT;
  const panelWidth = Math.max(0, Math.min(widths.c4, maxPanel));
  const treeWidth = Math.max(0, Math.min(widths.c4t, panelWidth - MIN_VIEWER));

  return { widths, beginDrag, panelWidth, treeWidth, panelFits: maxPanel >= MIN_PANEL };
}
