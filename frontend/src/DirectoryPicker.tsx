import { useEffect, useRef, useState } from "react";
import { IconArrowUp, IconFolder, IconX } from "@tabler/icons-react";

type BrowseResult = { path: string; parent: string | null; dirs: string[] };

/**
 * 目录选择器（Pi Web DirectoryPicker 同型）：模态面板 —— 路径输入直接跳转 +
 * 逐级目录列表（点击进入）+ 上级 + “选择此目录”。只与 /api/fs/browse 交互（只读目录名）。
 */
export function DirectoryPicker({ onCancel, onSelect }: {
  onCancel: () => void;
  onSelect: (path: string) => Promise<string | null>;   // 返回错误信息，null=成功
}) {
  const [currentPath, setCurrentPath] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function navigate(path?: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/fs/browse?path=${encodeURIComponent(path ?? "")}`);
      const data = await response.json() as BrowseResult & { error?: { message: string } };
      if (!response.ok) { setError(data.error?.message ?? "无法打开该目录"); return; }
      setCurrentPath(data.path);
      setPathInput(data.path);
      setParent(data.parent);
      setDirs(data.dirs);
    } catch { setError("网络错误"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void navigate(); }, []);

  async function choose() {
    if (busy || currentPath === "") return;
    setBusy(true);
    const message = await onSelect(currentPath);
    setBusy(false);
    if (message !== null) setError(message);
  }

  const nameOf = (path: string) => path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1) || path;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-2"
      onClick={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) onCancel(); }}>
      <div className="flex h-[min(620px,calc(100dvh-16px))] w-[520px] max-w-full flex-col overflow-hidden rounded-[10px] border border-neutral-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <span className="text-sm font-semibold">选择目录</span>
          <button aria-label="关闭" title="关闭" onClick={onCancel}
            className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"><IconX size={16} /></button>
        </div>

        <form className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2"
          onSubmit={(event) => { event.preventDefault(); void navigate(pathInput.trim() || undefined); }}>
          <button type="button" aria-label="上级目录" title="上级目录" disabled={parent === null || loading}
            onClick={() => parent !== null && void navigate(parent)}
            className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30">
            <IconArrowUp size={15} />
          </button>
          <input value={pathInput} onChange={(event) => setPathInput(event.target.value)}
            placeholder="输入路径后回车跳转"
            className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 font-mono text-xs outline-none transition-colors focus:border-neutral-400 focus:bg-white" />
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading && <p className="px-3 py-6 text-center text-xs text-neutral-400">加载中…</p>}
          {!loading && dirs.length === 0 && <p className="px-3 py-6 text-center text-xs text-neutral-400">没有子目录</p>}
          {!loading && dirs.map((name) => {
            const child = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
            return (
              <button key={name} onClick={() => void navigate(child)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-neutral-700 transition-colors hover:bg-neutral-100">
                <IconFolder size={15} className="shrink-0 text-neutral-400" />
                <span className="truncate">{name}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-neutral-200 px-4 py-3">
          <span className="min-w-0 truncate font-mono text-[11px] text-neutral-400" title={currentPath}>{currentPath || "—"}</span>
          <div className="flex shrink-0 items-center gap-2">
            {error !== null && <span className="max-w-40 truncate text-[11px] text-red-500" title={error}>{error}</span>}
            <button onClick={onCancel} disabled={busy}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[13px] text-neutral-600 transition-colors hover:border-neutral-300 disabled:opacity-50">取消</button>
            <button onClick={() => void choose()} disabled={busy || loading || currentPath === ""}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-neutral-800 disabled:opacity-40">
              {busy ? "注册中…" : "选择此目录"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
