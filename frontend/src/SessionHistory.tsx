import { useEffect, useMemo, useRef, useState } from "react";
import { IconChevronRight, IconHistory, IconX } from "@tabler/icons-react";
import { MessageView, type Block } from "./Message";
import { AgentAvatar, type AgentAvatarSpec } from "./agent-avatar";
import { Button, EmptyState, IconButton, Skeleton } from "./design/ui";
import { estimateTokens, formatPercent, formatTokens, isSameScale, normalizeTo } from "./token-estimate";
import { regionOf } from "./prompt-regions";
import { applySectionPatch, type Sections } from "./prompt-patches";

/**
 * 完整历史 = 回合检查器（与对话区**并排**，不覆盖）。
 *
 * 结构（用户 2026-10-18 定稿）：
 *   回合 → 请求（我们发出去的完整载荷）/ 回复（模型回来的一切：思考、工具、文本）
 * - 工具调用是「回复」内部的动作，不另立一侧；
 * - 两侧身份是**角色**而不是"我"：请求侧=发起方（payload 无作者字段，如实标「用户」），回复侧=本 Agent；
 * - 每块 = 名称 + 来源/拼装说明 + 字/token/占本次请求%/占上下文窗口% + 可折叠内容；
 * - token：单块用 Pi Web 同款估算式（CJK≈1/字，其余≈4 字符/token），总量锚定 provider 真实 usage。
 */

type SessionEntry = Record<string, unknown> & { type?: string; id?: string; timestamp?: string };
type EntriesResponse = { sessionId: string; total: number; hasMore: boolean; entries: SessionEntry[] };
type ModelsConfig = { providers: Array<{ id: string; models: Array<{ id: string; contextWindow?: number }> }> };

const PAGE = 200;
type RawMessage = {
  role?: string; content?: unknown; sections?: Record<string, string>; model?: string; provider?: string;
  /** Pi 在 system 消息上记的"本轮新增工具"（有才出现）。 */
  toolsAdded?: unknown;
  /** 工具结果消息（role="toolResult"）上的字段。 */
  toolCallId?: string; toolName?: string; isError?: boolean;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  durationMs?: number; stopReason?: string;
};
const messageOf = (entry: SessionEntry) => entry.message as RawMessage | undefined;
const roleOf = (entry: SessionEntry) => (entry.type === "message" ? messageOf(entry)?.role : undefined);

function clockOf(timestamp: unknown): string {
  if (typeof timestamp !== "string") return "";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour12: false });
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((raw) => {
    const part = raw as Record<string, unknown>;
    if (part.type === "text") return String(part.text ?? "");
    if (part.type === "thinking") return String(part.thinking ?? "");
    if (part.type === "toolCall") return `${String(part.name ?? "")} ${JSON.stringify(part.arguments ?? {})}`;
    return JSON.stringify(part);
  }).join("\n");
}

type ToolOutcome = { text: string; isError: boolean; durationMs?: number };

