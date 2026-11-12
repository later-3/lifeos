/**
 * 选中行为（Task 0013 copy-on-select + Task 0018 选中功能条）的挂载点：
 * 一个 document 级 `mouseup` + 剪贴板写入 + 提示状态 + 功能条状态。
 *
 * 为什么挂在 **document** 而不是每个消息块上：
 * 批注的拖选监听只挂在 assistant 文本块（`AnnotatedTextBlock`），用户气泡 / 思考块 / 工具块都没有。
 * 用户 2026-11-07 拍板的范围是"对话区域的所有内容"，所以判据只能是"选区落没落在允许复制的区域里"。
 *
 * 允许区域（`zones`）：每个 zone 带自己的身份——
 *  - 对话区 `<main>`（`toolbar: true`）：复制/功能条都适用（功能条按设置与选区事实出按钮）；
 *  - 检视面板 `<aside data-testid="review-aside">`（`toolbar: false`）：只复制，不弹条（02-design D11——
 *    检视面板的复制是工具刚需，批注/引用对 diff 无意义）。
 * 两者是兄弟节点，必须显式列举（2026-11-09 实测：靠"在 main 里"推断漏了检视面板）。
 *
 * 为什么不是 `pointerup` / `click`：
 * 实测（真实 Chrome + pbpaste）鼠标松手时 `mouseup` 里 `navigator.clipboard.writeText` 可写（`ok`），
 * 选区也不受影响；双击选词 / 三击选段都走 `mouseup`。键盘选区（Shift+方向键、Ctrl+A）**不触发**
 * （与 Task 0013 D6 同口径）。
 *
 * **功能条的焦点纪律（Task 0013 教训 + 0018 硬约束）**：
 * 弹条与按钮**不得让焦点离开文档、不得清选区**（点按钮前选区还在才能换算批注锚点）；
 * 只有「批注」被点击后才发生焦点转移（进草稿框 textarea，编辑态抢焦点合法）。
 * 按钮 `mousedown` preventDefault 由 `selection-toolbar.tsx` 负责；这里的动作全部基于**弹出时的快照**
 *（text + range.cloneRange()），不依赖活选区（`02-references.md` §1.2，Open WebUI / LibreChat 一致）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  copyLabel, shouldCopy, selectionAction, COPY_FEEDBACK_MS,
  type RectLike, type SelectionPrefsShape, type ToolbarButtons,
} from "./copy-on-select";
import type { CopyFeedback } from "./copy-toast";
import { copyText } from "./clipboard";

/** 一个允许选区的区域：元素 ref + 是否允许功能条。 */
export type CopyZone = { current: HTMLElement | null; toolbar?: boolean };

/** 事件目标里这些标签/属性代表"正在输入"，选区是用来替换的，不该复制/弹条。 */
function inFormField(node: Node | null): boolean {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  if (element === null) return false;
  if (element.closest("input, textarea, select") !== null) return true;
  return element.closest("[contenteditable='true']") !== null;
}

/** assistant 文本块的宿主（`data-block-index` 只在 AnnotatedTextBlock 的 host 上）。 */
function blockHostOf(node: Node): HTMLElement | null {
  let cur: Element | null = node instanceof Element ? node : node.parentElement;
  while (cur !== null) {
    if (cur.getAttribute("data-block-index") !== null) return cur as HTMLElement;
    cur = cur.parentElement;
  }
  return null;
}

/** 选区是否可批注：起止都落在同一个 assistant 文本块，且该块不在流式生成中（文字在变，锚点会漂）。 */
function annotatableOf(range: Range): boolean {
  const startHost = blockHostOf(range.startContainer);
  if (startHost === null || startHost !== blockHostOf(range.endContainer)) return false;
  return startHost.getAttribute("data-anno-busy") !== "1";
}

/** 说话人（引用前缀用，D15）：向上找消息容器的 `data-role`。 */
function speakerOf(node: Node): "user" | "assistant" | undefined {
  let cur: Element | null = node instanceof Element ? node : node.parentElement;
  while (cur !== null) {
    const role = cur.getAttribute("data-role");
    if (role === "user" || role === "assistant") return role;
    cur = cur.parentElement;
  }
  return undefined;
}

