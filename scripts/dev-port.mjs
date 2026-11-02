#!/usr/bin/env node
// dev-port：开发实例的端口分配（Task 0016）。判定逻辑在 dev-ports-core.mjs（有测试），这里只做命令行。
//
//   node scripts/dev-port.mjs claim --task 0016 [--worktree <path>]
//   node scripts/dev-port.mjs list [--prune]
//   node scripts/dev-port.mjs release --task 0016
//
// 副作用：写 ~/.lifeos/state/dev-ports.json（原子写，全局唯一，与 LIFEOS_HOME 无关）。不杀进程、不改代码。
import { homedir } from "node:os";
import { join } from "node:path";
import { claimPorts, isPortBusy, listInstances, prune, releasePorts } from "./dev-ports-core.mjs";

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};
// 登记表必须全局唯一：用主家目录，**不读 LIFEOS_HOME**——否则每个开发实例各写一份，
// `list` 就看不到别人占的号（Task 0016 实测踩到：claim 跟着 LIFEOS_HOME 写进了 ~/.lifeos-dev/0016）。
const home = join(homedir(), ".lifeos");
// 空闲判定对 IPv4/IPv6 都成立，否则 Vite（[::1]）会被判成"已停"。
const portFree = async (port) => !(await isPortBusy(port));

const die = (message) => { console.error(message); process.exit(1); };

if (command === "claim") {
  const taskId = flag("task");
  if (taskId === undefined) die("用法：dev-port claim --task <NNNN> [--worktree <path>]");
  try {
    const result = await claimPorts({ home, taskId, worktree: flag("worktree") ?? "" });
    console.log(JSON.stringify(result, null, 2));
    console.log(`\n后端：LIFEOS_HOME=<独立家目录> node scripts/dev-supervisor.mjs --port=${result.backend}`);
    console.log(`前端：VITE_DEV_API=http://127.0.0.1:${result.backend} pnpm --dir frontend exec vite --port ${result.web}`);
  } catch (error) {
    die(`分配失败：${error instanceof Error ? error.message : String(error)}`);
  }
} else if (command === "list") {
  if (argv.includes("--prune")) {
    const dropped = await prune({ home, probe: portFree });
    for (const taskId of dropped) console.log(`清理幽灵条目：${taskId}`);
  }
  const rows = await listInstances({ home, probe: portFree });
  if (rows.length === 0) console.log("没有登记的开发实例。");
  else {
    console.log(["Task", "后端", "前端", "活动", "Worktree"].join("\t"));
    for (const row of rows) {
      const alive = row.backendAlive && row.webAlive ? "运行中" : row.backendAlive || row.webAlive ? "部分" : "已停";
      console.log([row.taskId, row.backend, row.web, alive, row.worktree].join("\t"));
    }
  }
} else if (command === "release") {
  const taskId = flag("task");
  if (taskId === undefined) die("用法：dev-port release --task <NNNN>");
  const existed = await releasePorts({ home, taskId });
  console.log(existed ? `已释放 ${taskId} 的端口登记（没有杀进程）` : `${taskId} 没有登记`);
} else {
  die("用法：dev-port <claim|list|release> [--task NNNN] [--worktree <path>] [--prune]");
}
