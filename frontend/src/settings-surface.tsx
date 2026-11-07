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
  IconArrowLeft, IconCheck, IconLanguage, IconMoon, IconPalette, IconRefresh,
  IconBell, IconPlug, IconInfoCircle, IconWand,
} from "@tabler/icons-react";
import {
  PRESET_LABELS, THEME_DEFAULTS, THEME_PRESETS, calculatePalette, contrastOf,
  type ThemePreset, type ThemeState,
} from "./design/theme";
import {
  fontFromSlider, fontLabel, sliderFromFont, sliderFromWidth, widthFromSlider, widthLabel,
  type DisplayPrefs,
} from "./display-prefs";
import { Button } from "./design/ui";

/* ── 分区注册表（数据驱动；新板块加一条即可）── */
type SectionKey = "appearance" | "display" | "motion" | "language" | "models" | "notify" | "about";
const SECTIONS: Array<{ g: string; items: Array<{ k: SectionKey; label: string }> }> = [
  { g: "外观", items: [{ k: "appearance", label: "主题" }, { k: "display", label: "显示" }, { k: "motion", label: "动效" }] },
  { g: "系统", items: [{ k: "language", label: "语言" }, { k: "models", label: "模型" }, { k: "notify", label: "通知" }, { k: "about", label: "关于" }] },
];
const SECTION_TITLES: Record<SectionKey, string> = {
  appearance: "主题", display: "显示", motion: "动效", language: "语言", models: "模型", notify: "通知", about: "关于",
};

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
      <h2 className="text-title font-semibold text-ink-900">{title}</h2>
      <p className="mb-5 mt-1 text-meta text-ink-500">{desc}</p>
      {children}
    </div>
  );
}

/** 占位分区：控件禁用 + 一句"待实现"（不渲染假数据）。 */
function Placeholder({ note }: { note: string }) {
  return (
    <div className="rounded-panel border border-line bg-sunken px-4 py-6 text-center">
      <p className="text-body text-ink-700">该分区的配置项还没实现</p>
      <p className="mt-1 text-micro text-ink-500">{note}</p>
    </div>
  );
}

