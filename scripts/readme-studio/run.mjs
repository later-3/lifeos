#!/usr/bin/env node
/**
 * studio：README 素材与产品宣传片共用的拍摄工具箱。
 *
 *   node scripts/readme-studio/run.mjs <storyboard.yml> [--app <url>] [--out <dir>] [--keep]
 *   node scripts/readme-studio/run.mjs --all                       # 跑 storyboards/ 下所有
 *   node scripts/readme-studio/run.mjs hero --keys                 # 只出关键帧（不录，调试用）
 *
 * 为什么拆成"捕获 / 编码"两层（Task 0022 D15，Task 0023 依赖）：
 *   README 的 GIF 与宣传片的 MP4 需要**不同的捕获方式**：
 *     GIF  → recordVideo（25fps 够用，一步出 webm，链路最短）
 *     MP4  → CDP screencast（实测 1080p 93fps；recordVideo 锁 25fps，做不出 60fps 顺滑）
 *   两者共用的是：演示数据、动作 DSL、拍摄光标、关键帧导出。
 *
 * 关键帧（`--keys` 或 storyboard 里的 `shot:`）是**给你审核用的**：
 * 每一步操作后抓一张 PNG，配合时长与体积判断"这个动作讲清楚了没有"。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { capture } from "./capture.mjs";
import { encodeGif, encodeMp4, encodeWebp, findContentStart } from "./encode.mjs";

const HERE = import.meta.dirname;
const STORYBOARDS = join(HERE, "storyboards");
const RAW = "/tmp/lifeos-studio";

/* ── 极简 YAML 读取 ───────────────────────────────────────────────
 * 不引 js-yaml：storyboard 的结构是我们自己定的（name / size / steps / 一组标量），
 * 用一个 80 行的解析器就够；引依赖会让"重跑一次"多一个安装前提。
 * 支持：`key: value`、`key:` 开块、`- ` 列表项、`- key: value` 列表映射、`#` 注释、引号字符串。
 * 不支持（用不到）：锚点、多行文本块、复杂嵌套。遇到不支持的写法会**报错并指行号**，不静默。
 * ──────────────────────────────────────────────────────────────── */
function parseScalar(raw) {
  const value = raw.trim();
  if (value === "") return undefined;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    const out = {};
    for (const part of value.slice(1, -1).split(",")) {
      const [key, ...rest] = part.split(":");
      if (key === undefined || rest.length === 0) continue;
      out[key.trim()] = parseScalar(rest.join(":"));
    }
    return out;
  }
  return value;
}

function parseYaml(text, file = "storyboard") {
  const lines = text.split("\n").map((line, index) => ({ index: index + 1, raw: line }))
    .filter(({ raw }) => raw.trim() !== "" && !raw.trim().startsWith("#"));

  const fail = (line, message) => {
    throw new Error(`${file}:${line.index} ${message}\n  → ${line.raw}`);
  };

  // 递归下降：按缩进判断层级
  function parseBlock(start, indent) {
    const isList = lines[start] !== undefined && lines[start].raw.trimStart().startsWith("- ");
    const result = isList ? [] : {};
    let index = start;
    while (index < lines.length) {
      const line = lines[index];
      const currentIndent = line.raw.length - line.raw.trimStart().length;
      if (currentIndent < indent) break;
      if (currentIndent > indent) fail(line, `缩进异常（期望 ${indent}，实际 ${currentIndent}）`);
      const body = line.raw.trim();

      if (isList) {
        if (!body.startsWith("- ")) fail(line, "列表块里出现非列表项");
        const rest = body.slice(2).trim();
        if (rest === "") {
          const [nested, next] = parseBlock(index + 1, indent + 2);
          result.push(nested);
          index = next;
          continue;
        }
        // `- { a: 1, b: 2 }`（行内映射）：整行交给 parseScalar，不能按 ":" 切（否则 key 会变成 "{ a"）
        if (rest.startsWith("{")) {
          result.push(parseScalar(rest));
          index += 1;
          continue;
        }
        if (rest.includes(":") && !rest.startsWith('"')) {
          // `- key: value` → 先建一个对象，后续同缩进的 `key: value` 继续并进去
          const item = {};
          const [key, ...valueParts] = rest.split(":");
          const parsed = parseScalar(valueParts.join(":"));
          if (parsed === undefined) {
            const [nested, next] = parseBlock(index + 1, indent + 4);
            item[key.trim()] = nested;
            index = next;
          } else {
            item[key.trim()] = parsed;
            index += 1;
          }
          // 同缩进的后续 key 并进同一个列表项
          while (index < lines.length) {
            const peer = lines[index];
            const peerIndent = peer.raw.length - peer.raw.trimStart().length;
            if (peerIndent !== indent + 2 || peer.raw.trimStart().startsWith("- ")) break;
            const peerBody = peer.raw.trim();
            const [peerKey, ...peerValue] = peerBody.split(":");
            const peerParsed = parseScalar(peerValue.join(":"));
            if (peerParsed === undefined) {
              const [nested, next] = parseBlock(index + 1, indent + 4);
              item[peerKey.trim()] = nested;
              index = next;
            } else {
              item[peerKey.trim()] = peerParsed;
              index += 1;
            }
          }
          result.push(item);
          continue;
        }
        result.push(parseScalar(rest));
        index += 1;
        continue;
      }

      if (!body.includes(":")) fail(line, "顶层缺少 key:value");
      const [key, ...valueParts] = body.split(":");
      const parsed = parseScalar(valueParts.join(":"));
      if (parsed === undefined) {
        const [nested, next] = parseBlock(index + 1, line.raw.search(/\S/) + 2);
        result[key.trim()] = nested;
        index = next;
      } else {
        result[key.trim()] = parsed;
        index += 1;
      }
    }
    return [result, index];
  }

  const [parsed] = parseBlock(0, 0);
  return parsed;
}

