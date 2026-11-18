/**
 * thinking 原点（Task 0028 · P1；缺陷来源 Task 0027 · R4）。
 *
 * ## 缺陷是什么
 *
 * 思考正文按需取（`?deferThinking=1` + `GET …/entries/:entryId/thinking?blockIndex=N`）时，
 * 两个参数来自**两个坐标系**：
 *  - `entryId` 曾取"被渲染那条消息"的 id —— 而过程折叠时渲染的是**整轮合并块**（`mergedBlocks`），
 *    宿主消息只是这一轮的**第一条**回复；
 *  - `blockIndex` 是**合并后**的下标。
 *
 * 于是从一轮的第 2 段回复起，所有思考块都拿着第 1 段的 entryId 去配自己的下标。
 * 真实会话实测错配率 **96.3% / 96.2% / 99.4%**（Task 0027 `evidence/thinking-pairing-mismatch.json`），
 * 表现为界面永远显示「思考正文没取回来 · 重试」，且重试仍是同一个错请求（47 次 / 10 秒的请求风暴）。
 *
 * ## 修法（本文件）
 *
 * **一次循环同时产出合并块与原点**：块的顺序与原点一一对应，原点里存它**真正所属**的 entry id
 * 与该 entry 内的真实下标。这样"下标"和"身份"永远同源，不可能再错配。
 *
 * 为什么不是"让后端返回 token"：那要改 API 形状（`specs/code/api/api.md` 2.7 一处实现），
 * 而"渲染时带原点"是纯前端改动、零协议变化 —— 最小正确面。
 *
 * ## 边界（必须守住）
 *
 * - **必须** 保持块顺序与合并顺序完全一致（`blocks[i]` 与 `origins[i]` 是同一个块）。
 * - **必须** 不给缺 `id` 的消息伪造原点（老会话、乐观插入）：返回 `undefined`，
 *   调用方据此**不发请求**。伪造一个空 entryId 只会换来一串 404（`specs/code/api/api.md` 2.3）。
 * - **必须** 纯函数、无 IO、无 DOM：可被 node 测试穷举（`specs/code/frontend/code.md` 2.13）。
 */
import type { Block } from "../views/Message.tsx";

/** 一个块的原点：它属于哪条 session entry、在该 entry 里的第几个 content 块。 */
export type ThinkingOrigin = { entryId: string; blockIndex: number };

/** 折叠用：一条回复消息里我们只需要 id 与块列表。 */
export type OriginReply = { id?: string | undefined; blocks: readonly Block[] };

/**
 * 把一轮的多条回复摊平成"合并块 + 原点"。
 *
 * `origins[i]` 是 `blocks[i]` 的原点；消息没有 id 时该段所有块的原点为 `undefined`。
 */
export function originsOf(replies: readonly OriginReply[]): {
  blocks: Block[];
  origins: Array<ThinkingOrigin | undefined>;
} {
  const blocks: Block[] = [];
  const origins: Array<ThinkingOrigin | undefined> = [];
  for (const reply of replies) {
    const entryId = reply.id;
    reply.blocks.forEach((block, blockIndex) => {
      blocks.push(block);
      origins.push(entryId === undefined || entryId === "" ? undefined : { entryId, blockIndex });
    });
  }
  return { blocks, origins };
}

/**
 * 把一个原点变成"可以发出去的请求参数"，不能发就返回 `undefined`。
 *
 * 判据集中在这里（而不是散在调用点）：空 id、负数、非整数下标都不发请求。
 * 这不是"防御性编程"，是缺陷 D3 的直接后果——错参数的请求会变成 400/404 风暴。
 */
export function thinkingRequestOf(origin: ThinkingOrigin | undefined): ThinkingOrigin | undefined {
  if (origin === undefined) return undefined;
  if (origin.entryId === "") return undefined;
  if (!Number.isInteger(origin.blockIndex) || origin.blockIndex < 0) return undefined;
  return origin;
}
