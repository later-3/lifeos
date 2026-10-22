#!/usr/bin/env node
/** PWA 安装契约：manifest、图标、iOS meta、service worker 必须齐全。 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const root = new URL("../..", import.meta.url).pathname;
const pub = join(root, "frontend/public");
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
  if (!ok) failures.push(name);
};
const manifest = JSON.parse(readFileSync(join(pub, "manifest.webmanifest"), "utf8"));
const sizes = new Set((manifest.icons ?? []).map((icon) => icon.sizes));
check("manifest：name/short_name", manifest.name === "Life OS" && manifest.short_name === "Life OS");
check("manifest：start_url/scope/display", manifest.start_url === "/" && manifest.scope === "/" && manifest.display === "standalone");
check("manifest：192/512 图标", sizes.has("192x192") && sizes.has("512x512"));
check("manifest：maskable 图标", (manifest.icons ?? []).some((icon) => (icon.purpose ?? "").includes("maskable")));
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  const path = join(pub, name);
  check(`图标存在：${name}`, existsSync(path), `${size}px`);
  if (existsSync(path)) {
    const bytes = readFileSync(path);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    check(`图标尺寸：${name}`, width === size && height === size, `${width}x${height}`);
  }
}
const html = readFileSync(join(root, "frontend/index.html"), "utf8");
check("index：manifest 链接", html.includes('rel="manifest"') && html.includes("/manifest.webmanifest"));
check("index：manifest 带凭据（Cloudflare Access）", html.includes('crossorigin="use-credentials"'));
check("index：apple touch icon", html.includes('rel="apple-touch-icon"'));
check("index：iOS standalone meta", html.includes('name="apple-mobile-web-app-capable"'));
check("index：全面屏安全区", html.includes("viewport-fit=cover"));
check("service worker 存在", existsSync(join(pub, "sw.js")));
const sw = readFileSync(join(pub, "sw.js"), "utf8");
check("service worker：只走同源 GET / 有 fetch", sw.includes('addEventListener("fetch"') && sw.includes('request.method !== "GET"'));
if (failures.length > 0) {
  console.error(`PWA 契约失败 ${failures.length} 项`);
  process.exit(1);
}
console.log("PWA 契约通过");