export function loadStoryboard(path) {
  return { ...parseYaml(readFileSync(path, "utf8"), basename(path)), __path: path };
}

/* ── 执行 ─────────────────────────────────────────────────────── */

async function shoot(storyboard, options = {}) {
  const name = storyboard.name ?? basename(storyboard.__path, ".yml");
  const app = options.app ?? process.env.STUDIO_APP ?? "http://127.0.0.1:5181";
  const outDir = join(RAW, name);
  const keyDir = join(RAW, name, "keys");
  mkdirSync(keyDir, { recursive: true });

  const steps = (storyboard.steps ?? []).map((step) => ({ ...step }));
  // 每步自动配一张关键帧（审核对照表用），除非该步自己指定了 shot
  const withShots = steps.map((step, index) => (
    step.shot === undefined && options.autoShots !== false
      ? { ...step, shot: `${String(index + 1).padStart(2, "0")}-${Object.keys(step)[0]}` }
      : step
  ));

  // 每次拍摄前重置演示家目录：素材必须可复现，且不能把上一次的测试会话留在画面里
  if (storyboard.resetDemo !== false) {
    const demoHome = process.env.STUDIO_HOME ?? join(process.env.HOME ?? "", ".lifeos-readme");
    const demoScript = process.env.STUDIO_DEMO_SCRIPT ?? join(HERE, "..", "readme-demo-home.mjs");
    try {
      execFileSync("node", [demoScript], { env: { ...process.env, LIFEOS_HOME: demoHome }, stdio: "pipe" });
    } catch (error) {
      throw new Error(`重置演示家目录失败（${demoHome}）：${String(error).slice(0, 300)}`);
    }
  }

  console.log(`\n▶ ${name}  ${storyboard.mode ?? "video"} ${JSON.stringify(storyboard.size ?? storyboard.viewport ?? "")}`);
  const result = await capture({
    mode: storyboard.mode === "cdp" ? "cdp" : "video",
    url: `${app}${storyboard.path ?? "/"}`,
    viewport: storyboard.viewport ?? { width: 1000, height: 625 },
    size: storyboard.size,
    steps: withShots,
    outDir,
    keyShotDir: keyDir,
    jpegQuality: storyboard.jpegQuality,
    log: (line) => console.log(`   ${line}`),
  });

  // 编码
  const outputs = [];
  for (const output of storyboard.outputs ?? []) {
    const target = join(options.outputRoot ?? "./docs/images", output.file);
    if (output.type === "gif") {
      // 录屏从 context 创建就开始，页面加载完成前是白屏（实测开头 1–2 秒全白）。
      // 自动找到第一张有内容的画面再开始出片，避免"片头白屏"。
      const trimStart = result.webm !== undefined && output.trimBlank !== false ? findContentStart(result.webm) : 0;
      if (trimStart > 0) console.log(`   ↳ 跳过开头 ${trimStart}s 空白画面`);
      const written = encodeGif({
        webm: result.webm, framesDir: result.framesDir, metaPath: join(outDir, "meta.json"),
        out: target, fps: output.fps, width: output.width, colors: output.colors, trimStart,
      });
      outputs.push(written);
      console.log(`   → ${output.file}  ${written.mb.toFixed(2)}MB`);
    } else if (output.type === "webp" || output.type === "png") {
      const pngs = storyboard.steps?.filter((step) => step.shot !== undefined).map((step) => join(keyDir, `${step.shot}.png`)) ?? [];
      for (const [index, png] of pngs.entries()) {
        const file = pngs.length === 1 ? target : target.replace(/\.webp$/, `-${index + 1}.webp`);
        const written = encodeWebp(png, file, output.width ?? 1440);
        outputs.push(written);
      }
      console.log(`   → ${output.file}（来自 ${pngs.length} 张关键帧）`);
    } else if (output.type === "mp4") {
      const written = encodeMp4({
        webm: result.webm, framesDir: result.framesDir, metaPath: join(outDir, "meta.json"),
        out: target, fps: output.fps ?? 60, width: output.width ?? 1920, height: output.height ?? 1080,
      });
      outputs.push(written);
      console.log(`   → ${output.file}  ${(written.bytes / 1024 / 1024).toFixed(1)}MB`);
    }
  }

  // video 模式下 capture 不知道时长（webm 落盘才有），这里用 ffprobe 补上
  let durationSec = Number(result.durationSec?.toFixed(2) ?? 0);
  if (durationSec === 0 && result.webm !== undefined) {
    try {
      // 必须按 JSON 解析：本机 miniforge 的 ffprobe 是 wrapper，**无视 `-of csv` 参数**，
      // 永远返回 JSON（实测：`-of csv=p=0` 拿到的仍是 `{"streams":…}`，Number() 得到 NaN）。
      const raw = execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", result.webm]).toString();
      const probed = Number(JSON.parse(raw).format.duration);
      if (Number.isFinite(probed)) durationSec = probed;
    } catch { /* 量不到就不报，不编造 */ }
  }

  // 审核材料：关键帧 + 时长 + 体积
  const summary = {
    name,
    mode: storyboard.mode ?? "video",
    durationSec: durationSec > 0 ? Number(durationSec.toFixed(2)) : undefined,
    frameCount: result.frameCount,
    keyShots: result.keyShots,
    outputs: outputs.map((item) => ({ file: basename(item.out), kb: Math.round(item.bytes / 1024) })),
  };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  // webm / 帧序列默认保留：重编码时不必重拍（一次录制 100+MB 帧，重拍代价比占盘大）。
  // 清理交给 `node scripts/readme-studio/run.mjs --clean`（或手动删 /tmp/lifeos-studio）。
  void rmSync;
  return summary;
}

