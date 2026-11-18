import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

/*
 * 构建版本（Task 0013，案例 C216；Task 0024 收窄到唯一消费者）：buildId 构建期生成一次，
 * **只给 `sw.js` 的缓存 key 用**（`lifeos-shell-<buildId>`）。
 * - buildId = git sha 短码 + 时间戳 36 进制：同一 commit 两次构建也不同（时间戳），必变；
 * - 为什么必须每次构建都变：cache key 恒定 = activate 里 `key !== CACHE` 永假 = 旧缓存永不清除
 *   （C216 的原始根因：界面跑旧 bundle 数日）；
 * - sw.js 的占位符 `__LIFEOS_SW_BUILD__` 在 closeBundle 里替换——public/ 是静态拷贝，
 *   vite 不处理它，只能在产物侧重写。
 *
 * 2026-11-17（Task 0024）删除：此前还向 index.html 注入 `window.__LIFEOS_BUILD__` 并写
 * `dist/version.json`，供前端轮询比对后弹「有新版本」提示条。该提示条的触发条件等同于
 * 用户自己执行构建，没有信息量，整条链路（页面轮询 + 提示条 + version.json）已删除。
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
    closeBundle() {
      const outDir = "dist";
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
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API ?? "http://127.0.0.1:43120",
        /*
         * `ws: true` 必须显式写：事件通道是 WebSocket（Task 0028 · P3），
         * 而 http-proxy 默认**不转发** upgrade 请求 —— 漏了它，开发模式下整条事件通道静默失效
         * （表现为：页面能开、但运行点/未读/流式全不动，且控制台只有一句 ws 连接失败）。
         * `testing.md` 2.12 要求"断线重连必须经真实代理路径验证"，本行就是那条路径的前提。
         */
        ws: true,
      },
    },
  },
});
