/**
 * 输入历史（composer 的 ↑/↓ 浏览）—— Task 0012。
 *
 * ## 为什么改成纯函数 + 派生
 *
 * 改之前（2026-11-05 之前）：`App.tsx` 里一个 `useRef<string[]>([])` 记"我刚发了什么"，
 * 全站一份、只追加、方向反、只能走一步。用户的原话是"按上键，期望是历史消息，现在是乱的，
 * 这个历史消息是针对每个 session 单独来说的"——四个独立缺陷叠在一起：
 *
 *  1. **没有会话维度**：切会话/切 Agent 都不清（`resetChatState` 漏了它），于是 A 的历史在 B 里出现；
 *  2. **方向与数组序相反**：写入按「旧→新」追加，读取让 `↑` 下标 +1，第一下取到最旧一条；
 *  3. **只能走一步**：`input === ""` 是进入分支的必要条件，取回后输入框非空就再也进不去；
 *  4. **索引不复位**：用户手动清空输入框后 `↑` 从旧下标继续，跳过最新一条。
 *
 * 现在的做法（与三家参考一致，见 `knowledge/reference-baseline.md` "输入框对象结构"行）：
 *
 *  - **历史 = 从当前会话的消息派生**（pi-web `ChatWindow.tsx:822-833` 同构）：
 *    当前会话的 user 文本、倒序取、Set 去重、上限 50、输出「最近一条在前」。
 *    派生天然按会话隔离——切会话 `messages` 换了，历史跟着换，不需要"记得清"。
 *    **刷新也不丢**，因为消息来自服务端。
 *  - **方向 = 下标增大即更旧**（Pi TUI `editor.ts:456-486`：`newIndex = historyIndex - direction`，
 *    Up 传 -1 → 下标 +1）。输出顺序既是「新→旧」，`↑` 就是 `+1`，读写同向。
 *  - **可连按**：触发条件是 `input === "" || 正在浏览`（Pi TUI `editor.ts:926-930` 的
 *    `isEditorEmpty() || historyIndex > -1`），不在浏览时输入框有字就不抢 `↑`（那是光标移动）。
 *  - **游标带作用域**：游标记住它属于哪个作用域（会话/草稿键），作用域一变就作废。
 *    不靠 React effect 的时序去"切换后清空"（那正是漏清的老路）。
 *
 * ## 为什么不用 localStorage 存输入历史
 *
 * Pi TUI 用 `populateHistory` 在**打开会话时**用该会话的用户消息重置历史；pi-web 直接派生。
 * 两者都不额外持久化一份"发送流水"。我们派生自 `messages`，事实源只有一个（服务端会话），
 * 也就不存在"库里有一份、界面有一份、两边对不上"的第四类缺陷。
 */

/** 历史最大条数。与 pi-web 一致（`ChatWindow.tsx:830` 的 `history.length >= 50`）；Pi TUI 是 100。 */
export const HISTORY_LIMIT = 50;

/** 浏览中的游标：第几条（0 = 最新）、属于哪个作用域。 */
export type BrowsingCursor = { index: number; scope: string };

/** 游标：`undefined` = 不在浏览状态（输入框是用户自己的内容）。 */
export type HistoryCursor = BrowsingCursor | undefined;

export const NO_HISTORY_CURSOR: HistoryCursor = undefined;

/** 派生所需的最小形状（只读 role 与 text，避免绑死前端 Message 类型）。 */
export type HistoryMessage = { role: string; text?: string };

/**
 * 从当前会话的消息派生输入历史。
 *
 * @returns 「最近一条在前」的文本数组（已 trim、去重、≤ {@link HISTORY_LIMIT} 条）。
 *
 * 去重是**全局内容**去重（同 pi-web 的 `Set<string>`）：同一句话发过两次，历史里出现一次，
 * 位置取最近那次。这与 Pi TUI 的"只去相邻重复"不同，选 pi-web 是因为浏览历史的目的是
 * "找回说过的话"，重复条目只会让按住 ↑ 的次数变多。
 */
export function inputHistoryOf(messages: readonly HistoryMessage[], limit: number = HISTORY_LIMIT): string[] {
  const seen = new Set<string>();
  const history: string[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message === undefined || message.role !== "user") continue;
    const text = (message.text ?? "").trim();
    if (text === "") continue;          // 纯图片消息（文本为空）不进历史
    if (seen.has(text)) continue;
    seen.add(text);
    history.push(text);
    if (history.length >= limit) break;
  }
  return history;
}

export type HistoryStep = { cursor: HistoryCursor; text: string };

/**
 * 按一次 ↑/↓ 之后游标与输入框应该变成什么。
 *
 * @returns `undefined` = 这次按键**不处理**（交给浏览器做光标移动 / 什么都不做）。
 *
 * 规则（逐条都有测试，见 `test/input-history.test.mjs`）：
 *
 *  - 没有历史 → 不处理；
 *  - 不在浏览状态且输入框有内容 → 不处理（↑/↓ 是光标移动）；
 *  - 游标的作用域不是当前作用域（刚切了会话/草稿）→ 视作不在浏览状态，从最新一条重新开始；
 *  - `older`（↑）：下标 +1，到顶钳住（不回绕）；
 *  - `newer`（↓）：下标 −1，到 −1 时清空输入框并**退出浏览**（下次 ↑ 从最新一条重新开始）；
 *  - 游标越界（历史变短）→ 钳到有效范围。
 *
 * 注意 `inputEmpty` 只在**进入**浏览时起作用：已经在浏览（游标有效）时，即便输入框里有
 * 从历史取回的文本，↑/↓ 仍然继续浏览——这就是"只能走一步"的修法。
 *
 * **用户一打字就退出浏览**（Pi TUI `editor.ts` 里每个编辑动作都调 `exitHistoryBrowsing()`）：
 * 组件在 textarea 的 `onChange`（只由用户输入触发，程序 setState 不会触发）里把游标置为
 * {@link NO_HISTORY_CURSOR}。这样"取回后再手动清空 → 按 ↑"回到最新一条，而不是从旧游标算起。
 * 本函数**不**用"文本是否等于历史某条"去猜用户是否改过（规范 2.1：禁止用值比较猜语义）。
 */
export function historyNavigate(input: {
  cursor: HistoryCursor;
  scope: string;
  history: readonly string[];
  direction: "older" | "newer";
  inputEmpty: boolean;
}): HistoryStep | undefined {
  const { scope, history, direction, inputEmpty } = input;
  if (history.length === 0) return undefined;

  const cursor = input.cursor !== undefined && input.cursor.scope === scope ? input.cursor : undefined;
  // 不在浏览状态：输入框有内容 → ↑/↓ 是光标移动；空的输入框按 ↓ 也无事可做
  // （已经在最底了，抢过来只是白 preventDefault）。两种都交给浏览器。
  if (cursor === undefined && (!inputEmpty || direction === "newer")) return undefined;

  const last = history.length - 1;
  const from = cursor === undefined ? -1 : Math.max(-1, Math.min(last, cursor.index));
  const next = direction === "older" ? from + 1 : from - 1;

  if (next < 0) {
    // 走过最新一条 → 回到用户自己的空输入并**退出浏览**（Pi TUI 同款：historyIndex = -1）。
    // 退出之后 ↑ 会从最新一条重新开始，不会跳过它。
    return { cursor: NO_HISTORY_CURSOR, text: "" };
  }
  const index = Math.min(next, last);
  return { cursor: { index, scope }, text: history[index] ?? "" };
}