function blocksOf(message: RawMessage | undefined, results: Map<string, ToolOutcome>): Block[] {
  const content = message?.content;
  if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  const blocks: Block[] = [];
  for (const raw of content) {
    const part = raw as Record<string, unknown>;
    if (part.type === "text") blocks.push({ type: "text", text: String(part.text ?? "") });
    else if (part.type === "thinking") blocks.push({ type: "thinking", text: String(part.thinking ?? "") });
    else if (part.type === "toolCall") {
      const result = results.get(String(part.id ?? ""));
      blocks.push({
        type: "toolCall", id: part.id as string | undefined, name: String(part.name ?? "?"), arguments: part.arguments,
        ...(result === undefined ? {} : { result: result.text, isError: result.isError }),
        ...(result?.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
      });
    } else blocks.push({ type: "text", text: `\`\`\`json\n${JSON.stringify(part, null, 2)}\n\`\`\`` });
  }
  return blocks;
}

type SectionBlock = {
  key: string; label: string; owner: string; assembledBy: string; code: string;
  editable?: string; text: string; chars: number; tokens: number;
  /** 这一轮落盘的补丁改动了它（Pi 只落变化的区，没动的区不重复落）。 */
  changed: boolean;
};

type ResponseBlock = {
  key: string; kind: "thinking" | "tool" | "text"; label: string; tag?: string;
  body: string; isError?: boolean; tokens: number;
  /** 工具块才有：结果正文（与 arguments 分开展示）。 */
  result?: string;
};

type Turn = {
  index: number; key: string; at?: string;
  sections: SectionBlock[];
  sentMessages: Array<{ role: string; preview: string; tokens: number }>;
  responseBlocks: ResponseBlock[];
  model?: string;
  usageIn: number; usageOut: number; exactIn: boolean; exactOut: boolean; durationMs?: number;
  requestTokens: number; responseTokens: number;
  /** 这一轮的请求是"沿用上一轮分区"（Pi 没落新 system 消息 = 分区没变）。 */
  sectionsCarriedOver: boolean;
  /** Pi 在 system 消息里记的新增工具数（有才显示）。 */
  toolsAdded?: number;
};

function buildTurns(entries: SessionEntry[]): Turn[] {
  // 工具结果在会话文件里是 `message.role="toolResult"`（顶层 type 仍是 "message"），按 toolCallId 配对
  const results = new Map<string, ToolOutcome>();
  for (const entry of entries) {
    const outcome = entry.type === "message" ? messageOf(entry) : undefined;
    if (outcome?.role !== "toolResult") continue;
    const id = outcome.toolCallId;
    if (typeof id !== "string") continue;
    results.set(id, {
      text: textOfContent(outcome.content),
      isError: outcome.isError === true,
      ...(typeof outcome.durationMs === "number" ? { durationMs: outcome.durationMs } : {}),
    });
  }

  const turns: Turn[] = [];
  // 系统分区按**补丁序列**累加（Pi 只落变化的区；见 prompt-patches.ts）
  let systemSections: Sections = {};
  // 这一轮的 system 补丁"待"下一个 user 回合消费（system 条目总在自己的 user 条目之前）
  let pendingSystem: { changed: string[]; toolsAdded?: number } | undefined;
  const history: Array<{ role: string; preview: string; tokens: number }> = [];
  type Draft = {
    user: SessionEntry; body: SessionEntry[]; sections: Sections; sent: Turn["sentMessages"];
    changed: string[]; carriedOver: boolean; toolsAdded?: number;
  };
  let current: Draft | undefined;

  const flush = (draft: Draft) => {
    const assistantMessages = draft.body.map(messageOf).filter((message): message is RawMessage => message?.role === "assistant");
    const first = assistantMessages[0];
    // 一个回合可能有多条助手消息（工具循环）：上下文看**最后一次请求**，输出与耗时按这个回合求和
    const withUsage = assistantMessages.filter((message) => message.usage !== undefined);
    const lastWithUsage = withUsage[withUsage.length - 1];
    const usageIn = lastWithUsage === undefined ? 0
      : (lastWithUsage.usage?.input ?? 0) + (lastWithUsage.usage?.cacheRead ?? 0) + (lastWithUsage.usage?.cacheWrite ?? 0);
    const usageOut = assistantMessages.reduce((sum, message) => sum + (typeof message.usage?.output === "number" ? message.usage.output : 0), 0);
    const durationMs = assistantMessages.reduce((sum, message) => sum + (typeof message.durationMs === "number" ? message.durationMs : 0), 0);

    // 顺序 = Pi 拼系统提示的顺序（键首次出现的顺序），不额外排序
    const sections: SectionBlock[] = Object.entries(draft.sections).map(([key, text]) => {
        const spec = regionOf(key);
        return {
          key, label: spec.label, owner: spec.owner, assembledBy: spec.assembledBy, code: spec.code,
          ...(spec.editable !== undefined ? { editable: spec.editable } : {}),
      text, chars: text.length, tokens: estimateTokens(text),
      changed: draft.changed.includes(key),
    };
  });
    const estimates = sections.map((section) => section.tokens);
    const exactIn = usageIn > 0 && isSameScale(usageIn, estimates);
    const scaledSections = normalizeTo(usageIn, estimates);
    sections.forEach((section, index) => { section.tokens = scaledSections[index] ?? section.tokens; });

    const responseBlocks: ResponseBlock[] = [];
    for (const entry of draft.body) {
      const message = messageOf(entry);
      if (message === undefined || message.role !== "assistant") continue;
      blocksOf(message, results).forEach((block, index) => {
        const key = `${String(entry.id ?? "a")}-${index}`;
        if (block.type === "thinking") responseBlocks.push({ key, kind: "thinking", label: `思考 #${index + 1}`, body: block.text, tokens: 0 });
        else if (block.type === "text") responseBlocks.push({ key, kind: "text", label: `文本 #${index + 1}`, body: block.text, tokens: 0 });
        else responseBlocks.push({
          key, kind: "tool", label: `工具 · ${block.name}`,
          ...(block.result === undefined
            ? { tag: "执行中…" }
            : { tag: `${formatTokens(block.result.length)} 字符${block.durationMs !== undefined ? ` · ${(block.durationMs / 1000).toFixed(1)}s` : ""}` }),
          body: JSON.stringify(block.arguments ?? {}, null, 2),
          ...(block.result !== undefined ? { result: block.result } : {}),
          ...(block.isError === true ? { isError: true } : {}),
          tokens: 0,
        });
      });
    }
    const blockEstimates = responseBlocks.map((block) => estimateTokens(block.body));
    const exactOut = usageOut > 0 && isSameScale(usageOut, blockEstimates);
    const scaledBlocks = normalizeTo(usageOut, blockEstimates);
    responseBlocks.forEach((block, index) => { block.tokens = scaledBlocks[index] ?? 0; });

    turns.push({
      index: turns.length + 1,
      key: String(draft.user.id ?? turns.length),
      ...(draft.user.timestamp !== undefined ? { at: String(draft.user.timestamp) } : {}),
      sections,
      sentMessages: draft.sent,
      responseBlocks,
      ...(first?.model !== undefined ? { model: String(first.model) } : {}),
      usageIn, usageOut, exactIn, exactOut,
      sectionsCarriedOver: draft.carriedOver,
      ...(draft.toolsAdded !== undefined ? { toolsAdded: draft.toolsAdded } : {}),
      ...(durationMs > 0 ? { durationMs } : {}),
      requestTokens: usageIn > 0 ? usageIn : sections.reduce((sum, section) => sum + section.tokens, 0),
      responseTokens: usageOut > 0 ? usageOut : responseBlocks.reduce((sum, block) => sum + block.tokens, 0),
    });
  };

  for (const entry of entries) {
    const systemMessage = entry.type === "message" && messageOf(entry)?.sections !== undefined ? messageOf(entry) : undefined;
    if (systemMessage !== undefined) {
      const applied = applySectionPatch(systemSections, systemMessage.sections ?? {});
      systemSections = applied.sections;
      const toolsAdded = systemMessage.toolsAdded;
      pendingSystem = {
        changed: applied.changed,
        ...(Array.isArray(toolsAdded) && toolsAdded.length > 0 ? { toolsAdded: toolsAdded.length } : {}),
      };
    }
    const role = roleOf(entry);
    if (role === "user") {
      if (current !== undefined) flush(current);
      const text = textOfContent(messageOf(entry)?.content);
      const info = pendingSystem;      // 这一轮开始前落下的 system 补丁
      pendingSystem = undefined;
      current = {
        user: entry,
        body: [],
        sections: { ...systemSections },
        changed: info?.changed ?? [],
        carriedOver: info === undefined,     // 这一轮没有新 system 消息 = 沿用上一轮分区
        ...(info?.toolsAdded !== undefined ? { toolsAdded: info.toolsAdded } : {}),
        sent: [...history, { role: "user", preview: text.slice(0, 60).replace(/\n/g, " "), tokens: estimateTokens(text) }],
      };
      history.push({ role: "user", preview: text.slice(0, 60).replace(/\n/g, " "), tokens: estimateTokens(text) });
      continue;
    }
    if (current !== undefined) current.body.push(entry);
    if (role === "assistant") {
      const text = textOfContent(messageOf(entry)?.content);
      history.push({ role: "assistant", preview: text.slice(0, 60).replace(/\n/g, " "), tokens: estimateTokens(text) });
    }
  }
  if (current !== undefined) flush(current);
  return turns;
}

/** 折叠状态逐层记忆；默认：最近一个回合展开、回合内的「回复」展开、其余折叠。 */
function useFolds() {
  const [state, setState] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("lifeos.history.fold") ?? "{}") as Record<string, boolean>; } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem("lifeos.history.fold", JSON.stringify(state)); } catch { /* 忽略 */ } }, [state]);
  const isOpen = (key: string, fallback: boolean) => state[key] ?? fallback;
  const toggle = (key: string, fallback: boolean) => setState((prev) => ({ ...prev, [key]: !(prev[key] ?? fallback) }));
  return { isOpen, toggle };
}

