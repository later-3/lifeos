/**
 * 批注列表（Task 0003 · P4，P6 后按用户反馈改过交互）。
 *
 * **与 demo 的差异**（用户 2026-11-03 两处裁决）：
 *  1. demo 是"N 条批注 → N 条消息"，真实实现是"N 条 → 1 条消息（内部 N 行）"：
 *     每次发送都走 `runTurn()` → `session.prompt()`，是**一次真实模型调用**。
 *  2. 它本身就是"批注转化成的消息"（内容就是将要发出去的那些行），
 *     所以去掉了单独的「定位」按钮：**单击整行 = 定位并钉住，再点一次 = 取消钉住**。
 *     理由（用户原话）："不用展示那个定位，单击那一行就是定位，就是盯住，
 *     再次单击就是取消盯住。" 每行一个按钮等于把同一件事说两遍。
 *
 * 这个组件只负责**显示与交互**，不持有批注数据（数据在 `useAnnotations`）。
 */

import type { Annotation } from "./annotations.ts";
import { markById } from "./marks.ts";

export type AnnotationPanelProps = {
  /** 全部批注（已由调用方排好序：消息顺序 + 段内偏移）。 */
  annotations: readonly Annotation[];
  /** messageId → 它在对话里的序号（1 起），用于显示"第 N 条回复"。 */
  messageOrdinal: (messageId: string) => number | undefined;
  /** 是否折叠。 */
  folded: boolean;
  onToggleFold: () => void;
  /**
   * 单击一行：定位到原文 + 钉住（再点一次取消钉住）。
   * 是否"已钉住"由 `pinnedOf` 查，行据此加底色。
   */
  onRowClick: (id: string) => void;
  /** 这一条当前是否钉住（决定行是否高亮）。 */
  pinnedOf: (id: string) => boolean;
  /** 删除一条批注（高亮一起消失）。 */
  onRemove: (id: string) => void;
};

export function AnnotationPanel({
  annotations, messageOrdinal, folded, onToggleFold, onRowClick, pinnedOf, onRemove,
}: AnnotationPanelProps) {
  const count = annotations.length;

  return (
    <section
      data-testid="annotation-panel"
      aria-label="批注"
      className="overflow-hidden rounded-panel ring-1 ring-line"
    >
      {/*
        无障碍（Task 0003 · P6）：`::highlight()` 画出来的高亮对读屏**完全不可见**，
        所以读屏用户只能靠这张表知道"我在哪段文字上标了什么"。
        数量变化用 aria-live 播报，新增/删除都有声音反馈。
      */}
      <p data-testid="annotation-announcer" data-no-clip-check aria-live="polite" className="sr-only">
        {count === 0 ? "还没有批注" : `共有 ${count} 条批注`}
      </p>
      {/* 标题栏：点击折叠 */}
      <button
        type="button"
        data-testid="annotation-panel-toggle"
        aria-expanded={!folded}
        aria-controls="annotation-panel-rows"
        onClick={onToggleFold}
        className="flex w-full items-center gap-2 bg-sunken px-3 py-1.5 text-left text-meta font-semibold text-ink-500 hover:bg-hover max-sm:min-h-11"
      >
        <span className="text-micro text-ink-500" aria-hidden="true">{folded ? "▶" : "▼"}</span>
        <span>批注转化成的消息</span>
        <span data-testid="annotation-panel-count"
          className="rounded-full bg-hover px-1.5 py-px text-micro tabular-nums text-ink-700">{count}</span>
        <span className="ml-auto text-micro font-normal text-ink-500">单击一行跳到原文并钉住</span>
      </button>

      {!folded && (
        <div id="annotation-panel-rows" data-testid="annotation-panel-rows" className="overflow-auto" style={{ maxHeight: "var(--container-anno-panel)" }}>
          {count === 0 ? (
            <p data-testid="annotation-panel-empty" className="px-3 py-3.5 text-center text-meta text-ink-500">
              还没有批注。在正文里拖选一段文字试试。
            </p>
          ) : (
            <table className="w-full border-collapse text-meta">
              <caption data-no-clip-check className="sr-only">
                批注列表：每条包含被批注的原文、你写的话、语气，以及定位与删除按钮
              </caption>
              <thead>
                <tr className="text-micro uppercase tracking-wide text-ink-500">
                  <th className="w-8 px-2.5 py-1.5 text-left font-semibold" />
                  <th className="px-2.5 py-1.5 text-left font-semibold">被批注的原文</th>
                  <th className="px-2.5 py-1.5 text-left font-semibold">用户的话</th>
                  <th className="w-32 px-2.5 py-1.5 text-left font-semibold">语气</th>
                  <th className="w-14 px-2.5 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {annotations.map((anno, index) => {
                  const ordinal = messageOrdinal(anno.messageId);
                  const pinned = pinnedOf(anno.id);
                  return (
                    <tr key={anno.id} data-testid="annotation-row" data-anno={anno.id}
                      data-pinned={pinned ? "true" : "false"}
                      aria-selected={pinned}
                      onClick={() => onRowClick(anno.id)}
                      className={`cursor-pointer border-t border-line align-top hover:bg-hover ${
                        pinned ? "bg-accent-soft" : ""
                      }`}>
                      <td className="px-2.5 py-1.5 tabular-nums text-ink-500">{index + 1}.</td>
                      <td className="px-2.5 py-1.5 text-ink-700">
                        <span className="line-clamp-2 border-l-2 border-line pl-1.5">「{anno.quote}」</span>
                        {ordinal !== undefined && (
                          <span className="mt-0.5 block text-micro text-ink-500">第 {ordinal} 条回复</span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5">
                        {anno.note === ""
                          ? <span className="italic text-ink-500">（没写话）</span>
                          : <span className="whitespace-pre-wrap text-ink-900">{anno.note}</span>}
                      </td>
                      <td className="px-2.5 py-1.5">
                        <span className="flex flex-wrap gap-1">
                          {anno.marks.map((id) => {
                            const mark = markById(id);
                            if (mark === undefined) return null;
                            return (
                              <span key={id} data-mark={id}
                                aria-label={`语气：${mark.label}`}
                                className="rounded-full px-1.5 py-px text-micro font-semibold"
                                style={{
                                  background: `var(--color-anno-${mark.tone}-soft)`,
                                  color: `var(--color-anno-${mark.tone})`,
                                }}>
                                {mark.label}
                              </span>
                            );
                          })}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5 text-right">
                        <button type="button" data-testid="annotation-remove" data-anno={anno.id}
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
          )}
        </div>
      )}
    </section>
  );
}
