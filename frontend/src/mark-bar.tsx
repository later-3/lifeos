/**
 * MarkBar（批注信息条）—— 挂在**被批注的那条消息**底部（Task 0008 · P2）。
 *
 * 用户 2026-11-04 定的形态：
 *  - 位置：**被批注的那条消息自己身上**，不是全局底部（"标注信息 bar 是放到
 *    被批注的那个信息上的"）——批注本来就属于某条具体消息，关联是直接的；
 *  - 默认**折叠**（只显示 `▶ N 条标记`）；
 *  - **常驻**：发送后、刷新后、切 session 后都在（P1 之后数据不再被清）；
 *  - 没有批注的消息**不渲染**（不占位）。
 *
 * 与旧 `annotation-panel.tsx` 的关系：表格内容（列、排序、交互）沿用它的设计，
 * 但挂载点从"输入框上方"变成"消息底部"，且只显示**这一条消息**的批注。
 */

import { useMemo, useState } from "react";
import type { Annotation } from "./annotations.ts";
import { markById } from "./marks.ts";
import { annotationLine } from "./annotation-message.ts";
import { IconChevronRight } from "@tabler/icons-react";

export type MarkBarProps = {
  /** 这条消息上的全部批注（调用方用 `ofMessage(messageId)` 取好传入）。 */
  annotations: readonly Annotation[];
  /** 消息 id 的先后顺序（与发送时的排序同一套，保证"看到的=发出去的"）。 */
  messageOrder: readonly string[];
  /** 这条消息自己的 id（排序时它排在其他消息之前/之后由全局顺序决定）。 */
  messageId: string;
  /** 默认折叠；用户点开后由组件内 state 接管。 */
  defaultFolded?: boolean;
  onRowClick: (id: string) => void;
  pinnedOf: (id: string) => boolean;
  onRemove: (id: string) => void;
  /** 清掉这条消息上的全部批注（逐条走持久化删除）。 */
  onRemoveAll: () => void;
};