/* ── CLI ──────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const has = (name) => args.includes(`--${name}`);

/**
 * 是否作为 CLI 直接被跑。
 *
 * 不能写成 `import.meta.url === \`file://${process.argv[1]}\``：实测两个都不可靠 ——
 *   ① 路径含中文时 import.meta.url 会 percent-encode，argv[1] 不会；
 *   ② macOS 的 /tmp 是指向 /private/tmp 的软链，两侧字面量不同但指向同一文件。
 * 所以两边都过 realpath 再比。
 */
function isMain() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    // 必须用 fileURLToPath：import.meta.url 里的中文是 percent-encoded 的，
    // `new URL(...).pathname` 拿到的仍是编码后的字符串，realpath 会 ENOENT（实测）。
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  // 只出关键帧：不录屏，用于调选择器（`--keys`）
  const keysOnly = has("keys");
  const all = has("all");
  const targets = all
    ? (existsSync(STORYBOARDS) ? execFileSync("ls", [STORYBOARDS]).toString().trim().split("\n").filter((f) => f.endsWith(".yml")) : [])
    : [args.find((arg) => !arg.startsWith("--") && arg !== flag("app") && arg !== flag("out"))];

  if (targets.length === 0 || targets[0] === undefined) {
    console.error("用法：node scripts/readme-studio/run.mjs <storyboard.yml|名称> [--app <url>] [--keys] [--keep] [--all]");
    process.exit(1);
  }

  const results = [];
  for (const target of targets) {
    const path = target.endsWith(".yml") ? resolve(target) : join(STORYBOARDS, `${target}.yml`);
    if (!existsSync(path)) {
      console.error(`找不到 storyboard：${path}`);
      process.exit(1);
    }
    const storyboard = loadStoryboard(path);
    results.push(await shoot(storyboard, {
      app: flag("app"),
      keep: has("keep"),
      autoShots: keysOnly ? true : true,
    }));
  }

  console.log("\n── 审核材料 ──");
  for (const item of results) {
    console.log(`${item.name}: ${item.durationSec ?? "?"}s  frames=${item.frameCount ?? "-"}`);
    for (const output of item.outputs) console.log(`  ${output.file}  ${output.kb}KB`);
    console.log(`  关键帧：${join(RAW, item.name, "keys")}`);
  }
}