/* ── 外观分区（真可用）── */
function AppearanceSection({ theme, onChange }: { theme: ThemeState; onChange: (next: ThemeState) => void }) {
  const palette = useMemo(() => calculatePalette(theme), [theme]);
  const set = (patch: Partial<ThemeState>) => onChange({ ...theme, ...patch });
  const pickPreset = (name: ThemePreset) => set({ ...THEME_PRESETS[name], preset: name });
  const previewColors = (name: ThemePreset) => {
    // 每张预设卡一个迷你预览：轨 / 列 / 内容 / accent 四段（demo 同款）
    const p = calculatePalette({ ...THEME_DEFAULTS, ...THEME_PRESETS[name], preset: name, mode: theme.mode });
    const hexs = [p.navEdge, p.navBg, p.surface, p.accentSolid].map(([l, c, h]) => {
      // 复用 theme 内部的 hex？它未导出——这里用 palette 值直接拼（计算同源：OKLCH→sRGB）
      return rgbHex(l, c, h);
    });
    return hexs;
  };
  return (
    <Section title="主题" desc="预设与深浅色即时生效；主色与底色台阶可微调。改动持久化到本浏览器。">
      {/* 深浅色 */}
      <div className="theme-row">
        <span><span className="lab text-meta text-ink-900">深浅色</span><br />
          <span className="text-micro text-ink-500">深色由同一套语义公式派生，不是第二套手挑值</span></span>
        <span className="mode-seg" role="radiogroup" aria-label="深浅色">
          <button type="button" className={theme.mode === "light" ? "on" : ""} aria-pressed={theme.mode === "light"}
            onClick={() => set({ mode: "light" })}>浅色</button>
          <button type="button" className={theme.mode === "dark" ? "on" : ""} aria-pressed={theme.mode === "dark"}
            onClick={() => set({ mode: "dark" })}>深色</button>
        </span>
      </div>
      {/* 预设卡 */}
      <h3 className="mb-2 mt-4 text-body font-semibold text-ink-900">主题预设</h3>
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
      {/* 主色 */}
      <h3 className="mb-2 mt-4 text-body font-semibold text-ink-900">主色</h3>
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
      <div className="mt-3">
        <SetSlider id="theme-accent-h" label="色相" min={0} max={360} step={1} value={theme.accentH}
          onChange={(v) => set({ accentH: v })} format={(v) => `${v}°`} />
        <SetSlider id="theme-accent-c" label="饱和" min={0} max={100} step={1} value={theme.accentC}
          onChange={(v) => set({ accentC: v })} format={(v) => (v === 0 ? "灰" : `${v}%`)} />
        <label className="chk flex items-center gap-2 text-meta text-ink-700">
          <input type="checkbox" checked={theme.lockNeutral} aria-label="中性色相跟随主色"
            onChange={(e) => set({ lockNeutral: e.currentTarget.checked })} />
          中性色相跟随主色
        </label>
      </div>
      {/* 底色台阶 */}
      <h3 className="mb-2 mt-4 text-body font-semibold text-ink-900">底色台阶（L*）</h3>
      <SetSlider id="theme-l-surface" label="内容" min={88} max={100} step={0.5} value={theme.lSurface} onChange={(v) => set({ lSurface: v })} format={(v) => v.toFixed(1)} />
      <SetSlider id="theme-l-nav" label="列" min={88} max={100} step={0.5} value={theme.lNav} onChange={(v) => set({ lNav: v })} format={(v) => v.toFixed(1)} />
      <SetSlider id="theme-l-rail" label="图标轨" min={84} max={100} step={0.5} value={theme.lRail} onChange={(v) => set({ lRail: v })} format={(v) => v.toFixed(1)} />
      <SetSlider id="theme-l-line" label="边界线" min={72} max={100} step={0.5} value={theme.lLine} onChange={(v) => set({ lLine: v })} format={(v) => v.toFixed(1)} />
      {/* 实时读数（demo 同款：调参时知道自己越线没有） */}
      <div className="mt-3 rounded-panel border border-line px-4 py-3 text-micro text-ink-500" data-testid="theme-readout">
        <span>列→内容 ΔL* {Math.abs(palette.surface[0] - palette.navBg[0]).toFixed(1)} · </span>
        <span>轨→列 ΔL* {Math.abs(palette.navBg[0] - palette.navEdge[0]).toFixed(1)} · </span>
        <span>悬停 ΔL* {Math.abs(palette.navBg[0] - palette.navAccent[0]).toFixed(1)} · </span>
        <span>选中 ΔL* {Math.abs(palette.navBg[0] - palette.navSelected[0]).toFixed(1)} · </span>
        <span className={contrastOf(palette.navMuted, palette.navSelected) < 4.5 ? "text-danger" : ""}>
          副行/选中 {contrastOf(palette.navMuted, palette.navSelected).toFixed(2)}:1
        </span>
      </div>
      <div className="mt-4">
        <Button variant="ghost" size="sm" onClick={() => onChange({ ...THEME_DEFAULTS })}>
          <IconRefresh size={14} /> 恢复默认主题
        </Button>
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
function DisplaySection({ prefs, viewport, onChange, onReset }: {
  prefs: DisplayPrefs; viewport: number;
  onChange: (next: DisplayPrefs) => void; onReset: () => void;
}) {
  return (
    <Section title="显示" desc="内容宽度与字号，立即生效、自动保存。">
      <div data-testid="display-prefs" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5" data-testid="pref-row-width">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="width" className="text-meta text-ink-700">内容宽度</label>
            <span className="text-micro tabular-nums text-ink-500" data-testid="pref-value-width">{widthLabel(prefs.width)}</span>
          </div>
          <input id="width" data-testid="pref-slider-width" type="range" min={0} max={100} step={1}
            value={sliderFromWidth(prefs.width, viewport)} aria-label={widthLabel(prefs.width)}
            onChange={(e) => onChange({ ...prefs, width: widthFromSlider(Number(e.currentTarget.value), viewport) })}
            className="h-11 w-full cursor-pointer accent-accent sm:h-6" />
          <div className="flex justify-between text-micro text-ink-300"><span>专注（约 1/3 屏）</span><span>铺满</span></div>
        </div>
        <div className="flex flex-col gap-1.5" data-testid="pref-row-font">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="font" className="text-meta text-ink-700">字号</label>
            <span className="text-micro tabular-nums text-ink-500" data-testid="pref-value-font">{fontLabel(prefs.font)}</span>
          </div>
          <input id="font" data-testid="pref-slider-font" type="range" min={0} max={100} step={1}
            value={sliderFromFont(prefs.font)} aria-label={fontLabel(prefs.font)}
            onChange={(e) => onChange({ ...prefs, font: fontFromSlider(Number(e.currentTarget.value)) })}
            className="h-11 w-full cursor-pointer accent-accent sm:h-6" />
          <div className="flex justify-between text-micro text-ink-300"><span>85%</span><span>200%</span></div>
        </div>
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
  const icons: Record<SectionKey, React.ReactNode> = {
    appearance: <IconPalette size={16} />, display: <IconWand size={16} />, motion: <IconWand size={16} />,
    language: <IconLanguage size={16} />, models: <IconPlug size={16} />, notify: <IconBell size={16} />, about: <IconInfoCircle size={16} />,
  };
  return (
    <div className="absolute inset-0 z-30 flex bg-surface" data-testid="settings-surface" role="region" aria-label="设置">
      {/* 分区导航（数据驱动） */}
      <nav aria-label="设置分区" className="w-52 flex-none overflow-y-auto border-r border-line bg-nav-bg p-2">
        {SECTIONS.map((g) => (
          <div key={g.g}>
            <div className="px-2 pb-1 pt-3 text-micro font-semibold tracking-wide text-nav-muted first:pt-1">{g.g}</div>
            {g.items.map((it) => (
              <button key={it.k} type="button"
                className={`flex h-9 w-full items-center gap-2 rounded-control px-2 text-left text-body transition-colors ${
                  section === it.k ? "bg-nav-selected font-medium text-ink-900" : "text-ink-700 hover:bg-nav-accent"}`}
                aria-current={section === it.k ? "true" : undefined}
                onClick={() => onSection(it.k)}>
                {icons[it.k]}
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      {/* 内容区 */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-8">
          <div className="mb-6 flex items-center gap-2">
            <button type="button" className="flex items-center gap-1.5 rounded-control px-2 py-1.5 text-meta text-ink-700 hover:bg-hover"
              onClick={onClose} aria-label="关闭设置">
              <IconArrowLeft size={16} /> 返回对话
            </button>
            <IconMoon size={14} className="ml-auto text-ink-300" aria-hidden />
          </div>
          {section === "appearance" && <AppearanceSection theme={theme} onChange={onTheme} />}
          {section === "display" && <DisplaySection prefs={prefs} viewport={viewport} onChange={onPrefs} onReset={onPrefsReset} />}
          {section === "motion" && <Section title="动效" desc="动画时长、呼吸幅度等演示参数。"><Placeholder note="规划中：动效板块将迁入 animlab 已调定的参数（Task 0007 登记）。" /></Section>}
          {section === "language" && <Section title="语言" desc="界面显示语言。"><Placeholder note="规划中：当前界面文案为中文；多语言待国际化需求成立时实现。" /></Section>}
          {section === "models" && <Section title="模型" desc="模型与凭据在「助手配置」中按助手分别设置；此处为全局默认（待实现）。"><Placeholder note="规划中：全局默认模型目前由 ~/.lifeos/config/models.json 管理，界面管理待后端接口。" /></Section>}
          {section === "notify" && <Section title="通知" desc="后台完成提醒、推送。"><Placeholder note="规划中：网页通知 / Web Push 已登记待办（todo #12/#13），实现后在此配置。" /></Section>}
          {section === "about" && <Section title="关于" desc="Life OS — Agent 的工作操作系统。"><Placeholder note="版本与构建信息待构建管线提供。" /></Section>}
        </div>
      </div>
    </div>
  );
}
