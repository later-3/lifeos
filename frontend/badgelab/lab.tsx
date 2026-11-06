/**
 * 数字徽标候选实验室 —— **真组件、真样式、真动画**，不是效果图。
 *
 * 为什么要有这个页面：只给文字描述（"描边 pill""实心+扩散环"）用户根本没法选——
 * 看不到实际效果。这里把每个候选都**真的实现一遍**，放在同一页里并排跑。
 *
 * 用的是与主应用**完全相同的**设计 token（`design/tokens.css`）与行组件
 * （`Row` / `GroupHeader` / `SessionRow`），所以看到的就是装上去之后的样子。
 *
 * 打开方式：
 *   cd frontend && npx vite --port 5399
 *   浏览器 → http://localhost:5399/badgelab/
 *
 * ## 当前要解决的两个问题（用户 2026-11-05 指出）
 *
 * 1. **在跑是白字，其他是彩色字** —— 并排看时"白 1"和"绿 3"不像一套东西。
 *    → 全部改成「薄底 + 同色深字」，不再有白字。
 * 2. **在跑 / 完成 颜色太接近** —— 它们本来都是绿色，实测两个 14px 色块 ΔRGB = 0。
 *    → 换色相。这一页给出 5 套配色，用同一个 ΔRGB 脚本算过距离。
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import { AgentAvatar } from "../src/agent-avatar";
import { GroupBody, GroupHeader, SessionRow } from "../src/groups-panel";
import { Row } from "../src/design/ui";

type Slot = "running" | "unreadDone" | "unreadError";
type Status = Record<Slot, number>;
type Breathe = "halo" | "soft" | "dot" | false;

// ——————————————————————————————————————————————————————————————
// 配色方案
// ——————————————————————————————————————————————————————————————

type Palette = {
  key: string;
  name: string;
  note: string;
  /** [字色, 底色] */
  run: [string, string];
  done: [string, string];
  err: [string, string];
  /** 与「完成」的色距、与「失败」的色距（ΔRGB；<60 在 14px 上基本分不出） */
  distances: string;
  contrast: string;
  recommended: boolean;
};

const PALETTES: Palette[] = [
  {
    key: "P1",
    name: "P1 · 蓝 / 绿 / 红",
    note: "在跑=蓝（进度条语义，全行业的「进行中」默认色），完成=绿（成功），失败=红。",
    run: ["#1d4ed8", "#eef2ff"],
    done: ["#067647", "#ecfdf3"],
    err: ["#b42318", "#fef3f2"],
    distances: "run↔done 152 · run↔err 248 · done↔err 198",
    contrast: "6.0 / 5.4 / 6.1",
    recommended: true,
  },
  {
    key: "P2",
    name: "P2 · 靛 / 绿 / 红",
    note: "在跑=靛紫。比蓝更「科技感」，但和系统主色 accent（#2563eb）容易混。",
    run: ["#4338ca", "#eeecfd"],
    done: ["#067647", "#ecfdf3"],
    err: ["#b42318", "#fef3f2"],
    distances: "run↔done 157 · run↔err 212 · done↔err 198",
    contrast: "6.8 / 5.4 / 6.1",
    recommended: false,
  },
  {
    key: "P3",
    name: "P3 · 橙 / 绿 / 红",
    note: "在跑=橙（「正在处理」的常见色）。但橙与红色距只有 32，14px 上几乎分不出，不推荐。",
    run: ["#9a3412", "#fdf0e8"],
    done: ["#067647", "#ecfdf3"],
    err: ["#b42318", "#fef3f2"],
    distances: "run↔done 170 · run↔err 32 · done↔err 198",
    contrast: "6.5 / 5.4 / 6.1",
    recommended: false,
  },
  {
    key: "P4",
    name: "P4 · 灰 / 绿 / 红",
    note: "在跑=中性灰（「机器在干、你不用管」）。最不吵，但看不出「在跑」这件事本身。",
    run: ["#3f3f46", "#efeff1"],
    done: ["#067647", "#ecfdf3"],
    err: ["#b42318", "#fef3f2"],
    distances: "run↔done 79 · run↔err 129 · done↔err 198",
    contrast: "9.1 / 5.4 / 6.1",
    recommended: false,
  },
  {
    key: "P5",
    name: "P5 · 深绿 / 浅绿 / 红（不换色相）",
    note: "在跑用同一个绿、但加深。色距只有 36，14px 上分不出 —— 保留它只为对比「不换色的代价」。",
    run: ["#04543a", "#cdeedd"],
    done: ["#067647", "#ecfdf3"],
    err: ["#b42318", "#fef3f2"],
    distances: "run↔done 36 · run↔err 186 · done↔err 198",
    contrast: "7.2 / 5.4 / 6.1",
    recommended: false,
  },
];

