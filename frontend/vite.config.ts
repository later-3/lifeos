import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

/*
 * 构建版本（Task 0013，案例 C216）：buildId 是版本事实的唯一来源，构建期生成一次，
 * 三处消费（index.html 注入 / dist/version.json / dist/sw.js 缓存 key）全部由它派生。
 * - buildId = git sha 短码 + 时间戳 36 进制：同一 commit 两次构建也不同（时间戳），必变；
 * - dev 模式不注入（version-check 靠"无注入即跳过"，零成本）；
 * - sw.js 的占位符 `__LIFEOS_SW_BUILD__` 在 closeBundle 里替换——public/ 是静态拷贝，
 *   vite 不处理它，只能在产物侧重写。
 */
function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short=10 HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "nogit"; // 非 git 环境（如 CI 深克隆失败）降级；时间戳仍保证 buildId 必变
  }
}

const buildId = `${gitShortSha()}-${Date.now().toString(36)}`;

function lifeosBuildVersion(): Plugin {
  return {
    name: "lifeos-build-version",
    transformIndexHtml(_html, ctx) {
      // dev 不注入：version-check 靠"无注入即跳过"，dev 环境零成本且可测试性不受干扰
      //（测试用 addInitScript 自己注入；若 dev 也注入，会盖掉测试夹具——C217 修复中实测踩到）
      if (ctx?.server) return [];
      return [
        {
          tag: "script",
          children: `window.__LIFEOS_BUILD__=${JSON.stringify(buildId)};`,
          injectTo: "head-prepend",
        },
      ];
    },
    closeBundle() {
      const outDir = "dist";
      writeFileSync(`${outDir}/version.json`, JSON.stringify({ buildId }) + "\n");
      const swPath = `${outDir}/sw.js`;
      const sw = readFileSync(swPath, "utf8");
      if (!sw.includes("__LIFEOS_SW_BUILD__")) {
        throw new Error("sw.js 缺少 __LIFEOS_SW_BUILD__ 占位符——缓存 key 无法注入构建版本（Task 0013 契约）");
      }
      // 预缓存清单（install 时 cache.addAll，首次访问即有完整断线兜底）：
      // dist 根的固定壳文件 + 全部带 hash 的 assets。构建期扫产物，不与运行时相互猜。
      const assets = readdirSync(`${outDir}/assets`, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => `/assets/${e.name}`);
      const shell = ["/", "/manifest.webmanifest", "/icon.svg", "/apple-touch-icon.png"];
      const precache = [...shell, ...assets];
      writeFileSync(
        swPath,
        sw
          .replaceAll("__LIFEOS_SW_BUILD__", buildId)
          .replaceAll("__LIFEOS_PRECACHE__", JSON.stringify(precache)),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), lifeosBuildVersion()],
  server: {
    // 后端地址：默认 43120；调试别的端口时用 VITE_DEV_API=http://127.0.0.1:43121 pnpm dev:web
    proxy: { "/api": process.env.VITE_DEV_API ?? "http://127.0.0.1:43120" },
  },
});
