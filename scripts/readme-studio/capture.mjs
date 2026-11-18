#!/usr/bin/env node
/**
 * 捕获器：把一段浏览器操作录成**帧序列 + 真实时间戳**。
 *
 * 两档，按用途选（这是 Task 0022 与 0023 共用的底层）：
 *
 *   mode: "video"   → playwright context.recordVideo，出 webm。
 *                     **固定 25fps**（实测 r_frame_rate=25/1，1080p 也一样）。
 *                     用途：README 的 GIF（12fps 输出，25fps 源足够）。
 *
 *   mode: "cdp"     → CDP Page.startScreencast（jpeg），出 frames/NNNNNN.jpg + meta.json。
 *                     实测 1080p 下 **93fps**（60s 抓 5544 帧，帧间隔 p50 9ms / p99 18ms / max 66ms）。
 *                     用途：宣传片要 60fps 顺滑镜头，25fps 源做不到。
 *
 * 为什么两档而不是统一用 CDP：
 *   1. CDP 的 jpeg 序列要落盘（1080p ≈ 20KB/帧 → 60s ≈ 108MB），GIF 素材不值得付这个代价；
 *   2. recordVideo 一步出有音轨容器的 webm，GIF 产线直接 ffmpeg 读，链路最短。
 *
 * 为什么必须记真实时间戳：
 *   jpeg 序列的帧间隔并不均匀（p50 9ms、p99 18ms、max 66ms）。若按固定 `-framerate` 拼，
 *   所有停顿会被平均掉，动作节奏与真实时间不同步（"打字看起来像快进"）。
 *   因此每帧写 `meta.json` 的 timestamp，编码时用 concat demuxer 按帧间时长复原时间轴。
 *
 * 用法（storyboard 由 run.mjs 读，通常不直接调）：
 *   capture({ mode, url, size, fpsHint, steps, outDir, keepFrames })
 */
import { mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** storyboard 的辅助脚本目录（`evalFile` 从这读）。 */
const STORYBOARD_SCRIPT_DIR = join(import.meta.dirname, "storyboards");

const PLAYWRIGHT_CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(import.meta.dirname, "../../frontend/node_modules/playwright-core/index.js"),
  join(process.env.HOME ?? "", ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
];

/** 找 playwright-core：允许环境变量覆盖，允许项目内安装，最后回落到本机缓存。 */
async function loadPlaywright() {
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    if (candidate === undefined || candidate === "") continue;
    try {
      const module = await import(candidate);
      return module.default ?? module;
    } catch { /* 试下一个 */ }
  }
  throw new Error("找不到 playwright-core：设置 PLAYWRIGHT_CORE 或 pnpm --dir frontend add -D playwright-core");
}

/** 全部动作名（新增动作要同时在 runStep 里实现）。 */
export const ACTIONS = ["click", "type", "press", "move", "scroll", "zoom", "unzoom", "waitFor", "waitForText", "pause", "shot", "eval", "evalFile", "selectText", "badge", "scene"];

/**
 * 校验并返回这一步的动作名。
 *
 * 两种写法都允许，且都归一到这里：
 *   - type: { into: ..., text: ... }        ← 单行映射
 *   - type:\n    into: ...\n    text: ...   ← 分行块（YAML 解析成嵌套对象）
 * 取值方式统一：**对象形式的参数留在 step[动作名] 里**，runStep 直接读 `step.type.into`。
 *
 * 判据必须是「按 ACTIONS 名单找」，不能用"只有 1 个 key"——
 * steps 在进到这里之前已被 run.mjs 补上 `shot`（审核关键帧名），key 数不为 1。
 */
