/**
 * 首屏就绪状态（Task 0019）——**「加载中」是第三种状态，不许拿空数组冒充**。
 *
 * ## 为什么有这个文件
 *
 * 用户实测（2026-11-17 截图）：打开/刷新时有一帧同时出现「12 条骨架 + 14 个真实助手行」，
 * 右栏写着结论性的「先选择项目」，头部写着「新会话」——然后全被真实数据替换掉。
 *
 * 根因不是"忘了加 if"，而是**没有能表达"还没拿到"的值**：
 *   · 列表：`groups: []` 一个值同时表示"请求没回来"和"确实没有项目"；
 *   · 就绪：`loaded` 一个 boolean 同时表示"有缓存可画"和"服务端已确认"；
 *   · 恢复：没有"首屏恢复中"这个概念 → `sessionId === undefined` 立刻被当成草稿态。
 *
 * 于是渲染条件只能写 `!loaded && <骨架/>` + `agents.map(...)` 两条独立分支 ——
 * 骨架和真实行**必然**会同框。这里把三个语义拆成可穷举的纯函数，页面只执行结论。
 *
 * ## 参考（都被核对到行，见 01-background.md §行业参考）
 *
 * - Open WebUI `src/lib/stores/chatList.ts:10`：列表是 `Writable<Item[] | null>`，
 *   `null` = 未加载 / `[]` = 真空；`Sidebar.svelte:1820` 的 `{#if $chats}` 因此天然互斥。
 * - LobeChat `src/features/HomeSidebar/Body/Private/List.tsx:42`：`if (!isInit) return <SkeletonList/>`
 *   ——**early return**，骨架分支不会继续往下渲染行。
 * - pi-web `components/AppShell.tsx:885`：`showPlaceholder = initialSessionRestored && !showChat`
 *   ——恢复期间不画占位；`SessionSidebar.tsx:1102` 恢复期间标题留空而不是写"选择项目"。
 *
 * 三条结论合并成两条不变量，本文件就是它们的实现：
 *   ① **互斥**：同一时刻列表要么是骨架、要么是真实行；
 *   ② **不撒谎**：还没拿到的东西不写结论性文案（空态/标题）。
 */

/** 一列列表此刻该画什么。 */
export type ListSurface = "loading" | "empty" | "ready";

/**
 * 列表表面：**有内容就先画内容，骨架只在"没内容且还没就绪"时出现**。
 *
 * `ready` 只是"服务端已确认"，不是"可以画了"——所以判断顺序必须是内容优先。
 * 这也顺手修掉了另一个方向的缺陷：缓存命中后 `ready` 可能因故回到 false，
 * 若按 `ready` 决定画不画，已经显示出来的行会被骨架**盖住**（内容 → 加载，最刺眼的一种回退）。
 */
export function listSurfaceOf(input: { ready: boolean; count: number }): ListSurface {
  if (input.count > 0) return "ready";
  return input.ready ? "empty" : "loading";
}

/**
 * 列头计数：**没就绪且为 0 时不显示**。
 *
 * 0 是一个事实陈述（"这列什么都没有"），未加载时它只是数组的默认长度。
 * 实测那一帧里「会话 0」挂在一个马上要变成 15 的列上。
 */
export function columnCountOf(input: { ready: boolean; count: number }): number | undefined {
  if (!input.ready && input.count === 0) return undefined;
  return input.count;
}

/** 聊天区此刻该画什么。 */
export type ChatSurface = "loading" | "empty-project" | "empty-session" | "empty-message" | "content";

/**
 * 聊天区域表面。
 *
 * 判定顺序（每条都对应一次实测的假状态）：
 * 1. **有消息就是内容** —— 最优先。否则首屏恢复流程收尾前，已经渲染出来的消息会被空态盖掉。
 * 2. 会话解析中（`resolving`：首屏恢复 / 切助手）→ 加载中。此时 `sessionId`/`selectedProjectId` 还没定，
 *    照旧逻辑会先画"先选择项目"/"新会话"，等恢复完再跳成真内容。
 * 3. 有会话但消息没到（`messagesLoading`）→ 加载中。空会话提示只在**确实 0 条**时出。
 * 4. 其余按"有没有项目 / 有没有会话"分三种空态。
 */
export function chatSurfaceOf(input: {
  /**
   * **有未完成的"会话解析"**：首屏恢复（URL / 上次会话）或切助手（要找出新助手的默认会话）。
   * 两者都会在几百毫秒后落到一个具体会话上，所以这段期间说"没有会话"是猜的。
   */
  resolving: boolean;
  sessionId: string | undefined;
  selectedProjectId: string | undefined;
  /** 已选中会话、消息还在路上。 */
  messagesLoading: boolean;
  messageCount: number;
}): ChatSurface {
  if (input.messageCount > 0) return "content";
  if (input.resolving) return "loading";
  if (input.sessionId !== undefined) return input.messagesLoading ? "loading" : "empty-message";
  if (input.selectedProjectId === undefined) return "empty-project";
  return "empty-session";
}
