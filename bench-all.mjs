import { sessionRowsOf } from "./src/session-rows.ts";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
const H = join(homedir(), ".lifeos");
const agents = await readdir(join(H, "agents"));
const targets = [];
for (const a of agents) {
  const ps = await readdir(join(H, "agents", a, "projects")).catch(() => []);
  for (const p of ps) targets.push({ a, p });
}
console.log(`目标：${agents.length} Agent / ${targets.length} 项目绑定`);
for (const pass of [1, 2, 3]) {
  const t = performance.now();
  let rows = 0;
  for (const { a, p } of targets) rows += (await sessionRowsOf(a, p).catch(() => [])).length;
  console.log(`第 ${pass} 次全量扫描：${(performance.now() - t).toFixed(0)}ms，${rows} 行`);
}