function BlockHeader({ open, label, tag, sub, meta, depth = 0, strong = false, onToggle }: {
  open: boolean; label: string; tag?: string; sub?: string; meta: string;
  depth?: number; strong?: boolean; onToggle: () => void;
}) {
  return (
    <button type="button" onClick={onToggle}
      className={`flex w-full items-center gap-1.5 rounded-control pr-1 text-left transition-colors hover:bg-hover ${sub === undefined ? "h-7" : "py-1"}`}
      style={{ paddingLeft: 4 + depth * 10 }}>
      <IconChevronRight size={12} className={`shrink-0 self-start text-ink-500 transition-transform ${open ? "rotate-90" : ""} ${sub === undefined ? "" : "mt-1"}`} />
      <span className="min-w-0 flex-1">
        <span className={`flex items-baseline gap-1.5 ${sub === undefined ? "text-micro" : "text-meta"}`}>
          <span className={`min-w-0 truncate ${strong ? "font-semibold text-ink-900" : "font-medium text-ink-700"}`}>{label}</span>
          {tag !== undefined && tag !== "" && <span className="min-w-0 truncate font-mono text-micro text-ink-500">{tag}</span>}
        </span>
        {sub !== undefined && <span className="block truncate text-micro text-ink-500">{sub}</span>}
      </span>
      <span className="ml-auto min-w-16 shrink-0 self-start text-right tabular-nums text-micro text-ink-500">{meta}</span>
    </button>
  );
}

