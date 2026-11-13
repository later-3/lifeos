/**
 * 动画调参台 —— **独立页面，不需要后端、不需要建会话**。
 *
 * ## 为什么有这一页
 *
 * 用户原话：
 * > 你起一个完整的实例干嘛呢？我还要去发起会话吗？难道？你就单独针对这些特效，我来调，
 * > 调好了之后就产生一组数据，我们就使用那组数据不就行了吗？
 *
 * 前几轮我都是"改代码 → 起整套实例 → 请用户发消息 → 等回合结束"，才能看一眼呼吸效果。
 * 这一页把"看效果"和"跑系统"解耦：所有会动的元素都在这里，参数全部可调，实时生效。
 *
 * ## 调完之后
 *
 * 页面底部会实时生成一段 JSON（当前参数）。把那段发给我，我直接写进 tokens，
 * 不再一轮一轮猜。
 *
 * ## 打开方式
 *
 *   cd frontend && npx vite --port 5399
 *   → http://localhost:5399/animlab/
 */
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import { AgentAvatar } from "../src/agent-avatar";
import { GroupBody, GroupHeader, SessionRow } from "../src/groups-panel";
import { Row, Spinner } from "../src/design/ui";

// ——————————————————————————————————————————————————————————————
// 参数模型
// ——————————————————————————————————————————————————————————————

type Params = {
  /** 徽标峰值缩放（1 = 不动；>1 是放大）。 */
  badgeScale: number;
  /** 会话行蓝点峰值缩放。 */
  dotScale: number;
  /** 呼吸周期（ms）。徽标与点共用，保持同拍。 */
  duration: number;
  /** 缓动曲线。 */
  easing: string;
  /** 扩散环向外推的距离（px）。0 = 不要环。 */
  ringSpread: number;
  /** 扩散环起始透明度。 */
  ringOpacity: number;
  /** 聊天区转圈（Spinner）转一圈的时间（ms）。 */
  spinnerDuration: number;
  /** 聊天区工作指示文案的呼吸：最淡时的不透明度。 */
  textPulseMin: number;
  /** 聊天区 ResponseBar 等待呼吸：最淡时的不透明度。 */
  waitingMin: number;
  /** 聊天区呼吸周期（ms）。 */
  chatDuration: number;
  /** 尊重系统"减少动态效果"设置。 */
  respectReducedMotion: boolean;
};

const PRESETS: Array<{ key: string; name: string; note: string; params: Params }> = [
  {
    key: "now",
    name: "A · 现在（v5 你调定的）",
    note: "徽标几乎不动（1.02），表达交给小蓝点（1.30）；环 3px 但很浓（.8）；周期 3s。",
    params: { badgeScale: 1.02, dotScale: 1.30, duration: 3000, easing: "cubic-bezier(.45,0,.55,1)", ringSpread: 3, ringOpacity: 0.8, spinnerDuration: 1200, textPulseMin: 0.7, waitingMin: 0.7, chatDuration: 3000, respectReducedMotion: true },
  },
  {
    key: "v4",
    name: "B · 上一版（v4）",
    note: "徽标 1.06、点 1.22、环 4px。你说「稍微有点夸张」。",
    params: { badgeScale: 1.06, dotScale: 1.22, duration: 2400, easing: "cubic-bezier(.45,0,.55,1)", ringSpread: 4, ringOpacity: 0.38, spinnerDuration: 900, textPulseMin: 0.5, waitingMin: 0.55, chatDuration: 1800, respectReducedMotion: true },
  },
  {
    key: "soft",
    name: "C · 很轻",
    note: "几乎只有点在动，徽标基本静止。适合怕干扰。",
    params: { badgeScale: 1.03, dotScale: 1.12, duration: 3000, easing: "cubic-bezier(.45,0,.55,1)", ringSpread: 2, ringOpacity: 0.25, spinnerDuration: 900, textPulseMin: 0.6, waitingMin: 0.65, chatDuration: 1800, respectReducedMotion: true },
  },
  {
    key: "clear",
    name: "D · 清楚一点",
    note: "比现在再明显一档，但不回到 v3。",
    params: { badgeScale: 1.09, dotScale: 1.28, duration: 2200, easing: "cubic-bezier(.45,0,.55,1)", ringSpread: 5, ringOpacity: 0.42, spinnerDuration: 900, textPulseMin: 0.45, waitingMin: 0.5, chatDuration: 1600, respectReducedMotion: true },
  },
  {
    key: "slow",
    name: "E · 慢呼吸",
    note: "幅度同 A，周期拉到 3.6s（更接近静息呼吸）。",
    params: { badgeScale: 1.06, dotScale: 1.22, duration: 3600, easing: "cubic-bezier(.45,0,.55,1)", ringSpread: 4, ringOpacity: 0.38, spinnerDuration: 900, textPulseMin: 0.5, waitingMin: 0.55, chatDuration: 2400, respectReducedMotion: true },
  },
  {
    key: "noring",
    name: "F · 不要扩散环",
    note: "只缩放，没有外扩的环。",
    params: { badgeScale: 1.08, dotScale: 1.28, duration: 2400, easing: "cubic-bezier(.45,0,.55,1)", ringSpread: 0, ringOpacity: 0, spinnerDuration: 900, textPulseMin: 0.5, waitingMin: 0.55, chatDuration: 1800, respectReducedMotion: true },
  },
];

