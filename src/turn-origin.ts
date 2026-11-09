// 一轮的发起者（"这一轮是谁说的"）。
//
// ## 为什么需要它
//
// Pi 的消息只有 role 级身份：`UserMessage = { role, content, timestamp }`（`pi/packages/ai/src/types.ts:564-568`），
// `AgentMessage` 也没有 author（`pi/packages/agent/src/types.ts:374`）。
// 于是界面上的"谁说的"只能按 role 硬编码（`isUser ? 用户 : 当前 Agent`），
// 而 Agent↔Agent 会话里那唯一一条 user 消息其实是**发起方 Agent** 写的 —— 界面却显示成用户。
//
// ## 载体为什么是 plain custom 条目
//
// - 它**立即落盘**（`pi/packages/coding-agent/src/core/session-manager.ts:1191-1196`）→ 刷新/重启后仍然正确；
// - 它**不是消息** → 不进界面消息、不进 counts（`src/session-rows.ts` 只数四种 role）；
// - 它**不进模型上下文**（`sessionEntryToContextMessages` 对 plain custom 返回 `[]`，同文件 `:439-466`）。
//
// 模型侧另有一条通道：系统提示的 `sections`（见 `speakerSection`），
// 与 `src/assembly.ts` 已经在用的 `lifeos_interaction_harness` 同一机制。
//
// ## 参考
//
// - Zulip `zerver/models/messages.py:106`：`sender_id` 是消息的一列（不靠 role 推）；
// - Mattermost `server/public/model/post.go:150`：`UserId` 必填且可校验；
// - Open WebUI `backend/open_webui/models/chats.py:438`：`message.user_id or chat.user_id`（有就记、没有就回落、不猜）。
// 详见 Task 0014 的 `07-references.md` §2。

/** 会话里记录"这一轮谁发起"的自定义条目类型。 */
export const TURN_ORIGIN_ENTRY = "lifeos_turn_origin";

/** 一轮的发起者。`kind: "user"` = 用户本人（含经 HTTP 发送的一切）；`kind: "agent"` = 另一个 Agent 用工具发起。 */
export type TurnOrigin =
  | { kind: "user" }
  | {
    kind: "agent";
    /** 发起方 Agent id（如 coder）。 */
    agentId: string;
    /** 发起方显示名（写入口时带上，读侧不必再查一次 agents 目录）。 */
    name?: string;
    /** 通过哪个工具发起：`lifeos_ask` / `lifeos_send`。 */
    via?: string;
  };

export const USER_ORIGIN: TurnOrigin = { kind: "user" };

/** 落盘形状（读侧全部可选，容忍老数据与坏行）。 */
export type StoredOrigin = {
  kind?: unknown;
  agentId?: unknown;
  name?: unknown;
  via?: unknown;
  turnId?: unknown;
  at?: unknown;
};

/** 把落盘的 data 解析成 `TurnOrigin`；解析不出来 → undefined（**绝不猜**）。 */
export function parseOrigin(data: StoredOrigin | undefined): TurnOrigin | undefined {
  if (data === undefined) return undefined;
  if (data.kind === "user") return { kind: "user" };
  if (data.kind !== "agent") return undefined;
  const agentId = typeof data.agentId === "string" ? data.agentId.trim() : "";
  if (agentId === "") return undefined;   // 没有 id 的 agent origin 没有意义：宁可回落成用户，也不编一个
  return {
    kind: "agent",
    agentId,
    ...(typeof data.name === "string" && data.name.trim() !== "" ? { name: data.name.trim() } : {}),
    ...(typeof data.via === "string" && data.via.trim() !== "" ? { via: data.via.trim() } : {}),
  };
}

/** 一轮的条目形状（只用到 type / customType / data）。 */
type EntryLike = { type?: string; customType?: string; data?: unknown };

/**
 * 会话分支里**最后一条** origin（= 当前这一轮是谁发起的）。
 *
 * 与 `activeTaskOf()` 完全同一手法（从 branch 末尾往前找）：Task 也是这样"最后一次为准"。
 */
export function lastOriginOf(branch: ReadonlyArray<EntryLike>): TurnOrigin | undefined {
  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i];
    if (entry?.type !== "custom" || entry.customType !== TURN_ORIGIN_ENTRY) continue;
    return parseOrigin(entry.data as StoredOrigin | undefined);
  }
  return undefined;
}

/** 展示名：有 name 用 name，否则用 id（与会话行的 `peer.name ?? peer.id` 同口径）。 */
export function originLabel(origin: TurnOrigin): string {
  return origin.kind === "user" ? "用户" : origin.name ?? origin.agentId;
}

/**
 * 模型侧的身份段。**每一轮都有**（用户轮也写），这样"本轮谁在说"永远有明文答案，
 * 不依赖模型从历史里推断。
 *
 * 为什么不改消息正文：正文是用户的真实输入，加前缀会污染会话文件与搜索/复制；
 * `sections` 是 Pi 的公开机制（`pi/packages/coding-agent/src/core/system-prompt.ts:29-30`）。
 */
export function speakerSection(origin: TurnOrigin): string {
  const body = origin.kind === "user"
    ? "本轮消息来自用户本人（不是另一个 Agent）。"
    : `本轮消息来自 ${originLabel(origin)}（另一个 Agent，通过 ${origin.via ?? "工具"} 发起；不是用户本人）。`;
  return `<lifeos_current_speaker>${body}</lifeos_current_speaker>`;
}
