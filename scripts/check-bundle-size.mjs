#!/usr/bin/env node
/**
 * 首屏产物预算门禁（Task 0016 · P2-S3）。
 *
 * ## 为什么需要它
 *
 * 2026-11-16 实测（案例 C001）：0015 为了支持"三套图标集可切换"用了
 * `import * as Tabler/Lucide/Phosphor` + 动态索引，tree-shaking 失效，
 * **三个库整包进了首屏 8572 KB**（主 chunk 9.27 MB 的 ≈87%–92%），而我们只用 41 个语义名。
 *
 * 它通过了 1356 条单测、219 条 UI 契约、三类 lint —— **因为没有任何门禁看产物大小**。
 * 手机上的表现是"打开要等"（4G 无压缩时 45.8 s，CF brotli 后 9.6 s）。
 *
 * ## 阈值从哪来（协议 §3.13：不自创数字）
 *
 * **未压缩 ≤ 1.0 MB**：各模块实测字节相加 ——
 *   自有源码 ≈330 KB + react/react-dom 216 KB + prism/marked/dompurify/diff ≈208 KB
 *   + 三套图标（41 语义名 × 3 套，命名导入）136 KB ≈ **890 KB**，留 ≈12% 余量。
 *   改完图标后实测 **820 KB**（余量 22%）。
 *
 * **brotli ≤ 260 KB**（手机真正收到的）：CF 边缘用 brotli 下发（`evidence/deployment-facts.md` §5），
 *   实测 **207 KB**（压缩比 0.253），留 25% 余量 → 260 KB。
 *
 * **gzip ≤ 320 KB**（无边缘时的兜底）：实测 **252 KB**（压缩比 0.307），留 27% 余量。
 *
 * **注意压缩比会随内容变化**：图标库是高度重复的 SVG 数据，压缩比 ≈0.22；
 * 把它换成代码后压缩比变成 ≈0.30（同样字节数压得更小不了）。所以阈值不能按"旧压缩比 × 新体积"推，
 * 必须**重新实测**——这条是本次改完才发现阈值定小的原因（实测 252 > 原定 250）。
 *
 * ## 活性验证（规范 2.4：门禁要能证明自己活着）
 *
 * `--self-test` 会用一个伪造的 1.1 MB chunk 跑一遍判定，**必须**报红；否则说明阈值逻辑失效。
 *
 * 用法：
 *   node scripts/check-bundle-size.mjs             # 校验 dist 产物
 *   node scripts/check-bundle-size.mjs --self-test # 活性验证
 *   node scripts/check-bundle-size.mjs --dir <p>   # 换产物目录（默认 frontend/dist）
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { join } from "node:path";

/** 主 chunk 是"首屏必须下载的入口 JS"——`assets/index-*.js` 里最大的那个。 */
const MAX_BYTES = 1.0 * 1024 * 1024;
const MAX_BROTLI_BYTES = 260 * 1024;
const MAX_GZIP_BYTES = 320 * 1024;

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? undefined : argv[i + 1]; };

/** 找主 chunk：`assets/` 下体积最大的 `.js`。 */
function mainChunkOf(distDir) {
  const assets = join(distDir, "assets");
  if (!existsSync(assets)) return null;
  const files = readdirSync(assets).filter((name) => name.endsWith(".js"))
    .map((name) => ({ path: join(assets, name), size: statSync(join(assets, name)).size }))
    .sort((a, b) => b.size - a.size);
  return files[0] ?? null;
}

/** 判定一份产物是否超预算。返回失败原因数组（空 = 通过）。 */
function violationsOf({ size, gzipSize, brotliSize }) {
  const bad = [];
  if (size > MAX_BYTES) {
    bad.push(`未压缩 ${(size / 1024).toFixed(0)} KB > 上限 ${MAX_BYTES / 1024} KB`);
  }
  if (brotliSize > MAX_BROTLI_BYTES) {
    bad.push(`brotli ${(brotliSize / 1024).toFixed(0)} KB > 上限 ${MAX_BROTLI_BYTES / 1024} KB（手机实际收到的就是这一档）`);
  }
  if (gzipSize > MAX_GZIP_BYTES) {
    bad.push(`gzip ${(gzipSize / 1024).toFixed(0)} KB > 上限 ${MAX_GZIP_BYTES / 1024} KB`);
  }
  return bad;
}

if (argv.includes("--self-test")) {
  const cases = [
    // [说明, 输入, 期望是否红]
    ["未压缩超限", { size: Math.round(1.1 * 1024 * 1024), gzipSize: 100 * 1024, brotliSize: 80 * 1024 }, true],
    ["brotli 超限", { size: 820 * 1024, gzipSize: 252 * 1024, brotliSize: 300 * 1024 }, true],
    ["gzip 超限", { size: 820 * 1024, gzipSize: 400 * 1024, brotliSize: 207 * 1024 }, true],
    ["全部在预算内", { size: Math.round(0.9 * 1024 * 1024), gzipSize: 300 * 1024, brotliSize: 240 * 1024 }, false],
    ["实测值（改完图标的真实产物）", { size: 820 * 1024, gzipSize: 252 * 1024, brotliSize: 207 * 1024 }, false],
  ];
  for (const [label, input, shouldFail] of cases) {
    const failed = violationsOf(input).length > 0;
    if (failed !== shouldFail) {
      console.error(`✗ 活性验证失败：[${label}] 期望${shouldFail ? "红" : "绿"}，实际${failed ? "红" : "绿"}`);
      process.exit(1);
    }
  }
  console.log(`✓ 活性验证通过（${cases.length} 个用例：三档各自能红 / 实测值不误红）`);
  process.exit(0);
}

const distDir = flag("dir") ?? "frontend/dist";
const chunk = mainChunkOf(distDir);
if (chunk === null) {
  console.error(`✗ 找不到产物：${distDir}/assets/*.js（先 pnpm build）`);
  process.exit(1);
}
const body = readFileSync(chunk.path);
const gzipSize = gzipSync(body).length;
const brotliSize = brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } }).length;
const bad = violationsOf({ size: chunk.size, gzipSize, brotliSize });
const label = chunk.path.split("/").pop();

if (bad.length > 0) {
  console.error(`✗ 首屏体积超预算：${label}`);
  for (const reason of bad) console.error(`   ${reason}`);
  console.error("   阈值来源见本脚本头注（模块实测字节相加 / 协议 §3.13）。");
  console.error("   常见原因：新增了图标库或大依赖的命名空间导入（`import * as`）——tree-shaking 会失效。");
  process.exit(1);
}

console.log(`✓ 首屏体积在预算内：${label} ${(chunk.size / 1024).toFixed(0)} KB 未压缩 / ${(brotliSize / 1024).toFixed(0)} KB brotli / ${(gzipSize / 1024).toFixed(0)} KB gzip（上限 1024 / 260 / 320 KB）`);
