/**
 * 输入区（Task 0017 · P5 领域 hook #4）。
 *
 * ## 这个 hook 管什么
 *
 * 输入框相关的**会话级**状态：草稿文本、待发附件（按草稿键分桶）、斜杠命令面板、
 * 批注外部的触发请求、"是否贴底"。
 *
 * ## 纪律（搬自 App.tsx，逐条保留）
 *
 * - **附件按草稿键分桶**（`lifeos.draft.<sessionId>` 同一套归属）：切会话时上一会话的
 *   待发图片不能跟过来（Task 0019 实测过：附件全站一份 → 切会话后误发）。
 * - **命令面板的可用性按当前会话算**：切会话必须清空（`setPalette(undefined)`），
 *   残留会按旧会话的 meta 误导用户（Task 0019）。
 * - 批注触发用 `nonce`：同一 messageId 连点两次也要能触发（纯 messageId 去重会吞掉第二次）。
 */
import { useCallback, useRef, useState } from "react";

import type { PendingImage } from "../api/attachments";

export type PaletteItem = { key: string; label: string; hint?: string; disabled?: boolean; run: () => void };
export type PaletteState = { items: PaletteItem[]; index: number };
export type DraftRequest = { messageId: string; nonce: number };

export function useComposer(draftKey: string | undefined, initialInput = "") {
  const [input, setInputState] = useState(initialInput);
  /** 附件按**草稿键**分桶（Task 0019）：切换会话不串味。 */
  const [attachmentMap, setAttachmentMap] = useState<Record<string, PendingImage[]>>({});
  const attachments = draftKey !== undefined ? attachmentMap[draftKey] ?? [] : [];
  const setAttachments = useCallback((next: PendingImage[]) => {
    if (draftKey === undefined) return;
    setAttachmentMap((map) => ({ ...map, [draftKey]: next }));
  }, [draftKey]);

  /** 斜杠命令面板（`/` 触发）：切会话必须清空。 */
  const [palette, setPalette] = useState<PaletteState | undefined>();
  /** 批注的外部触发（功能条点「批注」）：nonce 允许同一消息重复触发。 */
  const [draftRequest, setDraftRequest] = useState<DraftRequest | null>(null);
  const draftNonce = useRef(0);
  const requestDraft = useCallback((messageId: string) => {
    draftNonce.current += 1;
    setDraftRequest({ messageId, nonce: draftNonce.current });
  }, []);
  const onDraftHandled = useCallback(() => setDraftRequest(null), []);

  /** 消息区是否贴底（控制"回到底部"箭头与自动跟随）。 */
  const [atBottom, setAtBottom] = useState(true);

  return {
    input, setInput: setInputState,
    attachments, setAttachments, attachmentMap, setAttachmentMap,
    palette, setPalette,
    draftRequest, requestDraft, onDraftHandled,
    atBottom, setAtBottom,
  };
}
