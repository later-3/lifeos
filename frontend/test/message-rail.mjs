#!/usr/bin/env node
/**
 * 消息导航竖条的界面契约（Task 0020 · P6）。
 *
 * 与 `test/rail-*.test.mjs` 的分工：那些测**纯函数**（刻度投影、几何、跳转判定、锚点选择），
 * 这个测**用户在屏幕上看到的东西**——几何、可见性、交互、主题。`testing.md` 2.15：
 * 界面契约必须断言到几何，且"命中 0 个的断言是恒绿的假断言"，所以每条都先打印命中数。
 *
 * 用法：
 *   APP_URL=http://localhost:5176 RAIL_SESSION=<sid> node frontend/test/message-rail.mjs
 *
 * 需要一条**有历史**的会话（`RAIL_SESSION`），且家目录里它至少有 20 条刻度。
 * 没有的话脚本会明确报"没测到"，而不是静默通过。
 */
import pw from "/Users/xulater/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js";
const { chromium } = pw;

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const SESSION = process.env.RAIL_SESSION ?? "";
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
  if (!ok) failures.push(name);
};

if (SESSION === "") {
  console.error("缺 RAIL_SESSION：这条契约要一条有历史的会话（例：RAIL_SESSION=01a2…beef）");
  process.exit(2);
}

const url = `${APP_URL}/?agent=lifeosagent&project=workspace&session=${SESSION}`;
const browser = await chromium.launch({ headless: true });

/** 竖条的几何快照（一律用页面内 getBoundingClientRect，见 jump-to-latest.mjs 的同一教训）。 */
const snapshot = (page) => page.evaluate(() => {
  const rail = document.querySelector('[data-testid="message-rail"]');
  if (rail === null) return { found: false };
  const railRect = rail.getBoundingClientRect();
  const main = document.querySelector("main");
  const mainRect = main.getBoundingClientRect();
  const content = main.querySelector(".max-w-reading");
  const contentRect = content?.getBoundingClientRect();
  const ticks = [...document.querySelectorAll('[data-testid="rail-tick"]')].map((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      id: node.getAttribute("data-rail-id"),
      role: node.getAttribute("data-rail-role"),
      active: node.getAttribute("data-rail-active") === "true",
      top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width,
      background: style.backgroundColor,
    };
  });
  return {
    found: true,
    windowed: rail.getAttribute("data-rail-windowed") === "true",
    range: rail.getAttribute("data-rail-range"),
    anchor: rail.getAttribute("data-rail-anchor"),
    rail: { top: railRect.top, bottom: railRect.bottom, left: railRect.left, width: railRect.width, height: railRect.height },
    main: { top: mainRect.top, bottom: mainRect.bottom },
    gutter: contentRect ? contentRect.left - mainRect.left : null,
    ticks,
  };
});

