/**
 * 图片查看器的缩放与平移数学（纯函数：frontend 2.13，组件只绑事件）。
 * 独立成 .ts 是因为 Node 测试不能 import 含 JSX 的 .tsx（test/image-viewer.test.mjs）。
 *
 * 参考：pi-web 上游 `components/ImagePreview.tsx`（e533d9b）只有开合、没有缩放；
 * 下面这些是按用户 2026-10-27「悬浮放大缩小」的要求补的。
 */

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;
/** 按钮/键盘的缩放步长：×1.5 比 ×2 少几次点击，比 ×1.25 少一次"不够大"的来回。 */
export const ZOOM_STEP = 1.5;

export function clampZoom(scale: number): number {
  if (Number.isNaN(scale)) return 1;                  // 非法值回到"适应窗口"
  if (scale === Infinity) return ZOOM_MAX;            // ±∞ 按方向钳到界
  if (scale === -Infinity) return ZOOM_MIN;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

export function nextZoom(scale: number, direction: 1 | -1, step = ZOOM_STEP): number {
  const raw = direction === 1 ? scale * step : scale / step;
  // 浮点会攒出 1.4999999 之类，显示与比较都难受；留两位
  return Math.round(clampZoom(raw) * 100) / 100;
}

export function zoomPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/** 图片在容器里"适应"的基础尺寸（等比、不裁切、不放超过 2 倍，避免小图糊成一片）。 */
export function fitSize(naturalW: number, naturalH: number, boxW: number, boxH: number): { w: number; h: number } {
  if (!(naturalW > 0) || !(naturalH > 0) || !(boxW > 0) || !(boxH > 0)) return { w: 0, h: 0 };
  const raw = Math.min(boxW / naturalW, boxH / naturalH);
  const scale = Math.min(raw, 2);
  return { w: Math.round(naturalW * scale), h: Math.round(naturalH * scale) };
}

/** 缩放后的实际显示尺寸（平移约束要用它）。 */
export function displaySize(fitW: number, fitH: number, scale: number): { w: number; h: number } {
  return { w: Math.round(fitW * scale), h: Math.round(fitH * scale) };
}

/**
 * 平移钳制：把图片钳回"至少还看得见一半"的范围内。
 * 图片比容器大 → 允许左右/上下各平移 (显示尺寸 - 容器)/2 + 半屏；
 * 图片没容器大 → 不允许平移（否则会被拖到看不见）。
 */
export function clampPan(offset: number, displayPx: number, boxPx: number): number {
  if (displayPx <= boxPx) return 0;
  const max = (displayPx - boxPx) / 2 + Math.min(boxPx, displayPx) / 2;
  return Math.min(max, Math.max(-max, offset));
}

