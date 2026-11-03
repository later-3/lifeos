/**
 * 底部批注表格（Task 0003 · P4）。
 *
 * 与 demo（`tools/anno-demo/`）的表格一致，但**发送形态改了**（用户 2026-11-03 定）：
 * demo 是"N 条批注 → N 条消息"，真实实现是"N 条批注 → 1 条消息（内部 N 行）"。
 * 原因：真实发送每次 POST 都走 `runTurn()` → `session.prompt()`，是一次真实模型调用。
 *
 * 这个组件只负责**显示与交互**，不持有批注数据（数据在 `useAnnotations`）；
 * 发起发送由调用方（composer）决定。
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
  /** 定位：跳到原文并展开那个批注框。 */
  onLocate: (id: string) => void;
  /** 删除一条批注（高亮一起消失）。 */
  onRemove: (id: string) => void;
};

export function AnnotationPanel({
  annotations, messageOrdinal, folded, onToggleFold, onLocate, onRemove,
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
      <p data-testid="annotation-announcer" aria-live="polite" className="sr-only">
        {count === 0 ? "还没有批注" : `共有 ${count} 条批注`}
      </p>
      {/* 标题栏：点击折叠 */}
      <button
        type="button"
        data-testid="annotation-panel-toggle"
        aria-expanded={!folded}
        aria-controls="annotation-panel-rows"
        onClick={onToggleFold}
        className="flex w-full items-center gap-2 bg-sunken px-3 py-1.5 text-left text-meta font-semibold text-ink-500 hover:bg-hover"
      >
        <span className="text-micro text-ink-300" aria-hidden="true">{folded ? "▶" : "▼"}</span>
        <span>批注转化成的消息</span>
        <span data-testid="annotation-panel-count"
          className="rounded-full bg-hover px-1.5 py-px text-micro tabular-nums text-ink-700">{count}</span>
        <span className="ml-auto text-micro font-normal text-ink-300">点「定位」跳到原文</span>
      </button>

      {!folded && (
        <div id="annotation-panel-rows" data-testid="annotation-panel-rows" className="overflow-auto" style={{ maxHeight: "var(--container-anno-panel)" }}>
          {count === 0 ? (
            <p data-testid="annotation-panel-empty" className="px-3 py-3.5 text-center text-meta text-ink-300">
              还没有批注。在正文里拖选一段文字试试。
            </p>
          ) : (
            <table className="w-full border-collapse text-meta">
              <caption className="sr-only">
                批注列表：每条包含被批注的原文、你写的话、语气，以及定位与删除按钮
              </caption>
              <thead>
                <tr className="text-micro uppercase tracking-wide text-ink-300">
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
                  return (
                    <tr key={anno.id} data-testid="annotation-row" data-anno={anno.id}
                      className="border-t border-line align-top hover:bg-hover">
                      <td className="px-2.5 py-1.5 tabular-nums text-ink-300">{index + 1}.</td>
                      <td className="px-2.5 py-1.5 text-ink-700">
                        <span className="line-clamp-2 border-l-2 border-line pl-1.5">「{anno.quote}」</span>
                        {ordinal !== undefined && (
                          <span className="mt-0.5 block text-micro text-ink-300">第 {ordinal} 条回复</span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5">
                        {anno.note === ""
                          ? <span className="italic text-ink-300">（没写话）</span>
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
                        <button type="button" data-testid="annotation-locate" data-anno={anno.id}
                          onClick={() => onLocate(anno.id)}
                          className="rounded-control px-1.5 py-0.5 text-micro text-accent hover:bg-accent-soft">
                          定位
                        </button>
                        <button type="button" data-testid="annotation-remove" data-anno={anno.id}
                          onClick={() => onRemove(anno.id)}
                          aria-label="删除这条批注"
                          className="ml-1 rounded-control px-1 py-0.5 text-micro text-ink-300 hover:bg-danger-soft hover:text-danger">
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
