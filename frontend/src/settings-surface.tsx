/**
 * 设置界面（Task 0009 · P1-3，Task 0007 的落码载体）。
 *
 * 结构参照 Twenty `useSettingsNavigationItems.tsx:43-57`：**导航是数据**（分区数组 + 条目），
 * 新板块 = 加一条配置定义，不写第二套框架。分两类：
 * - **真可用**：外观（主题引擎 design/theme.ts）、显示（display-prefs 的宽度/字号，功能 1:1 迁入）；
 * - **占位**：动效/语言/模型/通知/关于——结构在、控件禁用并标注"待实现"，
 *   不渲染假数据（project-space §3.2 规则）。
 *
 * 入口：头部"显示设置"按钮（保留 aria-label，ui-contract 契约依赖）→ 打开本表面并落在"显示"分区。
 * 打开时是全页表面（覆盖 main 区），关闭回到原位；手机上同样全页。
 */
import { useEffect, useMemo, useState } from "react";
import {
  PRESET_LABELS, THEME_DEFAULTS, THEME_PRESETS, calculatePalette, contrastOf,
  type ThemePreset, type ThemeState,
} from "./design/theme";
import {
  fontFromSlider, fontLabel, sliderFromFont, sliderFromWidth, widthFromSlider, widthLabel,
  type DisplayPrefs,
} from "./display-prefs";
import {
  badgePeriodS, badgeBreatheMax, dotBreatheMax, BADGE_DEFAULTS, type BadgePrefs, type BadgeStrength,
} from "./badge-prefs";
import { Button, IconButton, Segmented, ClickableRow, ToggleChip } from "./design/ui";
import { LAYER_CLASS } from "./design/surface";
import { ThemePreview } from "./design/theme-preview";
import { ICON_SET_LABELS, iconSetCoverage, type IconSetId } from "./design/icon-sets";
import type { IconName } from "./design/icons";
import type { SelectionPrefs } from "./selection-prefs";
import { AppIcon } from "./design/icons";
import { applyThemePack, loadThemePacks, loadActivePackId, saveActivePackId, saveThemePacks, validateThemePack, type ThemePack } from "./design/theme-package.ts";
import { VAR_MAP } from "./design/theme.ts";
import preloadedThemes from "./design/preloaded-themes.json";
import { translateVscodeTheme, translateObsidianTheme, extractVscodeSeed } from "./design/theme-translators.ts";
import { useState as useSt } from "react";

/* ── 分区注册表（数据驱动；新板块加一条即可）── */
type SectionKey = "appearance" | "display" | "interaction" | "motion" | "language" | "models" | "notify" | "about";

/**
 * **只登记已有真实控件的分区**（2026-11-09 审核修正）。
 *
 * 此前导航列了 7 个分区、其中 5 个点进去只有一句"该分区的配置项还没实现"——
 * 实测 71% 的导航项是死点击，用户点一次就知道"这页面一半是空的"。
 * `knowledge/design/layout-model.md` §2.2 本来写的就是用 `show(ctx)` 把未实现的项
 * **直接不显示**，而不是渲染禁用控件或空占位；这一版按那条落码。
 * 规划中的分区改在导航底部用一行文字说明（可读、不可点，不制造死点击）。
 */
const SECTIONS: Array<{ g: string; items: Array<{ k: SectionKey; label: string }> }> = [
  { g: "外观", items: [{ k: "appearance", label: "主题" }, { k: "display", label: "显示" }, { k: "interaction", label: "交互" }] },
];
/** 规划中的分区：只作为一行说明，不进导航（避免 5 个空点击）。 */
const PLANNED_SECTIONS = "模型 · 通知 · 语言 · 动效 · 关于";

const ACCENT_DOTS: Array<{ h: number; c: number; label: string }> = [
  { h: 221, c: 62, label: "蓝" }, { h: 158, c: 45, label: "绿" }, { h: 262, c: 50, label: "紫" },
  { h: 34, c: 62, label: "橙" }, { h: 351, c: 55, label: "粉" }, { h: 200, c: 40, label: "青" },
  { h: 0, c: 0, label: "黑" },
];

