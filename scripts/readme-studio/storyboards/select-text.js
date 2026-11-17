// 在最后一条助手消息里拖选一段正文，并触发 mouseup 让功能条出现。
//
// 为什么用脚本而不是鼠标拖拽：正文在 iframe 之外、位置随内容变化，
// 按坐标拖选每次都要重调；按文本节点选一段则稳定得多。
(() => {
  const blocks = [...document.querySelectorAll('[data-testid="message-text"]')];
  const last = blocks[blocks.length - 1];
  if (!last) return "no-block";
  const walker = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
  let node = null;
  while (walker.nextNode()) {
    const value = walker.currentNode.nodeValue ?? "";
    if (value.trim().length > 24) { node = walker.currentNode; break; }
  }
  if (!node) return "no-text-node";
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, Math.min(20, node.length));
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  // 功能条由 mouseup 触发
  const rect = range.getBoundingClientRect();
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
  return "selected";
})()