// ——————————————————————————————————————————————————————————————
// 形状：薄底药丸 / 点 + 数字
// ——————————————————————————————————————————————————————————————

/**
 * 薄底药丸：16px 高、同色深字、没有白字。
 *
 * 为什么用内联 style：这一页要**动态换配色**（同一组件跑 5 套色），
 * Tailwind 的类是构建时静态生成的，没法跟着 state 变。
 * 落地时颜色走 tokens（`--color-status-run` 等），不写死。
 */
function Pill({ count, slot, palette, breathe }: { count: number; slot: Slot; palette: Palette; breathe: Breathe }) {
  if (count <= 0) return null;
  const [fg, bg] = slot === "running" ? palette.run : slot === "unreadDone" ? palette.done : palette.err;
  const label = slot === "running" ? `${count} 个会话正在工作` : slot === "unreadDone" ? `${count} 个会话已完成待查看` : `${count} 个会话失败待查看`;
  const animation = breathe === false || slot !== "running"
    ? undefined
    : breathe === "halo" ? "badge-halo 1.8s ease-out infinite"
      : breathe === "soft" ? "badge-soft 1.8s ease-in-out infinite"
        : "badge-dot 1.5s ease-in-out infinite";
  return (
    <span role="status" aria-label={label} title={label} data-state-count={slot}
      style={{ color: fg, backgroundColor: bg, "--badge-halo": `${fg}73`, ...(animation !== undefined ? { animation } : {}) } as React.CSSProperties}
      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1.5 text-micro font-semibold leading-none tabular-nums">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** 点 + 数字：没有底色块，颜色落在 6px 圆点和数字上。 */
function DotNum({ count, slot, palette, breathe }: { count: number; slot: Slot; palette: Palette; breathe: Breathe }) {
  if (count <= 0) return null;
  const [fg] = slot === "running" ? palette.run : slot === "unreadDone" ? palette.done : palette.err;
  const label = slot === "running" ? `${count} 个会话正在工作` : slot === "unreadDone" ? `${count} 个会话已完成待查看` : `${count} 个会话失败待查看`;
  const animation = breathe === false || slot !== "running"
    ? undefined
    : breathe === "dot" || breathe === "halo" ? "badge-dot 1.5s ease-in-out infinite"
      : "badge-soft 1.8s ease-in-out infinite";
  return (
    <span role="status" aria-label={label} title={label} data-state-count={slot} style={{ color: fg }} className="inline-flex items-center gap-1">
      <span style={{ backgroundColor: fg, "--badge-halo": `${fg}73`, ...(animation !== undefined ? { animation } : {}) } as React.CSSProperties} className="h-1.5 w-1.5 shrink-0 rounded-full" />
      <span className="text-micro font-semibold leading-none tabular-nums">{count > 99 ? "99+" : count}</span>
    </span>
  );
}

type ShapeKey = "pill" | "dot";
const SHAPES: Array<{ key: ShapeKey; name: string; note: string; Component: typeof Pill }> = [
  { key: "pill", name: "形状① 薄底药丸", note: "16px 高，薄底 + 同色深字。你要的「打底改成薄的」。", Component: Pill },
  { key: "dot", name: "形状② 圆点 + 数字", note: "没有底色块，颜色只在 6px 点和数字上。最轻。", Component: DotNum },
];

const BREATHES: Array<{ key: Breathe; name: string; note: string }> = [
  { key: "halo", name: "光环扩散", note: "向外扩的环，不闪（Slack / iOS 角标）" },
  { key: "soft", name: "明暗呼吸", note: "整体透明度 1↔0.5（就是现在的 animate-pulse）" },
  { key: "dot", name: "圆点缩放", note: "点自己缩放（只对形状②有效）" },
  { key: false, name: "不呼吸", note: "静止（对照用）" },
];

// ——————————————————————————————————————————————————————————————
// 假数据（真实形状：3 助手 / 2 项目 / 若干会话）
// ——————————————————————————————————————————————————————————————

const AGENTS = [
  { id: "coder", name: "coder", status: { running: 1, unreadDone: 3, unreadError: 0 } as Status },
  { id: "lifeosagent", name: "Life Agent", status: { running: 0, unreadDone: 1, unreadError: 0 } as Status },
  { id: "frontend-developer", name: "Frontend Developer", status: { running: 0, unreadDone: 0, unreadError: 2 } as Status },
  { id: "architect", name: "Architect", status: { running: 0, unreadDone: 0, unreadError: 0 } as Status },
];

const PROJECTS = [
  {
    id: "lifeos", name: "lifeos", status: { running: 1, unreadDone: 2, unreadError: 0 } as Status,
    sessions: [
      { id: "s1", title: "要做一个检视模式，你可以参考下 copilot", state: "running" as const },
      { id: "s2", title: "我们创建一个 task，用于优化会话区标题", state: "unread" as const },
      { id: "s3", title: "有一个 bug：点击新建会话后项目丢失", state: "unread" as const },
      { id: "s4", title: "新建一个 task 用于管理 LifeOS 的配置", state: "idle" as const },
    ],
  },
  {
    id: "workspace", name: "workspace", status: { running: 0, unreadDone: 1, unreadError: 0 } as Status,
    sessions: [
      { id: "s5", title: "为什么 life agent 的 workspace 有点问题", state: "unread" as const },
      { id: "s6", title: "你看看对接 github、notion 等等", state: "idle" as const },
    ],
  },
];

const SLOTS: Slot[] = ["unreadDone", "running", "unreadError"];

// ——————————————————————————————————————————————————————————————
// 页面
// ——————————————————————————————————————————————————————————————

export default function Lab() {
  const [paletteKey, setPaletteKey] = useState("P1");
  const [shapeKey, setShapeKey] = useState<ShapeKey>("pill");
  const [breatheKey, setBreatheKey] = useState<Breathe>("halo");
  /** 大号对照：把徽标放大到 3× 看形状 */
  const [zoomed, setZoomed] = useState(false);

  const palette = PALETTES.find((p) => p.key === paletteKey) ?? PALETTES[0]!;
  const shape = SHAPES.find((s) => s.key === shapeKey) ?? SHAPES[0]!;
  const Badge = shape.Component;

  const AgentMarks = ({ status }: { status: Status }) => (
    <span className="flex shrink-0 items-center gap-1">
      {SLOTS.map((slot) => <Badge key={slot} count={status[slot]} slot={slot} palette={palette} breathe={breatheKey} />)}
    </span>
  );

  return (
    <div className="min-h-screen bg-sunken pb-10">
      <header className="mx-auto max-w-[1220px] px-6 pt-6">
        <h1 className="text-title font-semibold text-ink-900">会话数字徽标 · 配色与形状</h1>
        <p className="mt-1.5 max-w-[860px] text-meta leading-relaxed text-ink-700">
          这一页是真组件（同一套 token、同一套行布局），不是效果图。下面三个开关可以任意组合，
          下面的真实左栏会立刻跟着变。呼吸动画在浏览器里是活的。
        </p>
        <p className="mt-1 text-meta text-ink-500">
          针对你说的两点：① 在跑不再是白字，全部「薄底 + 同色深字」；② 在跑换掉绿色，与「完成」拉开色距。
        </p>
      </header>

      {/* —— 三个开关 —— */}
      <section className="mx-auto mt-5 max-w-[1220px] px-6">
        <div className="flex flex-wrap items-start gap-6 rounded-panel bg-surface p-4 ring-1 ring-line">
          <div>
            <div className="mb-1.5 text-micro font-semibold text-ink-500">配色</div>
            <div className="flex gap-1.5">
              {PALETTES.map((p) => (
                <button key={p.key} type="button" onClick={() => setPaletteKey(p.key)}
                  className={`h-8 rounded-control px-3 text-micro font-medium ${p.key === paletteKey ? "bg-accent text-white" : "bg-hover text-ink-700 hover:bg-line"}`}>
                  {p.key}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-micro font-semibold text-ink-500">形状</div>
            <div className="flex gap-1.5">
              {SHAPES.map((s) => (
                <button key={s.key} type="button" onClick={() => setShapeKey(s.key)}
                  className={`h-8 rounded-control px-3 text-micro font-medium ${s.key === shapeKey ? "bg-accent text-white" : "bg-hover text-ink-700 hover:bg-line"}`}>
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-micro font-semibold text-ink-500">在跑怎么呼吸</div>
            <div className="flex gap-1.5">
              {BREATHES.map((b) => (
                <button key={String(b.key)} type="button" onClick={() => setBreatheKey(b.key)}
                  className={`h-8 rounded-control px-3 text-micro font-medium ${b.key === breatheKey ? "bg-accent text-white" : "bg-hover text-ink-700 hover:bg-line"}`}>
                  {b.name}
                </button>
              ))}
            </div>
          </div>
          <div className="ml-auto self-end">
            <label className="flex cursor-pointer items-center gap-1.5 text-micro text-ink-700">
              <input type="checkbox" checked={zoomed} onChange={(e) => setZoomed(e.target.checked)} />
              放大 2× 看形状
            </label>
          </div>
        </div>
      </section>

      {/* —— 五套配色 · 三种状态一览 —— */}
      <section className="mx-auto mt-5 max-w-[1220px] px-6">
        <h2 className="mb-2 text-content font-semibold text-ink-900">五套配色对比（同一形状 {shape.name}）</h2>
        <div className="overflow-hidden rounded-panel bg-surface ring-1 ring-line">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line">
                <th className="px-4 py-2 text-micro font-semibold text-ink-500">配色</th>
                <th className="px-4 py-2 text-micro font-semibold text-ink-500">完成 3 · 在跑 1 · 失败 2</th>
                <th className="px-4 py-2 text-micro font-semibold text-ink-500">色距（ΔRGB）</th>
                <th className="px-4 py-2 text-micro font-semibold text-ink-500">对比度</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {PALETTES.map((p) => (
                <tr key={p.key} className={`border-b border-line last:border-0 ${p.key === paletteKey ? "bg-accent-soft" : ""}`}>
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center gap-1.5 text-meta font-semibold text-ink-900">
                      {p.name}
                      {p.recommended && <span className="rounded-inner bg-success-soft px-1 py-0.5 text-[10px] font-medium text-success">推荐</span>}
                    </div>
                    <div className="mt-0.5 max-w-[300px] text-micro leading-snug text-ink-500">{p.note}</div>
                  </td>
                  <td className="bg-sunken px-4 py-3">
                    <span className="flex items-center gap-2">
                      {SLOTS.map((slot) => <shape.Component key={slot} count={slot === "running" ? 1 : slot === "unreadDone" ? 3 : 2} slot={slot} palette={p} breathe={breatheKey} />)}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top text-micro tabular-nums text-ink-700">{p.distances}</td>
                  <td className="px-4 py-3 align-top text-micro tabular-nums text-ink-700">{p.contrast}</td>
                  <td className="px-4 py-3 align-top">
                    <button type="button" onClick={() => setPaletteKey(p.key)}
                      className={`h-7 shrink-0 rounded-control px-2.5 text-micro font-medium ${p.key === paletteKey ? "bg-accent text-white" : "bg-hover text-ink-700 hover:bg-line"}`}>
                      {p.key === paletteKey ? "正在用" : "用这套"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-micro text-ink-500">
          色距 = 两个颜色 RGB 空间的直线距离（我算的，脚本在 /tmp/c4.mjs）。低于 60 时，14px 的小色块肉眼基本分不出。
        </p>
      </section>

      {/* —— 真实左栏 —— */}
      <section className="mx-auto mt-6 max-w-[1220px] px-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-content font-semibold text-ink-900">真实左栏</h2>
          <span className="rounded-inner bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">{palette.key} · {shape.name}</span>
          <span className="text-micro text-ink-500">呼吸：{BREATHES.find((b) => b.key === breatheKey)?.name}</span>
        </div>
        <div className="flex items-start gap-3" style={zoomed ? { transform: "scale(2)", transformOrigin: "top left" } : undefined}>
          <aside style={{ width: 232 }} className="flex shrink-0 flex-col bg-sunken">
            <div className="flex h-10 shrink-0 items-center gap-1.5 px-2 pl-3">
              <span className="text-micro font-medium tracking-wide text-ink-500">助手</span>
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
              {AGENTS.map((agent) => (
                <Row key={agent.id} selected={agent.id === "coder"}>
                  <AgentAvatar id={agent.id} name={agent.name} size={22} />
                  <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                  <AgentMarks status={agent.status} />
                </Row>
              ))}
            </div>
          </aside>

          <aside style={{ width: 300 }} className="flex shrink-0 flex-col bg-sunken ring-1 ring-line">
            <div className="flex h-10 shrink-0 items-center gap-1.5 px-2 pl-3">
              <span className="text-micro font-medium tracking-wide text-ink-500">会话</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {PROJECTS.map((project) => (
                <div key={project.id}>
                  <GroupHeader name={project.name} count={project.sessions.length} open
                    onToggle={() => {}} selected={project.id === "lifeos"}
                    actions={<AgentMarks status={project.status} />} />
                  <GroupBody>
                    {project.sessions.map((session) => (
                      <SessionRow key={session.id} testId={session.id}
                        selected={session.id === "s1"}
                        title={session.title} titleFallback={false}
                        onSelect={() => {}} onRename={() => {}} onHistory={() => {}} onDelete={() => {}}
                        renaming={false} renameValue=""
                        onRenameChange={() => {}} onRenameCommit={() => {}} onRenameCancel={() => {}}
                        participants={<span />}
                        meta={<span className="text-ink-500">coder</span>}
                        status={session.state === "running"
                          ? <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ backgroundColor: palette.run[0] }} title="生成中" />
                          : session.state === "unread"
                            ? <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: palette.done[0] }} title="完成未读（查看后消失）" />
                            : <span className="text-micro text-ink-500">2小时前</span>} />
                    ))}
                  </GroupBody>
                </div>
              ))}
            </div>
          </aside>

          <div className="min-w-0 flex-1 rounded-panel bg-surface p-4 ring-1 ring-line">
            <h3 className="text-content font-semibold text-ink-900">{palette.name} · {shape.name}</h3>
            <p className="mt-1.5 text-meta leading-relaxed text-ink-700">{shape.note}</p>
            <p className="mt-1 text-meta leading-relaxed text-ink-700">{palette.note}</p>
            <dl className="mt-4 space-y-1.5 text-micro">
              <div className="flex gap-2"><dt className="w-14 shrink-0 text-ink-500">在跑</dt>
                <dd className="text-ink-700">{BREATHES.find((b) => b.key === breatheKey)?.note}</dd></div>
              <div className="flex gap-2"><dt className="w-14 shrink-0 text-ink-500">色距</dt>
                <dd className="tabular-nums text-ink-700">{palette.distances}</dd></div>
              <div className="flex gap-2"><dt className="w-14 shrink-0 text-ink-500">对比度</dt>
                <dd className="tabular-nums text-ink-700">{palette.contrast}（WCAG AA 需 ≥4.5）</dd></div>
              <div className="flex gap-2"><dt className="w-14 shrink-0 text-ink-500">尺寸</dt>
                <dd className="tabular-nums text-ink-700">{shapeKey === "pill" ? "16 × 16（单数字）" : "≈18 × 12（6px 点 + 数字）"}</dd></div>
            </dl>
            <p className="mt-4 border-t border-line pt-3 text-micro leading-relaxed text-ink-500">
              会话行上的圆点也用同一套色（在跑=在跑色、未读=完成色），这样「上面的数字」和「下面的点」是同一个颜色。
            </p>
          </div>
        </div>
      </section>

      <footer className="mx-auto mt-6 max-w-[1220px] px-6 text-micro text-ink-500">
        告诉我「配色 + 形状 + 呼吸」三个选择（例如 P1 + 薄底药丸 + 光环扩散），我就落地到 CountBadge 并补门禁断言。
      </footer>
    </div>
  );
}

// 挂载（badgelab 是独立入口页，不参与主应用路由）
const host = document.getElementById("root");
if (host !== null) createRoot(host).render(<Lab />);
