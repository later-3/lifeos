/**
 * 设计系统样板间（T4）—— **活文档**，不是截图。
 *
 * 为什么有这一页（2026-11-09 用户：「后续的前端都要有一套统一的规范，不会乱套，
 * 且我们视觉风格上统一」）：规范不能只是文字。参照 LobeHub 的 `ui.lobehub.com`、
 * novu 的文档站 —— 新写一个页面时，先来这里找现成的 primitive 与 token，
 * **找不到才新增**。这一页直接 import 真实的 `tokens.css` 与 `design/ui.tsx`，
 * 所以它永远不会与实现漂移（不是截图、不是手抄）。
 *
 * 打开方式（不需要后端、不需要家目录）：
 *   cd frontend && npx vite --port 5399
 *   → http://127.0.0.1:5399/dev/design-system.html
 *
 * 它同时是一个**视觉自检工具**：
 *  - 「状态矩阵」把每个 primitive × 状态并排摆开 —— 少写一个 disabled/focus 态一眼看得出；
 *  - 「浮层配方」把 SURFACE 的 5 个角色并排，深浅色切换时能立即看出"深色浮层糊不糊"；
 *  - 「层级」列出 LAYER 的 5 档与 z 值，顺序错了一眼就发现。
 */
import { createRoot } from "react-dom/client";
import { useState } from "react";

import "../src/index.css";
import { applySurfaceTokens, calculatePalette, clampState, hex, THEME_PRESETS } from "../src/design/theme";
import { LAYER, LAYER_CLASS, SCRIM_CLASS, SURFACE, surfaceStyle } from "../src/design/surface";
import { Button, ComposerButton, controlClass, Field, IconButton, Label, Row, Segmented, Skeleton, Spinner, Tabs } from "../src/design/ui";
import { AppIcon, type IconName } from "../src/design/icons";
import { SessionRow } from "../src/design/ui";

/* ── 排版小件 ── */
function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line py-8">
      <h2 className="text-title font-semibold text-ink-900" style={{ letterSpacing: "var(--tracking-title)" }}>{title}</h2>
      {note !== undefined && <p className="mt-1 max-w-2xl text-meta text-ink-500">{note}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-micro text-ink-500">{label}</span>
      <div className="flex min-h-9 items-center gap-2">{children}</div>
    </div>
  );
}