export function TurnInspector({ agentId, sessionId, title, agentName, avatar, onClose }: {
  agentId: string; sessionId: string; title: string; agentName: string; avatar?: AgentAvatarSpec; onClose: () => void;
}) {
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  // 上下文窗口按**该回合实际用的模型**取（provider 里第一个模型的窗口 ≠ 本会话模型；切过模型就更是错的）
  const [contextWindows, setContextWindows] = useState<Map<string, number>>(() => new Map());
  const folds = useFolds();
  const root = useRef<HTMLDivElement>(null);

  async function load(offset: number) {
    setLoading(true);
    setFailed(null);
    try {
      const response = await fetch(`/api/agents/${agentId}/sessions/${sessionId}/entries?offset=${offset}&limit=${PAGE}`);
      const body = await response.json() as EntriesResponse & { error?: { message?: string } };
      if (!response.ok) { setFailed(body.error?.message ?? "读取失败"); return; }
      setTotal(body.total);
      setHasMore(body.hasMore);
      setEntries((prev) => (offset === 0 ? body.entries : [...prev, ...body.entries]));
    } catch { setFailed("网络错误"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(0); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agentId, sessionId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    void (async () => {
      try {
        const models = await (await fetch("/api/models-config")).json() as ModelsConfig;
        const map = new Map<string, number>();
        for (const provider of models.providers) {
          for (const model of provider.models) {
            if (typeof model.contextWindow !== "number") continue;
            map.set(`${provider.id}/${model.id}`, model.contextWindow);
            if (!map.has(model.id)) map.set(model.id, model.contextWindow);
          }
        }
        setContextWindows(map);
      } catch { /* 拿不到就不显示占窗口比 */ }
    })();
  }, []);

  /** 回合用的模型 → 窗口；查不到就不显示比例（不拿别的模型的数字冒充）。 */
  const windowOf = (turn: Turn): number | undefined => {
    if (turn.model === undefined) return undefined;
    const id = turn.model;
    return contextWindows.get(id) ?? (id.includes("/") ? contextWindows.get(id.slice(id.indexOf("/") + 1)) : undefined);
  };

  const turns = useMemo(() => buildTurns(entries), [entries]);
  const lastIndex = turns.length - 1;

  return (
    <div ref={root} className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex h-11 shrink-0 items-center gap-2 pl-4 pr-2">
        <div className="min-w-0">
          <h2 className="truncate text-body font-semibold text-ink-900">完整历史</h2>
          <p className="truncate text-micro text-ink-500" data-shot-mask="history-meta">
            {agentName} · {title === "" ? "未命名会话" : title} · {turns.length} 回合 · {total} 条
          </p>
        </div>
        <span className="ml-auto" />
        <IconButton label="关闭完整历史" onClick={onClose}><IconX size={15} /></IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-shot-mask="history-body">
        {loading && entries.length === 0 && <Skeleton rows={5} />}
        {failed !== null && <p className="py-6 text-center text-meta text-danger">{failed}</p>}
        {!loading && failed === null && turns.length === 0 && (
          <EmptyState icon={<IconHistory size={20} />} title="还没有回合" hint="发一条消息后，这里会出现「请求 → 回复」的完整记录。" />
        )}

        {turns.map((turn, turnIndex) => {
          const turnKey = `t${turn.key}`;
          const turnOpen = folds.isOpen(turnKey, turnIndex === lastIndex);
          const window = windowOf(turn);
          const requestMeta = `${formatTokens(turn.requestTokens)} tok${window !== undefined ? ` · 窗口 ${formatPercent(turn.requestTokens, window)}` : ""}${turn.exactIn ? "" : " · ≈"}`;
          const responseMeta = `${formatTokens(turn.responseTokens)} tok${turn.durationMs !== undefined ? ` · ${(turn.durationMs / 1000).toFixed(1)}s` : ""}${turn.exactOut ? "" : " · ≈"}`;
          const requestKey = `q${turn.key}`;
          const requestOpen = folds.isOpen(requestKey, false);
          const replyKey = `a${turn.key}`;
          const replyOpen = folds.isOpen(replyKey, turnIndex === lastIndex);
          return (
            <section key={turn.key} className="mb-2 border-b border-line pb-1 last:border-b-0">
              <BlockHeader open={turnOpen} label={`回合 #${turn.index}`} strong
                sub={[clockOf(turn.at), turn.model ?? ""].filter((part) => part !== "").join(" · ")}
                meta={`in ${formatTokens(turn.usageIn)} / out ${formatTokens(turn.usageOut)}`}
                onToggle={() => folds.toggle(turnKey, turnIndex === lastIndex)} />

              {turnOpen && (
                <div className="mt-0.5 ml-2 space-y-0.5 border-l border-line pl-2">
                  {/* 请求 */}
                  <div>
                    <BlockHeader open={requestOpen} label="请求" tag="发起方 → 模型" strong
                      meta={requestMeta} depth={1} onToggle={() => folds.toggle(requestKey, false)} />
                    {requestOpen && (
                      <div className="space-y-0.5 border-t border-line py-1 pr-1">
                        {turn.sections.length === 0 && <p className="pl-6 text-micro text-ink-500">会话文件里没有 system 分区。</p>}
                        {turn.sections.length > 0 && turn.sectionsCarriedOver && (
                          <p className="pl-6 text-micro text-ink-500">分区沿用上一轮：Pi 只在分区变化时落新的 system 消息（本轮没落）。</p>
                        )}
                        {turn.toolsAdded !== undefined && (
                          <p className="pl-6 text-micro text-ink-500">本轮新增工具 {turn.toolsAdded} 个（Pi 记在 system 消息的 toolsAdded 里）。</p>
                        )}
                        {turn.sections.map((section) => {
                          const key = `s${turn.key}-${section.key}`;
                          const open = folds.isOpen(key, false);
                          return (
                            <div key={section.key}>
                              <BlockHeader open={open} label={section.label}
                                tag={`${section.owner === "lifeos" ? "我方" : section.owner === "pi" ? "Pi 内置" : "运行时"} · <${section.key}>${section.changed ? " · 本次变更" : ""}`} depth={2}
                                meta={`${formatTokens(section.tokens)} tok · ${formatPercent(section.tokens, turn.requestTokens)}`}
                                onToggle={() => folds.toggle(key, false)} />
                              {open && (
                                <div className="pb-1.5 pl-9 pr-2">
                                  <p className="text-micro text-ink-500">
                                    {section.owner === "lifeos" ? "我方" : section.owner === "pi" ? "Pi 内置" : "运行时"} · {section.assembledBy}
                                  </p>
                                  <p className="font-mono text-micro text-ink-300">{section.code}</p>
                                  {section.editable !== undefined && <p className="text-micro text-ink-500">改这里：<span className="font-mono">{section.editable}</span></p>}
                                  <details className="mt-1">
                                    <summary className="cursor-pointer select-none text-micro text-ink-500">全文 · {section.chars} 字符</summary>
                                    <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-micro text-ink-700">{section.text}</pre>
                                  </details>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {(() => {
                          const key = `m${turn.key}`;
                          const open = folds.isOpen(key, false);
                          const sentTokens = turn.sentMessages.reduce((sum, item) => sum + item.tokens, 0);
                          return (
                            <>
                              <BlockHeader open={open} label="消息序列" tag={`${turn.sentMessages.length} 条`} depth={2}
                                meta={`${formatTokens(sentTokens)} · 估算`} onToggle={() => folds.toggle(key, false)} />
                              {open && (
                                <ul className="space-y-0.5 pb-1 pl-9 pr-2">
                                  {turn.sentMessages.map((item, index) => (
                                    <li key={index} className="flex items-baseline gap-1.5 text-micro">
                                      <span className={`shrink-0 font-mono ${item.role === "user" ? "text-ink-900" : "text-ink-500"}`}>{item.role}</span>
                                      <span className="min-w-0 flex-1 truncate text-ink-700">{item.preview}</span>
                                    </li>
                                  ))}
                                  <li className="text-micro text-ink-500">工具 schema 由运行时注入、不落会话文件；工具清单见上方「工具清单区」。</li>
                                </ul>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* 回复 */}
                  <div className="pt-0.5">
                    <BlockHeader open={replyOpen} label="回复" tag={`模型 → ${agentName}`} strong
                      meta={responseMeta} depth={1} onToggle={() => folds.toggle(replyKey, turnIndex === lastIndex)} />
                    {replyOpen && (
                      <div className="space-y-0.5 border-t border-line py-1 pr-1">
                        {turn.responseBlocks.length === 0 && <p className="pl-6 text-micro text-ink-500">本回合没有回复内容。</p>}
                        {turn.responseBlocks.map((block) => {
                          const key = `b${block.key}`;
                          const open = folds.isOpen(key, false);
                          return (
                            <div key={block.key}>
                              <BlockHeader open={open} label={block.label} {...(block.tag !== undefined ? { tag: block.tag } : {})} depth={2}
                                meta={`${formatTokens(block.tokens)} tok · ${formatPercent(block.tokens, Math.max(1, turn.responseTokens))}`}
                                onToggle={() => folds.toggle(key, false)} />
                              {open && (
                                <div className="pb-1.5 pl-9 pr-2">
                                  {block.kind === "text"
                                    ? <MessageView role="assistant" blocks={[{ type: "text", text: block.body }]} busy={false} />
                                    : <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-micro text-ink-700">{block.body}</pre>}
                                  {block.result !== undefined && (
                                    <details className="mt-1" open={false}>
                                      <summary className="cursor-pointer select-none text-micro text-ink-500">工具结果 · {block.result.length} 字符</summary>
                                      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-micro text-ink-700">{block.result}</pre>
                                    </details>
                                  )}
                                  {block.isError === true && <p className="mt-1 text-micro text-danger">该工具调用出错（结果里的退出码/报错是事实）</p>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          );
        })}

        {hasMore && (
          <div className="flex justify-center py-2">
            <Button size="sm" onClick={() => void load(entries.length)} disabled={loading}>加载更多</Button>
          </div>
        )}
      </div>
    </div>
  );
}
