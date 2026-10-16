// 停止开发/发布进程：按端口找进程并优雅结束（macOS/Linux；Windows 暂不支持）。
import { execFileSync } from "node:child_process";

const ports = { 43120: "后端（pnpm dev / pnpm start）", 5173: "前端 Vite（pnpm dev:web）", 5174: "前端 Vite（备用端口）" };
const extra = process.argv.find((arg) => arg.startsWith("--port="));
const targets = [...Object.keys(ports), ...(extra === undefined ? [] : [extra.slice("--port=".length)])];

function pidsOn(port) {
  try {
    return execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" })
      .split("\n").map((line) => line.trim()).filter((line) => line !== "");
  } catch { return []; }
}

const stopped = [];
for (const port of targets) {
  for (const pid of pidsOn(port)) {
    try {
      process.kill(Number(pid), "SIGTERM");
      stopped.push(`${ports[port] ?? `端口 ${port}`} (pid ${pid})`);
    } catch { /* 已经退出 */ }
  }
}

if (stopped.length === 0) {
  console.log("没有在跑的后端/前端进程。");
} else {
  console.log("已停止：");
  for (const item of stopped) console.log(`  ${item}`);
  const still = targets.flatMap((port) => pidsOn(port));
  if (still.length > 0) {
    for (const pid of still) { try { process.kill(Number(pid), "SIGKILL"); } catch { /* 忽略 */ } }
    console.log(`（有 ${still.length} 个进程没响应 SIGTERM，已强制结束）`);
  }
}
