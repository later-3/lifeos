// 会话历史图片的字节预算（Task 0012 · P2）：**纯函数，不接线、不读盘、不改会话文件**。
//
// 参考实现（行号见 02-design §6 / evidence/2026-10-28-01）：
// - opencode `packages/core/src/session/model-request.ts:182-205` `boundImages()`：累计字节，
//   越线后从最旧丢到目标线；`:193-195` 注释说明"切点只在越线时移动，前缀缓存才保得住"。
// - opencode `:44-45` `IMAGE_REMOVED`：占位必须告诉模型"你看不到它了，别凭记忆编"。
// - codex `models.rs:1830-1843`：图片标签带**路径**；`compact_remote_v2_images.rs:28-30`：
//   图与其标签**整体**替换，不拆开。
//
// 我们与参考的差异（02-design §7）：只按**编码后字节**计（base64 长度），不按解码字节——
// 网关限的是编码后的请求体；按解码算会少算 25%。

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { stripRefLines } from "./image-note.ts";

import {
  resolveBudget,
  type Budget,
  type PayloadLimitsConfig,
  type PayloadLimitsState,
} from "./payload-limit.ts";

/** 迟滞预算：trigger 是"开始丢"的线，target 是"丢到哪停"，keepRecent 是永不丢的张数。 */
export type ImageBudget = {
  triggerBytes: number;
  targetBytes: number;
  keepRecent: number;
  /** 硬线（= limit − reserve）：保护的图只在越过它时才让位。不给时退化为 trigger。 */
  hardBytes?: number;
};

export type BoundResult = {
  /** 新数组；未改动的 message 对象**复用原引用**（未越线时整个数组原样返回） */
  messages: AgentMessage[];
  droppedCount: number;
  bytesBefore: number;
  bytesAfter: number;
  /** 淘汰后仍在上下文里的图片张数 */
  keptImages: number;
};

/**
 * 工具产图时的说明文字前缀：图被淘汰时这条说明**一并替换**，避免"路径说明 + 已移除占位"重复。
 * （Pi 现在的文案：`read` 是 `Read image file [image/png]`；P4 会改成 `screenshot <path> <w>x<h>`。）
 */
const IMAGE_NOTE_PREFIXES = ["Read image file", "screenshot ", "Screenshot "];

/** 从说明文字里捞绝对路径（P4 之后就有；现在捞不到也不影响淘汰）。 */
const PATH_PATTERN = /((?:\/|~\/)[\w./@+-]*\.(?:png|jpe?g|webp|gif|bmp|avif))/i;

type ImageRef = { messageIndex: number; partIndex: number; bytes: number; mimeType: string; path?: string };

type PartLike = { type?: string; data?: unknown; mimeType?: unknown; text?: unknown };

/** 图片在请求体里的真实开销 = base64 字符串长度（不是解码后的字节）。 */
function imageWireBytes(data: string): number {
  return data.length;
}

function humanBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)}KB`;
  return `${bytes}B`;
}

/** 一条消息里的文本部分（用来找路径 / 判断说明文字）。 */
function textOfContent(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const part of content) {
    const block = part as PartLike;
    if (block.type === "text" && typeof block.text === "string") out.push(block.text);
  }
  return out;
}

function isImageNote(text: string): boolean {
  return IMAGE_NOTE_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/** 占位文案：告诉模型"删了、别编、怎么取回"（opencode 语义 + 我们的路径）。 */
export function imagePlaceholder(input: { mimeType: string; bytes: number; path?: string | undefined }): string {
  const size = humanBytes(input.bytes);
  const where = input.path === undefined ? "" : ` ${input.path} ·`;
  // 分两种"怎么再看到"（opencode IMAGE_REMOVED 的场景依据）：有文件 → read 回来；
  // 用户粘的图只存在于会话 JSONL 里、**没有文件**，写"read"是给错指令（场景 A1）。
  const how = input.path === undefined
    ? "这张来自你发送的附件，会话里没有对应文件可读；需要时请重新发送它"
    : "需要时用 read 重新查看它";
  return `[图片已移除${where} ${input.mimeType} ${size} —— 为控制请求体积已从上下文省略；不要凭记忆描述它的内容，${how}]`;
}

/** 收集所有图片（按出现顺序 = 从旧到新），并尽力带上同一消息里的路径。 */
function collectImages(messages: AgentMessage[]): { refs: ImageRef[]; paths: Map<number, string> } {
  const refs: ImageRef[] = [];
  const paths = new Map<number, string>();
  messages.forEach((message, messageIndex) => {
    const content = (message as { content?: unknown }).content;
    const texts = textOfContent(content);
    const path = texts.map((text) => PATH_PATTERN.exec(text)?.[1]).find((hit) => hit !== undefined);
    if (path !== undefined) paths.set(messageIndex, path);
    if (!Array.isArray(content)) return;
    content.forEach((part, partIndex) => {
      const block = part as PartLike;
      if (block.type !== "image" || typeof block.data !== "string") return;
      refs.push({
        messageIndex,
        partIndex,
        bytes: imageWireBytes(block.data),
        mimeType: typeof block.mimeType === "string" ? block.mimeType : "image/unknown",
        ...(path !== undefined ? { path } : {}),
      });
    });
  });
  return { refs, paths };
}

/**
 * 按字节预算淘汰旧图片（R1–R10，见 04-plan P2）。
 *
 * - 未越过 `triggerBytes`：**原样返回同一个数组**（不产生任何改写，前缀不动）；
 * - 越过：从最旧开始丢，丢到 `bytesAfter ≤ targetBytes` 为止，但最后 `keepRecent` 张永不丢；
 * - 被丢的图块替换成一行占位文本，同一消息里的图片说明文字一并去掉（图与标签整体处理）。
 *
 * 幂等：已淘汰过的历史再跑一次不会再变（剩下的要么 ≤ trigger，要么全在 keepRecent 保护区内）。
 */
export function boundImages(messages: AgentMessage[], budget: ImageBudget): BoundResult {
  const { refs } = collectImages(messages);
  const bytesBefore = refs.reduce((sum, ref) => sum + ref.bytes, 0);
  const unchanged: BoundResult = {
    messages,
    droppedCount: 0,
    bytesBefore,
    bytesAfter: bytesBefore,
    keptImages: refs.length,
  };
  if (refs.length === 0 || bytesBefore <= budget.triggerBytes) return unchanged;

  // 裁决规则见 planElision（唯一实现，meta.effective 也用它）：opencode 的迟滞 + 硬线优先
  const { dropCount, kept: bytesAfter } = planElision(refs.map((ref) => ref.bytes), budget);
  // 触发线以上但涨得不够多：一张都不该丢（迟滞带的意义所在）
  if (dropCount === 0) return unchanged;

  const dropped = refs.slice(0, dropCount);
  const droppedByMessage = new Map<number, Set<number>>();
  const totalByMessage = new Map<number, number>();
  for (const ref of refs) totalByMessage.set(ref.messageIndex, (totalByMessage.get(ref.messageIndex) ?? 0) + 1);
  for (const ref of dropped) {
    const set = droppedByMessage.get(ref.messageIndex) ?? new Set<number>();
    set.add(ref.partIndex);
    droppedByMessage.set(ref.messageIndex, set);
  }
  /** 一条消息里的图**全部**被丢时，它的说明文字才失去指向（只丢一部分时保留） */
  const fullyDropped = (messageIndex: number): boolean =>
    (droppedByMessage.get(messageIndex)?.size ?? 0) === (totalByMessage.get(messageIndex) ?? 0);

  const next = messages.map((message, messageIndex) => {
    const positions = droppedByMessage.get(messageIndex);
    if (positions === undefined) return message;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return message;
    const rebuilt: unknown[] = [];
    content.forEach((part, partIndex) => {
      const block = part as PartLike;
      if (positions.has(partIndex)) {
        const ref = dropped.find((item) => item.messageIndex === messageIndex && item.partIndex === partIndex)!;
        rebuilt.push({ type: "text", text: imagePlaceholder({ mimeType: ref.mimeType, bytes: ref.bytes, path: ref.path }) });
        return;
      }
      // 图被删掉后：纯说明行整块去掉；「用户的话 + 引用行」只去掉引用行，**保留用户的话**
      if (block.type === "text" && typeof block.text === "string" && fullyDropped(messageIndex)) {
        if (isImageNote(block.text)) return;
        const stripped = stripRefLines(block.text);
        if (stripped !== block.text) {
          rebuilt.push({ type: "text", text: stripped === "" ? "[内容已省略]" : stripped });
          return;
        }
      }
      rebuilt.push(part);
    });
    return { ...(message as Record<string, unknown>), content: rebuilt } as AgentMessage;
  });

  return {
    messages: next,
    droppedCount: dropCount,
    bytesBefore,
    bytesAfter,
    keptImages: refs.length - dropCount,
  };
}

/**
 * 迟滞计划（纯函数，**唯一的裁决点**）：给一串按序的图片字节，算出要丢掉的最旧张数与保留量。
 *
 * `boundImages` 用它定"丢几张"；`payloadMetaOf` 用它算"这一次实际会发多少"——两处必须同一套规则，
 * 否则界面显示的 effective 与真实发送不一致（P7b 实测抓到过：显示 418B、实发 560KB）。
 */
export function planElision(
  sizes: readonly number[],
  budget: ImageBudget,
): { dropCount: number; kept: number } {
  const keepRecent = Math.max(0, Math.floor(budget.keepRecent));
  const protectedFrom = Math.max(0, sizes.length - keepRecent);
  const hard = budget.hardBytes ?? budget.triggerBytes;
  let kept = 0;
  let dropCount = 0;
  for (const size of sizes) {
    kept += size;
    if (kept <= budget.triggerBytes) continue;
    // 保护是**软偏好**、trigger/hard 是**硬约束**：保护区内只有越过硬线才让位
    while (kept > budget.targetBytes) {
      if (dropCount >= protectedFrom && kept <= hard) break;
      if (dropCount >= sizes.length) break;
      kept -= sizes[dropCount] ?? 0;
      dropCount += 1;
    }
  }
  return { dropCount, kept };
}

/** 调用方读好的上限（配置 + 观测），交给纯函数用；读盘不进这里（R9）。 */
export type ImageBudgetLimits = { config: PayloadLimitsConfig; state: PayloadLimitsState };

/** 只用模型的两个字段（结构化类型：不绑 Pi 的 Model 泛型，也便于测试传字面量）。
 *
 * `maxRequestBytes` 写成 `number | undefined`（Task 0015 · P1）：Pi 从 v1.5.0 起把 `models.json`
 * 的类型由 TypeBox `Static` 换成 pi-schema `Static`，可选属性变成「可缺省 **或显式 undefined**」。
 * 本仓库 `tsconfig` 开了 `exactOptionalPropertyTypes`，只写 `?: number` 会把「显式 undefined」判为不兼容
 * （实测：`src/assembly.ts:347` TS2345）。这里放宽的是**输入侧的接受面**，不改任何行为。 */
export type BudgetModel = { provider: string; inputLimits?: { maxRequestBytes?: number | undefined } | undefined };

export type AppliedImageBudget = {
  budget: Budget;
  result: BoundResult;
};

/**
 * 把三层上限解析（`payload-limit.ts`）落到本轮 messages 上（Task 0012 · P3）。
 *
 * - **没有上限来源** → `undefined`：调用方原样返回，不猜数字（未声明 = 不启用淘汰）。
 * - 有上限但没越线 → 返回 `budget` + 原样的 `result`（`droppedCount === 0`），调用方据此"什么都不做"。
 * - 越线 → `result.messages` 是改写后的副本；**会话文件不动**。
 *
 * `model` 来自 Pi 的 `ExtensionContext.model`：`/model` 切了模型后，下一轮自然按新 provider 的上限重算。
 */
export function applyImageBudget(
  messages: AgentMessage[],
  model: BudgetModel | undefined,
  limits: ImageBudgetLimits,
): AppliedImageBudget | undefined {
  const budget = resolveBudget({
    providerId: model?.provider ?? "",
    modelLimit: model?.inputLimits?.maxRequestBytes,
    config: limits.config,
    state: limits.state,
  });
  if (budget === undefined) return undefined;
  return { budget, result: boundImages(messages, budget) };
}

/** 历史里的图片字节合计（编码后）。给"上一次 413 了吗"的自救判断用。 */
export function imageBytesOf(messages: AgentMessage[]): number {
  return collectImages(messages).refs.reduce((sum, ref) => sum + ref.bytes, 0);
}