/** 把一组 token 摆成色块（值与主题引擎同源：不是手抄的 hex）。 */
function Palette({ mode }: { mode: "light" | "dark" }) {
  const palette = calculatePalette(clampState({ mode }));
  const groups: Array<[string, Array<[string, [number, number, number]]>]> = [
    ["表面", [
      ["surface", palette.surface], ["sunken", palette.sunken], ["hover", palette.hover], ["line", palette.line],
    ]],
    ["导航", [
      ["nav-bg", palette.navBg], ["nav-edge", palette.navEdge], ["nav-accent", palette.navAccent],
      ["nav-selected", palette.navSelected], ["nav-line", palette.navLine], ["nav-muted", palette.navMuted],
    ]],
    ["文字", [
      ["ink-900", palette.ink900], ["ink-700", palette.ink700], ["ink-500", palette.ink500], ["ink-300", palette.ink300],
    ]],
    ["强调 / 语义", [
      ["accent", palette.accent], ["accent-solid", palette.accentSolid], ["accent-soft", palette.accentSoft],
      ["success", palette.success], ["danger", palette.danger], ["running", palette.running],
    ]],
  ];
  return (
    <div className="flex flex-col gap-4">
      {groups.map(([group, entries]) => (
        <div key={group} className="flex flex-col gap-2">
          <Label>{group}</Label>
          <div className="flex flex-wrap gap-2">
            {entries.map(([name, color]) => {
              const value = hex(...color);
              return (
                <div key={name} className="w-28">
                  <div className="h-12 rounded-panel ring-1 ring-line" style={{ background: value }} />
                  <div className="mt-1 font-mono text-micro text-ink-700">{name}</div>
                  <div className="font-mono text-micro text-ink-500">{value}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function App() {
  const [mode, setMode] = useState<"light" | "dark">("light");
  const [tab, setTab] = useState("one");
  const [seg, setSeg] = useState("a");
  const [text, setText] = useState("");

  const switchMode = (next: "light" | "dark") => {
    setMode(next);
    // 与产品同一套入口：applyTheme 会写全部 token；这里只切模式
    document.documentElement.dataset.themeMode = next;
    document.documentElement.style.colorScheme = next;
    // 简化：直接用引擎算出的值覆盖（产品里由 App 的 effect 做同样的事）
    const palette = calculatePalette(clampState({ mode: next }));
    const map: Array<[string, [number, number, number]]> = [
      ["--color-surface", palette.surface], ["--color-sunken", palette.sunken], ["--color-hover", palette.hover],
      ["--color-line", palette.line], ["--color-nav-bg", palette.navBg], ["--color-nav-edge", palette.navEdge],
      ["--color-nav-accent", palette.navAccent], ["--color-nav-selected", palette.navSelected],
      ["--color-nav-line", palette.navLine], ["--color-nav-muted", palette.navMuted],
      ["--color-accent", palette.accent], ["--color-accent-solid", palette.accentSolid], ["--color-accent-soft", palette.accentSoft],
      ["--color-ink-900", palette.ink900], ["--color-ink-700", palette.ink700], ["--color-ink-500", palette.ink500],
      ["--color-ink-300", palette.ink300], ["--color-success", palette.success], ["--color-danger", palette.danger],
      ["--color-running", palette.running],
    ];
    for (const [name, color] of map) document.documentElement.style.setProperty(name, hex(...color));
    applySurfaceTokens(next);
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 text-ink-900">
      <header className="flex items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="text-title font-semibold" style={{ letterSpacing: "var(--tracking-title)" }}>Life OS 设计系统</h1>
          <p className="mt-1 text-meta text-ink-500">
            这一页直接 import 真实的 tokens.css 与 design/ui.tsx —— 不是截图，不会漂移。
            新写页面前先来这里找，找不到才新增。
          </p>
        </div>
        <Segmented value={mode} onChange={(value) => switchMode(value as "light" | "dark")}
          options={[{ value: "light", label: "浅色" }, { value: "dark", label: "深色" }]} />
      </header>

      <Section title="色板" note="值与 theme.ts 的 calculatePalette 同源（深色不是第二套手挑值，是同一公式派生）。">
        <Palette mode={mode} />
      </Section>

      <Section title="字阶" note="只有 5 档（micro 11 / meta 12 / body 13.5 / content 15 / title 17）。超出即缺陷（audit-ui 计数上限 5）。">
        <div className="flex flex-col gap-2">
          {[["title", "页面标题 17"], ["content", "长正文 15"], ["body", "默认正文 13.5"], ["meta", "标签/辅助 12"], ["micro", "元信息 11"]].map(([token, sample]) => (
            <div key={token} className="flex items-baseline gap-4">
              <span className="w-16 shrink-0 font-mono text-micro text-ink-500">{token}</span>
              <span className={`text-${token}`}>{sample}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="圆角" note="6 档：inner 4 / control 6 / row 8 / panel 10 / bubble 14 / full。行与控件不同档 —— 同档会看起来像按钮。">
        <div className="flex flex-wrap gap-3">
          {[["inner", "4"], ["control", "6"], ["row", "8"], ["panel", "10"], ["bubble", "14"], ["full", "9999"]].map(([name, px]) => (
            <div key={name} className="flex flex-col items-center gap-1">
              <div className={`h-14 w-20 bg-accent-soft ring-1 ring-line rounded-${name}`} />
              <span className="font-mono text-micro text-ink-500">{name} {px}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="按钮" note="每个 variant × size × 状态。缺任何一个状态都是缺陷（这里一眼看得出）。">
        {(["primary", "secondary", "ghost", "danger"] as const).map((variant) => (
          <div key={variant} className="flex flex-wrap items-center gap-3">
            <span className="w-20 shrink-0 font-mono text-micro text-ink-500">{variant}</span>
            <Button variant={variant} size="md">默认</Button>
            <Button variant={variant} size="sm">小号</Button>
            <Button variant={variant} size="md" disabled>禁用</Button>
            <span className="text-micro text-ink-300">（hover / focus 用 Tab 与鼠标试）</span>
          </div>
        ))}
      </Section>

      <Section title="图标按钮" note="命中区 ≥28（sm 28 / md 32 / lg 32 / xl 44）；label 必填（可访问名）。">
        <div className="flex items-center gap-3">
          <IconButton label="设置" size="sm"><AppIcon name="adjustments" size={14} /></IconButton>
          <IconButton label="新增" size="md"><AppIcon name="plus" size={16} /></IconButton>
          <IconButton label="完成" size="lg" active><AppIcon name="check" size={16} /></IconButton>
          <IconButton label="删除" size="xl" tone="solid"><AppIcon name="trash" size={18} /></IconButton>
          <IconButton label="禁用示例" size="md" disabled><AppIcon name="plus" size={16} /></IconButton>
          <ComposerButton label="发送">↑</ComposerButton>
        </div>
      </Section>

      <Section title="列表行 / 标签 / 输入">
        <div className="flex max-w-sm flex-col gap-1">
          <Row selected><span className="min-w-0 flex-1 truncate">选中行（bg-nav-selected + 字重 500）</span></Row>
          <Row><span className="min-w-0 flex-1 truncate">普通行（hover 变 nav-accent）</span></Row>
          <Row><span className="min-w-0 flex-1 truncate">第三行</span></Row>
        </div>
        <div className="flex items-center gap-3">
          <Label>列头标签</Label>
          <Label tone="nav">导航层标签</Label>
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-nav-accent px-1.5 text-micro font-medium tabular-nums text-nav-muted">23</span>
          <Spinner />
        </div>
        <div className="max-w-xs"><Field label="字段标签" hint="辅助说明（meta 档）"><input className={controlClass} value={text} onChange={(event) => setText(event.currentTarget.value)} placeholder="输入…" /></Field></div>
        <div className="max-w-sm"><Skeleton rows={3} /></div>
      </Section>

      <Section title="Tabs / Segmented" note="两种都只用 token；Tabs 是页面内切换，Segmented 是档位切换（不承担导航）。">
        <Tabs value={tab} onChange={setTab} label="示例页签" idPrefix="ds"
          options={[{ value: "one", label: "第一" }, { value: "two", label: "第二" }, { value: "three", label: "第三" }]} />
        <Segmented value={seg} onChange={setSeg}
          options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />
      </Section>

      <Section title="浮层配方（SURFACE）" note="5 个角色一套配方。深浅色切换时看这里 —— 深色下浮层边界是否还看得见，一眼就能判断。">
        <div className="flex flex-wrap items-start gap-4">
          {(Object.keys(SURFACE) as Array<keyof typeof SURFACE>).map((tone) => (
            <div key={tone} className="flex flex-col gap-1">
              <div className={`w-40 ${SURFACE[tone].radius} ring-1 ring-line bg-surface ${SURFACE[tone].padding}`}
                style={surfaceStyle(tone)}>
                <div className="text-body font-medium text-ink-900">{tone}</div>
                <div className="text-micro text-ink-500">{SURFACE[tone].shadow.replace("var(--surface-", "").replace(")", "")}</div>
              </div>
              <span className="font-mono text-micro text-ink-500">{SURFACE[tone].radius} · {SURFACE[tone].layer}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-3 text-micro text-ink-500">
          <span>遮罩：<code className={`${SCRIM_CLASS} px-2 py-0.5 text-ink-900`}>{SCRIM_CLASS}</code></span>
        </div>
      </Section>

      <Section title="层级（LAYER）" note="只能用这 5 个名字（design-system.test 拦裸 z 数字）。顺序错了的现象是「某浮层莫名被盖住」，很难排查。">
        <div className="flex flex-col gap-1">
          {(Object.keys(LAYER) as Array<keyof typeof LAYER>).map((name) => (
            <div key={name} className="flex items-center gap-3">
              <span className="w-20 font-mono text-micro text-ink-500">{name}</span>
              <span className="w-10 font-mono text-micro text-ink-900">{LAYER[name]}</span>
              <code className="text-micro text-ink-500">.{LAYER_CLASS[name]}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="主题预设" note="5 个预设 × 深浅色。切换后上面的色板会跟着变（同一套公式）。">
        <div className="flex flex-wrap gap-2">
          {Object.keys(THEME_PRESETS).map((preset) => (
            <span key={preset} className="rounded-control bg-sunken px-2 py-1 text-micro text-ink-700">{preset}</span>
          ))}
        </div>
      </Section>

      <ListRowCompareSection />

      <footer className="py-10 text-micro text-ink-500">
        改动这一页不需要后端：<code className="font-mono">cd frontend &amp;&amp; npx vite --port 5399</code> →
        <code className="font-mono"> /dev/design-system.html</code>
      </footer>
    </div>
  );
}

/* ── 列表行 A/B 形态对比（Task 0015 · A3，用户实际观感拍板用）────────────
 * A = 两行社交风（名字行 + preview 行）；B = 单行收敛（preview 不显示）。
 * 两个形态是同一个组件的不同 props（showPreview/density），结构零差异——
 * 拍板选的是"默认形态"，不是两套代码。 */
type RowView = "A" | "B";

function ListRowCompareSection() {
  /* 列表行形态拍板（2026-11-13）：**B 单行收敛为默认**——真实组件就是
   * design/ui.tsx 的 Row（助手行）与 SessionRow（会话行，收编自 groups-panel）。
   * 两行社交风（次行=最后消息）涉及后端数据与内容策略，用户后续单独建 task。 */
  const [selected, setSelected] = useState(false);
  return (
    <Section
      title="列表行（既有组件：Row / SessionRow）"
      note="助手行与会话行都是设计系统内的成熟容器（axe 嵌套修复、状态↔动作同格互换、键盘/触屏覆盖分支）。社交风两行（次行=最后消息）涉及后端数据，后续单独 task。"
    >
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => setSelected((v) => !v)}>切换选中态</Button>
        <span className="text-micro text-ink-500">点击切换选中底（hover 任意行看右侧动作互换；Tab 聚焦同样可见）</span>
      </div>
      <div className="flex flex-col gap-1 rounded-panel bg-nav-bg p-2">
        <Row selected={selected} onClick={() => setSelected((v) => !v)}
          actions={
            <>
              <button type="button" title="设置" aria-label="设置" className="flex h-7 w-7 items-center justify-center rounded-control text-ink-500 hover:bg-hover hover:text-ink-900"><AppIcon name="adjustments" size={14} /></button>
              <button type="button" title="删除" aria-label="删除" className="flex h-7 w-7 items-center justify-center rounded-control text-ink-500 hover:bg-hover hover:text-ink-900"><AppIcon name="trash" size={14} /></button>
            </>
          }
          status={<span className="text-micro text-nav-muted">3 个会话 · 2 未读</span>}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-surface">FD</span>
          <span className="truncate">Frontend Developer</span>
        </Row>
        <SessionRow
          selected={!selected}
          title="统一主题架构讨论"
          titleFallback={false}
          participants={<span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-micro font-semibold text-surface">F</span>}
          meta="Frontend Developer · Task 0015 · 进行中"
          status={<span className="text-micro text-nav-muted">16:04</span>}
          onSelect={() => setSelected((v) => !v)}
          onRename={() => {}}
          onHistory={() => {}}
          onDelete={() => {}}
          renaming={false}
          renameValue=""
          onRenameChange={() => {}}
          onRenameCommit={() => {}}
          onRenameCancel={() => {}}
        />
      </div>
    </Section>
  );
}

function MiniIcon({ label, name }: { label: string; name: IconName }) {
  return (
    <button type="button" title={label} aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-control text-ink-500 hover:bg-hover hover:text-ink-900">
      <AppIcon name={name} size={14} />
    </button>
  );
}


createRoot(document.getElementById("root")!).render(<App />);
