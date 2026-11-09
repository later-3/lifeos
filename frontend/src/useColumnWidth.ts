import { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { DEFAULT_WIDTHS, dragWidth, layout, maxWidthOf, type Folded, type Widths } from "./design/layout";

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

export function useColumnWidth(input: { folded: Folded; panelOpen: boolean; historyOpen?: boolean; reviewOpen?: boolean; reviewRatio?: number }) {
  const [widths, setWidths] = useState<Widths>(loadWidths);
  const [viewport, setViewport] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => { localStorage.setItem(WIDTH_KEY, JSON.stringify({ version: WIDTH_VERSION, widths })); }, [widths]);

  const box = layout({ viewport, widths, requested: input.folded, panelOpen: input.panelOpen, historyOpen: input.historyOpen === true, reviewOpen: input.reviewOpen === true, reviewRatio: input.reviewRatio });

  /**
   * 拖动期间**不走 React 状态**，直接写列元素的宽度；松手时提交一次。
   *
   * 为什么（2026-11-09 用户报"拖动不丝滑"，实测确认）：
   * 旧实现每个 mousemove 都 `setWidths` → App 整棵树重渲染。实测 108 条消息的会话里，
   * 一次拖动产生 **4 个 108–148ms 的长任务**，帧时间 p90 从 10ms 涨到 16.7ms、最长 160ms；
   * 空会话则完全没有长任务 —— 成本全在"重渲染整条消息列表"（`MessageView` 未 memo）。
   *
   * 现在：拖动只改 DOM（`el.style.width`），一帧最多写一次（rAF 合并）；松手才 `setWidths`。
   * 聊天列是 `flex-1`，会自然跟着变宽变窄，不需要一起重算。
   * 这样既不牺牲"拖到哪停到哪"的准确度，也不需要在消息层引入 memo 的复杂度
   * （消息层的 props 里有十几个每帧重建的回调，memo 反而容易漏更新）。
   */
  function beginDrag(key: keyof Widths, event: ReactMouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widths[key];
    // 上限从视口算（`maxWidthOf`）：常量表只当下限/硬顶，实际能拖到哪由「不压破聊天」决定。
    // 旧实现只看常量表（c2≤440），1280 宽上明明能到 572 却停在 440，用户以为拖不动了。
    const limit = maxWidthOf(key, viewport, widths, input.folded);
    /*
     * 拖动目标**不靠一张手写映射表**找（2026-11-09 用户："每个区域都需要我单独点出来吗？
     * 以后新增是不是也不会按丝滑的方案？"）。
     *
     * 旧写法是一张 `{ c1: "agents", c2: "sessions" }` 的映射，只有左两列登记了，
     * 于是完整历史（c5）、文件面板（c4）、文件树（c4t）**三处都被漏掉**：
     * 实测这三个把手拖动时宽度全程不变、松手才跳一下 —— 手感与左边两列完全不同。
     *
     * 现在改成**通用约定**：任何可拖宽的区域，在自己的根元素上写 `data-resize-key="cX"`，
     * 拖动就自动是"逐帧跟手"的。新加区域只要写这一个属性，不需要改这里的任何代码。
     * 机器检查（ui-contract）：「把手数 = 可拖区域数」，且每个把手拖动都必须逐帧变化。
     */
    const target = document.querySelector<HTMLElement>(`[data-resize-key="${key}"]`) ?? undefined;

    let latest = startWidth;
    let frame = 0;
    const paint = () => {
      frame = 0;
      if (target !== undefined && target !== null) target.style.width = `${latest}px`;
    };
    // 方向来自把手位置（design/layout.ts HANDLE_SIGN），不在调用处判断
    const move = (moveEvent: MouseEvent) => {
      latest = dragWidth(key, startWidth, moveEvent.clientX - startX, limit);
      if (frame !== 0) return;                       // 一帧只写一次（mousemove 可能高于帧率）
      frame = window.requestAnimationFrame(paint);
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0; }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (target !== undefined && target !== null) target.style.width = "";   // 交还给 React
      setWidths((prev) => (prev[key] === latest ? prev : { ...prev, [key]: latest }));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return { widths, viewport, box, beginDrag };
}
