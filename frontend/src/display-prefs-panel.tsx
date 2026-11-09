/**
 * 显示设置弹层（内容宽度 + 字号）—— **Popover primitive 的第一个使用者**。
 *
 * 历史（2026-11-09 用户："还是应该在外面搞一个配置，就是原来的老位置，
 * 因为之前是改动配置，用户能实时看到工作区的改变的"）：
 *  - 2026-11-02：它是头部「完整历史 / 文件面板」两个图标旁的弹层，能边调边看；
 *  - 2026-11-09 P1：被换成"设置页"入口 → 设置页把工作区整块盖住 → **看不见反馈**；
 *  - 2026-11-09 本轮：作为 Popover 放回头部（桌面），手机隐藏（手机头部已有 6 个图标，标题只剩 38px）。
 *
 * 与设置页的关系：**设置页是总入口，这里是快捷入口**，两者读写同一份 `DisplayPrefs`，
 * 不存在第二份状态（用户原话："这里的设置里面的显示设置可以先保留，毕竟是总入口"）。
 */
import { useRef } from "react";
import { IconAdjustments, IconMinus, IconPlus } from "@tabler/icons-react";

import { IconButton } from "./design/ui";
import { Popover } from "./design/popover-view";
import { LAYER_CLASS } from "./design/surface";
import {
  DEFAULT_PREFS, FONT_SCALE_MAX, FONT_SCALE_MIN, focusWidthOf, fontFromSlider, fontLabel,
  sliderFromFont, sliderFromWidth, widthFromSlider, widthLabel, type DisplayPrefs,
} from "./display-prefs";

/** 弹层宽度：320（2026-11-09 拍板）。理由：滑块行程从 288 的 ~180 增到 ~210，
 *  而正文区在 1440 窗口下 864 → 320 只占 37%，右侧仍看得见正文变化（"边调边看"的前提）。 */
const PANEL_WIDTH = 320;

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
          className="h-11 w-full cursor-pointer accent-accent sm:h-7" />
        <IconPlus size={12} aria-hidden="true" className="shrink-0 text-ink-300" />
      </div>
      <div className="flex justify-between text-micro text-ink-300">
        <span>{hintLeft}</span>
        <span>{hintRight}</span>
      </div>
    </div>
  );
}

export function DisplayPrefsPanel({ prefs, viewport, onChange, open = false, onOpenChange }: {
  prefs: DisplayPrefs;
  viewport: number;
  onChange: (next: DisplayPrefs) => void;
  /** 受控开关（外面还要用它做"点 rail 项先关掉"之类的协调） */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);

  const widthPercent = sliderFromWidth(prefs.width, viewport);
  const fontPercent = sliderFromFont(prefs.font);

  return (
    <>
      <span ref={anchorRef} className="inline-flex">
        <IconButton label="显示设置" size="lg" active={open}
          aria-expanded={open} aria-haspopup="dialog"
          onClick={() => onOpenChange?.(!open)}>
          <IconAdjustments size={16} />
        </IconButton>
      </span>
      <Popover open={open} onClose={() => onOpenChange?.(false)} anchorRef={anchorRef}
        width={PANEL_WIDTH} label="显示设置">
        <div className="flex flex-col gap-3" data-testid="display-prefs-quick">
          <SliderRow id="quick-width" label="内容宽度" value={widthPercent}
            display={widthLabel(prefs.width)}
            hintLeft={`专注 ${focusWidthOf(viewport)}px`} hintRight="铺满"
            onChange={(next) => onChange({ ...prefs, width: widthFromSlider(next, viewport) })} />
          <SliderRow id="quick-font" label="字号" value={fontPercent}
            display={fontLabel(prefs.font)}
            hintLeft={`${Math.round(FONT_SCALE_MIN * 100)}%`} hintRight={`${Math.round(FONT_SCALE_MAX * 100)}%`}
            onChange={(next) => onChange({ ...prefs, font: fontFromSlider(next) })} />
          <div className="flex items-center justify-between border-t border-line pt-2">
            <button type="button"
              className="rounded-control px-1.5 py-1 text-micro text-ink-500 transition-colors hover:bg-hover hover:text-ink-900"
              onClick={() => onChange(DEFAULT_PREFS)}>
              恢复默认
            </button>
            <span className={`text-micro text-ink-300 ${LAYER_CLASS.popover}`} aria-hidden="true">Esc 关闭</span>
          </div>
        </div>
      </Popover>
    </>
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
