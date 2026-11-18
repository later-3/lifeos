// HTTP 测试夹具（供多个测试文件复用；不复制、不清题）。
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import { installHome } from "../src/home.ts";
import { createApp } from "../src/server.ts";
import { attachEventSocket } from "../src/event-socket.ts";

/**
 * HOME 先设置再 createApp（server.ts 在调用时读 env）。
 *
 * 用 `createAdaptorServer` + 手动 `listen`（而不是 `serve`）的原因：
 * 事件通道是 WebSocket，需要一个可挂 `upgrade` 的 `http.Server`
 * （Task 0028 · P3；`serve()` 不暴露 server 实例的升级钩子）。
 * `eventSocket` 句柄供用例注入更短的心跳/更小的积压上限后重建。
 */
export async function startOn(home, eventSocketOptions = undefined) {
  process.env.LIFEOS_HOME = home;
  const server = createAdaptorServer({ fetch: createApp().fetch });
  const sockets = attachEventSocket(server, eventSocketOptions ?? {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const originalClose = server.close.bind(server);
  server.close = (cb) => { sockets.close(); return originalClose(cb); };
  return { server, base: `http://127.0.0.1:${port}`, home };
}

/** 全新临时家目录 + 起服务；适合"从出厂安装开始"的端到端用例。 */
export async function start() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-test-"));
  await installHome(process.cwd(), home);
  return await startOn(home);
}
