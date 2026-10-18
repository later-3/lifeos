import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { IconCopy, IconFile, IconFileText, IconX } from "@tabler/icons-react";
import { isMarkdown } from "./fs-utils";

export type FileTab = { id: string; fileName: string; filePath: string; mode?: "render" | "source"; wrap?: boolean };
type FileData = { content: string; size: number; truncated: boolean; isBinary: boolean };

/** 源码视图行数上限（性能红线：超大文件不整页渲染）。 */
const LINE_CAP = 10000;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 右侧文件面板（Pi Web file-panel 同型）：页签行（36px，图标+名+×、中键关、同文件聚焦）
 * + FileViewer（路径/大小/渲染·源码·换行切换/复制；md 渲染、源码行号）。
 * 性能：内容按路径缓存（切页签不重拉）；滚动位置只存本组件 ref（不触发全局重渲染）。
 */
export function FilePanel({ tabs, activeId, onSelectTab, onCloseTab, onPrefsChange }: {
  tabs: FileTab[];
  activeId?: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onPrefsChange: (id: string, prefs: { mode?: "render" | "source"; wrap?: boolean }) => void;
}) {
  const active = tabs.find((tab) => tab.id === activeId);
  const contents = useRef(new Map<string, FileData>());          // 按路径缓存：切页签不重拉
  const prefs = useRef(new Map<string, { mode?: "render" | "source"; wrap?: boolean; scrollTop: number }>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [renderTick, setRenderTick] = useState(0);               // 切页签后触发一次滚动恢复

  // 取当前页签内容（缓存命中不发请求）。
  useEffect(() => {
    if (active === undefined) { setData(null); setFailed(null); return; }
    const cached = contents.current.get(active.filePath);
    if (cached !== undefined) { setData(cached); setFailed(null); setRenderTick((n) => n + 1); return; }
    let alive = true;
    setLoading(true);
    setFailed(null);
    setData(null);
    fetch(`/api/fs/content?path=${encodeURIComponent(active.filePath)}`)
      .then(async (response) => {
        const body = await response.json() as FileData & { error?: { message: string } };
        if (!alive) return;
        if (!response.ok) { setFailed(body.error?.message ?? "读取失败"); return; }
        contents.current.set(active.filePath, body);
        setData(body);
        setRenderTick((n) => n + 1);
      })
      .catch(() => { if (alive) setFailed("网络错误"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [active?.id, active?.filePath]);                            // 只跟当前页签走

  // 切页签后恢复该页签的滚动位置（只动 ref，不进全局状态）。
  useEffect(() => {
    if (active === undefined || data === null) return;
    const saved = prefs.current.get(active.id);
    if (scrollRef.current !== null) scrollRef.current.scrollTop = saved?.scrollTop ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderTick, data]);

  const mode: "render" | "source" = (() => {
    const saved = active !== undefined ? prefs.current.get(active.id) : undefined;
    const value = saved?.mode ?? active?.mode;
    if (value !== undefined) return value;
    return active !== undefined && isMarkdown(active.fileName) ? "render" : "source";
  })();
  const wrap = (active !== undefined ? (prefs.current.get(active.id)?.wrap ?? active?.wrap) : undefined) ?? false;

  function setMode(next: "render" | "source") {
    if (active === undefined) return;
    const prev = prefs.current.get(active.id);
    prefs.current.set(active.id, { ...prev, mode: next, wrap, scrollTop: scrollRef.current?.scrollTop ?? 0 });
    onPrefsChange(active.id, { mode: next, wrap });
    setRenderTick((n) => n + 1);
  }

  function setWrap(next: boolean) {
    if (active === undefined) return;
    const prev = prefs.current.get(active.id);
    prefs.current.set(active.id, { ...prev, mode, wrap: next, scrollTop: scrollRef.current?.scrollTop ?? 0 });
    onPrefsChange(active.id, { mode, wrap: next });
    setRenderTick((n) => n + 1);
  }

  const lines = useMemo(() => {
    if (data === null || mode !== "source") return null;
    const all = data.content.split("\n");
    return { list: all.slice(0, LINE_CAP), total: all.length };
  }, [data, mode]);

  const html = useMemo(() => {
    if (data === null || mode !== "render") return null;
    return DOMPurify.sanitize(marked.parse(data.content, { async: false }) as string);
  }, [data, mode]);

  const mono = "font-mono text-[11px] text-neutral-500 truncate";
  const segBtn = "px-2 py-0.5 text-[11px] transition-colors";
  const segActive = "bg-white text-neutral-900 shadow-sm";
  const segIdle = "text-neutral-500 hover:text-neutral-800";

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* 页签行（36px）：图标 + 名 + ×（hover 出现），中键关闭 */}
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-neutral-200 bg-neutral-50">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <div key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onCloseTab(tab.id); } }}
              title={tab.filePath}
              className={`group flex h-9 max-w-44 shrink-0 cursor-pointer items-center gap-1.5 border-r border-neutral-200 px-3 text-[12px] transition-colors ${isActive ? "bg-white font-medium text-neutral-900" : "text-neutral-500 hover:bg-neutral-100"}`}>
              {isMarkdown(tab.fileName) ? <IconFileText size={13} className="shrink-0" /> : <IconFile size={13} className="shrink-0" />}
              <span className="truncate">{tab.fileName}</span>
              <button aria-label={`关闭 ${tab.fileName}`} title="关闭"
                onClick={(event) => { event.stopPropagation(); onCloseTab(tab.id); }}
                className="rounded p-0.5 text-neutral-300 opacity-0 transition-opacity hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100">
                <IconX size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {/* 查看器 */}
      {active === undefined ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-neutral-400">
          从左侧文件树选择文件，将在这里打开（可多页签）。
        </div>
      ) : (
        <>
          {/* 工具栏：路径 · 大小 · 模式切换 · 复制 */}
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-neutral-200 px-3">
            <span className={`${mono} min-w-0 flex-1`} title={active.filePath}>{active.filePath}</span>
            {data !== null && <span className="shrink-0 text-[10px] text-neutral-400">{formatSize(data.size)}</span>}
            {data?.truncated === true && <span className="shrink-0 rounded bg-amber-50 px-1.5 py-px text-[10px] text-amber-600">仅前 2MB</span>}
            {data?.isBinary === true && <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-px text-[10px] text-neutral-500">二进制</span>}
            {data !== null && !data.isBinary && isMarkdown(active.fileName) && (
              <span className="flex shrink-0 items-center rounded-md bg-neutral-100 p-0.5">
                <button onClick={() => setMode("render")} className={`${segBtn} ${mode === "render" ? segActive : segIdle}`}>渲染</button>
                <button onClick={() => setMode("source")} className={`${segBtn} ${mode === "source" ? segActive : segIdle}`}>源码</button>
              </span>
            )}
            {data !== null && !data.isBinary && mode === "source" && (
              <button onClick={() => setWrap(!wrap)}
                className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition-colors ${wrap ? "border-neutral-400 bg-neutral-100 text-neutral-800" : "border-neutral-200 text-neutral-500 hover:border-neutral-300"}`}>
                换行
              </button>
            )}
            <button aria-label="复制内容" title="复制内容" disabled={data === null || data.isBinary}
              onClick={() => {
                if (data === null) return;
                void navigator.clipboard.writeText(data.content).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className={`shrink-0 rounded-md p-1 transition-colors ${copied ? "bg-emerald-500/15 text-emerald-500" : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"} disabled:opacity-30`}>
              <IconCopy size={14} />
            </button>
          </div>

          {/* 内容 */}
          <div ref={scrollRef}
            onScroll={(event) => {
              if (active === undefined) return;
              const prev = prefs.current.get(active.id);
              prefs.current.set(active.id, { ...prev, mode, wrap, scrollTop: event.currentTarget.scrollTop });
            }}
            className="min-h-0 flex-1 overflow-auto">
            {loading && <p className="px-4 py-6 text-center text-sm text-neutral-400">加载中…</p>}
            {failed !== null && <p className="px-4 py-6 text-center text-sm text-red-500">{failed}</p>}
            {!loading && failed === null && data?.isBinary === true && (
              <p className="px-4 py-6 text-center text-sm text-neutral-400">二进制文件，暂不支持预览。</p>
            )}
            {!loading && failed === null && data !== null && !data.isBinary && mode === "render" && html !== null && (
              <div className="md-body px-5 py-4" dangerouslySetInnerHTML={{ __html: html }} />
            )}
            {!loading && failed === null && data !== null && !data.isBinary && mode === "source" && lines !== null && (
              <div className={`min-w-full py-2 text-[12px] leading-[1.55] ${wrap ? "whitespace-pre-wrap" : ""}`}>
                {lines.list.map((line, index) => (
                  <div key={index} className={`flex ${wrap ? "flex-wrap" : ""}`}>
                    <span className="sticky left-0 w-12 shrink-0 select-none border-r border-neutral-100 bg-white px-2 text-right text-[11px] tabular-nums text-neutral-300">{index + 1}</span>
                    <code className={`min-w-0 flex-1 px-3 font-mono text-neutral-700 ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}>{line === "" ? " " : line}</code>
                  </div>
                ))}
                {lines.total > LINE_CAP && (
                  <p className="border-t border-neutral-100 px-3 py-2 text-[11px] text-neutral-400">
                    文件共 {lines.total.toLocaleString()} 行，仅显示前 {LINE_CAP.toLocaleString()} 行。
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
