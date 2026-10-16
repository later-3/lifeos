import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; text: string };
type AgentEvent = { seq: number; sessionId: string; type: "delta" | "done" | "error"; text?: string; message?: string };

export default function App() {
  const [agentId, setAgentId] = useState<string>();
  const [sessionId, setSessionId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamSeq, setStreamSeq] = useState(0);
  const current = useRef<string | undefined>(undefined);
  const snapshotSeq = useRef(0);
  const streaming = useRef(false);          // 当前会话是否正在流式追加（用于多窗口：被动窗口也能正确新建一条）
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { current.current = sessionId; }, [sessionId]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // 一条流承载该 Agent 的所有会话：快照 + 带序号的事件。
  useEffect(() => {
    if (agentId === undefined) return;
    const stream = new EventSource(`/api/agents/${agentId}/events?since=${streamSeq}`);
    stream.addEventListener("snapshot", (event) => {
      const snapshot = JSON.parse((event as MessageEvent).data) as { seq: number; running: { sessionId: string }[] };
      snapshotSeq.current = snapshot.seq;
      setStreamSeq(snapshot.seq);
      setBusy(snapshot.running.some((run) => run.sessionId === current.current));
    });
    stream.addEventListener("delta", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as AgentEvent;
      setStreamSeq(payload.seq);
      if (payload.seq <= snapshotSeq.current) return;   // 快照之前的旧事件只用于补状态，不重复渲染
      if (payload.sessionId !== current.current) return;
      setBusy(true);
      setMessages((list) => {
        if (!streaming.current) {
          streaming.current = true;
          return [...list, { role: "assistant", text: payload.text ?? "" }];
        }
        const next = [...list];
        const last = next[next.length - 1];
        if (last?.role === "assistant") next[next.length - 1] = { role: "assistant", text: last.text + (payload.text ?? "") };
        else next.push({ role: "assistant", text: payload.text ?? "" });
        return next;
      });
    });
    const finish = (event: MessageEvent) => {
      setStreamSeq((JSON.parse(event.data) as AgentEvent).seq);
      streaming.current = false;
      setBusy(false);
      if (agentId !== undefined && current.current !== undefined) void loadMessages(agentId, current.current);
    };
    stream.addEventListener("done", finish);
    stream.addEventListener("error", finish);
    return () => stream.close();
  }, [agentId, streamSeq === 0]);

  async function loadMessages(id: string, sid: string) {
    const data = await (await fetch(`/api/agents/${id}/sessions/${sid}`)).json() as { messages: Message[] };
    setMessages(data.messages);
  }

  useEffect(() => {
    void (async () => {
      const agents = await (await fetch("/api/agents")).json() as { items: { id: string }[] };
      const id = agents.items[0]?.id;
      if (id === undefined) return;
      setAgentId(id);
      const list = await (await fetch(`/api/agents/${id}/sessions`)).json() as { items: { sessionId: string }[] };
      const sid = list.items[0]?.sessionId ?? (await (await fetch(`/api/agents/${id}/sessions`, { method: "POST" })).json() as { sessionId: string }).sessionId;
      setSessionId(sid);
      await loadMessages(id, sid);
    })();
  }, []);

  async function send() {
    const text = input.trim();
    if (text === "" || agentId === undefined || sessionId === undefined || busy) return;
    setInput("");
    setBusy(true);
    streaming.current = true;
    setMessages((list) => [...list, { role: "user", text }, { role: "assistant", text: "" }]);
    const response = await fetch(`/api/agents/${agentId}/sessions/${sessionId}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const error = await response.json() as { error?: { message?: string } };
      setMessages((list) => [...list, { role: "assistant", text: `[出错] ${error.error?.message ?? "请求失败"}` }]);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col bg-white text-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h1 className="text-base font-medium">Life OS</h1>
        <span className="font-mono text-xs text-neutral-500">{agentId ?? "连接中…"}</span>
      </header>
      <main className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
        {messages.length === 0 && <p className="text-sm text-neutral-400">发一条消息开始对话。</p>}
        {messages.map((message, index) => (
          <div key={index} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed ${message.role === "user" ? "bg-neutral-900 text-white" : "bg-neutral-100"}`}>
              {message.text === "" && busy ? "…" : message.text}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </main>
      <footer className="border-t border-neutral-200 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input} rows={1} placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
            className="max-h-32 flex-1 resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
          />
          <button onClick={() => void send()} disabled={busy || input.trim() === ""} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40">
            {busy ? "生成中" : "发送"}
          </button>
        </div>
      </footer>
    </div>
  );
}
