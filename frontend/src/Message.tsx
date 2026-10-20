import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { IconCheck, IconCopy, IconRefresh, IconTool } from "@tabler/icons-react";
import { Spinner } from "./design/ui";
import { argPreview, type Phase } from "./stream-blocks";
import { copyText } from "./clipboard";
import { copyTextOf } from "./message-text";
import { revealActions } from "./resend";

/**
 * 消息渲染（Markdown + 结构化块）。
 * 之前直接把文本塞进 div（whitespace-pre-wrap）：Agent 回复里的列表、加粗、代码块全是原始符号。
 * 现在两端都走 marked + DOMPurify（与文件面板同一条链路），HTML 一律不许透传。
 *
 * 流式期（busy）的规则（参照 Pi Web 的 MessageView/ThinkingBlock/ToolCallBlock，见 references 基线表）：
 * - 思考块：增量文本实时可见（自动展开），跑完自动收起、可再点开；
 * - 工具块：调用一出现就展示（名字 + 参数摘要 + "执行中" 转圈），结果回来原地变"完成/出错"并保留耗时；
 * - 消息尾：工作指示行（旋转弧 + 阶段文案 + 秒数），只在 busy 时存在。
 */

export type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "toolCall"; id?: string; name: string; arguments?: unknown;
      result?: string; isError?: boolean; truncated?: boolean; durationMs?: number;
    };
export type Message = {
  role: "user" | "assistant"; text: string; blocks: Block[];
  /** Pi 的失败原因（stopReason=error）：显示在气泡里，并让"重新发送"可用 */
  error?: string;
  /** 仅客户端：这条正在被流事件更新（工作指示与块自动展开都只认它）。loadMessages 重建后自然清掉。 */
  streaming?: boolean;
};

function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { USE_PROFILES: { html: true } });
}

