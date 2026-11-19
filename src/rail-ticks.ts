/**
 * 对话区左侧导航竖条的**刻度投影**（Task 0020 · P1）。
 *
 * ## 刻度是什么
 *
 * 一条消息 = 一条刻度：**用户消息** + **轮末回复**（该轮最后一条有文字的 assistant）。
 * 所以一轮 = 两条刻度（问一条、答一条），与用户 2026-11-04 的原型裁决一致
 * （`agents/coder/projects/workspace/tasks/0008-…/tools/nav-demo/AGENTS.md`）。
 *
 * ## 为什么放在服务端
 *
 * 前端只持有**窗口内**的消息：首屏 `?tail=200`，更早的靠 `?before=` 游标一页页取
 * （`src/server.ts:509` 起、`frontend/src/App.tsx` 的 `loadOlder`）。实测最长会话 2290 条 entry、
 * 548 条刻度，其中大部分不在首屏那一页里。若让前端算，长会话的竖条会**只有尾巴**。
 *
 * 而且它必须与会话详情**同一份投影**（`specs/code/api/api.md` 2.7「一个形状一处实现」）：
 * 入参就是 `messagesOf()` 的输出，这里不碰文件系统、不碰 Pi，只做一次形状变换。
 *
 * ## 长度度量为什么是字符数（T6 的收口，2026-11-19 用户拍板）
 *
 * 原型原本"用户按字数、Agent 按 token"，但 assistant 的 `tokens` 是 `input + output`
 * （`src/agent-host.ts` 的 `messagesOf` 里 `const tokens = input + output`），而 **input 是累积上下文**
 * （实测 p50=630、max=965,223，output 中位只有 354）——拿它当长度，竖条会变成
 * "越往后的轮次越长"的斜阶梯，与"这轮回了多少"无关。
 *
 * 改用 output-only 也不成立：Pi 的 `usage.output` **包含工具调用的参数生成**，而工具参数不是文字。
 * 实测（136 个会话 / 37,529 条 assistant 消息）：轮末回复的字符与 output tokens 的相关系数只有 0.55
 * （无思考样本），混入带思考样本后掉到 0.31；原型数据自证 `chars=1022 → tok=24735`、`chars=1151 → tok=4066`
 * ——**字数更多的反而 token 更少**。
 *
 * 所以两侧统一取 `text.length`（字符数），口径一项，不再有两套。
 *
 * ## 与"轮末回复"有关的一条既有规则，这里**故意不复用**
 *
 * MarkBar 的挂点是 `App.tsx` 的 `visibleLastReplyByUserMessageId`，但那条规则回答的是
 * **"批注挂在哪条消息上不会随折叠消失"**（`anchorable ? 最后一条 : 第一条`）——
 * 它受"过程条折叠"影响，是渲染层的产物。
 *
 * 竖条回答的是**"这一轮的答案在哪"**，所以取"最后一条有文字的"。两者取值可能不同
 * （一轮里既有带过程块的首条、又有纯净的末条时，MarkBar 挂末条、竖条也是末条，一致；
 * 但全轮都带过程块时 MarkBar 挂首条，竖条仍取末条）。**这不是缺陷**：一个跟着折叠走，一个跟着语义走。
 */

/** 卡片预览的截断长度（字符）。100 ≈ 卡片 4 行（340px 宽 / 13px 字号，每行约 24 个汉字）。 */
export const RAIL_PREVIEW_CHARS = 100;

export type RailTick = {
  /** 该消息的 session entry id（与 `messagesOf()` 的 `id` 同源）= 前端跳转的锚点。 */
  id: string;
  role: "user" | "assistant";
  /** 长度度量：字符数（两侧同口径）。 */
  chars: number;
  /** 悬停卡片的正文预览，按**码点**截断到 {@link RAIL_PREVIEW_CHARS}。 */
  preview: string;
  /**
   * **回落锚点**：`id` 那条消息在界面上不一定有 DOM 节点。
   *
   * 为什么需要（2026-11-19 用户实测："点答没有跳转"）：轮末回复经常被**过程条折叠**了
   * （`frontend/src/App.tsx` 的 `folded.add(i)` —— 折叠条挂在**这一轮的第一条回复**上），
   * 于是它的 `data-message-id` 从来没进 DOM。跳转靠 `querySelector` 找锚点，找不到就静默不动。
   *
   * 所以对 assistant 刻度额外给出"这一轮的第一条回复"的 id：过程条就挂在那上面，
   * 它一定在 DOM 里（除非这一轮整个没渲染）。前端先试 `id`，不行再试 `host`。
   *
   * 用户刻度不需要回落（用户消息永远单独渲染），此时不出现该字段。
   */
  host?: string;
};

/** 本模块需要的消息形状（只读我们真正用到的字段，不绑死前端类型）。 */
type RailMessage = {
  role: string;
  text?: string;
  id?: string;
  /** 这一条还在追加（`messagesOf` 只给最后一条 assistant 打这个标记）。 */
  streaming?: true;
};

