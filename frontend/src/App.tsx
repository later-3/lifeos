import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; text: string };

export default function App() {
  const [agentId, setAgentId] = useState<string>();
  const [sessionId, setSessionId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const agents = await (await fetch("/api/agents")).json() as { items: { id: string }[] };
      const id = agents.items[0]?.id;
      if (id === undefined) return;
      setAgentId(id);
      const created = await (await fetch(`/api/agents/${id}/sessions`, { method: "POST" })).json() as { sessionId: string };
      setSessionId(created.sessionId);
    })();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const appendDelta = (delta: string) => setMessages((current) => {
    const next = [...current];
    const last = next[next.length - 1];
    if (last !== undefined && last.role === "assistant") next[next.length - 1] = { role: "assistant", text: last.text + delta };
    return next;
  });

  async function send() {
    const text = input.trim();
    if (text === "" || agentId === undefined || sessionId === undefined || busy) return;
    setInput("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", text }, { role: "assistant", text: "" }]);
    try {
      const response = await fetch(`/api/agents/${agentId}/sessions/${sessionId}/messages`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "请求失败");
      const stream = new EventSource(`/api/agents/${agentId}/sessions/${sessionId}/events`);
      const finish = () => { stream.close(); setBusy(false); };
      stream.addEventListener("delta", (event) => appendDelta((JSON.parse((event as MessageEvent).data) as { text: string }).text));
      stream.addEventListener("done", finish);
      stream.addEventListener("error", finish);
    } catch (error) {
      appendDelta(`\n[出错] ${error instanceof Error ? error.message : String(error)}`);
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
