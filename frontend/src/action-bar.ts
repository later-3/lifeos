import type { ReactNode } from "react";

/**
 * 消息动作条（层）的注册协议与纯规则。
 *
 * 分工：功能只提供**一条描述**（`MessageAction`）；位置、间距、对齐、何时出现、点击后的反馈，
 * 全部由容器 `MessageActions`（message-actions.tsx）决定。这里只放"不依赖 React 的规则"，
 * 便于离线单测（不需要渲染组件）。
 *
 * 分层参照 vercel/ai-chatbot：`components/ai-elements/message.tsx` 导出 `MessageActions`（容器）
 * 与 `MessageAction`（原子），业务层 `components/chat/message-actions.tsx` 只声明原子。
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
  /** 成功后的短暂反馈文案（如"已复制"）；不填则成功无反馈 */
  doneLabel?: string;
  /** 失败时的文案；不填用"失败"，总是危险色 */
  failedLabel?: string;
  run: () => void | Promise<void>;
};

/** 动作的反馈阶段（由容器持有；动作本身不写状态）。 */
export type ActionFeedback = "done" | "failed";

/** 动作条的视觉语气：默认 / 成功（accent）/ 失败（danger）。 */
export type ActionTone = "default" | "accent" | "danger";

/** 按钮文案：反馈期间换成 doneLabel/failedLabel，否则用注册时的 label。 */
export function actionLabel(action: MessageAction, feedback: ActionFeedback | undefined): string {
  if (feedback === "done") return action.doneLabel ?? "完成";
  if (feedback === "failed") return action.failedLabel ?? "失败";
  return action.label;
}

export function actionTone(feedback: ActionFeedback | undefined): ActionTone {
  if (feedback === "failed") return "danger";
  if (feedback === "done") return "accent";
  return "default";
}

/**
 * 动作条是否可见。四条任一成立：
 * - 指针停在这条消息上；
 * - 设备没有悬停能力（触屏）；
 * - 有状态动作（`pinned`：这一轮失败，必须一眼看到）；
 * - 正在展示点击反馈（"已复制"不能因为鼠标移开就消失）。
 */
export function revealActions(state: { hovered: boolean; noHover: boolean; pinned: boolean; feedback: boolean }): boolean {
  return state.hovered || state.noHover || state.pinned || state.feedback;
}

/** 这一轮被抑制（如助手正在流式输出）时，一条动作都不出现。 */
export function visibleActions(actions: MessageAction[], suppressed: boolean): MessageAction[] {
  return suppressed ? [] : actions;
}
