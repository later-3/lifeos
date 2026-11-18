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
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
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
/**
 * 多行块（`key: |`）的取值：把比当前缩进更深的后续行原样拼起来。
 *
 * 为什么要支持：`eval:` 动作里要写多行 JavaScript（拖选一段文字），
 * 压成单行既不可读也没法调试。YAML 的 `|` 块是最自然的写法。
 */
function takeBlock(lines, startIndex, keyIndent) {
  const collected = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    const indent = line.raw.length - line.raw.trimStart().length;
    if (line.raw.trim() !== "" && indent <= keyIndent) break;
    collected.push(line.raw.slice(Math.min(indent, keyIndent + 2)));
    index += 1;
  }
  return [collected.join("\n").replace(/\n+$/, ""), index];
}

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
            const peerRaw = peerValue.join(":").trim();
            // 列表项里的 block scalar（`prelude: |`）——实测缺这一条会让多镜头 storyboard 直接解析失败
            if (peerRaw === "|" || peerRaw === ">") {
              const [text, after] = takeBlock(lines, index + 1, peerIndent);
              item[peerKey.trim()] = peerRaw === ">" ? text.replace(/\n/g, " ") : text;
              index = after;
              continue;
            }
            const peerParsed = parseScalar(peerRaw);
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
      const rawValue = valueParts.join(":").trim();
      if (rawValue === "|" || rawValue === ">") {
        const [text, next] = takeBlock(lines, index + 1, indent);
        result[key.trim()] = rawValue === ">" ? text.replace(/\n/g, " ") : text;
        index = next;
        continue;
      }
      const parsed = parseScalar(rawValue);
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


/** ffprobe 取时长（本机 ffprobe 是 wrapper，无视 -of csv，必须按 JSON 解析）。 */
function probeDuration(videoPath) {
  try {
    const raw = execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", videoPath]).toString();
    const seconds = Number(JSON.parse(raw).format.duration);
    return Number.isFinite(seconds) ? seconds : 0;
  } catch { return 0; }
}

/** 给某个镜头的 steps 补上关键帧名（带镜头号，避免多镜头覆盖同名 png）。 */
function withShotsFor(steps, sceneIndex) {
  return steps.map((step, index) => (
    step.shot === undefined
      ? { ...step, shot: `s${sceneIndex + 1}-${String(index + 1).padStart(2, "0")}-${Object.keys(step).find((k) => k !== "shot") ?? "step"}` }
      : step
  ));
}

/** 列关键帧（审核材料）。 */
function keyShotsOf(keyDir) {
  try { return readdirSync(keyDir).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, "")); }
  catch { return []; }
}

/**
 * 把多个镜头拼成一个视频。
 *
 * **转场用「每段首尾各自淡入淡出到黑」+ concat，不用 `xfade`。**
 * 为什么（2026-11-16 实测，试了 6 种组合全部失败）：
 *   playwright 录出的 webm 转成什么中间格式都不被 xfade 接受——
 *   它要求输入是恒定帧率，而转出来的文件 `r_frame_rate` 报 `1/0`（`-vsync cfr`、`libx264`、
 *   `setp tb=AVTB`、先转 mp4/webm 都试过）。`xfade` 直接拒：`current rate of 1/0 is invalid`。
 *
 *   淡入淡出到黑 + concat 不依赖帧率探测，实测稳（13.5s 拼接成功）。
 *   观感上「过黑场」与「交叉淡化」都是转场，对 GIF 这种低帧率产物没有差别。
 */
