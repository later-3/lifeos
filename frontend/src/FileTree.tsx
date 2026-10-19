import { useCallback, useEffect, useRef, useState } from "react";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconFile, IconFileText, IconFolder, IconFolderOpen, IconRefresh } from "@tabler/icons-react";
import { DirectoryPicker } from "./DirectoryPicker";

import { Button, IconButton, Label, Row, Skeleton } from "./design/ui";
import { Modal } from "./design/overlay";
import { isMarkdown } from "./fs-utils";

type TreeEntry = { name: string; isDir: boolean };
type TreeResult = { path: string; entries: TreeEntry[]; error?: { message: string } };

const ROOT_KEY = "lifeos.fsRoot";
// 根 = 打开过的目录历史（后端白名单按最近使用排序，家目录永远第一）。
// 参照 VS Code「Open Recent」与 Pi Web 的 recent-projects：不另存历史，直接用已有数据排序。

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
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [roots, setRoots] = useState<string[]>([]);
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

  /** 切换根：一次 POST 既注册（幂等）又把它提到历史最前，然后清缓存重拉。 */
  async function switchRoot(path: string): Promise<string | null> {
    const response = await fetch("/api/fs/roots", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }),
    });
    const data = await response.json() as { roots?: string[]; error?: { message: string } };
    if (!response.ok) { const message = data.error?.message ?? "切换失败"; setError(message); return message; }
    localStorage.setItem(ROOT_KEY, path);
    if (data.roots !== undefined) setRoots(data.roots);
    setPickerOpen(false);
    setSwitcherOpen(false);
    setRoot(path);   // 触发清缓存与重拉
    return null;
  }

  async function openSwitcher() {
    try {
      const data = await (await fetch("/api/fs/roots")).json() as { roots: string[] };
      setRoots(data.roots);
    } catch { /* 打开失败就只显示当前根 */ }
    setSwitcherOpen(true);
  }

  const rootName = (path: string) => path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1) || path;

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
              className="flex h-8 w-full items-center gap-1.5 rounded-control pr-1.5 text-left text-body text-ink-700 transition-colors hover:bg-hover hover:text-ink-900"
              style={{ paddingLeft: 8 + depth * 14 }}>
              <IconChevronRight size={14}
                className={`shrink-0 text-ink-500 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`} />
              {pending.has(childPath)
                ? <IconFolder size={14} className="shrink-0 animate-pulse text-ink-300" />
                : isOpen
                  ? <IconFolderOpen size={14} className="shrink-0 text-ink-500" />
                  : <IconFolder size={14} className="shrink-0 text-ink-500" />}
              <span className="truncate">{entry.name}</span>
            </button>
            {isOpen && (
              <>
                {(entries[childPath] ?? []).length === 0 && !pending.has(childPath) && (
                  <p className="py-1 text-micro text-ink-500" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>空</p>
                )}
                {renderRows(childPath, depth + 1)}
              </>
            )}
          </div>
        );
      }
      return (
        <button key={childPath} onClick={() => onOpenFile(childPath, entry.name)}
          className="flex h-8 w-full items-center gap-1.5 rounded-control pr-1.5 text-left text-body text-ink-700 transition-colors hover:bg-hover hover:text-ink-900"
          style={{ paddingLeft: 8 + depth * 14 + 18 }}>
          {isMarkdown(entry.name)
            ? <IconFileText size={14} className="shrink-0 text-ink-500" />
            : <IconFile size={14} className="shrink-0 text-ink-500" />}
          <span className="truncate">{entry.name}</span>
        </button>
      );
    });
  }

  return (
    <>
      {pickerOpen && (
        <DirectoryPicker onCancel={() => setPickerOpen(false)} onSelect={switchRoot} />
      )}
      {switcherOpen && (
        <Modal title="切换目录" subtitle="打开过的目录会留在这里（最近使用在前）" width={560} onClose={() => setSwitcherOpen(false)}
          footer={<><span className="mr-auto text-micro text-ink-500">共 {roots.length} 个</span>
            <Button variant="ghost" size="sm" onClick={() => { setSwitcherOpen(false); setPickerOpen(true); }}>浏览其他目录…</Button></>}>
          <div className="space-y-0.5">
            {roots.map((path) => (
              <Row key={path} selected={path === root} onClick={() => void switchRoot(path)}>
                <IconFolder size={14} className="shrink-0 text-ink-300" />
                <span className="min-w-0 flex-1 truncate font-mono text-meta">{rootName(path)}</span>
                <span className="min-w-0 max-w-72 truncate font-mono text-micro text-ink-500" title={path}>{path}</span>
              </Row>
            ))}
          </div>
        </Modal>
      )}
      <div className="flex h-full min-h-0 flex-col bg-sunken">
        {/* 树列头（与三列同 40px）：根名 + 选择目录 + 刷新 + 收起 */}
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line pl-3 pr-1">
          <button type="button" onClick={() => void openSwitcher()} title={root ?? ""}
            className="flex min-w-0 flex-1 items-center gap-0.5 rounded-control px-0.5 text-left text-micro text-ink-500 transition-colors hover:text-ink-900">
            <span className="min-w-0 truncate font-mono">· {rootLabel}</span>
            <IconChevronDown size={12} className="shrink-0" />
          </button>
          <IconButton label="刷新文件树" active={refreshing} onClick={() => void refresh()}><IconRefresh size={14} /></IconButton>
          {onHide !== undefined && <IconButton size="sm" label="收起文件树" onClick={onHide}><IconChevronLeft size={16} /></IconButton>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          {error !== null && <p className="px-2 py-3 text-center text-micro text-danger">{error}</p>}
          {root !== undefined && entries[root] === undefined && error === null && <Skeleton rows={5} />}
          {root !== undefined && renderRows(root, 0)}
        </div>
      </div>
    </>
  );
}
