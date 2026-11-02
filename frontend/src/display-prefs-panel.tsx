/**
 * 显示设置弹层：两个滑块（内容宽度 + 字号），用户 2026-11-02 拍板放在顶部
 * 「完整历史」「文件面板」两个图标旁边，点开就是这个弹层。
 *
 * 为什么放进 `design/` 之外、单独一个文件：这不是通用控件，是"对话区的显示偏好"，
 * 只服务 chat surface；但它内部的滑块仍用设计系统的控件与 token。
 *
 * 数值全部走 `display-prefs.ts` 的纯函数（滑块 ↔ 偏好可逆，测试在 test/display-prefs.test.mjs）。
 */
import { useEffect, useRef, useState } from "react";
import { IconAdjustments, IconMinus, IconPlus } from "@tabler/icons-react";
import { IconButton } from "./design/ui";
import {
  DEFAULT_PREFS, FONT_SCALE_MAX, FONT_SCALE_MIN, focusWidthOf, fontFromSlider, fontLabel,
  sliderFromFont, sliderFromWidth, widthFromSlider, widthLabel, type DisplayPrefs,
} from "./display-prefs";

const PANEL_ID = "display-prefs-panel";

function SliderRow({ id, label, value, display, onChange, hintLeft, hintRight }: {
  id: string;
  label: string;
  /** 0–100 */
  value: number;
  /** 右侧当前值文案（如 `720px` / `110%`） */
  display: string;
  onChange: (next: number) => void;
  hintLeft: string;
  hintRight: string;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={`pref-row-${id}`}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-meta text-ink-700">{label}</label>
        <span className="tabular-nums text-micro text-ink-500" data-testid={`pref-value-${id}`}>{display}</span>
      </div>
      <div className="flex items-center gap-2">
        <IconMinus size={12} aria-hidden="true" className="shrink-0 text-ink-300" />
        <input id={id} type="range" min={0} max={100} step={1} value={value}
          aria-label={display}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          className="h-11 w-full cursor-pointer accent-accent sm:h-6" />
        <IconPlus size={12} aria-hidden="true" className="shrink-0 text-ink-300" />
      </div>
      <div className="flex justify-between text-micro text-ink-300">
        <span>{hintLeft}</span>
        <span>{hintRight}</span>
      </div>
    </div>
  );
}

export function DisplayPrefsPanel({ prefs, viewport, onChange }: {
  prefs: DisplayPrefs;
  viewport: number;
  onChange: (next: DisplayPrefs) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // 点外面 / Esc 关闭（与项目里其他浮层一致的手感，不引入新语义）
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onDown = (event: MouseEvent) => {
      if (boxRef.current !== null && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const widthPercent = sliderFromWidth(prefs.width, viewport);
  const fontPercent = sliderFromFont(prefs.font);

  return (
    <div ref={boxRef} className="relative">
      <IconButton label="显示设置" size="lg" active={open}
        aria-expanded={open} aria-controls={PANEL_ID}
        onClick={() => setOpen((value) => !value)}>
        <IconAdjustments size={16} />
      </IconButton>
      {open && (
        <div id={PANEL_ID} role="group" aria-label="显示设置"
          data-testid="display-prefs"
          className="absolute right-0 top-full z-30 mt-1 flex w-72 flex-col gap-4 rounded-panel border border-line bg-surface p-3 shadow-md">
          <SliderRow id="width" label="内容宽度" value={widthPercent}
            display={widthLabel(prefs.width)}
            hintLeft={`专注 ${focusWidthOf(viewport)}px`} hintRight="铺满"
            onChange={(next) => onChange({ ...prefs, width: widthFromSlider(next, viewport) })} />
          <SliderRow id="font" label="字号" value={fontPercent}
            display={fontLabel(prefs.font)}
            hintLeft={`${Math.round(FONT_SCALE_MIN * 100)}%`} hintRight={`${Math.round(FONT_SCALE_MAX * 100)}%`}
            onChange={(next) => onChange({ ...prefs, font: fontFromSlider(next) })} />
          <button type="button"
            className="self-start text-micro text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline"
            onClick={() => onChange(DEFAULT_PREFS)}>
            恢复默认
          </button>
        </div>
      )}
    </div>
  );
}

/** 偏好落盘（localStorage）。与 useColumnWidth 同一模式：坏值回默认，不抛。 */
const STORAGE_KEY = "lifeos.displayPrefs";

export function loadPrefs(parse: (raw: unknown) => DisplayPrefs): DisplayPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_PREFS;
    return parse(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: DisplayPrefs): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* 隐私模式写不了，忽略 */ }
}
