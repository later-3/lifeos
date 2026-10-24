// HTTP 测试夹具（供多个测试文件复用；不复制、不清题）。
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { installHome } from "../src/home.ts";
import { createApp } from "../src/server.ts";

/** HOME 先设置再 createApp（server.ts 在调用时读 env）。 */
export async function startOn(home) {
  process.env.LIFEOS_HOME = home;
  const server = serve({ fetch: createApp().fetch, port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}`, home };
}

/** 全新临时家目录 + 起服务；适合"从出厂安装开始"的端到端用例。 */
export async function start() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-test-"));
  await installHome(process.cwd(), home);
  return await startOn(home);
}