const EASINGS = [
  { value: "cubic-bezier(.45,0,.55,1)", label: "正弦（现在用的，两端不黏）" },
  { value: "ease-in-out", label: "ease-in-out（中段偏急）" },
  { value: "cubic-bezier(.2,0,0,1)", label: "Material emphasized" },
  { value: "linear", label: "linear（匀速，机械感）" },
  { value: "cubic-bezier(.34,1.56,.64,1)", label: "回弹（会过冲，慎用）" },
];

// ——————————————————————————————————————————————————————————————
// 由参数生成 CSS
// ——————————————————————————————————————————————————————————————

/** `#1d4ed8` + 透明度 → `rgba(...)`。 */
const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
const RUNNING = "#1d4ed8";

function buildCss(p: Params): string {
  const ring = p.ringSpread > 0 && p.ringOpacity > 0
    ? `, lab-ring ${p.duration}ms ${p.easing} infinite`
    : "";
  return `
@keyframes lab-badge { 0%, 100% { transform: scale(1); } 50% { transform: scale(${p.badgeScale}); } }
@keyframes lab-dot   { 0%, 100% { transform: scale(1); } 50% { transform: scale(${p.dotScale}); } }
@keyframes lab-ring {
  0%   { box-shadow: 0 0 0 0 ${rgba(RUNNING, p.ringOpacity)}; }
  70%  { box-shadow: 0 0 0 ${p.ringSpread}px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@keyframes lab-text  { 0%, 100% { opacity: 1; } 50% { opacity: ${p.textPulseMin}; } }
@keyframes lab-spin  { to { transform: rotate(360deg); } }
@keyframes lab-wait  { 0%, 100% { opacity: 1; } 50% { opacity: ${p.waitingMin}; } }

.lab-badge { animation: lab-badge ${p.duration}ms ${p.easing} infinite${ring}; }
.lab-dot   { animation: lab-dot ${p.duration}ms ${p.easing} infinite${ring}; }
.lab-text  { animation: lab-text ${p.chatDuration}ms ${p.easing} infinite; }
.lab-spin  { animation: lab-spin ${p.spinnerDuration}ms linear infinite; }
.lab-wait  { animation: lab-wait ${p.chatDuration}ms cubic-bezier(.2,0,0,1) infinite; }

${p.respectReducedMotion ? `@media (prefers-reduced-motion: reduce) {
  .lab-badge, .lab-dot, .lab-text, .lab-spin, .lab-wait { animation: none; }
  /* 关掉动画后靠形状区分：在跑＝空心圈（与主应用一致） */
  .lab-dot { background: transparent !important; box-shadow: inset 0 0 0 2px ${RUNNING}; }
}` : ""}
`;
}