/** 批注路由需要 messageId（向上找消息容器）。 */
function messageIdOf(node: Node): string | undefined {
  let cur: Element | null = node instanceof Element ? node : node.parentElement;
  while (cur !== null) {
    const id = cur.getAttribute("data-message-id");
    if (id !== null) return id;
    cur = cur.parentElement;
  }
  return undefined;
}

/** 功能条的一次弹出状态：全部来自**弹出时的快照**，之后点按钮不依赖活选区。 */
export type SelectionToolbarState = {
  /** 选中文本快照（原义，未 trim；显示/复制/引用都用它）。 */
  text: string;
  /** 选区视口矩形快照（定位用；滚动跟随会更新这一个字段）。 */
  anchor: RectLike;
  /** 选区是否可批注（同一非流式 assistant 文本块）。 */
  annotatable: boolean;
  /** 说话人（引用前缀）。 */
  speaker: "user" | "assistant" | undefined;
  /** 批注路由：选区落在哪条消息。 */
  messageId: string | undefined;
  /** 条上按钮（selectionAction 弹出时定死——之后设置变化不影响本条）。 */
  buttons: ToolbarButtons;
  /** 内部：活 Range 快照（滚动跟随重新量矩形用；组件不渲染它）。 */
  rangeSnapshot: Range;
};

export type UseCopyOnSelectResult = {
  feedback: CopyFeedback | null;
  toolbar: SelectionToolbarState | null;
  closeToolbar: () => void;
  /** 关态「复制」按钮的动作（写剪贴板 + 胶囊 + 收条）。 */
  submitCopy: () => void;
};

