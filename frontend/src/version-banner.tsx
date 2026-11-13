/**
 * "有新版本"提示条（Task 0013，案例 C216）。
 *
 * 监听 version-check 的 `lifeos:new-version` 事件；未发现新版本时渲染 null（不占布局）。
 *
 * 视觉（0011 教训的自觉应用）：实心底的可见性押在**主题不变量**上——
 * `bg-ink-900 text-surface`（composer 实心钮同款：正文最深色 + 反白，对比 ≥AA 由主题系统保证，
 * 不押在主色巧不巧深上）。层级走 index.css 的 `.layer-version-banner`（--z-version-banner: 45，
 * 模态之下、toast 之上——更新提示不抢模态里的操作）。
 */
import { useEffect, useState } from "react";
import { LAYER } from "./design/surface";
import { NEW_VERSION_EVENT } from "./version-check";

export function VersionBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const onNewVersion = () => setStale(true);
    window.addEventListener(NEW_VERSION_EVENT, onNewVersion);
    return () => window.removeEventListener(NEW_VERSION_EVENT, onNewVersion);
  }, []);
  if (!stale) return null;
  return (
    <div role="status" aria-label="Life OS 有新版本" data-version-banner=""
      className="layer-version-banner fixed inset-x-0 top-0 flex items-center justify-center gap-3 bg-ink-900 py-2 text-surface">
      <span className="text-meta">Life OS 有新版本</span>
      <button type="button" data-version-banner-reload
        onClick={() => window.location.reload()}
        className="inline-flex min-h-11 shrink-0 items-center rounded-control px-3 font-medium hover:bg-hover/25">
        刷新
      </button>
    </div>
  );
}