/**
 * 按码点截断，绝不把代理对（emoji / 生僻字）切成两半。
 *
 * 为什么不用 `String.prototype.slice`：它按 UTF-16 单元切，`"👨‍👩‍👧".slice(0,1)` 会产生孤立的半代理，
 * 落到 JSON 里是 U+FFFD，卡片上就是"半个字"。
 */
export function truncateByCodePoint(text: string, limit: number): string {
  if (limit <= 0) return "";
  // 快的路径：纯 BMP 且长度够时不必展开成数组（长会话里每条都过一遍）
  if (text.length <= limit) return text;
  const points = Array.from(text);
  return points.length <= limit ? text : points.slice(0, limit).join("");
}

/**
 * 把消息序列投影成刻度序列（按时间正序）。
 *
 * @param messages `messagesOf()` 的输出（只读 `role` / `text` / `id` / `streaming`）。
 * @returns 刻度数组；没有任何刻度时返回 `[]`（不返回 `undefined`——调用方只处理一种空）。
 *
 * 不产生刻度的情况，逐条写明：
 * - **没有文字的消息**（工具调用前后的空文字段、纯 thinking 段、压缩卡）：不出刻度。
 *   用户 2026-11-04 原话："只是 agent 的最终回复才需要的，工具和思考那些都不需要的。"
 * - **还在流式的那一条**：它不是"最终回复"，这一轮还没结束。前端在轮内补一条待定刻度
 *   （`02-design.md` §6），结束时重新取。
 * - **`host` 什么时候出现**：只有"轮末回复不是这一轮第一条带文字的回复"时才有 ——
 *   那种情况下它会被过程条折叠，界面上没有它的 DOM 节点，跳转需要回落。
 * - **第一条用户消息之前的孤儿 assistant**（压缩后可能残留）：不出刻度。
 *   它没有对应的"问"，画出来会是一条用户点不出所以然的刻痕。
 * - **没有 id 的消息**：不出刻度。跳转靠 id 定位，没有 id 的刻度点了也没法跳（`messagesOf`
 *   在缺 id 时会降级成 `entry-N` 占位，所以这种情况实际只在测试夹具里出现）。
 */
export function railTicksOf(messages: readonly RailMessage[]): RailTick[] {
  const ticks: RailTick[] = [];
  /** 当前轮的候选"轮末回复"：同一轮里后出现的覆盖先出现的。 */
  let pendingReply: RailTick | undefined;
  /** 当前是否在某一轮里（见过一条用户消息）。开局就是 false，所以开头的孤儿 assistant 不会被收。 */
  let inTurn = false;
  /** 这一轮的第一条 assistant 消息 id（过程条挂在它身上 → 折叠时唯一还在 DOM 里的锚点）。 */
  let turnHost: string | undefined;

  const flush = (): void => {
    if (pendingReply !== undefined) ticks.push(pendingReply);
    pendingReply = undefined;
  };

  for (const message of messages) {
    const text = message.text ?? "";
    if (message.role === "user") {
      flush();
      inTurn = true;
      turnHost = undefined;
      if (message.id === undefined || message.id === "") continue;
      ticks.push({
        id: message.id,
        role: "user",
        chars: text.length,
        preview: truncateByCodePoint(text.trim(), RAIL_PREVIEW_CHARS),
      });
      continue;
    }
    if (message.role !== "assistant") continue;
    if (!inTurn) continue;                                // 孤儿：没有对应的"问"
    /*
     * 回落锚点 = **这一轮的第一条 assistant 消息**（不管它有没有文字）。
     *
     * 为什么不是"第一条带文字的回复"（第一版就是这么写的，实测错了）：过程条挂在
     * `App.tsx` 的 `isFirstReply` 上 —— 那是"这一轮的第一条 assistant 消息"，
     * 而这类会话里第一条几乎总是**空文字的工具段**。实测 DOM 里能查到的是 `t26a`/`t39a` 这种 id，
     * 而第一版给出的 host 是 `t21b`/`t39b` 这种"后来才有的带文字段" —— 一样不在 DOM 里。
     * 结果：13/40 条答刻度带了 host，点了仍旧不跳。
     */
    if (turnHost === undefined && message.id !== undefined && message.id !== "") turnHost = message.id;
    if (message.streaming === true) continue;             // 不是最终回复
    if (text.trim() === "") continue;                     // 工具段 / 思考段 / 压缩卡
    if (message.id === undefined || message.id === "") continue;
    pendingReply = {
      id: message.id,
      role: "assistant",
      chars: text.length,
      preview: truncateByCodePoint(text.trim(), RAIL_PREVIEW_CHARS),
      ...(turnHost !== undefined && turnHost !== message.id ? { host: turnHost } : {}),
    };
  }
  flush();
  return ticks;
}
