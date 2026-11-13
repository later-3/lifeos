import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ToastProvider } from "./design/toast";
import { VersionBanner } from "./version-banner";
import { startVersionCheck } from "./version-check";
import "./index.css";

// 版本轮询（Task 0013）：__LIFEOS_BUILD__ 未注入（dev）时内部直接返回，零成本。
// 停止函数不保留：页面生命周期与轮询一致，无热卸载场景。
startVersionCheck();

// PWA：只在构建产物里注册；开发态避免 Service Worker 缓存 Vite 模块。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => { /* 安装能力失败不影响应用 */ });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <VersionBanner />
      <App />
    </ToastProvider>
  </StrictMode>,
);