function actionOf(step) {
  /**
   * `shot` 是**装饰**而不是动作：run.mjs 默认给每一步注入 `shot: "01-click"` 用于关键帧，
   * 而 ACTIONS 里同时存在 `shot` 动作（显式抓一张图）。
   *
   * 实测踩坑（2026-11-16）：不把它排除的话，`{ selectText: ..., shot: "14-selectText" }`
   * 会被判成 action=shot —— 于是只截图、什么也没做，后续点「批注」必然超时。
   */
  const action = ACTIONS.find((name) => name !== "shot" && step[name] !== undefined)
    ?? (step.shot !== undefined ? "shot" : undefined);
  if (action === undefined) {
    throw new Error(`这一步没有可识别的动作（可用：${ACTIONS.join(" / ")}）：${JSON.stringify(step)}`);
  }
  return action;
}

/**
 * 取某一步、某个动作的参数：把「对象形式」与「扁平形式」抹平。
 *
 *   click: '[data-testid="x"]'                     → { value: '[data-testid="x"]' }
 *   type:  { into: '…', text: '…', delayMs: 42 }   → { into: '…', text: '…', delayMs: 42 }
 *   type:                                      （分行块，等价上一行）
 *     into: '…'
 *     text: '…'
 * 标量形式统一放到 `value` 上，对象形式按字段取。
 */
function paramsOf(step, action) {
  const raw = step[action];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { value: raw };
  return raw;
}

