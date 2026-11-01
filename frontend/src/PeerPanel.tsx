// 与其他 Agent 对话的右侧详情（Task 0013 · M1）。
//
// 设计（用户口径）：点开工具详情 → 右边看到对方 Agent 的执行过程与持续对话。
// 渲染**复用主对话的同一套组件**（MessageView + applyStreamEvent），不另写一套：
//   - 历史：GET /api/agents/<target>/sessions/<sid>（结构与本会话一致）
//   - 实时：同一条 SSE 连接，对端会话加进 focus.watching（服务端 events.ts matchesFocus 命中即投递）
// 输入：由发起方驱动，这里禁止发言（服务端也会拒，这里只是别让用户白打字）。
import { useEffect, useRef, useState } from "react";
import { applyStreamEvent, blocksOfStream, createStreamState, finalTextOfStream, textOfBlocks, type StreamState } from "./stream-blocks";
import { MessageView, type Block } from "./Message";
import { Spinner } from "./design/ui";

export type PeerTarget = { agentId: string; sessionId: string; agentName: string };

type Row = { role: "user" | "assistant"; blocks: Block[]; streaming: boolean };

export function PeerPanel({ target, liveEvents, onClose }: {
  target: PeerTarget;
  /** 该连接收到的全部事件（已按 watching 投递）；面板自己挑属于这条会话的。 */
  liveEvents: { subscribe: (listener: (event: unknown) => void) => () => void };
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const stream = useRef<StreamState>(createStreamState());
  const streaming = useRef(false);

  // 历史：打开时拉一次（与主会话同样的接口形状）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/agents/${target.agentId}/sessions/${target.sessionId}`);
        if (!response.ok) throw new Error(`读取对话失败（HTTP ${response.status}）`);
        const data = (await response.json()) as { messages?: Array<{ role: string; text?: string; blocks?: Block[] }> };
        if (cancelled) return;
        setRows((data.messages ?? []).map((message) => ({
          role: message.role === "user" ? "user" : "assistant",
          blocks: message.blocks ?? [{ type: "text" as const, text: message.text ?? "" }],
          streaming: false,
        })));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [target.agentId, target.sessionId]);

  // 实时：与主对话**同一套**管道（Task 0013）。
  // 关键：一轮对话 = 一条 assistant 消息，段与工具块的有序排列由 applyStreamEvent 负责；
  // 这里绝不能"每个事件造一行"，否则中途调工具时会把同一轮拆成多行、顺序还会乱。
  useEffect(() => {
    stream.current = createStreamState();
    streaming.current = false;
    return liveEvents.subscribe((raw) => {
      const event = raw as { agentId?: string; sessionId?: string; type?: string; state?: string };
      if (event.agentId !== target.agentId || event.sessionId !== target.sessionId) return;
      if (typeof event.type !== "string") return;
      if (event.type === "turn") {
        const runningNow = event.state === "running";
        setRunning(runningNow);
        if (runningNow) { stream.current = createStreamState(); streaming.current = false; }
        return;
      }
      if (event.type === "done" || event.type === "error") {
        setRunning(false);
        setRows((list) => {
          const last = list[list.length - 1];
          if (last === undefined || !last.streaming) return list;
          return [...list.slice(0, -1), { ...last, streaming: false }];
        });
        streaming.current = false;
        return;
      }
      const tailIsStreaming = streaming.current;
      if (!tailIsStreaming) stream.current = createStreamState();
      const next = applyStreamEvent(stream.current, event as never);
      stream.current = next;
      const blocks = blocksOfStream(next);
      const text = finalTextOfStream(next) || textOfBlocks(blocks);
      streaming.current = true;
      setRows((list) => {
        const last = list[list.length - 1];
        if (!tailIsStreaming || last === undefined || last.role !== "assistant") {
          return [...list, { role: "assistant", blocks, streaming: true }];
        }
        return [...list.slice(0, -1), { ...last, blocks, streaming: true }];
      });
      void text;
    });
  }, [liveEvents, target.agentId, target.sessionId]);

  return (
    <aside className="flex min-h-0 w-full flex-col bg-surface" data-testid="peer-panel">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-meta font-medium text-ink-700">
          与 {target.agentName} 的对话
        </span>
        {running && <Spinner size={12} className="text-accent" />}
        <span className="shrink-0 text-micro text-ink-300">{running ? "对方执行中" : "已完成"}</span>
        <button type="button" onClick={onClose}
          className="shrink-0 rounded px-1.5 py-0.5 text-micro text-ink-500 hover:bg-sunken">关闭</button>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2" data-testid="peer-messages">
        {loading && <div className="text-micro text-ink-300">读取中…</div>}
        {error !== undefined && <div className="text-micro text-danger">{error}</div>}
        {!loading && error === undefined && rows.length === 0 && (
          <div className="text-micro text-ink-300">对方还没有输出。</div>
        )}
        {rows.map((row, index) => (
          <MessageView key={index} role={row.role} blocks={row.blocks} busy={row.streaming} align="start" />
        ))}
      </div>

      {/* 由发起方驱动：这里不提供输入框（服务端同样拒绝，避免"看起来能发"） */}
      <footer className="border-t border-line px-3 py-2 text-micro text-ink-300">
        这条对话由对方 Agent 发起，此处不能发言。
      </footer>
    </aside>
  );
}
