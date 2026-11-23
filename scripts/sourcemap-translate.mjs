/**
 * 卡死取证：把 `Debugger.paused` 的调用栈翻译成**可读的源码位置**（Task 0033 · P5）。
 *
 * ## 这个模块解决什么
 *
 * `Debugger.paused` 给的 `location` 是**运行时代码**的位置：
 *  - dev server（5183）：已经是 `/src/App.tsx:1247:31`，可直接读；
 *  - 生产产物（43120）：是 `index-xxx.js:97:7163`，**压缩后的行列**，必须经 sourcemap 才能变成源码行。
 *
 * 所以取证工具必须能解码 sourcemap。本模块只做这件事（纯函数，便于测试）。
 *
 * ## 为什么自己实现 VLQ 解码
 *
 * 项目已有 `source-map-js`（vite 的依赖），但它在 `node_modules/.pnpm/...` 深处，
 * 而取证工具是**紧急排查工具** —— 用户卡死时现装依赖是灾难。所以：
 *
 * 1. 优先用 `source-map-js`（有就用，质量更好）；
 * 2. 拿不到就退回本文件里的 VLQ 解码（够用：只需要 `mappings` 的 `originalPositionFor`）。
 *
 * ## 支持两种 sourcemap 形态
 *
 * - **外部 `.map` 文件**：`index-xxx.js.map`，内容 JSON；
 * - **内联 base64**：`//# sourceMappingURL=data:application/json;base64,...`（Vite dev 用这个）。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/* ───────────────────────── VLQ 解码（最简实现） ───────────────────────── */

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_INDEX = new Map([...BASE64].map((char, index) => [char, index]));

/**
 * 解码一行 mappings，返回 `[生成列, 源文件索引, 源行, 源列]` 的绝对位置数组。
 *
 * ⚠️ **生成列每行从 0 重新开始**，只有 source / line / offset 跨行累加。
 * 我第一版把 column 也跨行累加了 —— 单测用的手造映射恰好每行第一个 segment 都是 +0，
 * 所以过了；拿 Vite 真实映射一试，**第 2 行以后全部查不到**（`undefined`）。
 * 这是"写测试的映射太干净"造成的假绿，真实数据一跑就露。
 */
function decodeLine(line, state) {
  const segments = [];
  state.column = 0;   // 每行重置（source/line/offset 不重置）
  let column = 0;
  for (const segmentText of line.split(",")) {
    if (segmentText === "") continue;
    const values = [];
    let value = 0;
    let shift = 0;
    for (const char of segmentText) {
      const digit = BASE64_INDEX.get(char);
      if (digit === undefined) return [];   // 非法字符：整行放弃（不静默错译）
      const continuation = digit & 32;
      value += (digit & 31) << shift;
      if (continuation !== 0) { shift += 5; continue; }
      const negative = (value & 1) === 1;
      value >>>= 1;
      values.push(negative ? -value : value);
      value = 0;
      shift = 0;
    }
    if (values.length < 4) continue;
    state.column += values[0];
    state.source += values[1];
    state.line += values[2];
    state.offset += values[3];
    column = state.column;
    segments.push({ generatedColumn: column, source: state.source, line: state.line, offset: state.offset });
  }
  return segments;
}

/**
 * 极简 `originalPositionFor`：找生成列 ≤ 目标列的最后一个 segment。
 *
 * 为什么不做二分/索引：一次取证最多翻译几十帧，线性扫描够用；
 * 少一层结构就少一处出错可能（这是排查工具，不是构建工具）。
 */
export function originalPositionFor(map, generatedLine, generatedColumn) {
  if (map === undefined || map.mappings === undefined) return undefined;
  const lines = map.mappings.split(";");
  const index = generatedLine - 1;
  if (index < 0 || index >= lines.length) return undefined;

  /* 每行的起始状态必须从文件头累加（VLQ 是跨行连续的绝对状态） */
  const state = { column: 0, source: 0, line: 0, offset: 0 };
  let best;
  for (let row = 0; row <= index; row += 1) {
    const segments = decodeLine(lines[row] ?? "", state);
    if (row !== index) continue;
    for (const segment of segments) {
      if (segment.generatedColumn > generatedColumn) break;
      best = segment;
    }
  }
  if (best === undefined) return undefined;
  const source = map.sources?.[best.source] ?? "(unknown source)";
  return { source, line: best.line + 1, column: best.offset + 1 };
}

/* ───────────────────────── 加载与来源解析 ───────────────────────── */

/**
 * 从"运行时代码的 URL"找对应的 sourcemap。
 *
 * 三种来源都试（按可靠度）：
 *  1. 同目录 `xxx.js.map`（构建产物）；
 *  2. 文件末尾的 `sourceMappingURL`（可能是内联 base64，也可能是相对路径）；
 *  3. dev server 的模块已经内联了 map（通常是 2 的内联形态）。
 */