/** 执行一条 storyboard 动作。动作种类刻意少（够用且好看），新增前先想清楚。 */
async function runStep(page, step, log, shotDir) {
  const action = actionOf(step);
  const params = paramsOf(step, action);
  if (action === "click") {
    const selector = typeof params === "string" ? params : params.value;
    await page.locator(selector).first().click({ timeout: 15_000 });
    log(`click ${selector}`);
  } else if (action === "type") {
    const target = page.locator(params.into).first();
    await target.click();
    await target.type(params.text, { delay: params.delayMs ?? 30 });
    log(`type ${JSON.stringify(String(params.text).slice(0, 24))}`);
  } else if (action === "press") {
    await page.keyboard.press(params.value ?? params.key);
    log(`press ${params.value ?? params.key}`);
  } else if (action === "move") {
    // move 支持两种写法：`move: {x, y, steps}` 与 `move: "x,y"`；分行块解析成对象，故先取 params
    const point = typeof params === "string"
      ? { x: Number(params.split(",")[0]), y: Number(params.split(",")[1]) }
      : params;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`move 需要 {x, y} 或 "x,y"：${JSON.stringify(params)}`);
    }
    await page.mouse.move(x, y, { steps: Number(point.steps ?? 12) });
    log(`move ${x},${y}`);
  } else if (action === "scroll") {
    const amount = Number(typeof params === "number" ? params : params.value ?? params.y ?? 0);
    await page.mouse.wheel(0, amount);
    log(`scroll ${amount}`);
  } else if (action === "zoom") {
    // 特写必须在**录制时**做：后期 crop+scale 会糊（实测）。zoom 是 Chromium 原生属性，字体会重新排版，清晰。
    await page.evaluate(({ selector, value }) => {
      const el = document.querySelector(selector);
      if (el === null) throw new Error(`zoom 目标不存在：${selector}`);
      el.style.zoom = String(value);
    }, { selector: params.selector, value: params.value });
    log(`zoom ${params.selector} = ${params.value}`);
  } else if (action === "unzoom") {
    const selector = typeof params === "string" ? params : params.value ?? params.selector;
    await page.evaluate((target) => {
      const el = document.querySelector(target);
      if (el !== null) el.style.zoom = "";
    }, selector);
    log(`unzoom ${selector}`);
  } else if (action === "waitFor") {
    const selector = typeof params === "string" ? params : params.value;
    await page.locator(selector).first().waitFor({ state: "visible", timeout: 60_000 });
    log(`waitFor ${selector}`);
  } else if (action === "waitForText") {
    const text = typeof params === "string" ? params : params.value;
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 60_000 });
    log(`waitForText ${text}`);
  } else if (action === "pause") {
    const seconds = Number(typeof params === "number" ? params : params.value ?? params.seconds ?? 1);
    await page.waitForTimeout(seconds * 1000);
    log(`pause ${seconds}s`);
  } else if (action === "shot") {
    const name = typeof params === "string" ? params : params.value ?? step.shot;
    mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: join(shotDir, `${name}.png`) });
    log(`shot ${name}`);
  } else if (action === "eval") {
    await page.evaluate(typeof params === "string" ? params : params.value);
    log("eval");
  } else if (action === "badge") {
    /**
     * 画面内角标（DIRECTOR.md R2）：多张同构画面并列时，每张自己说明"这是哪个"。
     *
     * 为什么画在页面内而不是靠 ffmpeg drawtext：
     *  ① 颜色能跟着主题走（`color: inherit` 的对比由主题保证），八套主题都不会糊；
     *  ② 不依赖字体文件（ffmpeg 画中文必须显式指定 fontfile，换机器就可能出方块）。
     */
    const { text, position = "bottom-left" } = params;
    await page.evaluate(({ text, position }) => {
      const id = "lifeos-studio-badge";
      document.getElementById(id)?.remove();
      const style = document.createElement("style");
      style.textContent = `
        #${id} {
          position: fixed; z-index: 2147483600; pointer-events: none;
          padding: 8px 14px; border-radius: 10px;
          font: 600 15px/1.2 -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif;
          letter-spacing: .01em;
          background: rgba(17, 17, 19, .78); color: #fff;
          box-shadow: 0 4px 16px rgba(0, 0, 0, .28);
          backdrop-filter: blur(6px);
        }
        #${id}[data-pos="bottom-left"] { left: 20px; bottom: 20px; }
        #${id}[data-pos="bottom-right"] { right: 20px; bottom: 20px; }
        #${id}[data-pos="top-left"] { left: 20px; top: 20px; }
        #${id}[data-pos="top-right"] { right: 20px; top: 20px; }
      `;
      document.head.appendChild(style);
      const badge = document.createElement("div");
      badge.id = id;
      badge.dataset.pos = position;
      badge.textContent = text;
      document.body.appendChild(badge);
    }, { text, position });
    log(`badge "${text}" @ ${position}`);
  } else if (action === "scene") {
    /**
     * 镜头边界（多镜头素材用）：`{ scene: { name, ... } }` 表示"从这里开始是新镜头"。
     *
     * 当前实现：只记一条分隔标记，供 run.mjs 切分成多个片段（每段独立编码再拼接）。
     * 为什么不在同一个 webm 里直接切：片段的时长/数量要能独立调整，
     * 一个镜头重拍不该让整段重新录（返回别的镜头要重放一遍操作，很贵）。
     */
    const { name } = params;
    log(`── 镜头开始：${name ?? "(未命名)"}`);
  } else if (action === "selectText") {
    /**
     * 用**真实鼠标**拖选一段文字（在可见的段落上）。
     *
     * 三次失败的教训（2026-11-16，都留有截图）：
     *  ① 脚本 `range` + 假 `mouseup` → 文字选中了，但功能条**不出现**（功能条由真实 mouseup 驱动）；
     *  ② 选 `message-text` 容器 → 容器高 546px、顶部在视口外（y=-111），按在负坐标等于按到窗外；
     *  ③ 选长文本节点 → 节点跨行，起止坐标落在不同段落，拖选变成从段中拖到段中，落点不在同一行。
     *
     * 现在按**段落**选：取视口内完整可见的 `<p>` / `<li>`，在它的首尾之间拖。
     */
    const { selector = '[data-testid="message-text"]', chars = 18 } = params;
    const box = await page.evaluate(({ selector, chars }) => {
      const blocks = [...document.querySelectorAll(`${selector} p, ${selector} li, ${selector} h1, ${selector} h2`)];
      const candidates = blocks
        .map((el) => ({ el, rect: el.getBoundingClientRect(), text: (el.textContent ?? "").trim() }))
        .filter((item) => item.text.length > chars && item.rect.width > 120
          && item.rect.top > 60 && item.rect.bottom < window.innerHeight - 140);
      if (candidates.length === 0) return null;
      // 优先取靠上的一条（画面稳定，不会被下方输入框挡住）
      const picked = candidates[0];
      const { el } = picked;
      el.scrollIntoView({ block: "center" });
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let first = null;
      while (walker.nextNode()) {
        if ((walker.currentNode.nodeValue ?? "").trim() !== "") { first = walker.currentNode; break; }
      }
      if (first === null) return null;
      const head = document.createRange();
      head.setStart(first, 0);
      head.setEnd(first, Math.min(2, first.length));
      const a = head.getBoundingClientRect();
      const tail = document.createRange();
      const len = first.length;
      tail.setStart(first, Math.max(0, len - 2));
      tail.setEnd(first, len);
      const b2 = tail.getBoundingClientRect();
      return { x1: a.x + 1, y1: a.y + a.height / 2, x2: b2.x + b2.width - 1, y2: b2.y + b2.height / 2, text: picked.text.slice(0, 20) };
    }, { selector, chars });
    if (box === null) throw new Error(`selectText 找不到视口内可选的段落：${selector}`);

    /**
     * 拖选 + **自检重试**。
     *
     * 为什么必须自检（2026-11-16 实测）：拖完不一定真的有选区——
     * 流式重渲染会在拖选期间替换正文节点，选区随之塌缩；此时截图上是"什么都没选中"，
     * 后续点「批注」必然超时。所以要读回 `getSelection()` 与功能条状态，
     * 不成立就重新滚到该段、微调起点再拖一次（最多 3 次）。
     */
    let attempt = 0;
    let ok = false;
    while (attempt < 3 && !ok) {
      attempt += 1;
      await page.mouse.move(box.x1 + attempt - 1, box.y1, { steps: 6 });
      await page.mouse.down();
      await page.mouse.move(box.x2, box.y2, { steps: 16 });
      await page.mouse.up();
      await page.waitForTimeout(220);
      const state = await page.evaluate(() => ({
        selected: window.getSelection()?.toString() ?? "",
        toolbar: document.querySelector('[data-testid="selection-toolbar"]') !== null,
      }));
      ok = state.selected.trim() !== "" && state.toolbar;
      log(`selectText 第 ${attempt} 次：选中 ${JSON.stringify(state.selected.slice(0, 18))} 功能条=${state.toolbar}`);
      if (!ok) await page.waitForTimeout(320);
    }
    if (!ok) throw new Error(`selectText 拖选 3 次都没拿到有效选区（段落：「${box.text}」）——通常是流式还没结束或该段被重渲染`);
    log(`selectText "${box.text}"`);
  } else if (action === "evalFile") {
    /**
     * 从 storyboards/ 下读一段 JS 执行。
     *
     * 为什么需要：拖选文本、读 DOM 位置这类操作要写十几行 JS，
     * 塞进 YAML 既不合法（缩进会炸）也不好调试。独立 .js 文件可直接 `node --check` 验语法。
     */
    const file = typeof params === "string" ? params : params.value;
    const code = readFileSync(join(STORYBOARD_SCRIPT_DIR, file), "utf8");
    const result = await page.evaluate(code);
    log(`evalFile ${file} → ${JSON.stringify(result ?? null)}`);
  } else {
    throw new Error(`未知动作：${JSON.stringify(Object.keys(step))}`);
  }

  // 审核关键帧：**动作做完之后**再抓，抓到的才是"这一步的结果"（不是动作前的样子）。
  // run.mjs 默认给每一步注入 shot 名；也可在某步显式写 `shot: 自定义名`。
  if (step.shot !== undefined) {
    mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: join(shotDir, `${step.shot}.png`) });
  }
}

