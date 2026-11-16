import { useEffect, useRef, useState } from "react";
import { MOBILE_QUERY, mobileQueryOf, resolveAppHeight } from "./mobile-platform";

export { MOBILE_QUERY, mobileQueryOf, resolveAppHeight };

/**
 * 手机布局断点（Task 0016 · P2-S2）。
 *
 * 改之前只有 `(max-width: 639px)`：手机横屏（844×390）会掉回桌面三列布局，
 * 而手指还是手指——实测命中区掉到 32–36px（`设置` 36 / `完整历史` 32 / `显示设置` 32）。
 * 现在多一支"粗指针 + 矮视口"，判据是参考项目 pi-web 的 `MOBILE_QUERY`
 * （`hooks/useIsMobile.ts:7`），但我们**保留自己的 639 宽度断点**（不采用它的 768，
 * 否则 700px 窗口会丢三列）。判定与常量在 `mobile-platform.ts`，可离线单测。
 */
export function useIsMobile(query = MOBILE_QUERY): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return mobile;
}

/**
 * 手机键盘弹起时 visualViewport 变小：用 CSS 变量驱动根容器高度，避免 composer 被遮。
 *
 * **必须**经 `resolveAppHeight()` 判定（Task 0016 · P2-S2）：直接取 `visualViewport.height`
 * 时，**双指放大**也会让它变小 → 整个应用缩水（观感是"布局崩了"）。
 * pi-web 同样只在 scale≈1 时才信它（`lib/mobile-viewport.ts:11-45`）。
 */
export function useAppHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    const apply = () => {
      const height = resolveAppHeight({
        innerHeight: window.innerHeight,
        visualHeight: viewport?.height ?? window.innerHeight,
        visualScale: viewport?.scale ?? 1,
      });
      document.documentElement.style.setProperty("--app-height", `${Math.round(height)}px`);
    };
    apply();
    viewport?.addEventListener("resize", apply);
    viewport?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      viewport?.removeEventListener("resize", apply);
      viewport?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);
}

/**
 * 右边缘向左滑 = 返回上一级。
 * 只作为系统返回的补充：监听 touch，不动横向滚动；输入/可编辑区域内不抢。
 * 方向按用户 2026-10-22 的定义：右边缘 → 左。
 */
export function useEdgeBack(enabled: boolean, onBack: () => void): void {
  const callback = useRef(onBack);
  callback.current = onBack;
  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number; id: number } | undefined;
    const ignored = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']") !== null;

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { start = undefined; return; }
      const touch = event.touches[0]!;
      if (touch.clientX < window.innerWidth - 24 || ignored(event.target)) { start = undefined; return; }
      start = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
    };
    const onMove = (event: TouchEvent) => {
      if (start === undefined) return;
      const touch = [...event.touches].find((item) => item.identifier === start!.id);
      if (touch === undefined) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (dx < -12 && Math.abs(dx) > Math.abs(dy) * 1.2) event.preventDefault();
    };
    const onEnd = (event: TouchEvent) => {
      if (start === undefined) return;
      const touch = [...event.changedTouches].find((item) => item.identifier === start!.id);
      if (touch === undefined) { start = undefined; return; }
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      start = undefined;
      if (dx <= -48 && Math.abs(dx) > Math.abs(dy) * 1.2) callback.current();
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

/** 浏览器提供 beforeinstallprompt 时显示显式安装入口；iOS 没有该事件，走 Safari 分享菜单。 */
export function useInstallPrompt(): { canInstall: boolean; install: () => Promise<void> } {
  const [prompt, setPrompt] = useState<InstallPromptEvent | undefined>(undefined);
  useEffect(() => {
    const onPrompt = (event: Event) => {
      const candidate = event as InstallPromptEvent;
      if (typeof candidate.prompt !== "function") return;
      event.preventDefault();
      setPrompt(candidate);
    };
    const onInstalled = () => setPrompt(undefined);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return {
    canInstall: prompt !== undefined,
    install: async () => {
      if (prompt === undefined) return;
      await prompt.prompt();
      setPrompt(undefined);
    },
  };
}
