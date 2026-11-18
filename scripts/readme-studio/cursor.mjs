/**
 * 拍摄光标：录屏时把鼠标位置与点击画进画面。
 *
 * 为什么必须自己注入：Chromium 的录屏（recordVideo 与 CDP screencast 都一样）**不含系统光标**，
 * 观众看不出"这一步点了哪里"，产品演示就退化成幻灯片。
 *
 * 手法参考 `simonw/shot-scraper` @63104b0 的 `_storyboard_cursor_script`（`shot_scraper/cli.py:2088-2190`，
 * Apache-2.0）：固定定位圆点跟随 mousemove，mousedown 时插一枚扩散圆环。
 * **不引它的依赖**（那是 Python CLI），只照抄这套 DOM 手法，并按我们的需要改两点：
 *   1. 颜色取我们的 accent（#2563eb），不用它的橙色；
 *   2. 加 `data-lifeos-cursor`，便于截图/断言时排除，也便于排查"这个点是从哪来的"。
 *
 * 用法：`await context.addInitScript({ content: CURSOR_SCRIPT })`（每个 page 自动生效）。
 */
export const CURSOR_SCRIPT = `
(() => {
  if (window.__lifeosCursorInstalled) return;
  window.__lifeosCursorInstalled = true;

  const COLOR = "#2563eb";
  const SIZE = 18;
  const CLICK_SIZE = 46;

  function install() {
    if (document.body === null) { requestAnimationFrame(install); return; }

    const style = document.createElement("style");
    style.textContent = \`
      [data-lifeos-cursor] {
        position: fixed; left: 0; top: 0;
        width: \${SIZE}px; height: \${SIZE}px;
        margin-left: \${-SIZE/2}px; margin-top: \${-SIZE/2}px;
        border-radius: 999px;
        background: \${COLOR};
        border: 2px solid #fff;
        box-shadow: 0 2px 10px rgba(0,0,0,.35);
        opacity: 0; pointer-events: none; z-index: 2147483647;
        transition: left 90ms ease-out, top 90ms ease-out, opacity 90ms ease-out;
      }
      [data-lifeos-click] {
        position: fixed;
        width: \${CLICK_SIZE}px; height: \${CLICK_SIZE}px;
        margin-left: \${-CLICK_SIZE/2}px; margin-top: \${-CLICK_SIZE/2}px;
        border: 3px solid \${COLOR}; border-radius: 999px;
        pointer-events: none; z-index: 2147483646;
        animation: lifeos-click-ring 620ms ease-out forwards;
      }
      @keyframes lifeos-click-ring {
        from { opacity: .85; transform: scale(.25); }
        to   { opacity: 0;   transform: scale(1.3); }
      }
    \`;
    document.documentElement.appendChild(style);

    const dot = document.createElement("div");
    dot.setAttribute("data-lifeos-cursor", "");
    document.body.appendChild(dot);

    const move = (event) => {
      dot.style.left = event.clientX + "px";
      dot.style.top = event.clientY + "px";
      dot.style.opacity = "1";
    };
    const ring = (event) => {
      const el = document.createElement("div");
      el.setAttribute("data-lifeos-click", "");
      el.style.left = event.clientX + "px";
      el.style.top = event.clientY + "px";
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 700);
    };
    document.addEventListener("mousemove", move, true);
    document.addEventListener("mousedown", (event) => { move(event); ring(event); }, true);
    document.addEventListener("click", move, true);
  }
  install();
})();
`;
