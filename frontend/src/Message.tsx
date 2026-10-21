import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { IconCopy, IconRefresh, IconTool } from "@tabler/icons-react";
import { Spinner } from "./design/ui";
import { argPreview, type Phase } from "./stream-blocks";
import { copyText } from "./clipboard";
import { copyTextOf } from "./message-text";
import { retryRemainingSeconds, turnStepText, type TurnStep } from "./working";
import { MessageActionBar } from "./message-actions";
import type { MessageAction } from "./action-bar";
import { failureLabel, type FailureKind } from "./failure-text";
import { toolState } from "./tool-state";

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
  /** Pi 的原始失败信息（errorMessage）：作为证据小字显示 */
  error?: string;
  /** 失败归类（超时/连不上/鉴权/限流/服务端/空回复/中断/截断）：决定显示哪句话 */
  failure?: FailureKind;
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
export function WorkingRow({ step, phase, activeTool, retry }: {
  step: TurnStep;
  phase: Phase; activeTool?: string;
  retry?: { attempt: number; maxAttempts: number; delayMs: number; message: string; startedAt: number };
}) {
  const total = useWorkingSeconds(true);
  // 状态区分（2026-10-19）：请求刚发出 = 连接中；超过 3s 还没首个事件 = 等待模型响应
  // 重试（2026-10-20）：倒计时逐秒减少（Pi CLI 的 RetryStatusIndicator 同款），不再是静态 "Ns"
  const label = retry !== undefined
    ? `模型调用失败，${retryRemainingSeconds(retry.delayMs, Date.now() - retry.startedAt)}s 后重试（${retry.attempt}/${retry.maxAttempts}）：${retry.message}`
    : phase === "tool" && activeTool !== undefined && activeTool !== "" ? `正在执行 ${activeTool}…`
    : phase === "waiting" && total < 3 ? "正在连接模型…" : PHASE_LABEL[phase];
  return (
    <div className={`flex flex-wrap items-center gap-2 py-0.5 text-meta ${retry !== undefined ? "text-danger" : "text-ink-500"}`}>
      <Spinner size={14} className={retry !== undefined ? "text-danger" : "text-accent"} />
      <span className="font-medium text-ink-700">{turnStepText(step)}</span>
      {step === 3 && <span className="animate-pulse">{label}</span>}
      <span className="tabular-nums text-micro text-ink-500" title="本轮耗时">{total}s</span>
    </div>
  );
}

/** 本条消息要注册进动作条的动作：功能只描述"做什么"，对齐/间距/可见性/反馈由容器决定。 */
function actionsOf(text: string, onRetry: (() => void) | undefined): MessageAction[] {
  const actions: MessageAction[] = [];
  if (text !== "") {
    actions.push({
      key: "copy", label: "复制", icon: <IconCopy size={12} />, title: "复制这条消息",
      testId: "copy-message", doneLabel: "已复制", failedLabel: "复制失败",
      run: () => copyText(text),
    });
  }
  if (onRetry !== undefined) {
    actions.push({
      key: "resend", label: "重新发送", icon: <IconRefresh size={12} />, title: "重新发送这一轮",
      testId: "resend-message",   // 与复制同一条规则：悬停出现（成败都不例外）
      run: onRetry,
    });
  }
  return actions;
}

export function MessageView({ role, blocks, busy, error, failure, align = "end", onRetry }: {
  role: "user" | "assistant"; blocks: Block[]; busy: boolean; error?: string; failure?: FailureKind;
  /** 聊天区用户消息靠右（end）；历史时间线里靠左（start），避免与头像/时间脱开 */
  align?: "end" | "start";
  /** 这一轮失败时的"重新发送"（动作挂在被重发的那条用户消息上） */
  onRetry?: () => void;
}) {
  const text = copyTextOf(blocks);
  const [hovered, setHovered] = useState(false);
  const actions = actionsOf(text, onRetry);
  // 流式中的回复不给动作（Pi Web 同款：isStreaming → null）；容器据此整体抑制
  const suppressed = role === "assistant" && busy;
  const hover = { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) };
  const bar = <MessageActionBar side={role} actions={actions} hovered={hovered} suppressed={suppressed} />;
  if (role === "user") {
    return (
      <div className={`flex flex-col gap-1 ${align === "end" ? "items-end" : "items-start"}`}
        data-testid="message" data-role="user" {...hover}>
        <div className="max-w-bubble rounded-bubble rounded-br-md bg-message-user px-4 py-2.5 text-white" data-testid="message-text" data-message-kind="user">
          <Markdown text={text} inverse />
        </div>
        {bar}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="message" data-role="assistant" data-message-kind="assistant" {...hover}>
      {blocks.map((block, index) => (
        // 这一轮失败时把过程展开（思考/工具都看得见）：失败也要能解释"它做了什么"
        <BlockView key={index} block={block} live={busy} forceOpen={failure !== undefined} />
      ))}
      {(failure !== undefined || error !== undefined) && (
        <div data-testid="failure-reason" data-message-kind="failure" className="rounded-panel bg-message-failure px-3 py-2">
          <p className="text-meta text-danger">{failureLabel(failure)}</p>
          {error !== undefined && <p className="text-micro text-ink-500">{error}</p>}
        </div>
      )}
      {bar}
    </div>
  );
}

