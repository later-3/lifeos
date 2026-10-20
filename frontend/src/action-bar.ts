import type { ReactNode } from "react";

/**
 * 消息动作条（层）的注册协议。
 *
 * 功能只提供"一条动作描述"，**不再各自决定**位置、间距、对齐、何时出现、点击后的反馈——
 * 这些都由容器（message-actions.tsx 的 `MessageActionBar`）统一决定：
 * - 对齐：用户消息贴右、助手消息贴左（`side` 决定，调用方不传样式）；
 * - 间距/字号/命中区：容器内统一（≥28px、11px 文案、紧凑排布）；
 * - 可见性：悬停 / 无悬停设备 / `pinned`（状态动作常显）；
 * - 反馈：`doneLabel`/`failedLabel` + 1.5s 复原，由容器执行，功能不用自己写 timer。
 *
 * 分层参照 vercel/ai-chatbot：`components/ai-elements/message.tsx` 导出 `MessageActions`（容器）
 * 与 `MessageAction`（原子），业务在 `components/chat/message-actions.tsx` 里只声明这两个原子。
 */
export type MessageAction = {
  /** 稳定标识（React key；同一条消息里唯一） */
  key: string;
  label: string;
  icon?: ReactNode;
  /** 悬停提示；不填用 label */
  title?: string;
  /** 契约测试用的选择器（如 copy-message） */
  testId?: string;
  /** 状态动作：这一轮失败之类，**常显**（不受悬停控制） */
  pinned?: boolean;
  /** 成功后的短暂反馈文案（如"已复制"） */
  doneLabel?: string;
  /** 失败时的文案；不填用"失败"，总是危险色 */
  failedLabel?: string;
  run: () => void | Promise<void>;
};

/** 动作条是否可见：悬停 / 无悬停设备 / 有状态动作（状态动作必须常显，否则用户找不到）。 */
export function revealActions(hovered: boolean, noHover: boolean, pinned: boolean): boolean {
  return hovered || noHover || pinned;
}

/** 这一轮被抑制（如助手正在流式输出）时，一条动作都不出现。 */
export function visibleActions(actions: MessageAction[], suppressed: boolean): MessageAction[] {
  return suppressed ? [] : actions;
}
