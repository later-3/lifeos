#!/usr/bin/env node
// instance-drift：主实例前后端是否错版（协议 §3.7 主区边界；开发规范 §7.4）。
//
//   node scripts/instance-drift.mjs [--port 43120] [--root /Users/<user>/Code/lifeos]
//
// 只读：lsof 找进程、ps 读启动时刻、stat 读产物 mtime。不重启、不构建、不写任何文件。
// 判定逻辑在 instance-drift-core.mjs（纯函数 + 有测试），这里只做命令行。
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PORT, collectDrift } from "./instance-drift-core.mjs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};

const port = Number.parseInt(flag("port") ?? String(DEFAULT_PORT), 10);
const root = flag("root") ?? join(homedir(), "Code", "lifeos");
const drift = await collectDrift(root, port);

const stamp = (ms) => (ms === undefined ? "—" : new Date(ms).toLocaleString("zh-CN", { hour12: false }));

console.log(`主实例：端口 ${drift.port}${drift.pid === undefined ? "（没有进程）" : ` pid=${drift.pid}`}`);
console.log(`  进程启动：${stamp(drift.processStart)}`);
console.log(`  后端产物：${stamp(drift.backendArtifact)}   (${join(root, "dist", "server.mjs")})`);
console.log(`  前端产物：${stamp(drift.frontendArtifact)}   (${join(root, "frontend", "dist", "index.html")})`);
console.log("");
console.log(`判定：${drift.verdict.state}`);
console.log(`事实：${drift.verdict.detail}`);
console.log(`下一步：${drift.verdict.next}`);

// unknown 不是错误（实例没跑时正常），所以退出码只区分“读到不合法的端口/根目录”
process.exit(0);
