import { useEffect, useRef, useState } from "react";
import { IconCheck } from "@tabler/icons-react";
import { revealActions, visibleActions, type MessageAction } from "./action-bar";

/**
 * 动作条容器：**功能往这里注册**（`MessageAction[]`），容器负责其余一切。
 * 新增动作只需要在 Message.tsx 里 push 一条描述，不用碰对齐/间距/可见性/反馈逻辑。
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

const IDLE_MS = 1500;

/** 单个动作按钮：容器负责视觉与反馈状态机（idle → done/failed → 自动复原）。 */
function ActionButton({ action }: { action: MessageAction }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (timer.current !== undefined) clearTimeout(timer.current); }, []);

  const activate = () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    Promise.resolve()
      .then(() => action.run())
      .then(() => setState("done"))
      .catch(() => setState("failed"))
      .finally(() => { timer.current = setTimeout(() => setState("idle"), IDLE_MS); });
  };

  const label = state === "done" ? (action.doneLabel ?? "完成") : state === "failed" ? (action.failedLabel ?? "失败") : action.label;
  const tone = state === "failed" ? "text-danger" : state === "done" ? "text-accent" : "text-ink-500 hover:text-ink-900";
  return (
    <button type="button" onClick={activate} title={action.title ?? action.label}
      {...(action.testId !== undefined ? { "data-testid": action.testId } : {})}
      className={`flex min-h-7 items-center gap-1 rounded-control px-2 text-micro transition-colors ${tone}`}>
      {state === "done" ? <IconCheck size={12} /> : action.icon}
      <span aria-live="polite">{label}</span>
    </button>
  );
}

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
  const shown = visibleActions(actions, suppressed);
  if (shown.length === 0) return null;
  const pinned = shown.some((action) => action.pinned === true);
  const visible = revealActions(hovered, noHover, pinned);
  return (
    <div data-testid="message-actions"
      className={`flex gap-1 pt-0.5 transition-opacity duration-150 ${side === "user" ? "justify-end" : "justify-start"} ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
      {shown.map((action) => <ActionButton key={action.key} action={action} />)}
    </div>
  );
}
