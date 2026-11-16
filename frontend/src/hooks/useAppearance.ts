/**
 * 外观与偏好（Task 0017 · P5 领域 hook #1）。
 *
 * ## 这个 hook 管什么
 *
 * 用户的**外观状态**：主题、显示偏好（宽度/字号）、状态徽标参数、选中行为、设置表面的开合与分区。
 * 全部是"跨会话、跨项目"的偏好，都落 `~/.lifeos/config/ui.json`（服务端是事实源，localStorage 只是首屏缓存）。
 *
 * ## 为什么它先拆
 *
 * 这些状态与"会话/回合"完全无关：它们不关心当前打开哪条会话、也不随回合变化。
 * 在 `App.tsx` 里它们与 59 个 state 混在一起，任何一处外观改动都可能触发整个会话树的 render。
 *
 * ## 纪律（搬自 App.tsx 原实现，逐条保留）
 *
 * - **顺序**：引擎兜底（`applyTheme`）→ 外部主题包覆盖（`applyThemePack`）→ L3 质感（`applySurfaceTokens`）。
 *   顺序错了的表现是"刷新时先深后白"（首帧是包的颜色、React 起来后被引擎默认盖掉）。
 * - **单槽主题**：包可能只有 light 或只有 dark；生效 mode 必须同步回 state，否则下次变动会拿错 mode 兜底。
 * - **服务端偏好只在有值时覆盖**：首次使用（服务端没存过）不拿默认值把用户刚调的值盖掉（那是"重置"不是"恢复"）。
 * - **徽标 soft 底读 :root 的实际值**，不读 `calculatePalette(theme)` —— 引擎不知道外部主题包。
 */
import { useCallback, useEffect, useState } from "react";

import {
  applySurfaceTokens, applyTheme, loadTheme, type ThemeState,
} from "../design/theme";
import { applyThemePack, loadActivePackId, loadThemePacks } from "../design/theme-package";
import { BADGE_DEFAULTS, badgeSoft, badgeVarsOf, type BadgePrefs } from "../api/badge-prefs";
import { fontVars, parsePrefs, widthVar, type DisplayPrefs } from "../api/display-prefs";
import { loadPrefs } from "../views/display-prefs-panel";
import {
  cachedBadgePrefs, cachedSelectionPrefs, fetchUiPrefs,
  persistBadgePrefs, persistDisplayPrefs, persistSelectionPrefs, persistTheme,
} from "../api/ui-prefs-client";
import type { SelectionPrefs } from "../api/selection-prefs";

export type SettingsSection = Parameters<typeof import("../views/settings-surface").SettingsSurface>[0]["section"];

export function useAppearance() {
  const [theme, setTheme] = useState<ThemeState>(() => loadTheme());
  const [prefs, setPrefs] = useState<DisplayPrefs>(() => loadPrefs(parsePrefs));
  const [badges, setBadges] = useState<BadgePrefs>(() => cachedBadgePrefs());
  const [selectionPrefs, setSelectionPrefs] = useState<SelectionPrefs>(() => cachedSelectionPrefs());
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 打开设置落在**导航第一项**（主题）：与 Twenty/LibreChat「进入落第一项」一致。 */
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("appearance");
  /** 头部「显示」快捷弹层（桌面）：快速入口，设置页是总入口，两者读写同一份 prefs。 */
  const [displayPrefsOpen, setDisplayPrefsOpen] = useState(false);

  /* ── 主题：引擎兜底 → 包覆盖 → L3 质感 ── */
  useEffect(() => {
    applyTheme(theme);
    const activePackName = loadActivePackId();
    if (activePackName !== undefined) {
      const pack = loadThemePacks().find((item) => item.meta.name === activePackName);
      if (pack !== undefined) {
        const effective = applyThemePack(pack, theme.mode, theme);
        if (effective !== theme.mode) setTheme({ ...theme, mode: effective });
      }
    }
    applySurfaceTokens(theme.mode);
    persistTheme(theme);
  }, [theme]);

  /* ── 启动时拉一次服务端偏好（只在有值时覆盖） ── */
  useEffect(() => {
    let alive = true;
    void fetchUiPrefs().then((remote) => {
      if (!alive || remote === undefined) return;
      if (remote.theme !== undefined) setTheme(remote.theme);
      if (remote.display !== undefined) setPrefs(remote.display);
      if (remote.badges !== undefined) setBadges(remote.badges);
      if (remote.selection !== undefined) setSelectionPrefs(remote.selection);
    });
    return () => { alive = false; };
  }, []);

  /* ── 显示偏好：落盘 + 写字号/阅读宽度到根节点（组件只用 token，不感知缩放） ── */
  useEffect(() => { persistDisplayPrefs(prefs); }, [prefs]);
  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(fontVars(prefs.font))) root.style.setProperty(name, value);
    root.style.setProperty("--container-reading-width", widthVar(prefs.width));
  }, [prefs]);

  /* ── 状态徽标：动画周期/幅度 + 三个 soft 底（从 :root 实际值派生，主题包也生效） ── */
  useEffect(() => { persistBadgePrefs(badges); }, [badges]);
  useEffect(() => {
    const root = document.documentElement.style;
    document.documentElement.dataset.badgeStrength = badges.strength;
    const readVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const surfaceHex = readVar("--color-surface");
    for (const [name, value] of Object.entries(badgeVarsOf(badges))) root.setProperty(name, value);
    for (const semantic of ["running", "success", "danger"] as const) {
      const base = readVar(`--color-${semantic}`);
      if (base === "") continue;   // 首帧还没写入：不写 soft，等下一轮 effect
      root.setProperty(`--color-${semantic}-soft`, badgeSoft(semantic, theme.mode, badges.strength, base, surfaceHex));
    }
  }, [badges, theme]);

  /* ── 视口宽度（滑块取值用；宽度"铺满"存 none，换窗口仍铺满） ── */
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const setSelectionPrefsAndPersist = useCallback((next: SelectionPrefs) => {
    setSelectionPrefs(next);
    persistSelectionPrefs(next);
  }, []);

  return {
    theme, setTheme,
    prefs, setPrefs,
    badges, setBadges,
    resetPrefs: useCallback(() => setPrefs(parsePrefs({})), []),
    resetBadges: useCallback(() => setBadges(BADGE_DEFAULTS), []),
    selectionPrefs, setSelectionPrefsAndPersist,
    viewportWidth,
    settingsOpen, setSettingsOpen,
    settingsSection, setSettingsSection,
    displayPrefsOpen, setDisplayPrefsOpen,
  };
}