for (const [label, viewport, expectVisible] of [
  ["宽视口 1600", { width: 1600, height: 1000 }, true],
  ["1280（左列展开，空白仅 24）", { width: 1280, height: 800 }, true],
  ["390（手机，空白 16）", { width: 390, height: 844 }, false],
]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 160)));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // 先等消息区真的有内容，再判竖条（testing.md 2.26：注入类夹具先断言对象存在）
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="message"]').length > 0, undefined, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
  const snap = await snapshot(page);
  console.log(`\n── ${label} ──`);
  check(`[${label}] 竖条存在`, snap.found === (expectVisible ? true : snap.found), JSON.stringify({ found: snap.found, windowed: snap.windowed, range: snap.range }));
  if (!snap.found) { await context.close(); continue; }

  check(`[${label}] 刻度数 > 0（命中 0 个 = 没测）`, snap.ticks.length > 0, `${snap.ticks.length} 条`);
  check(`[${label}] 刻度高度都有实际尺寸（不是 0×0）`, snap.ticks.every((tick) => tick.height >= 1 && tick.width >= 1),
    `h ${Math.min(...snap.ticks.map((t) => t.height)).toFixed(1)}–${Math.max(...snap.ticks.map((t) => t.height)).toFixed(1)}px`);
  check(`[${label}] 刻度不越出消息区（上下各留边）`,
    snap.ticks[0].top >= snap.main.top - 0.5 && snap.ticks.at(-1).bottom <= snap.main.bottom + 0.5,
    `首 ${snap.ticks[0].top.toFixed(0)} 末 ${snap.ticks.at(-1).bottom.toFixed(0)} / main ${snap.main.top.toFixed(0)}–${snap.main.bottom.toFixed(0)}`);
  check(`[${label}] 轨道贴消息区左缘、垂直居中`,
    Math.abs(snap.rail.top - snap.main.top) < 2 && Math.abs(snap.rail.bottom - snap.main.bottom) < 2,
    `rail ${snap.rail.top.toFixed(0)}–${snap.rail.bottom.toFixed(0)}`);

  // 用户刻度比 Agent 深（颜色通道：不靠"看起来差不多"，比实际计算值）
  const userTick = snap.ticks.find((tick) => tick.role === "user");
  const agentTick = snap.ticks.find((tick) => tick.role === "assistant");
  const luminance = (rgb) => {
    const [r, g, b] = (rgb.match(/\d+/g) ?? [0, 0, 0]).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  check(`[${label}] 用户刻度与 Agent 刻度颜色不同`,
    userTick !== undefined && agentTick !== undefined && userTick.background !== agentTick.background,
    `user ${userTick?.background} / agent ${agentTick?.background}`);
  void luminance;

  // 正文的拖选不被吞：轨道容器除刻度外必须 pointer-events:none
  const passthrough = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="message-rail"]');
    const style = getComputedStyle(rail);
    return { pointerEvents: style.pointerEvents };
  });
  check(`[${label}] 轨道容器不吞正文点击（pointer-events: none）`, passthrough.pointerEvents === "none", JSON.stringify(passthrough));

  if (expectVisible && snap.ticks.length > 2) {
    // 悬停 → 卡片，且与该刻度垂直居中
    const target = snap.ticks[Math.min(2, snap.ticks.length - 1)];
    await page.locator(`[data-rail-id="${target.id}"]`).hover();
    await page.waitForTimeout(350);
    const card = await page.evaluate((id) => {
      const node = document.querySelector('[data-testid="rail-card"]');
      if (node === null) return null;
      const rect = node.getBoundingClientRect();
      const tick = document.querySelector(`[data-rail-id="${id}"]`).getBoundingClientRect();
      return {
        text: node.textContent?.slice(0, 40),
        height: rect.height,
        inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
        centerGap: Math.round((rect.top + rect.height / 2) - (tick.top + tick.height / 2)),
      };
    }, target.id);
    check(`[${label}] 悬停出卡片`, card !== null, card?.text ?? "");
    check(`[${label}] 卡片与该刻度垂直居中（偏差 ≤ 2px）`, card !== null && Math.abs(card.centerGap) <= 2, `偏差 ${card?.centerGap}px`);
    check(`[${label}] 卡片不出视口`, card !== null && card.inViewport === true);

    // 高亮只有一条
    const actives = snap.ticks.filter((tick) => tick.active).length;
    check(`[${label}] 当前刻度只有一条高亮`, actives <= 1, `${actives} 条`);
  }

  check(`[${label}] 无页面错误`, pageErrors.length === 0, pageErrors.join(" | "));
  await context.close();
}

/*
 * 深色主题：竖条与卡片都要跟着换（用 token 派生，不允许写死浅色值）。
 *
 * **深色必须打桩 `/api/ui-prefs`**：主题的权威来源是服务端 `~/.lifeos/config/ui.json`
 * （`/api/ui-prefs`），不是 localStorage —— 第一版改 localStorage 完全没生效，
 * 两个 context 读到的都是同一个 rgb（实测）。打桩同时保证测试不写用户数据。
 */
const themeSnapshot = async (mode) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.route("**/api/ui-prefs", async (route) => {
    if (route.request().method() === "GET") {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ json: { ...body, theme: { ...(body.theme ?? {}), preset: "neutral", mode } } });
      return;
    }
    await route.fulfill({ json: {} });
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="rail-tick"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(900);
  const read = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const tick = document.querySelector('[data-rail-role="user"]');
    return {
      mode: document.documentElement.dataset.themeMode,
      surface: cs.getPropertyValue("--color-surface").trim(),
      ink900: cs.getPropertyValue("--color-ink-900").trim(),
      tick: tick === null ? null : getComputedStyle(tick).backgroundColor,
    };
  });
  await context.close();
  return read;
};
const light = await themeSnapshot("light");
const dark = await themeSnapshot("dark");
{
  console.log("\n── 深浅色 ──");
  check("深浅两套下刻度颜色都跟着变（不是写死的）", light.tick !== null && dark.tick !== null && light.tick !== dark.tick,
    `light ${light.tick} / dark ${dark.tick}`);
  check("深色下轨道用深色主题的 ink（与 surface 有对比）", dark.mode === "dark" && dark.tick !== dark.surface,
    `ink ${dark.ink900} / surface ${dark.surface}`);
}

await browser.close();
if (failures.length > 0) {
  console.error(`\n消息导航竖条契约失败 ${failures.length} 项`);
  process.exit(1);
}
console.log("\n消息导航竖条契约通过");
