import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ToastProvider } from "./design/toast";
import { IconSetContext } from "./design/icon-context";
import preloadedThemes from "./design/preloaded-themes.json";
import type { IconSetId } from "./design/icon-sets";
import { VersionBanner } from "./version-banner";
import { startVersionCheck } from "./version-check";
import { primeEmojiShortcodes } from "./emoji-catalog";
import "./index.css";

/*
 * 主题包缓存（S5）：boot 脚本（index.html，React 之前）只能读 localStorage。
 * 预置的 8 个主题包在构建产物里，这里在**第一次渲染前**写进去，
 * 这样下一次刷新 boot 就能直接用激活主题包的颜色——首帧即最终色（不再 #292828 → #111212 跳一下）。
 */
try {
  if (localStorage.getItem("lifeos.themePacks") === null && preloadedThemes.length > 0) {
    localStorage.setItem("lifeos.themePacks", JSON.stringify(preloadedThemes));
  }
} catch { /* 隐私模式：boot 脚本会退回内置色，不影响可用性 */ }

// 版本轮询（Task 0013）：__LIFEOS_BUILD__ 未注入（dev）时内部直接返回，零成本。
// 停止函数不保留：页面生命周期与轮询一致，无热卸载场景。
startVersionCheck();

// 表情短码表（Task 0016）：启动预热一次，之后正文里的 `:id:` 才能渲染成图；失败静默降级成纯文本。
void primeEmojiShortcodes();

// PWA：只在构建产物里注册；开发态避免 Service Worker 缓存 Vite 模块。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => { /* 安装能力失败不影响应用 */ });
  });
}

/** 图标集（S3）：从 localStorage 读，切换时由设置页写并触发重渲染。 */
function Root() {
  const [iconSet, setIconSet] = useState<IconSetId>(() => {
    try { return (localStorage.getItem("lifeos.iconSet") as IconSetId) ?? "tabler"; } catch { return "tabler"; }
  });
  useEffect(() => {
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<IconSetId>).detail;
      setIconSet(next);
      try { localStorage.setItem("lifeos.iconSet", next); } catch { /* 隐私模式 */ }
    };
    window.addEventListener("lifeos:icon-set", onChange);
    return () => window.removeEventListener("lifeos:icon-set", onChange);
  }, []);
  return (
    <IconSetContext value={iconSet}>
      <ToastProvider>
        {import.meta.env.PROD && <VersionBanner />}
        <App />
      </ToastProvider>
    </IconSetContext>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
