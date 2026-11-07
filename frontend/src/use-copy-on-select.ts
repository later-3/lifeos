/**
 * 选中即复制（Task 0013）的挂载点：一个 document 级 mouseup + 剪贴板写入 + 提示状态。
 *
 * 为什么挂在 **document** 而不是每个消息块上：
 * 现有批注的拖选监听只挂在 assistant 文本块（`AnnotatedTextBlock`，唯一使用者 `Message.tsx:425`），
 * 用户气泡 / 思考块 / 工具块都没有监听。用户 2026-11-07 拍板的范围是"对话区域的所有内容"，
 * 所以判据只能是"选区落没落在 `<main>` 里"。
 *
 * 为什么不是 `pointerup` / `click`：
 * 实测（真实 Chrome + pbpaste）鼠标松手时 `mouseup` 里 `navigator.clipboard.writeText`
 * 可写（`ok`），选区也不受影响；`pointerup` 同样可行但 `mouseup` 与浏览器原生的选区定稿同一时机。
 * 双击选词 / 三击选段也都走 `mouseup`（实测：双击的第二次 mouseup 已拿到完整词，
 * 三击的第三次 mouseup 已拿到整段）——所以不需要额外监听 `dblclick`。
 *
 * 键盘选区（Shift+方向键、Ctrl+A）**不触发**：Pi TUI 的 copy-on-select 也是鼠标驱动；
 * 且 Ctrl+A 会把整段对话静默塞进剪贴板。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { copyLabel, shouldCopy, COPY_FEEDBACK_MS } from "./copy-on-select";
import type { CopyFeedback } from "./copy-toast";
import { copyText } from "./clipboard";

/** 事件目标里这些标签/属性代表"正在输入"，选区是用来替换的，不该复制。 */
function inFormField(node: Node | null): boolean {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  if (element === null) return false;
  if (element.closest("input, textarea, select") !== null) return true;
  return element.closest("[contenteditable='true']") !== null;
}

export function useCopyOnSelect(zoneRef: { current: HTMLElement | null }, onError: (message: string) => void): CopyFeedback | null {
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null);
  const seq = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  // 回调放 ref：onError 每次渲染都是新函数，直接进依赖会让监听反复卸载重挂
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const show = useCallback((text: string, rect: { top: number; bottom: number; left: number; right: number }) => {
    seq.current += 1;
    setFeedback({ text: copyLabel(text), rect, seq: seq.current });
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFeedback(null), COPY_FEEDBACK_MS);
  }, []);

  /**
   * 「按下那一刻的选区文本与坐标」——用来区分**按下-拖动**与**在已有选区里单击**。
   *
   * 实测（真实 Chrome）：在已有选区内部单击时，`mouseup` 时选区**还是完整的**
   *（浏览器在 click 之后才清），所以只判"`mouseup` 有没有选区"会把一次普通点击也当成复制。
   *
   * 判据是**两条同时成立**才算单击：①鼠标几乎没动（≤3px）②选区文本与按下时一样。
   * 只判②不够：重复拖选同一段文字时选区也不变，但那是用户明确要复制（应重新复制并重新计时）。
   */
  const pressAt = useRef<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const selection = window.getSelection();
      pressAt.current = { text: selection === null ? "" : selection.toString(), x: event.clientX, y: event.clientY };
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, []);

  useEffect(() => {
    const onUp = (event: MouseEvent) => {
      const selection = window.getSelection();
      const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const node = range === null ? null : range.commonAncestorContainer;
      const host = node instanceof Element ? node : (node?.parentElement ?? null);
      const zone = zoneRef.current;

      const text = selection === null ? "" : selection.toString();
      const facts = {
        insideZone: zone !== null && host !== null && zone.contains(host),
        collapsed: selection === null || selection.isCollapsed || range === null,
        text,
        // 目标元素优先用松手点：落点在 input 里时 commonAncestorContainer 可能是外层
        inFormField: inFormField(event.target as Node | null) || inFormField(node),
      };
      if (!shouldCopy(facts)) return;
      // 在已有选区里单击（没移动 + 选区没变）= 不是复制动作，跳过。
      const press = pressAt.current;
      if (press !== null && press.text !== "" && press.text === text
        && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 3) return;

      const rect = range === null ? null : range.getBoundingClientRect();
      const anchor = rect !== null && (rect.width > 0 || rect.height > 0)
        ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
        : null;
      if (anchor === null) return;

      // 先立即写（用户按 Cmd+V 的时刻可能就在下一帧），成功后再出提示。
      void copyText(text).then(
        () => { show(text, anchor); },
        () => {
          // writeText 失败（非安全上下文 / 权限被拒）：退回对**当前选区**的 execCommand。
          // 实测这条路径不动选区、返回 true；仍失败才报错（不静默吞）。
          let ok = false;
          try { ok = document.execCommand("copy"); } catch { ok = false; }
          if (ok) { show(text, anchor); return; }
          errorRef.current("复制失败：浏览器拒绝了剪贴板写入");
        },
      );
    };
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mouseup", onUp);
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    };
  }, [zoneRef, show]);

  return feedback;
}
