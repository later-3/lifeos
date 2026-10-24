// 进程入口：只校验家目录已安装（安装是 `pnpm home:install` 的事，启动不创建、不覆盖），然后起 HTTP 服务。
import { serve } from "@hono/node-server";
import { pathExists, resolveHome } from "./home.ts";
import { createApp } from "./server.ts";
import { initLogs } from "./logging.ts";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = portArg === undefined ? 43120 : Number(portArg.slice("--port=".length));

const home = resolveHome();
if (!await pathExists(home)) {
  console.error(`家目录不存在：${home}`);
  console.error("请先运行：pnpm home:install");
  process.exit(1);
}
await initLogs();
serve({ fetch: createApp().fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`Life OS 后端已启动: http://127.0.0.1:${info.port}（家目录 ${home}）`);
});
