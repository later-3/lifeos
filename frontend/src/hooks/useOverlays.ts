/**
 * 弹层与模态（Task 0017 · P5 领域 hook #3）。
 *
 * ## 这个 hook 管什么
 *
 * 一类"临时占据界面、用完即关"的状态：确认框、项目概览卡、会话历史视图、
 * 添加项目对话框、助手配置模态、手机导航层级、对端对话抽屉、会话重命名。
 *
 * ## 为什么它们归一起
 *
 * 共同点：**都不属于会话数据**，都只在界面上"打开/关闭"，且都靠 Esc/点外部/点按钮关闭。
 * 它们散在 `App.tsx` 里时，任何一处弹层的开合都会让整个会话树参与 render。
 *
 * ## 纪律
 *
 * - 重命名是**行内状态**（`{ sid, value }`）：`sid` 决定哪一行显示输入框，`value` 是**正在输入**的值。
 *   两者必须一起搬——分开搬会让输入框在打字时被重置。
 * - `confirm` 的 `run` 是**动作闭包**：调用方传进来就执行，本 hook 不判断业务。
 * - 概览卡的 `anchorRef` 留在这里（Popover 定位锚是弹层自身的一部分）。
 */
import { useRef, useState } from "react";

import type { AgentAvatarSpec } from "../agent-avatar";
import type { Level } from "../mobile-nav";
import type { PeerTarget } from "../PeerPanel";

/** 助手（与 App.tsx 内的局部 type 同一形状；搬出来供本 hook 用）。 */
export type Agent = { id: string; name: string; description?: string; avatar?: AgentAvatarSpec };

export type { Level, PeerTarget };

export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => void;
};

export type OverviewTarget = { agentId: string; projectId: string; name: string };
export type HistoryTarget = { sessionId: string; title: string };
export type RenameDraft = { sid: string; value: string };

export function useOverlays() {
  const [confirm, setConfirm] = useState<ConfirmRequest>();
  const [overview, setOverview] = useState<OverviewTarget>();
  /** 概览卡的定位锚（Popover 用；不是 state，但只服务于这个弹层）。 */
  const overviewAnchor = useRef<HTMLElement | null>(null);
  const [history, setHistory] = useState<HistoryTarget>();
  const [addingProject, setAddingProject] = useState(false);
  const [configAgent, setConfigAgent] = useState<Agent>();
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileNavLevel, setMobileNavLevel] = useState<Level>("agents");
  const [peerTarget, setPeerTarget] = useState<PeerTarget | undefined>(undefined);
  const [renaming, setRenaming] = useState<RenameDraft>();

  return {
    confirm, setConfirm,
    overview, setOverview, overviewAnchor,
    history, setHistory,
    addingProject, setAddingProject,
    configAgent, setConfigAgent,
    mobileNav, setMobileNav,
    mobileNavLevel, setMobileNavLevel,
    peerTarget, setPeerTarget,
    renaming, setRenaming,
  };
}
