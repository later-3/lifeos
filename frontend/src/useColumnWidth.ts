import { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { DEFAULT_WIDTHS, dragCascade, dragWidth, layout, maxWidthOf, type Folded, type Widths } from "./design/layout";

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
    /*
     * **拖动是「一次算全部」而不是「自己改自己的宽度」**（2026-11-09 用户第二次报
     * 「文件树区域的拖动很垃圾」，并明确要求"从架构层面解决，不是单点"）：
     *
     *   拖内层（文件树 c4t）时，外层（文件面板 c4）要跟着长、必要时还要从左列借宽 ——
     *   这些决定全部在纯函数 `dragCascade()` 里（可穷举单测），组件只负责"把结果画出来"。
     *
     * 所以手里握的是**一份 widths 草稿**（draft），每帧算一次补丁、把**所有变化的元素**都写一遍；
     * 松手才提交一次 React 状态。新加嵌套可拖区域只需在 `RESIZE_PARENT` 登记一行，
     * 这里与 DOM 侧都不用改。
     */
    /*
     * **基准**与**草稿**必须分开（2026-11-09 实测踩到：树跟着鼠标多走了 70px）。
     *
     * `dragCascade` 的 `deltaX` 是从**按下那一刻**算起的累计位移，所以它的基准必须是
     * "按下时的 widths"（`base`，永远不变）；`draft` 只是"这一帧要画出来的样子"。
     * 如果拿 draft 当基准又把累计位移喂进去，位移会被重复累加 ——
     * 鼠标移 200px，树长了 270px，手感立刻不对。
     */
    const base: Widths = { ...widths };
    let draft: Widths = { ...base };
    const targets = new Map<keyof Widths, HTMLElement>();
    const targetOf = (name: keyof Widths): HTMLElement | undefined => {
      const cached = targets.get(name);
      if (cached !== undefined) return cached;
      const found = document.querySelector<HTMLElement>(`[data-resize-key="${name}"]`) ?? undefined;
      if (found !== undefined) targets.set(name, found);
      return found;
    };

    let frame = 0;
    let dirty: Array<keyof Widths> = [];
    const paint = () => {
      frame = 0;
      for (const name of dirty) {
        const element = targetOf(name);
        if (element !== undefined) element.style.width = `${draft[name]}px`;
      }
    };

    const move = (moveEvent: MouseEvent) => {
      // 每帧都从 base + 累计位移重算（幂等）：同一鼠标位置永远得到同一个结果，不会漂移
      const patch = dragCascade(key, base, moveEvent.clientX - startX, viewport, input.folded);
      dirty = Object.keys(patch) as Array<keyof Widths>;
      draft = { ...base, ...patch };
      if (frame !== 0) return;                       // 一帧只写一次（mousemove 可能高于帧率）
      frame = window.requestAnimationFrame(paint);
    };

    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      if (frame !== 0) { window.cancelAnimationFrame(frame); frame = 0; }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // 交还给 React（内联宽度清掉，否则会盖住新的存储值）
      for (const name of targets.keys()) {
        const element = targets.get(name);
        if (element !== undefined) element.style.width = "";
      }
      // 一次性提交：所有被改动的列（内层 + 外层 + 被借的左列）
      setWidths((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const name of Object.keys(draft) as Array<keyof Widths>) {
          if (prev[name] !== draft[name]) { next[name] = draft[name]; changed = true; }
        }
        return changed ? next : prev;
      });
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }


  return { widths, viewport, box, beginDrag };
}
