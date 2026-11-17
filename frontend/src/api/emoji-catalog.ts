// 表情短码的"已知集合"（Task 0016 · P1）：一次拉取目录，进程内缓存。
//
// 为什么不让渲染层每次请求：短码替换是**同步纯函数**（`emoji-shortcode.ts`），
// 而素材列表来自接口。两者解耦：这里只负责"拿到有哪些短码"，渲染仍然是纯函数。
//
// 缓存语义：失败不抛（没有表情短码就退化成纯文本，正文照样可读）；成功后不再重复拉取。
// 素材库变动（新增表情）要刷新页面才生效——比"每次渲染都发一次请求"划算得多。

import { applyShortcodes } from "./emoji-shortcode";

let knownIds: Set<string> | undefined;
let pending: Promise<void> | undefined;

async function load(): Promise<void> {
  const response = await fetch("/api/media/catalog?kind=emoji&limit=500").catch(() => undefined);
  if (response?.ok !== true) return;
  const data = await response.json().catch(() => undefined) as { items?: Array<{ id?: unknown }> } | undefined;
  if (!Array.isArray(data?.items)) return;
  knownIds = new Set(data.items.map((item) => item.id).filter((id): id is string => typeof id === "string"));
}

/** 预热（应用启动时调一次）。重复调用共享同一个进行中的请求。 */
export function primeEmojiShortcodes(): Promise<void> {
  if (knownIds !== undefined) return Promise.resolve();
  pending ??= load().catch(() => undefined).finally(() => { pending = undefined; });
  return pending;
}

/** 同步替换：目录还没拿到时原样返回（宁可少渲染一个表情，也不让正文卡住）。 */
export function expandShortcodes(text: string): string {
  if (knownIds === undefined) { void primeEmojiShortcodes(); return text; }
  return applyShortcodes(text, knownIds);
}

/** 测试用：注入固定集合，不碰网络。 */
export function setKnownShortcodesForTest(ids: readonly string[] | undefined): void {
  knownIds = ids === undefined ? undefined : new Set(ids);
}