function Markdown({ text, inverse = false }: { text: string; inverse?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className={`md-body${inverse ? " md-inverse" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 秒表：整轮生成期间每秒 +1（只在工作指示行里用，卸载即停）。 */
function useWorkingSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return seconds;
}

const PHASE_LABEL: Record<Phase, string> = {
  waiting: "等待模型响应…",
  thinking: "思考中…",
  tool: "正在执行工具…",
  text: "输出中…",
};

/** 工作指示行：转圈 + 现在在干什么 + 已用秒数。 */
export function WorkingRow({ phase, activeTool, retry }: {
  phase: Phase; activeTool?: string;
  retry?: { attempt: number; maxAttempts: number; delayMs: number; message: string };
}) {
  const seconds = useWorkingSeconds(true);
  // 状态区分（2026-10-19）：请求刚发出 = 连接中；超过 3s 还没首个事件 = 等待模型响应
  const label = retry !== undefined
    ? `模型调用失败，${Math.max(1, Math.round(retry.delayMs / 1000))}s 后重试（${retry.attempt}/${retry.maxAttempts}）：${retry.message}`
    : phase === "tool" && activeTool !== undefined && activeTool !== "" ? `正在执行 ${activeTool}…`
    : phase === "waiting" && seconds < 3 ? "正在连接模型…" : PHASE_LABEL[phase];
  return (
    <div className={`flex flex-wrap items-center gap-2 py-0.5 text-meta ${retry !== undefined ? "text-danger" : "text-ink-500"}`}>
      <Spinner size={14} className={retry !== undefined ? "text-danger" : "text-accent"} />
      <span className="animate-pulse">{label}</span>
      <span className="tabular-nums text-micro text-ink-500">{seconds}s</span>
    </div>
  );
}

/** 触屏/无悬停设备：动作条常显；悬停设备：悬停才显示（参照 Pi Web 的 hovered / isMobile）。 */
function useNoHover(): boolean {
  const [noHover, setNoHover] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(hover: none)");
    const update = () => setNoHover(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return noHover;
}

type CopyState = "idle" | "copied" | "failed";

/** 消息动作条：复制（有文本时）+ 重新发送（这一轮失败时）。复制失败也要说出来，不静默。 */
function MessageActions({ text, reveal, align, onRetry }: { text: string; reveal: boolean; align: "start" | "end"; onRetry?: () => void }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (timer.current !== undefined) clearTimeout(timer.current); }, []);
  const copy = () => {
    copyText(text)
      .then(() => setState("copied"))
      .catch(() => setState("failed"))
      .finally(() => {
        if (timer.current !== undefined) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 1500);
      });
  };
  const label = state === "copied" ? "已复制" : state === "failed" ? "复制失败" : "复制";
  const retryAction = onRetry === undefined ? null : (
    <button type="button" onClick={onRetry} title="重新发送这一轮"
      data-testid="resend-message"
      className="flex min-h-7 items-center gap-1 rounded-control px-2 text-micro text-ink-500 transition-colors hover:text-ink-900">
      <IconRefresh size={12} />
      <span>重新发送</span>
    </button>
  );
  // 反馈期间保持可见：否则鼠标一移开，"已复制"就随悬停态一起消失了
  const visible = reveal || state !== "idle";
  // 动作跟着消息一侧：用户消息贴右侧气泡，助手消息贴左侧正文（否则按钮跑到对侧，看着"隔得很开"）
  return (
    <div data-testid="message-actions"
      className={`flex ${align === "end" ? "justify-end" : "justify-start"} transition-opacity duration-150 ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
      {text !== "" && (
      <button type="button" onClick={copy} title="复制这条消息" data-testid="copy-message"
        className={`flex min-h-7 items-center gap-1 rounded-control px-2 text-micro transition-colors ${state === "failed" ? "text-danger" : state === "copied" ? "text-accent" : "text-ink-500 hover:text-ink-900"}`}>
        {state === "copied" ? <IconCheck size={12} /> : <IconCopy size={12} />}
        <span aria-live="polite">{label}</span>
      </button>
      )}
      {retryAction}
    </div>
  );
}

export function MessageView({ role, blocks, busy, error, align = "end", onRetry, failureNote }: {
  role: "user" | "assistant"; blocks: Block[]; busy: boolean; error?: string;
  /** 聊天区用户消息靠右（end）；历史时间线里靠左（start），避免与头像/时间脱开 */
  align?: "end" | "start";
  /** 这一轮失败时的"重新发送"（动作挂在失败的那条消息上，不另起一行） */
  onRetry?: () => void;
  /** 失败但气泡里没有原因时的一句说明（空回复/尾部是用户消息） */
  failureNote?: string;
}) {
  const text = copyTextOf(blocks);
  const [hovered, setHovered] = useState(false);
  const noHover = useNoHover();
  // 流式中的回复不给复制（Pi Web 同款：textContent && !isStreaming）；失败重发同理
  const showActions = (text !== "" || onRetry !== undefined) && !(role === "assistant" && busy);
  // 失败动作常显（不靠悬停）：用户刚遇到失败，必须一眼看到"重新发送"
  const reveal = revealActions(hovered, noHover, onRetry !== undefined);
  const hover = { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) };
  if (role === "user") {
    return (
      <div className={`flex flex-col gap-1 ${align === "end" ? "items-end" : "items-start"}`}
        data-testid="message" data-role="user" {...hover}>
        <div className="max-w-bubble rounded-bubble rounded-br-md bg-ink-900 px-4 py-2.5 text-white" data-testid="message-text">
          <Markdown text={text} inverse />
        </div>
        {failureNote !== undefined && <p className="text-meta text-ink-500" data-testid="failure-note">{failureNote}</p>}
        {showActions && <MessageActions text={text} reveal={reveal} align="end" {...(onRetry !== undefined ? { onRetry } : {})} />}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="message" data-role="assistant" {...hover}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} live={busy} />
      ))}
      {error !== undefined && <p className="text-meta text-danger">模型调用失败：{error}</p>}
      {failureNote !== undefined && <p className="text-meta text-ink-500" data-testid="failure-note">{failureNote}</p>}
      {showActions && <MessageActions text={text} reveal={reveal} align="start" {...(onRetry !== undefined ? { onRetry } : {})} />}
    </div>
  );
}