/**
 * 流式期自动展开；用户手动点过之后不再强扭。
 * `closeOnEnd`：思考块跑完要收起（否则一屏思考噪音），工具块跑完**不收起**（结果要让人看见）。
 */
function useAutoOpen(live: boolean, closeOnEnd: boolean, initialOpen = live): [boolean, () => void] {
  const [open, setOpen] = useState(initialOpen || live);
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) return;
    if (live) setOpen(true);
    else if (closeOnEnd) setOpen(false);
  }, [live, closeOnEnd]);
  const toggle = () => { touched.current = true; setOpen((value) => !value); };
  return [open, toggle];
}

function ThinkingBlock({ text, live, forceOpen = false }: { text: string; live: boolean; forceOpen?: boolean }) {
  // 失败轮次：默认展开并保持展开（不回收到"思考过程"一行），否则用户看不到它做过什么
  const [open, toggle] = useAutoOpen(live, !forceOpen, forceOpen);
  return (
    <div className="max-w-bubble overflow-hidden rounded-panel bg-message-thinking" data-message-kind="thinking">
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
  const state = toolState({ hasResult: block.result !== undefined, ...(block.isError !== undefined ? { isError: block.isError } : {}), live });
  const running = state === "running";
  const [open, toggle] = useAutoOpen(running, false);
  const preview = argPreview(block.name, block.arguments);
  const tone = state === "error" ? "text-danger" : state === "done" ? "text-success" : "text-ink-700";
  const status = state === "error" ? "出错" : state === "done" ? "完成" : state === "running" ? "执行中" : "未完成";
  const seconds = running ? undefined : block.durationMs !== undefined ? `${(block.durationMs / 1000).toFixed(1)}s` : undefined;
  const surface = state === "error" ? "bg-message-tool-error" : state === "done" ? "bg-message-tool-done" : "bg-message-tool";
  return (
    <div className={`max-w-bubble overflow-hidden rounded-panel ring-1 ring-line ${surface}`} data-message-kind={`tool-${state}`}>
      <button type="button" onClick={toggle}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-meta text-ink-700 transition-colors hover:bg-hover">
        {running ? <Spinner size={12} className="text-accent" /> : <IconTool size={14} className="shrink-0 text-ink-300" />}
        <span className="shrink-0 font-medium">{block.name}</span>
        {preview !== "" && <span className="min-w-0 flex-1 truncate font-mono text-micro text-ink-700">{preview}</span>}
        <span className={`ml-auto shrink-0 text-micro ${tone}`}
          {...(state === "missing" ? { title: "这一轮已结束，但没有拿到工具结果（可能被中断）" } : {})}>{status}</span>
        {seconds !== undefined && <span className="shrink-0 tabular-nums text-micro text-ink-700">{seconds}</span>}
      </button>
      {open && (
        <>
          <pre className="overflow-x-auto whitespace-pre-wrap border-t border-line px-3 py-2 font-mono text-micro leading-relaxed text-ink-700">{JSON.stringify(block.arguments ?? {}, null, 2)}</pre>
          {block.result !== undefined && (
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-line bg-sunken px-3 py-2 font-mono text-micro leading-relaxed text-ink-700">{block.result}{block.truncated === true ? "\n…（界面只显示前 8KB，完整结果见会话文件）" : ""}</pre>
          )}
        </>
      )}
    </div>
  );
}

function BlockView({ block, live, forceOpen = false }: { block: Block; live: boolean; forceOpen?: boolean }) {
  if (block.type === "text") {
    if (block.text === "" && live) return null;
    return <div data-testid="message-text"><Markdown text={block.text} /></div>;
  }
  if (block.type === "thinking") return <ThinkingBlock text={block.text} live={live} forceOpen={forceOpen} />;
  return <ToolCallBlock block={block} live={live} />;
}
