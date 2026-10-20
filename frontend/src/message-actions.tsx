import { useEffect, useRef, useState } from "react";
import { IconCheck } from "@tabler/icons-react";
import {
  actionLabel, actionTone, revealActions, visibleActions,
  type ActionFeedback, type ActionTone, type MessageAction,
} from "./action-bar";

/**
 * 动作条容器：功能往这里**注册描述**（`MessageAction[]`），容器负责其余一切。
 *
 * 容器独占：对齐（按消息一侧）、间距与命中区、可见性（悬停/触屏/反馈期间）、
 * 点击反馈状态机与自动复原（1.5s）。功能侧不写样式、不写 timer、不判可见性。
 */

/** 触屏/无悬停设备：动作常显（悬停设备：悬停才显示）。 */
function useNoHover(): boolean {
  const [noHover, setNoHover] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(hover: none)");
    const update = () => setNoHover(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return noHover;
}

const TONE_CLASS: Record<ActionTone, string> = {
  default: "text-ink-500 hover:text-ink-900",
  accent: "text-accent",
  danger: "text-danger",
};

const FEEDBACK_MS = 1500;

export function MessageActionBar({ side, actions, hovered, suppressed = false }: {
  /** 消息一侧：用户贴右、助手贴左（对齐是容器的决定，调用方不传样式） */
  side: "user" | "assistant";
  actions: MessageAction[];
  /** 指针是否停在这条消息上（消息层提供的事实；何时显示由容器按规则决定） */
  hovered: boolean;
  /** 这一轮被抑制（如助手正在流式输出）：一条动作都不出现 */
  suppressed?: boolean;
}) {
  const noHover = useNoHover();
  // 反馈状态机在容器里：一条动作一个状态 + 一个定时器；卸载时统一清理
  const [feedback, setFeedback] = useState<Record<string, ActionFeedback>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, []);

  const clear = (key: string) => setFeedback((prev) => {
    if (prev[key] === undefined) return prev;
    const { [key]: _removed, ...rest } = prev;
    return rest;
  });

  const settle = (action: MessageAction, next: ActionFeedback | undefined) => {
    const previous = timers.current.get(action.key);
    if (previous !== undefined) { clearTimeout(previous); timers.current.delete(action.key); }
    if (next === undefined) { clear(action.key); return; }          // 成功但这动作不需要反馈
    setFeedback((prev) => ({ ...prev, [action.key]: next }));
    timers.current.set(action.key, setTimeout(() => {
      timers.current.delete(action.key);
      clear(action.key);
    }, FEEDBACK_MS));
  };

  const activate = (action: MessageAction) => {
    // 失败一律给可见反馈（failedLabel），成功则看这个动作要不要 doneLabel
    Promise.resolve()
      .then(() => action.run())
      .then(() => settle(action, action.doneLabel === undefined ? undefined : "done"))
      .catch(() => settle(action, "failed"));
  };

  const shown = visibleActions(actions, suppressed);
  if (shown.length === 0) return null;
  const hasFeedback = shown.some((action) => feedback[action.key] !== undefined);
  const visible = revealActions({ hovered, noHover, feedback: hasFeedback });

  return (
    <div data-testid="message-actions"
      className={`flex gap-1 pt-0.5 transition-opacity duration-150 ${side === "user" ? "justify-end" : "justify-start"} ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
      {shown.map((action) => {
        const state = feedback[action.key];
        return (
          <button key={action.key} type="button" onClick={() => activate(action)}
            title={action.title ?? action.label}
            {...(action.testId !== undefined ? { "data-testid": action.testId } : {})}
            className={`flex min-h-7 items-center gap-1 rounded-control px-2 text-micro transition-colors ${TONE_CLASS[actionTone(state)]}`}>
            {state === "done" ? <IconCheck size={12} /> : action.icon}
            <span aria-live="polite">{actionLabel(action, state)}</span>
          </button>
        );
      })}
    </div>
  );
}
