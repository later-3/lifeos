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
import { mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
export const ACTIONS = ["click", "type", "press", "move", "scroll", "zoom", "unzoom", "waitFor", "waitForText", "pause", "shot", "eval"];

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
  const action = ACTIONS.find((name) => step[name] !== undefined);
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
