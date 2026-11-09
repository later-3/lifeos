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
import { useEffect, useMemo } from "react";
import {
  IconAdjustmentsHorizontal, IconCheck, IconLanguage, IconPalette, IconRefresh,
  IconBell, IconPlug, IconInfoCircle, IconWand, IconX,
} from "@tabler/icons-react";
import {
  PRESET_LABELS, THEME_DEFAULTS, THEME_PRESETS, calculatePalette, contrastOf,
  type ThemePreset, type ThemeState,
} from "./design/theme";
import {
  fontFromSlider, fontLabel, sliderFromFont, sliderFromWidth, widthFromSlider, widthLabel,
  type DisplayPrefs,
} from "./display-prefs";
import { Button, IconButton } from "./design/ui";
import { LAYER_CLASS } from "./design/surface";

/* ── 分区注册表（数据驱动；新板块加一条即可）── */
type SectionKey = "appearance" | "display" | "motion" | "language" | "models" | "notify" | "about";

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
  { g: "外观", items: [{ k: "appearance", label: "主题" }, { k: "display", label: "显示" }] },
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
  /** 预设卡迷你预览：轨 / 列 / 内容 / 主色 四段（与右侧实际生效值同源同公式）。 */
  const previewColors = (name: ThemePreset) => {
    const p = calculatePalette({ ...THEME_DEFAULTS, ...THEME_PRESETS[name], preset: name, mode: theme.mode });
    return [p.navEdge, p.navBg, p.surface, p.accentSolid].map(([l, c, h]) => rgbHex(l, c, h));
  };
  return (
    <Section title="主题" desc="预设与深浅色即时生效；主色与底色台阶可微调。改动持久化到本浏览器。">
      <div className="flex flex-col gap-4">
        <Card title="外观模式" hint="深色由同一套语义公式派生，不是第二套手挑值">
          <div className="flex items-center justify-between gap-3">
            <span className="text-meta text-ink-700">深浅色</span>
            <span className="mode-seg" role="radiogroup" aria-label="深浅色">
              <button type="button" className={theme.mode === "light" ? "on" : ""} aria-pressed={theme.mode === "light"}
                onClick={() => set({ mode: "light" })}>浅色</button>
              <button type="button" className={theme.mode === "dark" ? "on" : ""} aria-pressed={theme.mode === "dark"}
                onClick={() => set({ mode: "dark" })}>深色</button>
            </span>
          </div>
        </Card>

        <Card title="主题预设" hint="一套预设 = 一组主色与中性色；点卡片立即换">
          <div className="swatch-row" role="radiogroup" aria-label="主题预设">
            {(Object.keys(THEME_PRESETS) as ThemePreset[]).map((name) => {
              const colors = previewColors(name);
              const on = theme.preset === name;
              return (
                <button key={name} type="button" role="radio" aria-checked={on}
                  className={`swatch ${on ? "on" : ""}`} data-preset={name}
                  onClick={() => pickPreset(name)}>
                  <span className="prev" aria-hidden>{colors.map((c, i) => <i key={i} style={{ background: c }} />)}</span>
                  <span className="nm">{PRESET_LABELS[name]}</span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card title="主色" hint="默认近黑（最安静）；选了色相后中性色会跟着走，两个色系读成一个 palette">
          <div className="accent-dots">
            {ACCENT_DOTS.map((d) => {
              const on = theme.accentH === d.h && theme.accentC === d.c;
              const bg = rgbHex(theme.mode === "dark" ? 60 : 52, (d.c / 100) * 0.22, d.h);
              return (
                <button key={d.label} type="button" title={d.label} aria-label={`主色 ${d.label}`} aria-pressed={on}
                  className={`accent-dot ${on ? "on" : ""}`} style={{ background: bg }}
                  onClick={() => set({ accentH: d.h, accentC: d.c })}>
                  {on ? <IconCheck size={14} /> : null}
                </button>
              );
            })}
          </div>
          <SetSlider id="theme-accent-h" label="色相" min={0} max={360} step={1} value={theme.accentH}
            onChange={(v) => set({ accentH: v })} format={(v) => `${v}°`} />
          <SetSlider id="theme-accent-c" label="饱和" min={0} max={100} step={1} value={theme.accentC}
            onChange={(v) => set({ accentC: v })} format={(v) => (v === 0 ? "灰" : `${v}%`)} />
          <label className="chk flex items-center gap-2 text-meta text-ink-700">
            <input type="checkbox" checked={theme.lockNeutral} aria-label="中性色相跟随主色"
              onChange={(e) => set({ lockNeutral: e.currentTarget.checked })} />
            中性色相跟随主色
          </label>
        </Card>

        <Card title="底色台阶（L*）" hint="四档深度：内容 / 列 / 图标轨 / 边界线。台阶差决定「分层」是否看得见">
          <SetSlider id="theme-l-surface" label="内容" min={88} max={100} step={0.5} value={theme.lSurface} onChange={(v) => set({ lSurface: v })} format={(v) => v.toFixed(1)} />
          <SetSlider id="theme-l-nav" label="列" min={88} max={100} step={0.5} value={theme.lNav} onChange={(v) => set({ lNav: v })} format={(v) => v.toFixed(1)} />
          <SetSlider id="theme-l-rail" label="图标轨" min={84} max={100} step={0.5} value={theme.lRail} onChange={(v) => set({ lRail: v })} format={(v) => v.toFixed(1)} />
          <SetSlider id="theme-l-line" label="边界线" min={72} max={100} step={0.5} value={theme.lLine} onChange={(v) => set({ lLine: v })} format={(v) => v.toFixed(1)} />
          {/* 实时读数：调参时知道自己越线没有（<4.5 标红） */}
          <div className="rounded-control bg-sunken px-3 py-2 text-micro text-ink-500" data-testid="theme-readout">
            <span>列→内容 ΔL* {Math.abs(palette.surface[0] - palette.navBg[0]).toFixed(1)} · </span>
            <span>轨→列 ΔL* {Math.abs(palette.navBg[0] - palette.navEdge[0]).toFixed(1)} · </span>
            <span>悬停 ΔL* {Math.abs(palette.navBg[0] - palette.navAccent[0]).toFixed(1)} · </span>
            <span>选中 ΔL* {Math.abs(palette.navBg[0] - palette.navSelected[0]).toFixed(1)} · </span>
            <span className={contrastOf(palette.navMuted, palette.navSelected) < 4.5 ? "text-danger" : ""}>
              副行/选中 {contrastOf(palette.navMuted, palette.navSelected).toFixed(2)}:1
            </span>
          </div>
        </Card>

        <div>
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...THEME_DEFAULTS })}>
            <IconRefresh size={14} /> 恢复默认主题
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
function DisplaySection({ prefs, viewport, onChange, onReset }: {
  prefs: DisplayPrefs; viewport: number;
  onChange: (next: DisplayPrefs) => void; onReset: () => void;
}) {
  return (
    <Section title="显示" desc="内容宽度与字号，立即生效、自动保存。数值写入 CSS 变量，不产生第二份数。">
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
          <div className="flex justify-between text-micro text-ink-300"><span>专注</span><span>铺满</span></div>
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
          <div className="flex justify-between text-micro text-ink-300"><span>85%</span><span>200%</span></div>
        </Card>

        <div>
          <Button variant="ghost" size="sm" onClick={onReset}><IconRefresh size={14} /> 恢复默认</Button>
        </div>
      </div>
    </Section>
  );
}

/* ── 表面 ── */
export function SettingsSurface({ section, onSection, theme, onTheme, prefs, viewport, onPrefs, onPrefsReset, onClose }: {
  section: SectionKey; onSection: (k: SectionKey) => void;
  theme: ThemeState; onTheme: (next: ThemeState) => void;
  prefs: DisplayPrefs; viewport: number; onPrefs: (next: DisplayPrefs) => void; onPrefsReset: () => void;
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
    appearance: <IconPalette size={16} />, display: <IconAdjustmentsHorizontal size={16} />, motion: <IconWand size={16} />,
    language: <IconLanguage size={16} />, models: <IconPlug size={16} />, notify: <IconBell size={16} />, about: <IconInfoCircle size={16} />,
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
        <IconButton label="关闭设置" onClick={onClose}><IconX size={18} /></IconButton>
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
                  className={`relative flex h-9 shrink-0 items-center gap-2 rounded-control px-2 text-left text-body transition-colors ${
                    section === it.k
                      ? "font-semibold text-accent max-sm:bg-surface"
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
          {section === "display" && <DisplaySection prefs={prefs} viewport={viewport} onChange={onPrefs} onReset={onPrefsReset} />}
        </div>
      </div>
    </div>
  );
}
