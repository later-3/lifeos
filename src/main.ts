// 进程入口：只校验家目录已安装（安装是 `pnpm home:install` 的事，启动不创建、不覆盖），然后起 HTTP 服务。
import { createAdaptorServer } from "@hono/node-server";
import { attachEventSocket } from "./event-socket.ts";
import { installProxyIfConfigured } from "./http-proxy.ts";
import { pathExists, resolveHome } from "./home.ts";
import { createApp } from "./server.ts";
import { initLogs } from "./logging.ts";
import { ensureMediaDir } from "./media.ts";
import { backfillUserLayer } from "./user-layer-backfill.ts";
import { syncCompactionSettings } from "./compaction-settings-file.ts";
import { log } from "./logging.ts";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = portArg === undefined ? 43120 : Number(portArg.slice("--port=".length));

// 先装代理感知：必须在任何出站请求之前（pi-ai 的 openai SDK 用 globalThis.fetch）。
// 没有代理变量时这一步什么都不做。原因见 src/http-proxy.ts 顶部。
const proxySetup = await installProxyIfConfigured();

const home = resolveHome();
if (!await pathExists(home)) {
  console.error(`家目录不存在：${home}`);
  console.error("请先运行：pnpm home:install");
  process.exit(1);
}
await initLogs();
await ensureMediaDir(home);   // 媒体库目录与说明文件（协议 §5.2）；已存在不覆盖
// 用户层回填（协议 §4.2.1 · Task 0035）：存量全局项目不会重走注册，所以这里补一次。
// create-only、幂等；失败只留一条 warn（不阻断启动，home:check 会把缺口报出来）。
await backfillUserLayer(home);
/*
 * 压缩阈值同步（Task 0041 · S2 · D4）：把 `reserveTokens = max(窗口 × 0.15, 32000)` 按模型写进
 * `config/settings.json` 的 `compaction.modelOverrides`。
 *
 * 为什么在这里做：
 *   · Pi 的 `getCompactionSettings()` 只从 settings.json 读，没有编程接口（`settings-manager.js:654`）；
 *   · `SettingsManager.create()` 在**会话创建时**读一次文件 → 这里写完后，**新建会话**拿到新阈值。
 *     （已有会话保持旧值：刻意不做热更新，避免“改配置”影响正在跑的回合。）
 *
 * 失败只 warn（不阻断启动）：models.json 缺失/坏、settings.json 坏都可能是用户正在修的状态，
 * 此时压缩回落 Pi 默认 16384（= 改动前的行为），不是新缺陷。
 */
const compactionSync = await syncCompactionSettings(home);
if (compactionSync.ok) {
  if (compactionSync.written) {
    console.log(`压缩阈值已写入 ${compactionSync.path}（${compactionSync.models} 个模型）`);
  }
} else {
  void log.warn("main", "startup", "压缩阈值未写入，回落 Pi 默认 16384", {
    details: { reason: compactionSync.reason, path: compactionSync.path },
  });
}
/*
 * 用 `createAdaptorServer` 而不是 `serve`：需要拿到 `http.Server` 才能挂 `upgrade`
 * （事件通道走 WebSocket，见 `src/event-socket.ts`；`serve()` 内部把 server 建好就直接 listen 了，
 * 没有暴露升级钩子）。
 */
/*
 * `as unknown as http.Server`：`createAdaptorServer` 的返回类型是 `Server | Http2Server | Http2SecureServer`，
 * 而默认参数（不传 `serverOptions.createServer`）实际总是 Node 的 `http.Server`。
 * 这里只用到 `listen`/`address`/`on("upgrade")`，三者签名一致；不为此引入类型分支。
 */
const server = createAdaptorServer({ fetch: createApp().fetch }) as unknown as import("node:http").Server;
attachEventSocket(server);
server.listen(port, "127.0.0.1", () => {
  const info = server.address() as { port: number };
  console.log(`Life OS 后端已启动: http://127.0.0.1:${info.port}（家目录 ${home}）`);
  if (proxySetup.installed) {
    console.log(`出站代理已按环境变量启用：${proxySetup.proxy}（NO_PROXY 命中的地址仍直连）`);
  } else {
    console.log("出站未配置代理（没有 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY 环境变量）");
  }
});
