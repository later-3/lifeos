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
import { useMemo } from "react";
import { annotationLine } from "./annotation-message.ts";

export type AnnotationPanelProps = {
  /** 全部批注（已由调用方排好序：消息顺序 + 段内偏移）。 */
  annotations: readonly Annotation[];
  /**
   * 消息 id 的先后顺序（发送时也用它排序）。
   * 面板与真正发出去的内容**必须是同一套排序**，否则"看到的"和"发出去的"会不一致。
   */
  messageOrder: readonly string[];
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
  /** 清空全部批注（含高亮、面板）。demo 顶栏有这个入口，真实实现 P6 补上。 */
  onClearAll: () => void;
};

export function AnnotationPanel({
  annotations, messageOrder, folded, onToggleFold, onRowClick, pinnedOf, onRemove, onClearAll,
}: AnnotationPanelProps) {
  const count = annotations.length;

  /**
   * 每行展示"**它会发送成什么样**"（用户 2026-11-03：表格本来就是表格，
   * 不要把原始字段再并排摆一遍，要展示转换后的信息）。
   *
   * 直接复用 `annotationLine()`——**面板与发送走同一个函数**，
   * 这样"表里看到的"和"发出去的"物理上不可能不一致。
   * 序号按实际发出的行排（只有功能标记的行不占号，它们不发）。
   */
  const rows = useMemo(() => {
    const rank = (id: string): number => {
      const at = messageOrder.indexOf(id);
      return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
    const sorted = [...annotations].sort((a, b) => {
      const byMessage = rank(a.messageId) - rank(b.messageId);
      if (byMessage !== 0) return byMessage;
      if (a.blockIndex !== b.blockIndex) return a.blockIndex - b.blockIndex;
      return a.start - b.start;
    });
    let sent = 0;
    return sorted.map((anno) => {
      const line = annotationLine(anno, sent + 1);
      // 只有功能标记：不占用发送序号（它不进消息），但仍要显示以便删除
      if (line === null) return { anno, line: null, sendable: false };
      sent += 1;
      return { anno, line, sendable: true };
    });
  }, [annotations, messageOrder]);

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
        <span className={`text-micro text-ink-500 transition-transform duration-150 ${folded ? "" : "rotate-90"}`}
          aria-hidden="true">▶</span>
        <span>批注转化成的消息</span>
        <span data-testid="annotation-panel-count"
          className="rounded-full bg-hover px-1.5 py-px text-micro tabular-nums text-ink-700">{count}</span>
      </button>
      {count > 0 && (
        <div className="flex items-center justify-end border-t border-line bg-sunken px-3 py-1">
          <button type="button" data-testid="annotation-clear-all" onClick={onClearAll}
            className="inline-flex min-h-7 items-center rounded-control px-1.5 text-micro text-ink-500 hover:bg-danger-soft hover:text-danger max-sm:min-h-11">
            清空全部批注
          </button>
        </div>
      )}

      {/*
        折叠过渡（P6 补，2026-11-03）：箭头旋转 150ms + 内容区收起时淡出。
        用 grid-template-rows 0fr↔1fr 做高度过渡，不需要知道内容高度；
        `motion-reduce` 下关掉，尊重系统的"减少动态效果"。
      */}
      {!folded && (
        <div id="annotation-panel-rows" data-testid="annotation-panel-rows"
          className="overflow-auto motion-safe:animate-anno-panel"
          style={{ maxHeight: "var(--container-anno-panel)" }}>
            <table className="w-full border-collapse text-meta">
              <caption data-no-clip-check className="sr-only">
                批注列表：每条显示它会发送成什么样，单击一行可跳到原文并钉住
              </caption>
              <thead>
                <tr className="text-micro uppercase tracking-wide text-ink-500">
                  <th className="px-2.5 py-1.5 text-left font-semibold">发送时的样子</th>
                  <th className="w-10 px-1 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { anno } = row;
                  const pinned = pinnedOf(anno.id);
                  return (
                    <tr key={anno.id} data-testid="annotation-row" data-anno={anno.id}
                      data-pinned={pinned ? "true" : "false"}
                      data-sendable={row.sendable ? "true" : "false"}
                      aria-selected={pinned}
                      onClick={() => onRowClick(anno.id)}
                      className={`cursor-pointer border-t border-line align-top hover:bg-hover ${
                        pinned ? "bg-accent-soft" : ""
                      }`}>
                      <td className="px-2.5 py-1.5">
                        {row.line === null ? (
                          // 只有功能标记：不发给 Agent，但用户要看得见、删得掉
                          <span className="flex flex-wrap items-baseline gap-1.5">
                            <span className="line-clamp-2 border-l-2 border-line pl-1.5 text-ink-700">「{anno.quote}」</span>
                            <span className="text-micro text-ink-500">仅分类，不发送</span>
                          </span>
                        ) : (
                          <span data-testid="annotation-line" className="block whitespace-pre-wrap font-mono text-micro leading-relaxed text-ink-900">
                            {row.line}
                          </span>
                        )}
                      </td>
                      <td className="px-1 py-1.5 text-right">
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
        </div>
      )}
    </section>
  );
}
