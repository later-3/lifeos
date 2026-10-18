import { useEffect, useState } from "react";
import type { FileTab } from "./FilePanel";

// 文件面板状态（从 App 拆出，2026-10-17 坏味道清理）：
// 页签列表 / 激活页签 / 面板开合 + 开关页签动作，全部持久化（内容不入 localStorage，按路径内存缓存）。

const PANEL_KEY = "lifeos.filePanel";
const TABS_KEY = "lifeos.fileTabs";
type TabsPersist = { tabs: FileTab[]; activeId?: string };

function loadPersist(): TabsPersist {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as TabsPersist;
      if (Array.isArray(parsed.tabs)) return parsed;
    }
  } catch { /* 损坏则空 */ }
  return { tabs: [] };
}

export function useFilePanel() {
  const [initial] = useState(loadPersist);   // 只解析一次（原实现两个 useState 各解析一次）
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem(PANEL_KEY) !== "0");
  const [fileTabs, setFileTabs] = useState<FileTab[]>(initial.tabs);
  const [activeFileTabId, setActiveFileTabId] = useState<string | undefined>(initial.activeId);

  useEffect(() => { localStorage.setItem(PANEL_KEY, panelOpen ? "1" : "0"); }, [panelOpen]);
  useEffect(() => { localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: fileTabs, activeId: activeFileTabId })); }, [fileTabs, activeFileTabId]);

  /** 打开/聚焦页签并自动开面板（Pi Web handleOpenFile 同型）。 */
  function openFile(path: string, name: string) {
    const id = `file:${path}`;
    setFileTabs((prev) => (prev.some((tab) => tab.id === id) ? prev : [...prev, { id, fileName: name, filePath: path }]));
    setActiveFileTabId(id);
    setPanelOpen(true);
  }

  function closeFileTab(id: string) {
    const next = fileTabs.filter((tab) => tab.id !== id);
    setFileTabs(next);
    if (id === activeFileTabId) setActiveFileTabId(next[next.length - 1]?.id);
    if (next.length === 0) setPanelOpen(false);
  }

  function updateTabPrefs(id: string, prefs: { mode?: "render" | "source"; wrap?: boolean }) {
    setFileTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...prefs } : tab)));
  }

  return { panelOpen, setPanelOpen, fileTabs, activeFileTabId, setActiveFileTabId, openFile, closeFileTab, updateTabPrefs };
}
