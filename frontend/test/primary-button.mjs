/**
 * 主按钮可见性门禁（Task 0014，C214）。
 *
 * 缺陷：tokens.css 的 @theme 缺 --color-accent-solid → Tailwind 不生成
 * `bg-accent-solid` utility → 主按钮永远透明底 + 白字（浅色下整颗消失）。
 *
 * 断言（testing 2.15：真实选择器 + 几何/计算值；0 个 = 没测）：
 * ① utility 存在性：探针元素挂 `bg-accent-solid`，computed backgroundColor 非透明；
 * ② 对比度：该底色与白字 ≥4.5（引擎保证的语义不变量在静态层的延续）；
 * ③ :root 变量存在（静态定义生效，非仅引擎写回）。
 * 活性验证（2.4）：去掉 @theme 定义后本测试必须红（2026-11-13 修前实测红）。
 *
 * 运行：APP_URL 指向任意本项目 dev 页面（默认 5173）。
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
function loadPlaywrightCore() {
  const candidates = [
    join(HERE, "../../frontend/node_modules/playwright-core/index.js"),
    join(process.env.HOME ?? "", ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
  ];
  for (const c of candidates) if (existsSync(c)) return require_(c);
  throw new Error("找不到 playwright-core：设置 PLAYWRIGHT_CORE=/path/to/playwright-core/index.js");
}

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const { chromium } = loadPlaywrightCore();

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1200);

const probe = await page.evaluate(() => {
  const el = document.createElement("div");
  el.className = "bg-accent-solid";
  el.style.cssText = "position:absolute;width:40px;height:28px;color:#ffffff;";
  el.textContent = "保存";
  el.setAttribute("data-primary-probe", "");
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const bg = cs.backgroundColor;
  const varValue = getComputedStyle(document.documentElement).getPropertyValue("--color-accent-solid").trim();
  // WCAG 对比度（白字 vs 底色）
  const lum = (r, g, b) => {
    const f = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  let contrast = 0;
  // 无 alpha 段的 rgb() = 不透明；alpha ≤0.9 = 透明/近透明（utility 不存在时浏览器给 rgba(0,0,0,0)）
  const opaque = m !== null && (m[4] === undefined || Number(m[4]) > 0.9);
  if (opaque) {
    const L1 = 1.0, L2 = lum(Number(m[1]), Number(m[2]), Number(m[3]));
    contrast = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  }
  el.remove();
  return { bg, opaque, contrast: Number(contrast.toFixed(2)), varValue };
});

let failed = 0;
const check = (name, pass, note) => {
  console.log(`${pass ? "✓" : "✗"} ${name}${note ? " — " + note : ""}`);
  if (!pass) failed = 1;
};
check("bg-accent-solid utility 存在（背景非透明）", probe.opaque, `computed: ${probe.bg}`);
check("静态底色与白字对比 ≥4.5", probe.contrast >= 4.5, `对比 ${probe.contrast}`);
check(":root 有 --color-accent-solid（静态定义）", probe.varValue !== "", `值: ${probe.varValue || "(空)"}`);
await browser.close();
console.log(failed ? "primary-button 门禁：✗ 红" : "primary-button 门禁：✓ 绿");
process.exit(failed);
