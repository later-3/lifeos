/**
 * 复制文本（消息动作条用）。
 * 优先 Clipboard API；不可用时退回 textarea + execCommand（老浏览器/非安全上下文）。
 * 参照 Pi Web 的 lib/clipboard.ts：两条路径都要有，且失败要让调用方能看见（reject，不吞）。
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand("copy")) throw new Error("execCommand('copy') 返回 false");
  } finally {
    document.body.removeChild(area);
  }
}