export function useCopyOnSelect(
  zones: ReadonlyArray<CopyZone>,
  prefs: SelectionPrefsShape,
  onError: (message: string) => void,
): UseCopyOnSelectResult {
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null);
  const [toolbar, setToolbar] = useState<SelectionToolbarState | null>(null);
  const seq = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  // 回调放 ref：onError/prefs 每次渲染都是新值，直接进依赖会让监听反复卸载重挂
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const show = useCallback((text: string, rect: RectLike) => {
    seq.current += 1;
    setFeedback({ text: copyLabel(text), rect, seq: seq.current });
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFeedback(null), COPY_FEEDBACK_MS);
  }, []);

  const closeToolbar = useCallback(() => setToolbar(null), []);

  /** 关态的「复制」按钮：写剪贴板 → 胶囊反馈（与开态同一组件同一时机）→ 收条。 */
  const submitCopy = useCallback(() => {
    const current = toolbarRef.current;
    if (current === null) return;
    const text = current.text;
    const anchor = current.anchor;
    void copyText(text).then(
      () => { show(text, anchor); closeToolbar(); },
      () => {
        let ok = false;
        try { ok = document.execCommand("copy"); } catch { ok = false; }
        if (ok) { show(text, anchor); closeToolbar(); return; }
        errorRef.current("复制失败：浏览器拒绝了剪贴板写入");
        closeToolbar();
      },
    );
  }, [show, closeToolbar]);

  /**
   * 「按下那一刻的选区文本与坐标」——用来区分**按下-拖动**与**在已有选区里单击**。
   *
   * 实测（真实 Chrome）：在已有选区内部单击时，`mouseup` 时选区**还是完整的**
   * （浏览器在 click 之后才清），所以只判"`mouseup` 有没有选区"会把一次普通点击也当成复制。
   * 判据是**两条同时成立**才算单击：①鼠标几乎没动（≤3px）②选区文本与按下时一样。
   */
  const pressAt = useRef<{ text: string; x: number; y: number } | null>(null);
  /** zones 数组本身每次渲染都是新的，但元素引用只在挂载/卸载时变；用 ref 转一手避免反复重挂监听。 */
  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  // —— 功能条生命周期内：滚动跟随（重锚定）+ 塌缩关闭 —— //
  const toolbarRef = useRef(toolbar);
  toolbarRef.current = toolbar;
  useEffect(() => {
    if (toolbar === null) return;
    // range 存在 state 里（弹出时 cloneRange）；滚动/resize 时用**同一个 range** 重新量矩形。
    const liveRange = toolbar.rangeSnapshot;
    let frame = 0;
    const reanchor = () => {
      frame = 0;
      const current = toolbarRef.current;
      if (current === null || current.rangeSnapshot !== liveRange) return; // 已换了新弹出
      const rect = liveRange.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) { setToolbar(null); return; }   // 选区内容没了（重渲染替换节点）
      setToolbar({ ...current, anchor: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } });
    };
    const schedule = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(reanchor);
    };
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [toolbar]);

  // —— mousedown 记按点（区分单击）+ 条外按下关闭 + Esc 关闭 —— //
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const selection = window.getSelection();
      pressAt.current = { text: selection === null ? "" : selection.toString(), x: event.clientX, y: event.clientY };
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (toolbarRef.current !== null) { closeToolbar(); event.stopPropagation(); }
    };
    const onSelectionChange = () => {
      // 选区塌缩即收（含"流式重渲染替换文本节点"这种不发输入事件的塌缩路径；
      // LibreChat QuoteButton.tsx:448-454 点名的坑）。
      if (toolbarRef.current === null) return;
      const selection = window.getSelection();
      if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) closeToolbar();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onEsc, true);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onEsc, true);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [closeToolbar]);

  useEffect(() => {
    const onUp = (event: MouseEvent) => {
      const selection = window.getSelection();
      const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const node = range === null ? null : range.commonAncestorContainer;
      const host = node instanceof Element ? node : (node?.parentElement ?? null);
      const zonesNow = zonesRef.current;
      const zone = zonesNow.find((z) => z.current?.contains(host) === true);
      const insideZone = zone !== undefined;
      const allowToolbar = zone?.toolbar === true;

      const text = selection === null ? "" : selection.toString();
      const facts = {
        insideZone,
        collapsed: selection === null || selection.isCollapsed || range === null,
        text,
        // 目标元素优先用松手点：落点在 input 里时 commonAncestorContainer 可能是外层
        inFormField: inFormField(event.target as Node | null) || inFormField(node),
        annotatable: range !== null && allowToolbar && annotatableOf(range),
      };
      if (!shouldCopy(facts)) return;
      // 在已有选区里单击（没移动 + 选区没变）= 不是复制/弹条动作，跳过。
      const press = pressAt.current;
      if (press !== null && press.text !== "" && press.text === text
        && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 3) return;

      const action = selectionAction(facts, prefsRef.current);
      const anchor = range !== null ? range.getBoundingClientRect() : null;
      const rect: RectLike | null = anchor !== null && (anchor.width > 0 || anchor.height > 0)
        ? { top: anchor.top, bottom: anchor.bottom, left: anchor.left, right: anchor.right }
        : null;

      // ① 松手即复制（开态）：先立即写（用户按 Cmd+V 的时刻可能就在下一帧），成功后再出提示。
      if (action.copyNow) {
        void copyText(text).then(
          () => { if (rect !== null) show(text, rect); },
          () => {
            // writeText 失败（非安全上下文 / 权限被拒）：退回对**当前选区**的 execCommand。
            let ok = false;
            try { ok = document.execCommand("copy"); } catch { ok = false; }
            if (ok) { if (rect !== null) show(text, rect); return; }
            errorRef.current("复制失败：浏览器拒绝了剪贴板写入");
          },
        );
      }

      // ② 功能条（两种设置都弹；按钮组合由 selectionAction 决定）。
      if (action.showToolbar && rect !== null && range !== null) {
        setToolbar({
          text,
          anchor: rect,
          annotatable: facts.annotatable,
          speaker: node === null ? undefined : speakerOf(node),
          messageId: node === null ? undefined : messageIdOf(node),
          buttons: action.toolbar,
          rangeSnapshot: range.cloneRange(),
        });
      } else if (!action.showToolbar) {
        setToolbar(null);
      }
    };
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mouseup", onUp);
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    };
  }, [show]);

  return { feedback, toolbar, closeToolbar, submitCopy };
}