/**
 * 主入口。
 * @returns {{ webm?: string, framesDir?: string, frameCount?: number, durationSec: number, keyShots: string[] }}
 */
export async function capture(options) {
  const {
    mode = "video",
    url,
    viewport = { width: 1000, height: 625 },
    size,                       // mode=video 时的录屏尺寸；缺省同 viewport
    steps = [],
    outDir,
    keyShotDir,
    extraRoutes = [],
    blockExternalNetwork = true,
    log = () => {},
  } = options;

  const { chromium } = await loadPlaywright();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const framesDir = join(outDir, "frames");
  const videoDir = join(outDir, "video");
  mkdirSync(videoDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const contextArgs = {
    viewport,
    deviceScaleFactor: 2,
    ...(mode === "video" ? { recordVideo: { dir: videoDir, size: size ?? viewport } } : {}),
  };
  const context = await browser.newContext(contextArgs);

  // 拍摄光标（光标 + 点击涟漪）：录屏不含系统光标，没有它观众看不出点了哪里
  const { CURSOR_SCRIPT } = await import("./cursor.mjs");
  await context.addInitScript({ content: CURSOR_SCRIPT });

  // 断网：除本机外的请求一律阻断，避免第三方请求造成卡顿与数据漂移（也是"不泄露"的一道闸）
  if (blockExternalNetwork) {
    await context.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      const local = host === "127.0.0.1" || host === "localhost" || host === "::1";
      if (local || !/^https?:/.test(route.request().url())) return route.continue();
      return route.abort();
    });
  }
  for (const route of extraRoutes) await context.route(route.pattern, route.handler);

  const page = await context.newPage();
  const keyShots = [];
  let frameCount;
  let cdp;

  if (mode === "cdp") {
    mkdirSync(framesDir, { recursive: true });
    cdp = await context.newCDPSession(page);
    let index = 0;
    const meta = [];
    cdp.on("Page.screencastFrame", async (frame) => {
      writeFileSync(join(framesDir, `${String(index).padStart(6, "0")}.jpg`), Buffer.from(frame.data, "base64"));
      meta.push({ i: index, ts: frame.metadata.timestamp });
      index += 1;
      try { await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }); } catch { /* 停录时的最后一次 ack 会失败，正常 */ }
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: options.jpegQuality ?? 85,
      maxWidth: viewport.width,
      maxHeight: viewport.height,
      everyNthFrame: 1,
    });
    await page.goto(url, { waitUntil: "networkidle" });
    for (const step of steps) {
      await runStep(page, step, log, keyShotDir ?? join(outDir, "keys"));
      if (step.shot !== undefined) keyShots.push(step.shot);
    }
    try { await cdp.send("Page.stopScreencast"); } catch { /* 已停 */ }
    writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta));
    frameCount = meta.length;
    const span = meta.length > 1 ? meta[meta.length - 1].ts - meta[0].ts : 0;
    await context.close();
    await browser.close();
    return { framesDir, frameCount, durationSec: span, keyShots };
  }

  await page.goto(url, { waitUntil: "networkidle" });
  // prelude：在页面里执行一段准备脚本（如注入主题包激活状态），再刷新一次让它生效。
  // 为什么必须刷新：boot 脚本在 React 之前读 localStorage 上色，注入后不刷新就还是旧主题。
  if (typeof options.prelude === "string" && options.prelude.trim() !== "") {
    await page.evaluate(options.prelude);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    log("prelude 已注入并重载");
  }
  for (const step of steps) {
    await runStep(page, step, log, keyShotDir ?? join(outDir, "keys"));
    if (step.shot !== undefined) keyShots.push(step.shot);
  }
  await context.close();   // 关 context 才会把 webm 落盘
  await browser.close();
  const webm = readdirSync(videoDir).find((name) => name.endsWith(".webm"));
  if (webm === undefined) throw new Error("recordVideo 没有产出 webm");
  return { webm: join(videoDir, webm), durationSec: 0, keyShots };
}
