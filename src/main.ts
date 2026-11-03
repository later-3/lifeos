// 进程入口：只校验家目录已安装（安装是 `pnpm home:install` 的事，启动不创建、不覆盖），然后起 HTTP 服务。
import { serve } from "@hono/node-server";
import { installProxyIfConfigured } from "./http-proxy.ts";
import { pathExists, resolveHome } from "./home.ts";
import { createApp } from "./server.ts";
import { initLogs } from "./logging.ts";

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
serve({ fetch: createApp().fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`Life OS 后端已启动: http://127.0.0.1:${info.port}（家目录 ${home}）`);
  if (proxySetup.installed) {
    console.log(`出站代理已按环境变量启用：${proxySetup.proxy}（NO_PROXY 命中的地址仍直连）`);
  } else {
    console.log("出站未配置代理（没有 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY 环境变量）");
  }
});
