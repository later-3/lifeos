// 与其他 Agent 对话的右侧详情（Task 0013 · M1）。
//
// 设计（用户口径）：点开工具详情 → 右边看到对方 Agent 的执行过程与持续对话。
// 渲染**复用主对话的同一套组件**（MessageView + applyStreamEvent），不另写一套：
//   - 历史：GET /api/agents/<target>/sessions/<sid>（结构与本会话一致）
//   - 实时：同一条 SSE 连接，对端会话加进 focus.watching（服务端 events.ts matchesFocus 命中即投递）
// 输入：由发起方驱动，这里禁止发言（服务端也会拒，这里只是别让用户白打字）。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { applyStreamEvent, blocksOfStream, createStreamState, finalTextOfStream, textOfBlocks, type StreamState } from "../api/stream-blocks";
import { MessageView, type Block } from "./Message";
import { Spinner, MicroButton } from "../design/ui";

export type PeerTarget = { agentId: string; sessionId: string; agentName: string };

/** 一行 = 一条消息。`id` 是服务端 entry id：思考块的兜底定位要用它（Task 0028 · P8）。 */
type Row = { id?: string; role: "user" | "assistant"; blocks: Block[]; streaming: boolean };

export function PeerPanel({ target, liveEvents, loadThinking, onClose }: {
  target: PeerTarget;
  /** 该连接收到的全部事件（已按 watching 投递）；面板自己挑属于这条会话的。 */
  liveEvents: { subscribe: (listener: (event: unknown) => void) => () => void };
  /** 取思考正文（与主对话同一个入口：带并发闸与去重）。不传则该面板不提供展开。 */
  loadThinking?: (origin: { entryId: string; blockIndex: number }) => Promise<string>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const stream = useRef<StreamState>(createStreamState());
  const streaming = useRef(false);
  // 与主对话同款的"贴底跟随"：用户往上翻就不再抢滚动，回到底部自动恢复。
  const scrollRef = useRef<HTMLDivElement>(null);
  const followTail = useRef(true);
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node === null || !followTail.current) return;
    node.scrollTop = node.scrollHeight;
  }, [rows]);
  function onScroll(event: React.UIEvent<HTMLDivElement>): void {
    const node = event.currentTarget;
    followTail.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
  }

  // 历史：打开时拉一次（与主会话同样的接口形状）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        /*
         * 与主对话同口径带 `deferThinking=1`（P8/B2）：思考正文按需取，首屏省 68% 字节。
         * 侧边栏是**旁观**，更没有理由为了"能展开"而全量下载几十万字思考。
         * 取数走主对话同一个 `loadThinking`（它带并发闸与去重，见 Task 0028 · P7）。
         */
        const response = await fetch(`/api/agents/${target.agentId}/sessions/${target.sessionId}?deferThinking=1`);
        if (!response.ok) throw new Error(`读取对话失败（HTTP ${response.status}）`);
        const data = (await response.json()) as { messages?: Array<{ id?: string; role: string; text?: string; blocks?: Block[] }> };
        if (cancelled) return;
        setRows((data.messages ?? []).map((message) => ({
          ...(message.id !== undefined ? { id: message.id } : {}),
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
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-surface" data-testid="peer-panel">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-meta font-medium text-ink-700">
          与 {target.agentName} 的对话
        </span>
        {running && <Spinner size={12} className="text-accent" />}
        <span className="shrink-0 text-micro text-ink-500">{running ? "对方执行中" : "已完成"}</span>
        <MicroButton onClick={onClose}>关闭</MicroButton>
      </header>

      <div ref={scrollRef} onScroll={onScroll}
        className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto px-3 py-2" data-testid="peer-messages">
        {loading && <div className="text-micro text-ink-500">读取中…</div>}
        {error !== undefined && <div className="text-micro text-danger">{error}</div>}
        {!loading && error === undefined && rows.length === 0 && (
          <div className="text-micro text-ink-500">对方还没有输出。</div>
        )}
        <div className="mx-auto flex w-full max-w-reading flex-col gap-4">
          {rows.map((row, index) => (
            <MessageView key={index} role={row.role} blocks={row.blocks} busy={row.streaming} align="start"
              /* 与主对话共用同一个取数入口（含并发闸 + 同 key 去重）：侧边栏展开思考不该另写一套。 */
              {...(loadThinking !== undefined ? { loadThinking } : {})}
              /* 思考块的 messageId 用于兜底定位（未折叠时 origin = 本条 id + 块下标）。 */
              {...(loadThinking !== undefined && row.id !== undefined ? { messageId: row.id } : {})} />
          ))}
        </div>
      </div>

      {/*
        抽屉是**旁观视角**，不提供输入框（发言在左侧主聊天里做）。
        旧文案写"此处不能发言"，与 Task 0014 之后的事实不符——那条会话现在完全可以在左侧继续，
        理由是服务端已经不再按"会话来源"拒绝发言（02-design L3）。
      */}
      <footer className="border-t border-line px-3 py-2 text-micro text-ink-500">
        这里只是旁观对端的过程；要继续这条会话，回到左侧列表点开它发消息即可。
      </footer>
    </aside>
  );
}