// ——————————————————————————————————————————————————————————————
// 控件
// ——————————————————————————————————————————————————————————————

function Slider({ label, value, min, max, step, unit, onChange, hint }: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void; hint?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-micro text-ink-700">{label}</span>
        <span className="tabular-nums text-micro font-medium text-ink-900">{value.toFixed(step < 1 ? 2 : 0)}{unit}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1 w-full cursor-pointer accent-accent" />
      {hint !== undefined && <span className="mt-0.5 block text-[10px] leading-tight text-ink-500">{hint}</span>}
    </label>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-panel bg-surface p-3 ring-1 ring-line">
      <div className="mb-2 text-micro font-semibold text-ink-900">{title}</div>
      {note !== undefined && <div className="mb-2 text-[10px] leading-tight text-ink-500">{note}</div>}
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

// ——————————————————————————————————————————————————————————————
// 页面
// ——————————————————————————————————————————————————————————————

function Lab() {
  const [params, setParams] = useState<Params>(PRESETS[0]!.params);
  const [presetKey, setPresetKey] = useState("now");
  const [zoom, setZoom] = useState(3);

  const set = <K extends keyof Params>(key: K, value: Params[K]) => setParams((p) => ({ ...p, [key]: value }));
  const applyPreset = (key: string) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (preset === undefined) return;
    setPresetKey(key);
    setParams(preset.params);
  };
  const css = useMemo(() => buildCss(params), [params]);

  /** 用户调完后要发回给我的那段。 */
  const exportText = JSON.stringify({
    badgeScale: params.badgeScale,
    dotScale: params.dotScale,
    duration: params.duration,
    easing: params.easing,
    ringSpread: params.ringSpread,
    ringOpacity: params.ringOpacity,
    spinnerDuration: params.spinnerDuration,
    textPulseMin: params.textPulseMin,
    waitingMin: params.waitingMin,
    chatDuration: params.chatDuration,
  }, null, 2);

  const badge = (text: string) => (
    <span className="lab-badge inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#eef2ff] px-1 text-micro font-medium leading-none tabular-nums text-[#1d4ed8]">{text}</span>
  );
  const greenBadge = (text: string) => (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-success-soft px-1 text-micro font-medium leading-none tabular-nums text-success">{text}</span>
  );
  const redBadge = (text: string) => (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-soft px-1 text-micro font-medium leading-none tabular-nums text-danger">{text}</span>
  );

  return (
    <div className="min-h-screen bg-sunken pb-16">
      <style>{css}</style>

      <header className="mx-auto max-w-[1360px] px-6 pt-6">
        <h1 className="text-title font-semibold text-ink-900">动画调参台</h1>
        <p className="mt-1 max-w-[900px] text-meta leading-relaxed text-ink-700">
          所有会动的元素都在这一页，参数实时生效。不需要后端、不需要建会话、不用等回合结束。
          调好之后把最下面那段 JSON 发我，我直接写进 tokens。
        </p>
      </header>

      {/* 预设 */}
      <section className="mx-auto mt-4 max-w-[1360px] px-6">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => applyPreset(p.key)} title={p.note}
              className={`h-8 rounded-control px-3 text-micro font-medium ${p.key === presetKey ? "bg-accent text-white" : "bg-surface text-ink-700 ring-1 ring-line hover:bg-hover"}`}>
              {p.name}
            </button>
          ))}
          <span className="self-center text-[10px] text-ink-500">
            {PRESETS.find((p) => p.key === presetKey)?.note ?? "（已手动改过参数）"}
          </span>
        </div>
      </section>

      <div className="mx-auto mt-4 grid max-w-[1360px] grid-cols-[248px_1fr] gap-4 px-6">
        {/* —— 参数面板 —— */}
        <div className="space-y-3">
          <Group title="① 状态徽标（助手行 / 项目行）" note="蓝色数字那个。三种状态里只有「在跑」会动。">
            <Slider label="峰值缩放" value={params.badgeScale} min={1} max={1.3} step={0.01} unit="×"
              onChange={(v) => { set("badgeScale", v); setPresetKey(""); }}
              hint={`16px → ${(16 * params.badgeScale).toFixed(1)}px（+${((params.badgeScale - 1) * 16).toFixed(1)}px）`} />
          </Group>

          <Group title="② 会话行的蓝点" note="列表里每行右缘那个小点。">
            <Slider label="峰值缩放" value={params.dotScale} min={1} max={1.6} step={0.01} unit="×"
              onChange={(v) => { set("dotScale", v); setPresetKey(""); }}
              hint={`6px → ${(6 * params.dotScale).toFixed(1)}px（+${((params.dotScale - 1) * 6).toFixed(1)}px）`} />
          </Group>

          <Group title="③ 呼吸节奏（①②共用）" note="同一拍子，否则一块屏幕上两个节奏会互相干扰。">
            <Slider label="周期" value={params.duration} min={800} max={4000} step={100} unit="ms"
              onChange={(v) => { set("duration", v); setPresetKey(""); }} />
            <label className="block">
              <span className="text-micro text-ink-700">曲线</span>
              <select value={params.easing}
                onChange={(e) => { set("easing", e.target.value); setPresetKey(""); }}
                className="mt-1 w-full rounded-control bg-surface px-1.5 py-1 text-micro text-ink-900 ring-1 ring-line">
                {EASINGS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
              </select>
            </label>
          </Group>

          <Group title="④ 扩散环" note="元素外面往外推的一圈光。0 = 不要。">
            <Slider label="外推距离" value={params.ringSpread} min={0} max={12} step={1} unit="px"
              onChange={(v) => { set("ringSpread", v); setPresetKey(""); }} />
            <Slider label="起始透明度" value={params.ringOpacity} min={0} max={1} step={0.02} unit=""
              onChange={(v) => { set("ringOpacity", v); setPresetKey(""); }} />
          </Group>

          <Group title="⑤ 聊天区：转圈" note="「正在执行工具…」前面那个环。">
            <Slider label="转一圈" value={params.spinnerDuration} min={400} max={2400} step={100} unit="ms"
              onChange={(v) => { set("spinnerDuration", v); setPresetKey(""); }} />
          </Group>

          <Group title="⑥ 聊天区：文字呼吸" note="工作指示文案（「输出中…」）与等待条的淡入淡出。">
            <Slider label="文案最淡" value={params.textPulseMin} min={0.1} max={1} step={0.05} unit=""
              onChange={(v) => { set("textPulseMin", v); setPresetKey(""); }} hint="1 = 不动" />
            <Slider label="等待条最淡" value={params.waitingMin} min={0.1} max={1} step={0.05} unit=""
              onChange={(v) => { set("waitingMin", v); setPresetKey(""); }} />
            <Slider label="聊天区周期" value={params.chatDuration} min={600} max={4000} step={100} unit="ms"
              onChange={(v) => { set("chatDuration", v); setPresetKey(""); }} />
          </Group>

          <Group title="⑦ 无障碍">
            <label className="flex cursor-pointer items-start gap-1.5 text-[10px] leading-tight text-ink-700">
              <input type="checkbox" checked={params.respectReducedMotion} className="mt-0.5"
                onChange={(e) => { set("respectReducedMotion", e.target.checked); setPresetKey(""); }} />
              系统开着"减少动态效果"时停掉动画（蓝点改成空心圈区分）
            </label>
          </Group>

          <Group title="放大看">
            <Slider label="预览缩放" value={zoom} min={1} max={6} step={1} unit="×" onChange={setZoom} />
          </Group>
        </div>

        {/* —— 预览 —— */}
        <div className="min-w-0 space-y-4">
          {/* 三处同框：真实组件形态 */}
          <div className="rounded-panel bg-sunken p-3 ring-1 ring-line">
            <div className="mb-2 text-micro font-semibold text-ink-900">真实布局（助手列 / 会话列 / 聊天区）</div>
            <div className="flex items-start gap-3" style={{ transform: `scale(${zoom / 3})`, transformOrigin: "top left" }}>
              {/* 助手列 */}
              <aside style={{ width: 216 }} className="flex shrink-0 flex-col bg-sunken">
                <div className="flex h-10 shrink-0 items-center px-3">
                  <span className="text-micro font-medium tracking-wide text-ink-500">助手</span>
                </div>
                <div className="space-y-0.5 px-1.5 pb-2">
                  <Row selected>
                    <AgentAvatar id="coder" name="coder" size={22} />
                    <span className="min-w-0 flex-1 truncate">coder</span>
                    <span className="flex shrink-0 items-center gap-1">{badge("1")}{greenBadge("3")}</span>
                  </Row>
                  <Row>
                    <AgentAvatar id="lifeosagent" name="Life Agent" size={22} />
                    <span className="min-w-0 flex-1 truncate">Life Agent</span>
                    <span className="flex shrink-0 items-center gap-1">{greenBadge("1")}</span>
                  </Row>
                  <Row>
                    <AgentAvatar id="fd" name="Frontend Developer" size={22} />
                    <span className="min-w-0 flex-1 truncate">Frontend Developer</span>
                    <span className="flex shrink-0 items-center gap-1">{redBadge("2")}</span>
                  </Row>
                  <Row>
                    <AgentAvatar id="arch" name="Architect" size={22} />
                    <span className="min-w-0 flex-1 truncate">Architect</span>
                  </Row>
                </div>
              </aside>

              {/* 会话列 */}
              <aside style={{ width: 300 }} className="flex shrink-0 flex-col bg-sunken ring-1 ring-line">
                <div className="flex h-10 shrink-0 items-center px-3">
                  <span className="text-micro font-medium tracking-wide text-ink-500">会话</span>
                </div>
                <div className="px-2 pb-2">
                  <GroupHeader name="lifeos" count={4} open selected={false} onToggle={() => undefined}
                    onOverview={() => undefined}
                    actions={<span className="flex items-center gap-1">{badge("1")}{greenBadge("2")}</span>} />
                  <GroupBody>
                    <SessionRow testId="s1" selected={false} title="要做一个检视模式，你可以参考下 copilot" titleFallback={false}
                      onSelect={() => undefined} onRename={() => undefined} onHistory={() => undefined} onDelete={() => undefined}
                      renaming={false} renameValue="" onRenameChange={() => undefined} onRenameCommit={() => undefined} onRenameCancel={() => undefined}
                      participants={<span />} meta={<span className="text-ink-500">0010 检视模式</span>}
                      status={<span className="lab-dot h-1.5 w-1.5 rounded-full bg-[#1d4ed8]" title="生成中" />} />
                    <SessionRow testId="s2" selected={false} title="新建一个 task，修复一个 bug" titleFallback={false}
                      onSelect={() => undefined} onRename={() => undefined} onHistory={() => undefined} onDelete={() => undefined}
                      renaming={false} renameValue="" onRenameChange={() => undefined} onRenameCommit={() => undefined} onRenameCancel={() => undefined}
                      participants={<span />} meta={<span className="text-ink-500">0011 会话区标题</span>}
                      status={<span className="h-1.5 w-1.5 rounded-full bg-success" title="完成未读（查看后消失）" />} />
                    <SessionRow testId="s3" selected={false} title="我们看一下 task 013 是什么" titleFallback={false}
                      onSelect={() => undefined} onRename={() => undefined} onHistory={() => undefined} onDelete={() => undefined}
                      renaming={false} renameValue="" onRenameChange={() => undefined} onRenameCommit={() => undefined} onRenameCancel={() => undefined}
                      participants={<span />} meta={<span className="text-danger">失败：鉴权</span>}
                      status={<span className="h-1.5 w-1.5 rounded-full bg-danger" title="失败：鉴权" />} />
                    <SessionRow testId="s4" selected={false} title="一个已经看完的会话" titleFallback={false}
                      onSelect={() => undefined} onRename={() => undefined} onHistory={() => undefined} onDelete={() => undefined}
                      renaming={false} renameValue="" onRenameChange={() => undefined} onRenameCommit={() => undefined} onRenameCancel={() => undefined}
                      participants={<span />} meta={<span className="text-ink-500">0001 默认</span>}
                      status={<span className="text-micro text-ink-500">2小时前</span>} />
                  </GroupBody>
                </div>
              </aside>

              {/* 聊天区：转圈 + 工作指示 + 等待条 */}
              <div className="min-w-0 flex-1 rounded-panel bg-surface p-3 ring-1 ring-line">
                <div className="mb-2 text-micro font-semibold text-ink-900">聊天区（这三个也会动）</div>
                <div className="space-y-3">
                  {/* 工作指示行（转圈 + 文案呼吸 + 秒数） */}
                  <div className="flex flex-wrap items-center gap-2 text-meta text-ink-500">
                    <Spinner size={14} className="lab-spin text-accent" />
                    <span className="font-medium text-ink-700">思考</span>
                    <span className="lab-text">输出中…</span>
                    <span className="tabular-nums text-micro text-ink-500">12s</span>
                  </div>
                  {/* 等待条呼吸 */}
                  <div className="lab-wait rounded-panel bg-sunken p-2">
                    <span className="text-meta text-ink-500">正在等待回复…</span>
                  </div>
                  <div className="text-[10px] leading-relaxed text-ink-500">
                    转圈：{params.spinnerDuration}ms/圈 · 文案最淡 {params.textPulseMin} · 等待条最淡 {params.waitingMin} · 周期 {params.chatDuration}ms
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 大图对照：把徽标与点放大到能看清 */}
          <div className="rounded-panel bg-surface p-4 ring-1 ring-line">
            <div className="mb-3 text-micro font-semibold text-ink-900">放大对照（3×）</div>
            <div className="flex flex-wrap items-center gap-10">
              <div className="text-center">
                <div style={{ transform: "scale(3)", transformOrigin: "center", margin: "18px 24px" }}>
                  {badge("1")}
                </div>
                <div className="mt-1 text-[10px] text-ink-500">徽标 {params.badgeScale}×</div>
              </div>
              <div className="text-center">
                <div style={{ transform: "scale(3)", transformOrigin: "center", margin: "18px 24px" }}>
                  <span className="lab-dot block h-1.5 w-1.5 rounded-full bg-[#1d4ed8]" />
                </div>
                <div className="mt-1 text-[10px] text-ink-500">蓝点 {params.dotScale}×</div>
              </div>
              <div className="text-center">
                <div style={{ transform: "scale(3)", transformOrigin: "center", margin: "18px 24px" }}>
                  {greenBadge("3")}
                </div>
                <div className="mt-1 text-[10px] text-ink-500">绿徽标（不动）</div>
              </div>
              <div className="text-center">
                <div style={{ transform: "scale(3)", transformOrigin: "center", margin: "18px 24px" }}>
                  <span className="block h-1.5 w-1.5 rounded-full bg-success" />
                </div>
                <div className="mt-1 text-[10px] text-ink-500">绿点（不动）</div>
              </div>
            </div>
          </div>

          {/* 导出 */}
          <div className="rounded-panel bg-surface p-4 ring-1 ring-line">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-micro font-semibold text-ink-900">调好了？把这段发我</span>
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(exportText); }}
                className="h-6 rounded-control bg-accent px-2 text-[10px] font-medium text-white">复制</button>
            </div>
            <pre className="overflow-x-auto rounded-control bg-sunken p-2.5 text-[11px] leading-relaxed text-ink-900">{exportText}</pre>
            <p className="mt-2 text-[10px] leading-relaxed text-ink-500">
              也可以只告诉我「哪组参数 + 哪个数字不对」，我照着调。徽标与点是分开的，可以各调各的。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const host = document.getElementById("root");
if (host !== null) createRoot(host).render(<Lab />);