function mergeSegments(segments, outPath, { fadeSec = 0.2 } = {}) {
  /**
   * 拼接多个镜头：**每段首尾淡入淡出到黑 + concat**。
   *
   * 为什么不用 `xfade`（2026-11-16，把可行/不可行的组合都试了一遍）：
   *  - 对原始 webm 直接 xfade **两段**可行；
   *  - 但**三段以上链式 xfade** 会产出整段白帧（实测截图为纯白），
   *    原因是逐对链式拼接时中间文件的时长/时间基对不上，offset 越接越偏；
   *  - 预先转成恒定帧率的中间 mp4 再 xfade 也失败（`current rate of 1/0 is invalid`）。
   *
   * 「淡到黑再淡入」同样是转场，且不依赖帧率探测——实测 13s 拼接稳定。
   * 对 GIF（10fps）这种产物，观感与交叉淡化没有差别。
   */
  const parts = segments.map((segment, index) => {
    const end = segment.trimEnd > 0 ? segment.trimEnd : probeDuration(segment.webm);
    const duration = Math.max(0.1, end - segment.trimStart);
    const outStart = Math.max(0, duration - fadeSec);
    const target = join(dirname(outPath), `seg-${String(index + 1).padStart(2, "0")}.mp4`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(segment.trimStart), "-t", duration.toFixed(3), "-i", segment.webm,
      "-vf", `scale=1000:-2:flags=lanczos,setsar=1,fps=12,fade=t=in:st=0:d=${fadeSec},fade=t=out:st=${outStart.toFixed(3)}:d=${fadeSec}`,
      "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-vsync", "cfr", "-an", target]);
    return target;
  });

  if (parts.length === 1) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", parts[0], "-c", "copy", outPath]);
    return;
  }
  const listPath = join(dirname(outPath), "concat-list.txt");
  writeFileSync(listPath, parts.map((file) => `file '${basename(file)}'`).join("\n") + "\n");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
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

  /**
   * 拍摄前体检：**打桩模型必须在跑**。
   *
   * 为什么必须拦（实测 2026-11-16）：打桩服务挂掉后，拍摄照样能录完、GIF 照样能出——
   * 但画面里是红色的「模型调用失败 Connection error」和「2s 后重试」。
   * 这种图比没有图更糟：它把产品拍成了坏的。所以宁可整轮失败。
   */
  if (storyboard.requireStub !== false) {
    const stub = process.env.STUB_URL ?? "http://127.0.0.1:43140/v1/models";
    try {
      const response = await fetch(stub, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      throw new Error(`打桩模型服务没在跑（${stub}）：${String(error).slice(0, 160)}\n` +
        "  先起它：node scripts/readme-studio/stub-model.mjs\n" +
        "  否则画面里会出现红色的「模型调用失败」，拍出来的素材是错的。");
    }
  }

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

  /**
   * 拍摄前把「选中即复制」关掉（storyboard 可用 `copyOnSelect: true` 保留）。
   *
   * 为什么：默认开着时，松手立刻复制并弹出「已复制 · N 字」，功能条里**没有「批注」按钮**；
   * 而 annotate 这条素材要演的正是"松手 → 功能条 → 批注"。真实用户的这条路径本来就需要先关掉它，
   * 所以画面里展示的也是真实行为，不是为拍摄特制。
   */
  if (storyboard.copyOnSelect !== true) {
    const uiPath = join(process.env.STUDIO_HOME ?? join(process.env.HOME ?? "", ".lifeos-readme"), "config", "ui.json");
    try {
      const ui = JSON.parse(readFileSync(uiPath, "utf8"));
      ui.selection = { ...(ui.selection ?? {}), copyOnSelect: false };
      writeFileSync(uiPath, JSON.stringify(ui, null, 2));
      console.log("   · 已把演示家目录的 selection.copyOnSelect 设为 false（让功能条出现「批注」）");
    } catch (error) {
      console.log(`   · 跳过 copyOnSelect 设置（${String(error).slice(0, 80)}）`);
    }
  }

  console.log(`\n▶ ${name}  ${storyboard.mode ?? "video"} ${JSON.stringify(storyboard.size ?? storyboard.viewport ?? "")}`);
  /**
   * 多镜头（DIRECTOR.md R1/R2）：每个 scene 独立开 context 录一段，再拼成一个 webm。
   *
   * 为什么逐镜头独立录制、而不是一个大 setUp 连续录：
   *  1. 一个镜头重拍不该让整段重放（返回别的镜头要重走操作，很贵）；
   *  2. 每个镜头可以有自己的 prelude（换主题就是要换 localStorage 再刷新）；
   *  3. 拼接时才做转场，镜头的时长/顺序都能单独调。
   */
  if (Array.isArray(storyboard.scenes) && storyboard.scenes.length > 0) {
    const segments = [];
    for (const [index, scene] of storyboard.scenes.entries()) {
      const label = scene.name ?? `scene-${index + 1}`;
      console.log(`\n▶ ${name} · 镜头 ${index + 1}/${storyboard.scenes.length}：${label}`);
      const sceneSteps = (scene.steps ?? []).map((step) => ({ ...step }));
      // 角标（R2）：镜头一开始就挂上，整段镜头都在
      const withBadge = scene.badge === undefined
        ? sceneSteps
        : [{ badge: { text: scene.badge, position: scene.badgePosition ?? "bottom-left" } }, ...sceneSteps];
      const sceneDir = join(outDir, `scene-${String(index + 1).padStart(2, "0")}`);
      const captured = await capture({
        mode: "video",
        url: `${app}${storyboard.path ?? "/"}`,
        viewport: storyboard.viewport ?? { width: 1000, height: 625 },
        size: storyboard.size,
        steps: withShotsFor(withBadge, index),
        prelude: scene.prelude ?? storyboard.prelude,
        outDir: sceneDir,
        keyShotDir: keyDir,
        log: (line) => console.log(`   ${line}`),
      });
      if (captured.webm === undefined) throw new Error(`镜头 ${index + 1} 没有产出 webm`);
      const start = findContentStart(captured.webm);
      const full = probeDuration(captured.webm);
      // trimEnd：只保留末尾 N 秒。多例并列镜头（主题展示）只需要"安静展示"那一小段，
      // 前面等页面加载/等渲染的时间对观众没有信息量，留着只会让 GIF 变大变慢。
      const keep = Number(scene.trimEnd ?? storyboard.trimEnd ?? 0);
      /**
       * `trimEnd: N` = 取**末尾** N 秒（不是开头 N 秒）。
       *
       * 为什么是末尾（2026-11-16 实测踩坑）：展示型镜头（如"某主题下的一屏"）前面是
       * 页面加载 + prelude 重载 + 切会话，只有最后那段才是"要展示的画面"。
       * 之前按"开头 N 秒"取，结果取到的是加载中的白屏/骨架屏，拼出来整段纯白。
       */
      const from = keep > 0 ? Math.max(start, full - keep) : start;
      segments.push({ webm: captured.webm, label, trimStart: from, trimEnd: 0 });
      console.log(`   ↳ 时长 ${full.toFixed(2)}s，取末尾 ${keep > 0 ? keep + "s（" + from.toFixed(2) + "s 起）" : "全部"}`);
    }

    // 拼接（带转场）
    const merged = join(outDir, "merged.mp4");
    mergeSegments(segments, merged, { fadeSec: storyboard.fadeSec ?? 0.2 });
    console.log(`   拼接完成：${segments.length} 个镜头 → merged.mp4`);

    // 交给原有编码流程（GIF/MP4）
    const outputs = [];
    for (const output of storyboard.outputs ?? []) {
      const target = join(options.outputRoot ?? "./docs/images", output.file);
      if (output.type === "gif") {
        const written = encodeGif({ webm: merged, out: target, fps: output.fps, width: output.width, colors: output.colors });
        outputs.push(written);
        console.log(`   → ${output.file}  ${written.mb.toFixed(2)}MB`);
      } else if (output.type === "mp4") {
        const written = encodeMp4({ webm: merged, out: target, fps: output.fps ?? 60, width: output.width ?? 1920, height: output.height ?? 1080 });
        outputs.push(written);
        console.log(`   → ${output.file}  ${(written.bytes / 1024 / 1024).toFixed(1)}MB`);
      }
    }
    const summary = {
      name, mode: "scenes", scenes: segments.length,
      durationSec: Number(probeDuration(merged).toFixed(2)),
      keyShots: keyShotsOf(keyDir),
      outputs: outputs.map((item) => ({ file: basename(item.out), kb: Math.round(item.bytes / 1024) })),
    };
    writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
    return summary;
  }

  const result = await capture({
    mode: storyboard.mode === "cdp" ? "cdp" : "video",
    url: `${app}${storyboard.path ?? "/"}`,
    viewport: storyboard.viewport ?? { width: 1000, height: 625 },
    size: storyboard.size,
    steps: withShots,
    prelude: storyboard.prelude,
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
      /**
       * 静态图：**默认产出 1 张**（README 的静态图是一件事一张）。
       *
       * 先前的实现把"所有关键帧"都导成图片（01-x.webp、02-x.webp…），
       * 那是调试用的副产品，不是 README 需要的东西 —— 每个 storyboard 会产出十几个文件，
       * 谁也记不清该引用哪一张。
       *
       * 现在：`fromShot` 指定用哪一步的关键帧；不指定就取**最后一步**（通常是"画面已就位"那一帧）。
       */
      const allShots = storyboard.steps?.filter((step) => step.shot !== undefined).map((step) => step.shot) ?? [];
      const pick = output.fromShot ?? allShots[allShots.length - 1];
      if (pick === undefined) throw new Error(`静态图 ${output.file} 找不到关键帧（storyboard 里要有 shot）`);
      const png = join(keyDir, `${pick}.png`);
      if (!existsSync(png)) throw new Error(`静态图 ${output.file} 的关键帧不存在：${pick}`);
      const written = encodeWebp(png, target, output.width ?? 1440);
      outputs.push(written);
      console.log(`   → ${output.file}（来自关键帧 ${pick}）`);
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
