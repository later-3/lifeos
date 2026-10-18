import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { IconCopy, IconFile, IconFileText, IconTextWrap, IconX } from "@tabler/icons-react";
import { isMarkdown } from "./fs-utils";
import { EmptyState, IconButton, Segmented } from "./design/ui";

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

  const mono = "font-mono text-micro text-ink-500 truncate";

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* 页签行（32px）：图标 + 名 + ×（hover 出现），中键关闭；激活页签用 2px accent 下划线 */}
      <div className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-line bg-sunken">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <div key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onCloseTab(tab.id); } }}
              title={tab.filePath}
              className={`group relative flex h-8 max-w-44 shrink-0 cursor-pointer items-center gap-1.5 px-3 text-meta transition-colors ${isActive ? "bg-surface font-medium text-ink-900" : "text-ink-500 hover:bg-hover"}`}>
              {isActive && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
              {isMarkdown(tab.fileName) ? <IconFileText size={14} className="shrink-0" /> : <IconFile size={14} className="shrink-0" />}
              <span className="truncate">{tab.fileName}</span>
              <button aria-label={`关闭 ${tab.fileName}`} title="关闭" tabIndex={isActive ? 0 : -1}
                onClick={(event) => { event.stopPropagation(); onCloseTab(tab.id); }}
                className="rounded p-0.5 text-ink-300 opacity-0 transition-opacity hover:bg-hover hover:text-ink-700 group-hover:opacity-100 focus-visible:opacity-100">
                <IconX size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {/* 查看器 */}
      {active === undefined ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState icon={<IconFileText size={22} />} title="还没有打开文件"
            hint="从左侧文件树点一个文件，会在这里以页签打开（可多开）。" />
        </div>
      ) : (
        <>
          {/* 工具栏：路径 · 大小 · 模式切换 · 复制 */}
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
            <span className={`${mono} min-w-0 flex-1`} title={active.filePath}>{active.filePath}</span>
            {data !== null && <span className="shrink-0 text-micro text-ink-500">{formatSize(data.size)}</span>}
            {data?.truncated === true && <span className="shrink-0 rounded bg-danger-soft px-1.5 py-px text-micro text-danger">仅前 2MB</span>}
            {data?.isBinary === true && <span className="shrink-0 rounded bg-hover px-1.5 py-px text-micro text-ink-500">二进制</span>}
            {data !== null && !data.isBinary && isMarkdown(active.fileName) && (
              <Segmented value={mode} onChange={setMode}
                options={[{ value: "render", label: "渲染" }, { value: "source", label: "源码" }]} />
            )}
            {data !== null && !data.isBinary && mode === "source" && (
              <IconButton label={wrap ? "关闭自动换行" : "自动换行"} active={wrap} onClick={() => setWrap(!wrap)}>
                <IconTextWrap size={14} />
              </IconButton>
            )}
            <IconButton label="复制内容" tone={copied ? "accent" : "default"} active={copied} disabled={data === null || data.isBinary}
              onClick={() => {
                if (data === null) return;
                void navigator.clipboard.writeText(data.content).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}>
              <IconCopy size={14} />
            </IconButton>
          </div>

          {/* 内容 */}
          <div ref={scrollRef}
            onScroll={(event) => {
              if (active === undefined) return;
              const prev = prefs.current.get(active.id);
              prefs.current.set(active.id, { ...prev, mode, wrap, scrollTop: event.currentTarget.scrollTop });
            }}
            className="min-h-0 flex-1 overflow-auto">
            {loading && <p className="px-4 py-6 text-center text-body text-ink-500">加载中…</p>}
            {failed !== null && <p className="px-4 py-6 text-center text-body text-danger">{failed}</p>}
            {!loading && failed === null && data?.isBinary === true && (
              <p className="px-4 py-6 text-center text-body text-ink-500">二进制文件，暂不支持预览。</p>
            )}
            {!loading && failed === null && data !== null && !data.isBinary && mode === "render" && html !== null && (
              <div className="md-body md-body--compact px-5 py-4" dangerouslySetInnerHTML={{ __html: html }} />
            )}
            {!loading && failed === null && data !== null && !data.isBinary && mode === "source" && lines !== null && (
              <div className={`min-w-full py-2 text-meta text-body ${wrap ? "whitespace-pre-wrap" : ""}`}>
                {lines.list.map((line, index) => (
                  <div key={index} className={`flex ${wrap ? "flex-wrap" : ""}`}>
                    <span className="sticky left-0 w-12 shrink-0 select-none border-r border-hover bg-surface px-2 text-right text-micro tabular-nums text-ink-500">{index + 1}</span>
                    <code className={`min-w-0 flex-1 px-3 font-mono text-ink-700 ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}>{line === "" ? " " : line}</code>
                  </div>
                ))}
                {lines.total > LINE_CAP && (
                  <p className="border-t border-hover px-3 py-2 text-micro text-ink-500">
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
