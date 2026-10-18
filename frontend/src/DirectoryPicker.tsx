import { useEffect, useState } from "react";
import { IconArrowUp, IconFolder } from "@tabler/icons-react";
import { Modal } from "./design/overlay";
import { Button, EmptyState, IconButton, Skeleton, controlClass } from "./design/ui";

type BrowseResult = { path: string; parent: string | null; dirs: string[] };

/**
 * 目录选择器（Pi Web DirectoryPicker 同型）：路径输入直接跳转 + 逐级目录列表 + 上级 + 选择。
 * 模态语义/焦点陷阱/Esc 由 design/overlay.tsx 提供。
 */
export function DirectoryPicker({ onCancel, onSelect }: {
  onCancel: () => void;
  onSelect: (path: string) => Promise<string | null>;
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

  return (
    <Modal title="选择目录" subtitle="注册为一个项目（不复制文件，只记录路径）" width={560} onClose={() => { if (!busy) onCancel(); }}
      footer={<>
        <span className="mr-auto flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-mono text-micro text-ink-500" title={currentPath}>{currentPath || "—"}</span>
          {error !== null && <span className="shrink-0 text-micro text-danger">{error}</span>}
        </span>
        <Button onClick={onCancel} disabled={busy}>取消</Button>
        <Button variant="primary" onClick={() => void choose()} disabled={busy || loading || currentPath === ""}>
          {busy ? "注册中…" : "选择此目录"}
        </Button>
      </>}>
      <form className="mb-2 flex items-center gap-1.5"
        onSubmit={(event) => { event.preventDefault(); void navigate(pathInput.trim() || undefined); }}>
        <IconButton label="上级目录" disabled={parent === null || loading}
          onClick={() => { if (parent !== null) void navigate(parent); }}>
          <IconArrowUp size={16} />
        </IconButton>
        <input value={pathInput} onChange={(event) => setPathInput(event.target.value)}
          placeholder="输入路径后回车跳转"
          className={`${controlClass} h-9 font-mono text-meta`} />
      </form>

      <div className="max-h-80 min-h-40 overflow-y-auto">
        {loading && <Skeleton rows={6} />}
        {!loading && dirs.length === 0 && <EmptyState title="没有子目录" hint="可以直接选择当前目录。" />}
        {!loading && dirs.map((name) => {
          const child = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
          return (
            <button key={name} type="button" onClick={() => void navigate(child)}
              className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-body text-ink-700 transition-colors hover:bg-hover hover:text-ink-900">
              <IconFolder size={16} className="shrink-0 text-ink-300" />
              <span className="truncate">{name}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
