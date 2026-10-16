// 进程入口：确保家目录已安装，然后起 HTTP 服务。
import { serve } from "@hono/node-server";
import { installHome, resolveHome } from "./home.ts";
import { createApp } from "./server.ts";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = portArg === undefined ? 43120 : Number(portArg.slice("--port=".length));

const home = resolveHome();
await installHome(process.cwd(), home);
serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`Life OS 后端已启动: http://127.0.0.1:${info.port}（家目录 ${home}）`);
});