/**
 * 流式期自动展开；用户手动点过之后不再强扭。
 * `closeOnEnd`：思考块跑完要收起（否则一屏思考噪音），工具块跑完**不收起**（结果要让人看见）。
 */
function useAutoOpen(live: boolean, closeOnEnd: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(live);
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) return;
    if (live) setOpen(true);
    else if (closeOnEnd) setOpen(false);
  }, [live, closeOnEnd]);
  const toggle = () => { touched.current = true; setOpen((value) => !value); };
  return [open, toggle];
}

function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
  const [open, toggle] = useAutoOpen(live, true);
  return (
    <div className="max-w-bubble overflow-hidden rounded-panel bg-sunken">
      <button type="button" onClick={toggle}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-meta text-ink-500 transition-colors hover:text-ink-900">
        {live ? <Spinner size={12} className="text-accent" /> : null}
        <span>{live ? "思考中…" : "思考过程"}</span>
        <span className="ml-auto shrink-0 text-micro text-ink-500">{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div className="whitespace-pre-wrap border-t border-line px-3 py-2 text-meta leading-relaxed text-ink-700">{text}</div>
      )}
    </div>
  );
}

function ToolCallBlock({ block, live }: { block: Extract<Block, { type: "toolCall" }>; live: boolean }) {
  const running = block.result === undefined;
  const [open, toggle] = useAutoOpen(running, false);
  const preview = argPreview(block.name, block.arguments);
  const tone = block.isError === true ? "text-danger" : running ? "text-ink-500" : "text-success";
  const status = block.isError === true ? "出错" : running ? "执行中" : "完成";
  const seconds = running && live ? undefined : block.durationMs !== undefined ? `${(block.durationMs / 1000).toFixed(1)}s` : undefined;
  return (
    <div className="max-w-bubble overflow-hidden rounded-panel ring-1 ring-line">
      <button type="button" onClick={toggle}
        className="flex w-full items-center gap-1.5 bg-sunken px-3 py-2 text-left text-meta text-ink-700 transition-colors hover:bg-hover">
        {running ? <Spinner size={12} className="text-accent" /> : <IconTool size={14} className="shrink-0 text-ink-300" />}
        <span className="shrink-0 font-medium">{block.name}</span>
        {preview !== "" && <span className="min-w-0 flex-1 truncate font-mono text-micro text-ink-500">{preview}</span>}
        <span className={`ml-auto shrink-0 text-micro ${tone}`}>{status}</span>
        {seconds !== undefined && <span className="shrink-0 tabular-nums text-micro text-ink-500">{seconds}</span>}
      </button>
      {open && (
        <>
          <pre className="overflow-x-auto whitespace-pre-wrap border-t border-line px-3 py-2 font-mono text-micro leading-relaxed text-ink-700">{JSON.stringify(block.arguments ?? {}, null, 2)}</pre>
          {block.result !== undefined && (
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-line bg-sunken px-3 py-2 font-mono text-micro leading-relaxed text-ink-500">{block.result}{block.truncated === true ? "\n…（界面只显示前 8KB，完整结果见会话文件）" : ""}</pre>
          )}
        </>
      )}
    </div>
  );
}

function BlockView({ block, live }: { block: Block; live: boolean }) {
  if (block.type === "text") {
    if (block.text === "" && live) return null;
    return <div data-testid="message-text"><Markdown text={block.text} /></div>;
  }
  if (block.type === "thinking") return <ThinkingBlock text={block.text} live={live} />;
  return <ToolCallBlock block={block} live={live} />;
}
