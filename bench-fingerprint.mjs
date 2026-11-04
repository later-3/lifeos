// 对比：全扫 vs stat-only（fingerprint 命中时只需 stat）
import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
const H = join(homedir(), ".lifeos");
const agents = await readdir(join(H, "agents"));
const files = [];
for (const a of agents) {
  const ps = await readdir(join(H, "agents", a, "projects")).catch(() => []);
  for (const p of ps) {
    const d = join(H, "agents", a, "projects", p, "sessions");
    for (const f of await readdir(d).catch(() => [])) if (f.endsWith(".jsonl")) files.push(join(d, f));
  }
}
console.log(`文件数：${files.length}`);

// A: 全读（现在的做法）
let t = performance.now();
for (const f of files) await readFile(f, "utf8").catch(() => "");
console.log(`A 全读文件（现在）：${(performance.now()-t).toFixed(0)}ms`);

// B: 只 stat（fingerprint 命中时）
t = performance.now();
for (const f of files) await stat(f).catch(() => {});
console.log(`B 只 stat（缓存命中）：${(performance.now()-t).toFixed(0)}ms`);

// C: 并行 stat
t = performance.now();
await Promise.all(files.map((f) => stat(f).catch(() => {})));
console.log(`C 并行 stat：${(performance.now()-t).toFixed(0)}ms`);

// D: 并行读
t = performance.now();
await Promise.all(files.map((f) => readFile(f, "utf8").catch(() => "")));
console.log(`D 并行读：${(performance.now()-t).toFixed(0)}ms`);
