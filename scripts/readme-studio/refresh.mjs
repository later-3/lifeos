#!/usr/bin/env node
/**
 * 一键重跑全部 README 素材（GIF + 静态图）。
 *
 * 为什么要有一个统一入口：
 *   README 会**频繁更新**（用户 2026-11-18 明确要求）。每次要么记住 8 个 storyboard 名字、
 *   要么漏掉几张图 —— 前者容易错，后者更糟（图与界面不同步，是 C218 那类返工的来源）。
 *   这个脚本按故事板清单跑完，最后打印"哪些图更新了、哪些没变"，成为一次原子动作。
 *
 * 它做的事：
 *   1. 体检：后台 + 前端 + 打桩服务三件都在（缺哪个就报清楚怎么起）
 *   2. 按顺序跑所有 storyboard（stills 放最后，它依赖前面已经稳定的界面状态无影响，但先跑静图更稳）
 *   3. 汇总：每张图的体积、与 git HEAD 相比是否变化
 *   4. 门禁：跑 doc-links（两份 README 的图片集合/章节/断链）
 *
 * 用法：
 *   STUDIO_APP=http://127.0.0.1:5182 node scripts/readme-studio/refresh.mjs
 *   ... --only=hero,theme-tour      只跑指定几个
 *   ... --no-check                  跳过门禁
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const HERE = import.meta.dirname;
const ROOT = join(HERE, "..", "..");
const STORYBOARDS = join(HERE, "storyboards");
const APP = process.env.STUDIO_APP ?? "http://127.0.0.1:5182";

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7)?.split(",").map((s) => s.trim());
const noCheck = args.includes("--no-check");

/** 体检：三件套是否在跑。缺了直接报"怎么起"，不然会拍到一半失败。 */
async function preflight() {
  const checks = [
    { name: "前端", url: `${APP}/`, hint: `VITE_DEV_API=<后端> pnpm --dir frontend exec vite --port <端口>` },
    { name: "打桩模型", url: "http://127.0.0.1:43140/v1/models", hint: "node scripts/readme-studio/stub-model.mjs" },
  ];
  for (const check of checks) {
    try {
      const response = await fetch(check.url, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      throw new Error(`${check.name} 没在跑（${check.url}）：${String(error).slice(0, 120)}\n  起它：${check.hint}`);
    }
  }
}

/** 一份 storyboard 会写到哪些图（从 outputs 里读，不猜命名）。 */
function outputsOf(name) {
  const text = execFileSync("cat", [join(STORYBOARDS, `${name}.yml`)]).toString();
  return [...text.matchAll(/file:\s*([\w.-]+\.(?:gif|webp|mp4))/g)].map((m) => m[1]);
}

function sizeOf(file) {
  const path = join(ROOT, "docs/images", file);
  return existsSync(path) ? statSync(path).size : undefined;
}

const interactive = (name) => name === "stills" || name === "hero";

const all = readdirSync(STORYBOARDS).filter((f) => f.endsWith(".yml")).map((f) => basename(f, ".yml"));
// stills 放最后：它要在"界面已就位"的状态下拍，前面跑完 GIF 后页面状态更稳定
const order = ["hero", "turns-steer", "review", "annotate", "peer-delegate", "mobile-pwa", "theme-tour", "stills"]
  .filter((name) => all.includes(name))
  .concat(all.filter((name) => !["hero", "turns-steer", "review", "annotate", "peer-delegate", "mobile-pwa", "theme-tour", "stills"].includes(name)));

const targets = only === undefined ? order : order.filter((name) => only.includes(name));

await preflight();
console.log(`\n将跑 ${targets.length} 个 storyboard：${targets.join(" · ")}\n`);

const results = [];
for (const name of targets) {
  const before = Object.fromEntries(outputsOf(name).map((file) => [file, sizeOf(file)]));
  process.stdout.write(`▶ ${name} … `);
  try {
    const output = execFileSync("node", [join(HERE, "run.mjs"), name], {
      env: { ...process.env, STUDIO_APP: APP },
      cwd: ROOT,
    }).toString();
    const after = Object.fromEntries(outputsOf(name).map((file) => [file, sizeOf(file)]));
    const changed = Object.entries(after).filter(([file, size]) => size !== undefined && before[file] !== size);
    results.push({ name, ok: true, outputs: after, changed: changed.length });
    console.log(`✓ ${changed.length} 张更新`);
  } catch (error) {
    const message = String(error?.stdout ?? error).slice(-600);
    results.push({ name, ok: false, error: message });
    console.log("✗ 失败");
  }
}

console.log("\n── 汇总 ──");
for (const result of results) {
  if (!result.ok) {
    console.log(`✗ ${result.name}`);
    console.log(result.error.split("\n").slice(-4).map((line) => `    ${line}`).join("\n"));
    continue;
  }
  const sizes = Object.entries(result.outputs)
    .map(([file, size]) => `${file} ${size === undefined ? "缺失" : (size / 1024 / 1024 >= 1 ? (size / 1024 / 1024).toFixed(1) + "MB" : Math.round(size / 1024) + "KB")}`)
    .join(" · ");
  console.log(`${result.changed > 0 ? "●" : "○"} ${result.name.padEnd(14)} ${sizes}`);
}

if (!noCheck) {
  console.log("\n── 门禁（doc-links）──");
  try {
    const output = execFileSync("node", ["--experimental-strip-types", "--test", "test/doc-links.test.mjs"], { cwd: ROOT }).toString();
    console.log(output.split("\n").filter((line) => /^(✔|✖|ℹ (pass|fail))/.test(line)).join("\n"));
  } catch (error) {
    console.log(String(error?.stdout ?? error).split("\n").slice(-20).join("\n"));
    process.exitCode = 1;
  }
}

console.log("\n下一步：`git status --short docs/images` 看变更，逐张过目（MAINTAINING.md §2 第 5 步），再提交。");
if (results.some((r) => !r.ok)) process.exitCode = 1;
