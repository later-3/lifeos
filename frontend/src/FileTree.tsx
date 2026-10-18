import { useCallback, useEffect, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight, IconFile, IconFileText, IconFolder, IconFolderOpen, IconFolderPlus, IconRefresh } from "@tabler/icons-react";
import { DirectoryPicker } from "./DirectoryPicker";
import { isMarkdown } from "./fs-utils";

type TreeEntry = { name: string; isDir: boolean };
type TreeResult = { path: string; entries: TreeEntry[]; error?: { message: string } };

const ROOT_KEY = "lifeos.fsRoot";

/**
 * 文件夹树（右面板左栏形态，用户 2026-10-17：与查看器并排一体、独立拖宽）：
 * - 根默认 ~/.lifeos（roots[0]）；“选择目录”= 模态选择器 → 注册根 → 换根清缓存；
 * - 树：懒加载（展开才拉）+ 按路径缓存（不重拉）；刷新=清缓存并重拉根与所有已展开层；
 * - 本组件只负责树列本身，宽度由外层（App 面板布局）控制。
 */
export function FileTree({ onOpenFile, onHide }: { onOpenFile: (path: string, name: string) => void; onHide?: () => void }) {
  const [root, setRoot] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<Record<string, TreeEntry[]>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, TreeEntry[]>());   // 拉过的层不重拉（性能红线）

  // 初始化根：优先记住的根（仍在白名单才有效），否则 roots[0]（= 家目录）。
  useEffect(() => {
    void (async () => {
      try {
        const data = await (await fetch("/api/fs/roots")).json() as { roots: string[] };
        const remembered = localStorage.getItem(ROOT_KEY);
        setRoot(remembered !== null && data.roots.includes(remembered) ? remembered : data.roots[0]);
      } catch { setError("无法加载根列表"); }
    })();
  }, []);

  const loadInto = useCallback(async (path: string): Promise<TreeEntry[]> => {
    const cached = cache.current.get(path);
    if (cached !== undefined) return cached;
    const response = await fetch(`/api/fs/tree?path=${encodeURIComponent(path)}`);
    const data = await response.json() as TreeResult;
    if (!response.ok) { setError(data.error?.message ?? "读取目录失败"); return []; }
    cache.current.set(path, data.entries);
    setEntries((prev) => ({ ...prev, [path]: data.entries }));
    return data.entries;
  }, []);

  // 根变化：清缓存、清展开、拉根层。
  useEffect(() => {
    if (root === undefined) return;
    cache.current.clear();
    setEntries({});
    setExpanded(new Set());
    setError(null);
    void loadInto(root);
  }, [root, loadInto]);

  async function toggle(dirPath: string) {
    const next = new Set(expanded);
    if (next.has(dirPath)) { next.delete(dirPath); setExpanded(next); return; }
    next.add(dirPath);
    setExpanded(next);
    setPending((prev) => new Set(prev).add(dirPath));
    await loadInto(dirPath);
    setPending((prev) => { const s = new Set(prev); s.delete(dirPath); return s; });
  }

  /** 刷新：清缓存，重拉根 + 当前所有已展开层（完成态绿勾 2 秒，Pi Web 同款反馈）。 */
  async function refresh() {
    if (root === undefined || refreshing) return;
    setRefreshing(true);
    cache.current = new Map();
    const paths = [root, ...[...expanded].sort((a, b) => a.length - b.length)];
    setEntries({});
    for (const path of paths) await loadInto(path);
    setTimeout(() => setRefreshing(false), 2000);
  }

  async function selectDirectory(path: string): Promise<string | null> {
    const response = await fetch("/api/fs/roots", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }),
    });
    const data = await response.json() as { roots?: string[]; error?: { message: string } };
    if (!response.ok) { const message = data.error?.message ?? "注册失败"; setError(message); return message; }
    localStorage.setItem(ROOT_KEY, path);
    setPickerOpen(false);
    setRoot(path);   // 触发清缓存与重拉
    return null;
  }

  const rootLabel = root === undefined ? "…" : root === "/" ? "/" : root.slice(root.lastIndexOf("/") + 1) || root;

  function renderRows(dirPath: string, depth: number) {
    const list = entries[dirPath] ?? [];
    return list.map((entry) => {
      const childPath = `${dirPath === "/" ? "" : dirPath}/${entry.name}`;
      if (entry.isDir) {
        const isOpen = expanded.has(childPath);
        return (
          <div key={childPath}>
            <button onClick={() => void toggle(childPath)}
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12.5px] text-neutral-700 transition-colors hover:bg-neutral-100"
              style={{ paddingLeft: 8 + depth * 14 }}>
              <IconChevronRight size={12}
                className={`shrink-0 text-neutral-400 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`} />
              {pending.has(childPath)
                ? <IconFolder size={14} className="shrink-0 animate-pulse text-neutral-300" />
                : isOpen
                  ? <IconFolderOpen size={14} className="shrink-0 text-neutral-400" />
                  : <IconFolder size={14} className="shrink-0 text-neutral-400" />}
              <span className="truncate">{entry.name}</span>
            </button>
            {isOpen && (
              <>
                {(entries[childPath] ?? []).length === 0 && !pending.has(childPath) && (
                  <p className="py-0.5 text-[11px] text-neutral-300" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>空</p>
                )}
                {renderRows(childPath, depth + 1)}
              </>
            )}
          </div>
        );
      }
      return (
        <button key={childPath} onClick={() => onOpenFile(childPath, entry.name)}
          className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12.5px] text-neutral-600 transition-colors hover:bg-neutral-100"
          style={{ paddingLeft: 8 + depth * 14 + 18 }}>
          {isMarkdown(entry.name)
            ? <IconFileText size={14} className="shrink-0 text-neutral-400" />
            : <IconFile size={14} className="shrink-0 text-neutral-400" />}
          <span className="truncate">{entry.name}</span>
        </button>
      );
    });
  }

  return (
    <>
      {pickerOpen && (
        <DirectoryPicker onCancel={() => setPickerOpen(false)} onSelect={selectDirectory} />
      )}
      <div className="flex h-full min-h-0 flex-col bg-neutral-50">
        {/* 树列头：根名 + 选择目录 + 刷新 */}
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-neutral-200 px-2">
          <span className="text-[11px] font-medium tracking-wide text-neutral-400">文件</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-neutral-400" title={root ?? ""}>· {rootLabel}</span>
          <button aria-label="选择目录" title="选择目录" onClick={() => setPickerOpen(true)}
            className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700">
            <IconFolderPlus size={14} />
          </button>
          <button aria-label="刷新文件树" title="刷新文件树" onClick={() => void refresh()}
            className={`rounded-md p-1 transition-colors ${refreshing ? "bg-emerald-500/15 text-emerald-500" : "text-neutral-400 hover:bg-neutral-200/70 hover:text-neutral-700"}`}>
            <IconRefresh size={14} className={refreshing ? "stroke-[2.5]" : ""} />
          </button>
          {onHide !== undefined && (
            <button aria-label="收起文件树" title="收起文件树" onClick={onHide}
              className="rounded-md p-0.5 text-neutral-300 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300">
              <IconChevronLeft size={15} />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          {error !== null && <p className="px-2 py-3 text-center text-[11px] text-red-500">{error}</p>}
          {root !== undefined && entries[root] === undefined && error === null && (
            <p className="px-2 py-3 text-center text-[11px] text-neutral-400">加载中…</p>
          )}
          {root !== undefined && renderRows(root, 0)}
        </div>
      </div>
    </>
  );
}