export function MarkBar({
  annotations, messageOrder, messageId, defaultFolded = true,
  onRowClick, pinnedOf, onRemove, onRemoveAll,
}: MarkBarProps) {
  // 折叠态：默认折叠（用户定案）；点标题切换。组件随消息挂载，不必跨 session 持久。
  const [folded, setFolded] = useState(defaultFolded);

  /**
   * 展示顺序：与发送时同一套排序（消息顺序 + 段内偏移）。
   * 本消息的批注要么挂在"这条消息之前的那轮"，要么挂在它自己，
   * 用全局 messageOrder 排保证多条时先后的稳定性。
   */
  const rows = useMemo(() => {
    const rank = (id: string): number => {
      const at = messageOrder.indexOf(id);
      return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
    return [...annotations].sort((a, b) => {
      const byMessage = rank(a.messageId) - rank(b.messageId);
      if (byMessage !== 0) return byMessage;
      if (a.blockIndex !== b.blockIndex) return a.blockIndex - b.blockIndex;
      return a.start - b.start;
    });
  }, [annotations, messageOrder]);

  if (annotations.length === 0) return null;

  const consumed = rows.filter((a) => a.consumedBy !== undefined).length;
  const pendingCount = rows.length - consumed;
  // 序号计数器（map 里递增）：与发送同一规则——只有可发送的行占号（annotation-message.ts 同源）
  let sentOrdinal = 0;

  return (
    <section
      data-testid="mark-bar"
      data-mark-count={rows.length}
      aria-label={`这条回复上的批注（${rows.length} 条）`}
      className="overflow-hidden rounded-panel ring-1 ring-line"
    >
      {/* 标题行：折叠/展开 + 数量 + 已发送/待发送概览 + 清空 */}
      <div className="flex items-stretch bg-sunken">
        <button type="button"
          aria-expanded={!folded}
          aria-controls="mark-bar-rows"
          onClick={() => setFolded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-meta font-semibold text-ink-500 hover:bg-hover max-sm:min-h-11"
          title={folded ? "展开看这条回复上的批注" : "收起"}
        >
          <IconChevronRight size={13} aria-hidden="true"
            className={`shrink-0 transition-transform duration-150 ${folded ? "" : "rotate-90"}`} />
          <span>标记</span>
          <span data-testid="mark-bar-count"
            className="rounded-full bg-hover px-1.5 py-px text-micro tabular-nums text-ink-700">{rows.length}</span>
          {/* 状态概览：让用户不展开也知道还剩几条没发 */}
          <span className="ml-1 text-micro font-normal text-ink-500">
            {pendingCount > 0 ? `${pendingCount} 条待发送` : consumed > 0 ? "已全部发送" : ""}
          </span>
        </button>
        <button type="button" data-testid="mark-bar-clear" onClick={onRemoveAll}
          className="inline-flex shrink-0 items-center rounded-control px-2 text-micro text-ink-500 hover:bg-danger-soft hover:text-danger max-sm:min-h-11">
          清空
        </button>
      </div>

      {!folded && (
        <div id="mark-bar-rows" data-testid="mark-bar-rows" className="overflow-auto" style={{ maxHeight: "var(--container-anno-panel)" }}>
          <table className="w-full border-collapse text-meta">
            <thead>
              <tr className="text-micro uppercase tracking-wide text-ink-500">
                {/* 6 列（用户 2026-11-05 定：与原 annotation-panel 同一表格，不合并成一句）：
                    序号 | 被批注的原文 | 用户的话 | 语气 | 发送的信息 | ✕ */}
                <th className="w-8 px-2.5 py-1.5 text-left font-semibold">#</th>
                <th className="px-2.5 py-1.5 text-left font-semibold">被批注的原文</th>
                <th className="px-2.5 py-1.5 text-left font-semibold">用户的话</th>
                <th className="w-20 px-1.5 py-1.5 text-left font-semibold">语气</th>
                <th className="px-2.5 py-1.5 text-left font-semibold">发送的信息</th>
                <th className="w-10 px-1 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((anno, index) => {
                const pinned = pinnedOf(anno.id);
                // 序号按**实际发送顺序**：只有功能标记的行不占号（它不进消息）。
                // 旧缺陷：annotationLine(anno, 1) 硬编码，每行都是「1、」。
                const sendable = annotationLine(anno, 1) !== null;
                sentOrdinal = sendable ? sentOrdinal + 1 : sentOrdinal;
                const ordinal = sendable ? sentOrdinal : index + 1;
                const line = annotationLine(anno, ordinal);
                return (
                  <tr key={anno.id} data-testid="mark-row" data-anno={anno.id}
                    data-pinned={pinned ? "true" : "false"}
                    data-consumed={anno.consumedBy !== undefined ? "true" : "false"}
                    data-sendable={sendable ? "true" : "false"}
                    onClick={() => onRowClick(anno.id)}
                    className={`cursor-pointer border-t border-line align-top hover:bg-hover ${pinned ? "bg-accent-soft" : ""}`}>
                    <td className="px-2.5 py-1.5 tabular-nums text-ink-500">
                      {/* 已发送的小标记（用户 2026-11-04：让用户知道它不会再进消息） */}
                      {anno.consumedBy !== undefined
                        ? <span className="block rounded-full bg-hover px-1 py-px text-center text-micro text-ink-500">已发</span>
                        : `${ordinal}.`}
                    </td>
                    <td className="px-2.5 py-1.5 text-ink-700">
                      <span className="line-clamp-2 border-l-2 border-line pl-1.5">「{anno.quote}」</span>
                    </td>
                    {/* 没写话就留空（用户 2026-11-04：“你不要画蛇添足”）。空单元格本身就是"没写"。 */}
                    <td className="whitespace-pre-wrap px-2.5 py-1.5 text-ink-900">{anno.note}</td>
                    <td className="px-1.5 py-1.5">
                      <MarkTags marks={anno.marks} />
                    </td>
                    <td className="px-2.5 py-1.5">
                      {line === null ? (
                        <span className="text-micro text-ink-500">仅分类，不发送</span>
                      ) : (
                        <span data-testid="mark-line"
                          className="block whitespace-pre-wrap font-mono text-micro leading-relaxed text-ink-900">
                          {line}
                        </span>
                      )}
                    </td>
                    <td className="px-1 py-1.5 text-right">
                      <button type="button" data-testid="mark-remove" data-anno={anno.id}
                        onClick={(event) => { event.stopPropagation(); onRemove(anno.id); }}
                        aria-label="删除这条批注"
                        className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-control text-micro text-ink-500 hover:bg-danger-soft hover:text-danger max-sm:min-h-11 max-sm:min-w-11">
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 语气标签（供 MarkBar 展开态复用；保持与旧行为一致的展示）。 */
export function MarkTags({ marks }: { marks: readonly string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {marks.map((id) => {
        const mark = markById(id);
        if (mark === undefined) return null;
        return (
          <span key={id} data-mark={id} aria-label={`标签：${mark.label}`}
            className="rounded-full px-1.5 py-px text-micro font-semibold"
            style={{ background: `var(--color-anno-${mark.tone}-soft)`, color: `var(--color-anno-${mark.tone})` }}>
            {mark.label}
          </span>
        );
      })}
    </span>
  );
}
