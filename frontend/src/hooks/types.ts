/**
 * 领域 hook 共用类型（Task 0017 · P5）。
 *
 * 为什么单开一个文件而不是各自定义：`App.tsx` 里这些类型是**局部 type**（`Agent` / `Group` /
 * `Project` / `SessionItem`）。hook 要用它们就得从某处取；若从组件文件取，会形成
 * `App ↔ hook` 的双向依赖（ESM 能跑，但热更新顺序会变成隐式契约）。
 *
 * 这里只放**形状**，不放行为；`SessionRow` 直接复用后端的唯一形状（见下面那行 type 导入）。
 */
import type { SessionRow as SessionRowData } from "../../../src/session-rows.ts";
import type { AgentAvatarSpec } from "../views/agent-avatar";
import type { UserProfile } from "../views/user-avatar";

export type Agent = { id: string; name: string; description?: string; avatar?: AgentAvatarSpec };
export type { UserProfile };
export type Project = { id: string; name: string; isDefault: boolean; path?: string };
export type SessionItem = SessionRowData;
export type Group = { project: Project; sessions: SessionItem[] };