/* ── 小控件 ── */
function SetSlider({ id, label, min, max, step, value, onChange, format }: {
  id: string; label: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <div className="set-slider" data-testid={`set-row-${id}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={(e) => onChange(Number(e.currentTarget.value))} />
      <span className="v">{format ? format(value) : String(value)}</span>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-title font-semibold text-ink-900" style={{ letterSpacing: "var(--tracking-title)" }}>{title}</h2>
      <p className="mb-5 mt-1 text-meta text-ink-500">{desc}</p>
      {children}
    </div>
  );
}

/* ── 外观分区（真可用）── */
/** 一组设置 = 一张卡（Twenty SettingsPageLayout 的 PageCardLayout 同构：分组有边、块内 16 留白）。 */
function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-panel bg-surface" style={{ boxShadow: "var(--surface-card)" }}>
      <header className="border-b border-line px-4 py-2.5">
        <h3 className="text-body font-semibold text-ink-900">{title}</h3>
        {hint !== undefined && <p className="mt-0.5 text-micro text-ink-500">{hint}</p>}
      </header>
      <div className="flex flex-col gap-2 p-4">{children}</div>
    </section>
  );
}

function AppearanceSection({ theme, onChange }: { theme: ThemeState; onChange: (next: ThemeState) => void }) {
  const palette = useMemo(() => calculatePalette(theme), [theme]);
  const set = (patch: Partial<ThemeState>) => onChange({ ...theme, ...patch });
  const pickPreset = (name: ThemePreset) => set({ ...THEME_PRESETS[name], preset: name });
  const previewColors = (name: ThemePreset) => {
    const p = calculatePalette({ ...THEME_DEFAULTS, ...THEME_PRESETS[name], preset: name, mode: theme.mode });
    return [p.navEdge, p.navBg, p.surface, p.accentSolid].map(([l, c, h]) => rgbHex(l, c, h));
  };
  /* ── 统一主题管理（用户拍板 2026-11-13）：一个列表、一个口子，改色=保存为新主题 ── */
  const [packs, setPacksState] = useState(() => loadThemePacks());
  const [activePackName, setActivePackName] = useState<string | undefined>(() => loadActivePackId());
  const [customizing, setCustomizing] = useState(false);
  const [customName, setCustomName] = useState("");

  const allThemes = useMemo(() => {
    const effectivePacks = packs.length > 0 ? packs : (preloadedThemes as ThemePack[]);
    const builtIn = (Object.keys(THEME_PRESETS) as ThemePreset[]).map((name) => ({
      kind: "preset" as const, name: PRESET_LABELS[name], id: name,
      colors: previewColors(name),
    }));
    const external = effectivePacks.map((p) => ({
      kind: "external" as const, name: p.meta.name, id: "ext:" + p.meta.name,
      // 色带取该主题有值的 mode（dark-only 主题显示 dark 色带）
      colors: ["--color-nav-edge", "--color-nav-bg", "--color-surface", "--color-accent-solid"].map(
        (k) => ((p.modes[theme.mode] ?? p.modes.dark ?? p.modes.light) as Record<string, string> | undefined)?.[k] ?? "transparent",
      ),
    }));
    return [...builtIn, ...external];
  }, [packs, theme.mode, theme.preset, theme.accentH, theme.accentC]);

  function applyPreset(name: ThemePreset) {
    pickPreset(name);
    setActivePackName(undefined); saveActivePackId(undefined);
  }
  function applyExternal(name: string) {
    const pack = packs.find((p) => p.meta.name === name);
    if (pack === undefined) return;
    // 有种子 ThemeState → 走标准 React 状态流（onChange → applyTheme → 全站生效，与内置预设同管道）
    if (pack.seedThemeState !== undefined) {
      onChange(pack.seedThemeState);
    } else {
      applyThemePack(pack, theme.mode, theme);
    }
    setActivePackName(name); saveActivePackId(name);
  }
  function saveCustom() {
    if (customName.trim() === "") return;
    const existing = loadThemePacks();
    const vars: Record<string, string> = {};
    const paletteNow = calculatePalette(theme);
    for (const [varName, key] of VAR_MAP) {
      const v = paletteNow[key as keyof typeof paletteNow];
      if (v) vars[varName] = rgbHex(v[0], v[1], v[2]);
    }
    const pack: ThemePack = {
      kind: "lifeos-theme-pack", version: 1,
      meta: { name: customName.trim(), source: "custom", sourceRef: "基于内置预设自定义" },
      modes: { [theme.mode]: vars } as ThemePack["modes"],
    };
    const all = [...existing.filter((p) => p.meta.name !== pack.meta.name), pack];
    setPacksState(all); saveThemePacks(all);
    setCustomizing(false); setCustomName("");
  }

  return (
    <Section title="主题" desc="选一个主题即全站生效。改颜色 → 保存为新的自定义主题。">
      <div className="flex flex-col gap-4">
        <Card title="深浅色" hint="每个主题都有深浅两套（引擎从同一公式派生）">
          <div className="flex items-center justify-between gap-3">
            <span className="text-meta text-ink-700">模式</span>
            <span className="mode-seg" role="radiogroup" aria-label="深浅色">
              <button type="button" className={theme.mode === "light" ? "on" : ""} aria-pressed={theme.mode === "light"}
                onClick={() => set({ mode: "light" })}>浅色</button>
              <button type="button" className={theme.mode === "dark" ? "on" : ""} aria-pressed={theme.mode === "dark"}
                onClick={() => set({ mode: "dark" })}>深色</button>
            </span>
          </div>
        </Card>

        <Card title="主题" hint="内置 + 导入 + 自定义，选一个就是全部。点卡片立即换。">
        {/* 主题选择器（Popover 模式，对标 VSCode theme picker / Astryx ThemeSwitcher） */}
        <ThemeSelector
          themes={allThemes}
          activeId={activePackName !== undefined ? "ext:" + activePackName : theme.preset}
          onSelect={(id) => {
            if (id.startsWith("ext:")) { applyExternal(id.slice(4)); }
            else { applyPreset(id as ThemePreset); }
          }}
        />
      </Card>

        {!customizing && !activePackName ? (
          <Button variant="ghost" size="sm" onClick={() => setCustomizing(true)}>
            <AppIcon name="pencil" size={14} /> 自定义当前主题的颜色
          </Button>
        ) : null}
        {customizing && (
          <Card title="自定义颜色" hint="调整 → 保存 → 变成新的自定义主题（加进上面的列表）">
            <div className="accent-dots">
              {ACCENT_DOTS.map((d) => {
                const on = theme.accentH === d.h && theme.accentC === d.c;
                const bg = rgbHex(theme.mode === "dark" ? 60 : 52, (d.c / 100) * 0.22, d.h);
                return (
                  <ToggleChip key={d.label} shape="dot" pressed={on} title={d.label} aria-label={`主色 ${d.label}`}
                    style={{ background: bg }} onClick={() => set({ accentH: d.h, accentC: d.c })}>
                    {on ? <AppIcon name="check" size={14} /> : null}
                  </ToggleChip>
                );
              })}
            </div>
            <SetSlider id="theme-accent-h" label="色相" min={0} max={360} step={1} value={theme.accentH}
              onChange={(v) => set({ accentH: v })} format={(v) => `${v}°`} />
            <SetSlider id="theme-accent-c" label="饱和" min={0} max={100} step={1} value={theme.accentC}
              onChange={(v) => set({ accentC: v })} format={(v) => (v === 0 ? "灰" : `${v}%`)} />
            <SetSlider id="theme-l-surface" label="内容" min={88} max={100} step={0.5} value={theme.lSurface} onChange={(v) => set({ lSurface: v })} format={(v) => v.toFixed(1)} />
            <SetSlider id="theme-l-nav" label="列" min={88} max={100} step={0.5} value={theme.lNav} onChange={(v) => set({ lNav: v })} format={(v) => v.toFixed(1)} />
            <div className="flex items-center gap-2">
              <input value={customName} onChange={(e) => setCustomName(e.target.value)}
                placeholder="给这个主题取个名字…"
                className="min-w-0 flex-1 rounded-control bg-sunken px-2 py-1.5 text-body text-ink-900 ring-1 ring-line focus:outline-none focus:ring-accent" />
              <Button variant="primary" size="sm" onClick={saveCustom} disabled={customName.trim() === ""}>保存主题</Button>
              <Button variant="ghost" size="sm" onClick={() => setCustomizing(false)}>取消</Button>
            </div>
          </Card>
        )}

        {/* 字体与图标集（S3）：换字体、换图标集，都写进主题包 */}
        <TypographyAndIconCard theme={theme} onTheme={onChange} />

        {/* 当前主题效果预览（S2）：选主题即所见——13 类代表 primitive 全是活组件 */}
        <Card title="当前主题效果" hint="下面全部是活组件，不是截图——选任何主题、切深浅，这里立刻变。">
          <ThemePreview />
        </Card>

        <ExternalThemeCard theme={theme} onTheme={onChange} packs={packs} onPacksChange={(next) => { setPacksState(next); saveThemePacks(next); }} />

        <div>
          <Button variant="ghost" size="sm" onClick={() => { onChange({ ...THEME_DEFAULTS }); setActivePackName(undefined); saveActivePackId(undefined); }}>
            <AppIcon name="refresh" size={14} /> 恢复默认主题
          </Button>
        </div>
      </div>
    </Section>
  );
}

/* OKLCH(L*,C,H)→hex：与 design/theme.ts 内部同一公式（那里未导出 hex，这里复制最小实现并写明来源）。
   为什么不导出：hex 是主题模块的私有实现；设置界面只需要"预览用的同一公式"，
   漂移风险由 test/theme.test.mjs 的导出格式断言兜住（改内部必改测试）。 */
function rgbHex(lstar: number, c: number, hDeg: number): string {
  const L = (lstar + 16) / 116;
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h), b = c * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const f = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  return "#" + [f(r), f(g), f(bl)].map((v) => Math.round(Math.max(0, Math.min(255, v * 255))).toString(16).padStart(2, "0")).join("");
}

/* ── 显示分区（display-prefs 功能 1:1 迁入，含 ui-contract 契约的 testid/id）── */
/**
 * 结构与"主题"分区一致：**一组一卡**（Twenty PageCardLayout 同构）。
 * 2026-11-09 自审：上一版这里是一路裸列表，而同页的主题分区是卡 —— 同页两种结构是缺陷。
 * 契约保留：`data-testid="display-prefs"`、`#width` / `#font`、恢复默认按钮。
 */
function DisplaySection({ prefs, badges, viewport, onBadges, onChange, onReset, onBadgesReset }: {
  prefs: DisplayPrefs; badges?: BadgePrefs; viewport: number;
  onChange: (next: DisplayPrefs) => void; onReset: () => void;
  onBadges?: (next: BadgePrefs) => void; onBadgesReset?: () => void;
}) {
  return (
    <Section title="显示" desc="内容宽度、字号与状态徽标，立即生效、自动保存。数值写入 CSS 变量，不产生第二份数。">
      <div className="flex flex-col gap-4" data-testid="display-prefs">
        <Card title="内容宽度" hint="最左为专注（约 1/3 屏），最右为铺满">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-meta text-ink-700">当前</span>
            <span className="text-micro tabular-nums text-ink-500" data-testid="pref-value-width">
              {prefs.width.mode === "full" ? "铺满" : `${prefs.width.value}px`}
            </span>
          </div>
          <input id="width" data-testid="pref-slider-width" type="range" min={0} max={100} step={1}
            value={sliderFromWidth(prefs.width, viewport)} aria-label={widthLabel(prefs.width)}
            onChange={(e) => onChange({ ...prefs, width: widthFromSlider(Number(e.currentTarget.value), viewport) })}
            className="h-11 w-full cursor-pointer accent-accent sm:h-7" />
          {/* 端点提示是**文本**：tokens.css 头注明令 `ink-300` 只做分隔线/图标/装饰、禁止承载文本
              （对比度 2.6:1）。这里原来用 ink-300，axe 审计报了 color-contrast。 */}
          <div className="flex justify-between text-micro text-ink-500"><span>专注</span><span>铺满</span></div>
        </Card>

        <Card title="字号" hint="整组字阶等比缩放（micro 到 title 一起变），不改单个 px">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-meta text-ink-700">当前</span>
            <span className="text-micro tabular-nums text-ink-500" data-testid="pref-value-font">
              {Math.round(prefs.font.scale * 100)}%
            </span>
          </div>
          <input id="font" data-testid="pref-slider-font" type="range" min={0} max={100} step={1}
            value={sliderFromFont(prefs.font)} aria-label={fontLabel(prefs.font)}
            onChange={(e) => onChange({ ...prefs, font: fontFromSlider(Number(e.currentTarget.value)) })}
            className="h-11 w-full cursor-pointer accent-accent sm:h-7" />
          <div className="flex justify-between text-micro text-ink-500"><span>85%</span><span>200%</span></div>
        </Card>

        {badges !== undefined && onBadges !== undefined && (
          <Card title="状态徽标（运行 / 未读 / 失败）" hint="会话行与助手行的数字徽标、绿点红点与呼吸动画">
            {/* 预览一行三态：调下面的参数，这里的就是「当前会话里的实际样式」 */}
            <div data-testid="badge-preview" className="flex items-center gap-3 py-1">
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 bg-running-soft text-running text-micro font-medium leading-none tabular-nums animate-badge-breathe">1</span>
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 bg-success-soft text-success text-micro font-medium leading-none tabular-nums">3</span>
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 bg-danger-soft text-danger text-micro font-medium leading-none tabular-nums">1</span>
              <span className="h-1.5 w-1.5 rounded-full bg-running animate-dot-breathe" data-state-dot="running" />
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              <span className="h-1.5 w-1.5 rounded-full bg-danger" />
            </div>
            <div data-testid="set-row-badge-speed">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-meta text-ink-700">动画速率</span>
                <span className="text-micro tabular-nums text-ink-500" data-testid="pref-value-badge-speed">
                  {badges.speed.toFixed(1)}×（{badgePeriodS(badges.speed).toFixed(2)}s）
                </span>
              </div>
              <input id="badge-speed" data-testid="pref-slider-badge-speed" type="range" min={0.5} max={2.5} step={0.1}
                value={badges.speed} aria-label="动画速率"
                onChange={(e) => onBadges({ ...badges, speed: Number(e.currentTarget.value) })}
                className="h-11 w-full cursor-pointer accent-accent sm:h-7" />
            </div>
            <div data-testid="set-row-badge-amp">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-meta text-ink-700">呼吸幅度</span>
                <span className="text-micro tabular-nums text-ink-500" data-testid="pref-value-badge-amp">
                  {Math.round(badges.amplitude * 100)}%（徽标 {badgeBreatheMax(badges.amplitude).toFixed(2)} · 点 {dotBreatheMax(badges.amplitude).toFixed(2)}）
                </span>
              </div>
              <input id="badge-amp" data-testid="pref-slider-badge-amp" type="range" min={0} max={100} step={1}
                value={Math.round(badges.amplitude * 100)} aria-label="呼吸幅度"
                onChange={(e) => onBadges({ ...badges, amplitude: Number(e.currentTarget.value) / 100 })}
                className="h-11 w-full cursor-pointer accent-accent sm:h-7" />
              <div className="flex justify-between text-micro text-ink-500"><span>静止</span><span>v5（默认）</span></div>
            </div>
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="配色强度">
              {(["soft", "standard", "vivid"] as const).map((strengthValue) => (
                <ToggleChip key={strengthValue} role="radio" aria-checked={badges.strength === strengthValue}
                  pressed={badges.strength === strengthValue}
                  data-testid={`badge-strength-${strengthValue}`}
                  onClick={() => onBadges({ ...badges, strength: strengthValue as BadgeStrength })}>
                  {strengthValue === "soft" ? "柔和" : strengthValue === "standard" ? "标准" : "鲜明"}
                </ToggleChip>
              ))}
            </div>
            <div>
              <Button variant="ghost" size="sm" onClick={onBadgesReset}>
                <AppIcon name="refresh" size={14} /> 徽标恢复默认
              </Button>
            </div>
          </Card>
        )}
        <div>
          <Button variant="ghost" size="sm" onClick={onReset}><AppIcon name="refresh" size={14} /> 恢复默认</Button>
        </div>
      </div>
    </Section>
  );
}

/* ── 表面 ── */

/** 「交互」节（Task 0018）：选中行为设置。 */
function InteractionSection({ selection, onChange }: { selection: SelectionPrefs; onChange: (next: SelectionPrefs) => void }) {
  return (
    <Section title="交互" desc="选中文字后的行为。改动立即生效、自动保存。">
      <div className="flex flex-col gap-4" data-testid="interaction-prefs">
        <Card title="选中文字后自动复制" hint="开启：松手即复制并提示「已复制 · N 字」；关闭：松手弹出功能条，点「复制」才复制。">
          <label className="chk flex items-center gap-2 text-meta text-ink-700" data-testid="pref-copy-on-select">
            <input type="checkbox" checked={selection.copyOnSelect} aria-label="选中文字后自动复制"
              onChange={(e) => onChange({ ...selection, copyOnSelect: e.currentTarget.checked })} />
            选中后自动复制
          </label>
        </Card>
      </div>
    </Section>
  );
}

export function SettingsSurface({ section, onSection, theme, onTheme, prefs, badges, viewport, onPrefs, onPrefsReset, onBadges, onBadgesReset, selection, onSelection, onClose }: {
  section: SectionKey; onSection: (k: SectionKey) => void;
  theme: ThemeState; onTheme: (next: ThemeState) => void;
  prefs: DisplayPrefs; viewport: number; onPrefs: (next: DisplayPrefs) => void; onPrefsReset: () => void;
  badges?: BadgePrefs; onBadges?: (next: BadgePrefs) => void; onBadgesReset?: () => void;
  /** 选中行为（Task 0018 D7-D10）。 */
  selection: SelectionPrefs; onSelection: (next: SelectionPrefs) => void;
  onClose: () => void;
}) {
  // Esc 关闭（与模态同规）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // 每个分区一个不同图标（旧版"显示"与"动效"共用 IconWand，实测是视觉噪音）
  const icons: Record<SectionKey, React.ReactNode> = {
    appearance: <AppIcon name="palette" size={16} />, display: <AppIcon name="adjustments-horizontal" size={16} />, interaction: <AppIcon name="wand" size={16} />, motion: <AppIcon name="wand" size={16} />,
    language: <AppIcon name="language" size={16} />, models: <AppIcon name="plug" size={16} />, notify: <AppIcon name="bell" size={16} />, about: <AppIcon name="info" size={16} />,
  };
  return (
    <div className={`absolute inset-0 ${LAYER_CLASS.drawer} flex flex-col bg-surface sm:flex-row`}
      data-testid="settings-surface" role="region" aria-label="设置">
      {/*
        * 手机顶部条：**必须有可见的关闭入口**（2026-11-09 审核发现：手机上既没有图标轨、
        * 也没有 Esc，设置一开就没有任何出口，且内容被 230px 导航挤成 160px）。
        * 桌面不渲染它：桌面设置是 tab（rail 再点一次退出），加返回/关闭就成了"浮层"语义
        * （layout-model §1.2-2 明令禁止跨 tab 浮层）。
        */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-2 sm:hidden">
        <IconButton label="关闭设置" onClick={onClose}><AppIcon name="x" size={18} /></IconButton>
        <span className="text-body font-semibold text-ink-900">设置</span>
      </header>
      {/* 分区导航（数据驱动）：手机横向条 / 桌面 230 纵栏（同一份数据，两种排布） */}
      <nav aria-label="设置分区"
        className="settings-nav flex-none border-b border-line bg-nav-bg p-2 max-sm:overflow-x-auto sm:overflow-y-auto sm:border-b-0 sm:border-r">
        <div className="flex items-center gap-1 sm:flex-col sm:items-stretch sm:gap-0">
          {SECTIONS.map((g) => (
            <div key={g.g} className="flex items-center gap-1 sm:block">
              {/* 分组标题只在桌面出现：手机横排没有"组"这个概念 */}
              <div className="px-2 pb-1 pt-3 text-micro font-semibold tracking-wide text-nav-muted max-sm:hidden">{g.g}</div>
              {g.items.map((it) => (
                <button key={it.k} type="button"
                  /*
                   * 命中区（Task 0016 · P7-S3）：手机 44 / 桌面 36。
                   * 改之前 `h-9`（36px）——实测分区 Tab 在手机上 **68×36**，低于 44。
                   */
                  className={`relative flex h-11 shrink-0 items-center gap-2 rounded-control px-2 text-left text-body transition-colors sm:h-9 ${
                    section === it.k
                      // 选中态文字用 ink-900（accent 在 nav-bg 上只有 4.33，不到 AA 4.5）；
                      // 强调交给左侧 2px 指示条 —— 颜色是稀缺信号，不该由文字颜色承担
                      ? "font-semibold text-ink-900 max-sm:bg-surface"
                      : "text-ink-700 hover:bg-nav-accent"} sm:w-full`}
                  aria-current={section === it.k ? "page" : undefined}
                  onClick={() => onSection(it.k)}>
                  {/* 激活指示条：2px、贴左缘、上下内缩（Hoppscotch TabsNav.vue:78-90 的内缩手法，竖向变体）。
                      手机上导航是横排，左缘指示条没有意义 → 只在桌面出现。 */}
                  {section === it.k && (
                    <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent max-sm:hidden"
                      style={{ transition: "transform var(--motion-indicator), opacity var(--motion-indicator)" }} />
                  )}
                  {icons[it.k]}
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <p className="px-2 pt-4 text-micro leading-relaxed text-nav-muted max-sm:hidden">
          规划中：{PLANNED_SECTIONS}
        </p>
      </nav>
      {/* 内容区 */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full px-4 py-6 sm:px-8 sm:py-8" style={{ maxWidth: "var(--container-settings)" }}>
          {section === "appearance" && <AppearanceSection theme={theme} onChange={onTheme} />}
          {section === "interaction" && <InteractionSection selection={selection} onChange={onSelection} />}
          {section === "display" && <DisplaySection prefs={prefs} badges={badges} viewport={viewport}
            onChange={onPrefs} onReset={onPrefsReset} onBadges={onBadges} onBadgesReset={onBadgesReset} />}
        </div>
      </div>
    </div>
  );
}

/* ── 主题选择器（Popover 模式）────────────────────────────────────────
 * 一个按钮显示当前主题名 + 色带；点击弹出完整列表（每主题：色带 + 名字 + 来源）。
 * 对标 VSCode theme picker / Astryx ThemeSwitcher——不是并排卡片挤一行。 */
function ThemeSelector({ themes, activeId, onSelect }: {
  themes: Array<{ kind: "preset" | "external"; name: string; id: string; colors: string[] }>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = themes.find((t) => t.id === activeId) ?? themes[0];
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-control border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-nav-muted">
        <span className="flex h-6 w-10 shrink-0 overflow-hidden rounded-inner border border-line" aria-hidden>
          {(active?.colors ?? ["var(--color-line)", "var(--color-line)", "var(--color-line)", "var(--color-line)"]).map((c, i) => <i key={i} className="flex-1" style={{ background: c }} />)}
        </span>
        <span className="min-w-0 flex-1 truncate text-body text-ink-900">{active?.name ?? "选择主题"}</span>
        <AppIcon name="chevron-down" size={14} className="shrink-0 text-ink-300" />
      </button>
      {open && (
        <div className="absolute mt-1 w-full rounded-panel border border-line bg-surface"
          style={{ boxShadow: "var(--surface-popover)", zIndex: "var(--z-popover)", maxHeight: "280px", overflowY: "auto" }}>
          {themes.map((t) => (
            <ClickableRow key={t.id}
              className={`gap-3 px-3 py-2 ${t.id === activeId ? "bg-nav-selected" : ""}`}
              onClick={() => { onSelect(t.id); setOpen(false); }}>
              <span className="flex h-5 w-9 shrink-0 overflow-hidden rounded-inner border border-line" aria-hidden>
                {t.colors.map((c, i) => <i key={i} className="flex-1" style={{ background: c }} />)}
              </span>
              <span className="min-w-0 flex-1 truncate text-body text-ink-900">{t.name}</span>
              {t.kind === "external" && <span className="shrink-0 text-micro text-ink-300">外部</span>}
              {t.id === activeId && <AppIcon name="check" size={14} className="shrink-0 text-accent" />}
            </ClickableRow>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 外部主题导入卡（Task 0015 · B1）────────────────────────────────────
 * 粘贴 VSCode JSON 或 Obsidian CSS → 转译 → 校验报告 → 预览（即时生效）→ 保存。
 * 用户可基于内置主题自定义（切深浅 → 预览）→ "保存为我的主题" 存档。
 */
function ExternalThemeCard({ theme, onTheme, packs, onPacksChange }: { theme: ThemeState; onTheme: (next: ThemeState) => void; packs: ThemePack[]; onPacksChange: (next: ThemePack[]) => void }) {
  const [pasted, setPasted] = useSt("");
  const [activeId, setActiveId] = useSt<string | undefined>(() => loadActivePackId());
  const [report, setReport] = useSt<{ name: string; ok: boolean; summary: string } | undefined>();

  async function importPasted() {
    const text = pasted.trim();
    if (text === "") return;
    let pack: ThemePack;
    try {
      if (text.startsWith("{")) {
        const json = JSON.parse(text);
        // VSCode：种子提取 + 引擎再生（不是逐域映射——覆盖全族 59 个变量）
        const seed = extractVscodeSeed(json, "用户导入");
        const fullSeed = { ...THEME_DEFAULTS, ...seed.themeState } as ThemeState;
        const generated = calculatePalette(fullSeed);
        const vars: Record<string, string> = {};
        // 从引擎 Palette 生成全族变量值
        for (const [varName, key] of VAR_MAP) {
          const v = generated[key as keyof typeof generated];
          if (v) {
            // OKLCH → hex（简化：用 theme.ts 内部的 hex 函数不可直接调——用 rgbHex 替代）
            vars[varName] = rgbHex(v[0], v[1], v[2]);
          }
        }
        pack = {
          kind: "lifeos-theme-pack", version: 1,
          meta: { name: json.name ?? "未命名 VSCode 主题", source: "vscode", sourceRef: "用户导入" },
          modes: { [seed.themeState.mode]: vars } as ThemePack["modes"],
          seedThemeState: fullSeed,
        };
      } else {
        const result = translateObsidianTheme(text, "用户导入", "用户导入的 Obsidian 主题");
        pack = result.pack;
      }
    } catch (e) {
      setReport({ name: "解析失败", ok: false, summary: String(e).slice(0, 120) });
      return;
    }
    const r = validateThemePack(pack);
    const summary = r.ok
      ? `覆盖：light ${r.coverage.light} / dark ${r.coverage.dark}（共 ${r.coverage.total}）` + (r.contrastChecks.some(c => !c.pass) ? "（部分对比度警告）" : "")
      : r.issues.filter(i => i.level === "error").map(i => i.message.slice(0, 80)).join("；");
    setReport({ name: pack.meta.name, ok: r.ok, summary });
    if (r.ok) {
      const all = [...packs.filter(p => p.meta.name !== pack.meta.name), pack];
      onPacksChange(all);
      setPasted("");
      // 立即应用——**直接写 :root CSS 变量**（绕过 React 状态流，所见即所得）
      // 原理：外部主题的变量覆盖在引擎值之上；刷新后引擎恢复默认（后续接持久化）。
      const applyPackDirect = (p: ThemePack) => {
        const mode = p.modes.dark && Object.keys(p.modes.dark).length > 0 ? "dark" : "light";
        const vars = p.modes[mode] ?? {};
        const root = document.documentElement.style;
        for (const [k, v] of Object.entries(vars)) {
          if (typeof v === "string" && v.startsWith("#")) root.setProperty(k, v);
        }
        document.documentElement.dataset.themeMode = mode;
      };
      if (pack.seedThemeState !== undefined) {
        // VSCode 种子：用引擎 calculatePalette 从种子参数生成全族变量再写 :root
        const fullSeed = { ...THEME_DEFAULTS, ...pack.seedThemeState } as ThemeState;
        const generated = calculatePalette(fullSeed);
        const root = document.documentElement.style;
        for (const [varName, key] of VAR_MAP) {
          const v = generated[key as keyof typeof generated];
          if (v) root.setProperty(varName, rgbHex(v[0], v[1], v[2]));
        }
        document.documentElement.dataset.themeMode = pack.seedThemeState.mode ?? "dark";
      } else {
        applyPackDirect(pack);
      }
    }
  }

  return (
    <Card title="外部主题（VSCode / Obsidian）" hint="粘贴 JSON 或 CSS → 转译 → 预览 → 保存。基于内置主题自定义：先切深浅再预览。">
      <div className="flex flex-col gap-3">
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder={'粘贴 VSCode 主题 JSON 或 Obsidian CSS…'}
          className="min-h-16 w-full resize-y rounded-control bg-sunken px-2 py-1.5 text-micro text-ink-900 ring-1 ring-line placeholder:text-ink-300 focus:outline-none focus:ring-accent"
          rows={3}
        />
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={importPasted} disabled={pasted.trim() === ""}>导入并校验</Button>
          {report !== undefined && (
            <span className={`text-micro ${report.ok ? "text-success" : "text-danger"}`}>
              {report.name}：{report.summary}
            </span>
          )}
        </div>
        {/* 已保存主题的切换在上面的统一列表里（一个口子），这里只负责导入 */}
      </div>
    </Card>
  );
}

/* ── 字体与图标集（S3）──────────────────────────────────────────────
 * 字体：写到 --font-sans/--font-mono（主题包 fonts 槽）。
 * 图标集：派发 lifeos:icon-set 事件（main.tsx 的 Root 监听并切 Context）+ 写进主题包 icons 槽。
 */
const FONT_CHOICES = [
  { id: "system", label: "系统默认", sans: undefined, note: "Inter / PingFang（默认，零加载成本）" },
  { id: "serif-cjk", label: "宋体优先", sans: "\"Songti SC\", \"SimSun\", Georgia, serif", note: "中文衬线，阅读感更接近纸面" },
  { id: "hei-cjk", label: "黑体优先", sans: "\"PingFang SC\", \"Microsoft YaHei\", \"Helvetica Neue\", sans-serif", note: "中文无衬线，屏幕可读性优先" },
  { id: "mono-ui", label: "等宽优先", sans: "ui-monospace, SFMono-Regular, Menlo, monospace", note: "整站等宽（实验性）" },
] as const;

function TypographyAndIconCard({ theme, onTheme }: { theme: ThemeState; onTheme: (next: ThemeState) => void }) {
  const [fontId, setFontId] = useSt<string>(() => {
    try { return localStorage.getItem("lifeos.fontId") ?? "system"; } catch { return "system"; }
  });
  const [iconSet, setIconSetState] = useSt<IconSetId>(() => {
    try { return (localStorage.getItem("lifeos.iconSet") as IconSetId) ?? "tabler"; } catch { return "tabler"; }
  });

  function applyFont(id: string) {
    setFontId(id);
    try { localStorage.setItem("lifeos.fontId", id); } catch { /* 隐私模式 */ }
    const choice = FONT_CHOICES.find((f) => f.id === id);
    const root = document.documentElement.style;
    if (choice?.sans === undefined) {
      root.removeProperty("--font-sans");
    } else {
      root.setProperty("--font-sans", choice.sans);
    }
  }

  function applyIconSet(id: IconSetId) {
    setIconSetState(id);
    window.dispatchEvent(new CustomEvent("lifeos:icon-set", { detail: id }));
  }

  const coverage = iconSetCoverage();

  return (
    <Card title="字体与图标" hint="字体与图标集也是主题的一部分（写进主题包的 fonts / icons 槽）。">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-meta font-medium text-ink-700">字体</span>
          <div className="flex flex-wrap gap-2">
            {FONT_CHOICES.map((f) => (
              <ToggleChip key={f.id} shape="card" pressed={fontId === f.id} onClick={() => applyFont(f.id)}>
                <span className="block font-medium">{f.label}</span>
                <span className="block text-micro text-ink-500">{f.note}</span>
              </ToggleChip>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-meta font-medium text-ink-700">图标集</span>
          <Segmented
            value={iconSet}
            options={(Object.keys(ICON_SET_LABELS) as IconSetId[]).map((id) => ({ value: id, label: ICON_SET_LABELS[id] }))}
            onChange={(id) => applyIconSet(id as IconSetId)}
          />
          <div className="flex items-center gap-3 rounded-control bg-sunken px-3 py-2">
            {(["settings", "folder", "trash", "check", "pencil", "info"] as IconName[]).map((name) => (
              <AppIcon key={name} name={name} size={16} className="text-ink-700" />
            ))}
            <span className="text-micro text-ink-500">
              {coverage[iconSet].missing.length === 0
                ? `${coverage[iconSet].total} 个语义名全部覆盖`
                : `${coverage[iconSet].missing.length} 个语义名该集缺失（回退 Tabler）`}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