export async function loadSourceMapFor(runtimeUrl, fetchImpl = fetch) {
  const clean = runtimeUrl.split("?")[0];
  if (clean === "" || clean.startsWith("data:") || clean.startsWith("blob:")) return undefined;

  /* 1) 直接试同目录 .map（生产构建最常见的形态，且不需要先拉 JS 全量） */
  try {
    const response = await fetchImpl(`${clean}.map`);
    if (response.ok) {
      const text = await response.text();
      if (text.trimStart().startsWith("{")) return JSON.parse(text);
    }
  } catch { /* 继续试下一种 */ }

  /* 2) 拉运行时代码，读末尾的 sourceMappingURL */
  try {
    const response = await fetchImpl(clean);
    if (!response.ok) return undefined;
    const text = await response.text();
    const match = /\/\/# sourceMappingURL=([^\s"']+)$/m.exec(text) ?? /\/\/# sourceMappingURL=([^\s"']+)/.exec(text);
    if (match === null) return undefined;
    const target = match[1];
    if (target.startsWith("data:")) {
      const comma = target.indexOf(",");
      const payload = target.slice(comma + 1);
      const decoded = target.includes(";base64,")
        ? Buffer.from(payload, "base64").toString("utf8")
        : decodeURIComponent(payload);
      return JSON.parse(decoded);
    }
    const response2 = await fetchImpl(new URL(target, clean).toString());
    if (!response2.ok) return undefined;
    return JSON.parse(await response2.text());
  } catch {
    return undefined;
  }
}

/** 从磁盘读一份 map（离线分析用；比 fetch 快，也避免源码已改导致对不上）。 */
export function loadSourceMapFromDisk(runtimeUrl) {
  const path = runtimeUrl.replace(/^https?:\/\/[^/]+/, "");
  if (path === "" || !existsSync(path)) return undefined;
  const mapPath = `${path}.map`;
  if (!existsSync(mapPath)) return undefined;
  try { return JSON.parse(readFileSync(mapPath, "utf8")); } catch { return undefined; }
}

/* ───────────────────────── 栈翻译 ───────────────────────── */

/**
 * 把 `Debugger.paused` 的 callFrames 翻译成可读栈。
 *
 * @param frames  callFrames（CDP 原样）
 * @param resolve 每帧的 map 解析器（由调用方决定用 fetch 还是磁盘）
 * @returns 每帧 `{ functionName, raw, source, line, column, mapped }`
 */
export async function translateFrames(frames, resolve) {
  const cache = new Map();
  const rows = [];
  for (const frame of frames) {
    const rawUrl = String(frame.url ?? "");
    const location = frame.location ?? {};
    const raw = `${rawUrl.replace(/^https?:\/\/[^/]+/, "")}:${location.lineNumber}:${location.columnNumber}`;
    const row = {
      functionName: frame.functionName === "" ? "(anonymous)" : frame.functionName,
      raw,
      source: rawUrl.replace(/^https?:\/\/[^/]+/, ""),
      line: location.lineNumber,
      column: location.columnNumber,
      mapped: false,
    };
    if (rawUrl !== "") {
      if (!cache.has(rawUrl)) cache.set(rawUrl, await resolve(rawUrl).catch(() => undefined));
      const map = cache.get(rawUrl);
      if (map !== undefined) {
        const original = originalPositionFor(map, location.lineNumber, location.columnNumber);
        if (original !== undefined) {
          row.source = prettifySource(original.source);
          row.line = original.line;
          row.column = original.column;
          row.mapped = true;
        }
      }
    }
    rows.push(row);
  }
  return rows;
}

/**
 * 把 sourcemap 里的 source 路径收敛成**可读**形式（纯函数，可测）。
 *
 * 实测两种噪音：
 *  - 生产产物里我们自己的源码是 `../../src/api/review-segments.ts`（相对 dist 的写法）；
 *  - 第三方库是 `../../../../../../../../../../../Code/lifeos/node_modules/.pnpm/marked@18.1.1/…`
 *    —— 一屏里全是这种路径，人眼找不到重点。
 *
 * 规则：
 *  1. 去掉前导 `../`；
 *  2. `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/…` 收敛成 `<pkg>:…`（保留文件与其后路径）；
 *  3. 我们自己的源码保留 `src/…`（这是要重点看的）。
 */
export function prettifySource(value) {
  if (typeof value !== "string" || value === "") return value;
  let path = value.replace(/^(\u002e\.?\/)+/, "");      // 去掉前导 ../

  const pnpm = /node_modules\/.pnpm\/([^/]+)\/node_modules\/.*?(\/[^/]+)$/.exec(path);
  if (pnpm !== null) return `${pnpm[1]}${pnpm[2]}`;      // 例：marked@18.1.1/lib/marked.esm.js

  const plain = /node_modules\/([^/]+)\/.*?(\/[^/]+)$/.exec(path);
  if (plain !== null) return `${plain[1]}${plain[2]}`;

  return path;
}

/** 打印栈（人读格式）。 */
export function printStack(rows, appOrigin = "") {
  for (const [index, row] of rows.entries()) {
    const where = `${row.source.replace(appOrigin, "")}:${row.line}:${row.column}`;
    const mark = row.mapped ? " →" : "";
    console.log(`  ${String(index).padStart(2)}. ${row.functionName.padEnd(32)} ${where}${mark}`);
  }
  const mapped = rows.filter((row) => row.mapped).length;
  console.log(`  （${mapped}/${rows.length} 帧经 sourcemap 翻译成源码位置）`);
}

/** 供测试用：把 mappings 字符串直接解出来的最小接口。 */
export function decodeMappingsForTest(mappings, generatedLine, generatedColumn, sources) {
  return originalPositionFor({ mappings, sources }, generatedLine, generatedColumn);
}

export { join, dirname };
