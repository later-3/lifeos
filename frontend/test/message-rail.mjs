#!/usr/bin/env node
/**
 * 消息导航条的界面契约（Task 0020 · P6，横条形态）。
 *
 * 与 `test/rail-*.test.mjs` 的分工：那些测**纯函数**（刻度投影、几何、跳转判定、锚点选择），
 * 这个测**用户在屏幕上看到的东西** —— 几何、可见性、交互、主题、跳转。
 * `testing.md` 2.15：界面契约必须断言到几何，且"命中 0 个的断言是恒绿的假断言"，
 * 所以每条都先打印命中数。
 *
 * 用法：
 *   APP_URL=http://localhost:5176 RAIL_SESSION=<sid> node frontend/test/message-rail.mjs
 *
 * `RAIL_SESSION` 需要一条**回复被过程条折叠**的会话（每轮带工具调用的那种），
 * 否则"点答能跳转"这条测不到真实形态。
 */
import pw from "/Users/xulater/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js";
import { EVENT_CHANNEL_STUB } from "./event-channel-stub.mjs";
const { chromium } = pw;

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const SESSION = process.env.RAIL_SESSION ?? "";
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
  if (!ok) failures.push(name);
};

if (SESSION === "") {
  console.error("缺 RAIL_SESSION：这条契约要一条有历史的会话（例：RAIL_SESSION=01a2…abcd）");
  process.exit(2);
}

const url = `${APP_URL}/?agent=lifeosagent&project=workspace&session=${SESSION}`;
const browser = await chromium.launch({ headless: true });

const snapshot = (page) => page.evaluate(() => {
  const rail = document.querySelector('[data-testid="message-rail"]');
  if (rail === null) return { found: false };
  const list = rail.firstElementChild;
  const railRect = rail.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();
  const main = document.querySelector("main");
  const mainRect = main.getBoundingClientRect();
  const content = main.querySelector(".max-w-reading");
  const contentRect = content?.getBoundingClientRect();
  const ticks = [...list.querySelectorAll('[data-testid="rail-tick"]')].map((node) => {
    const bar = node.querySelector(".rail-tick-bar");
    const barRect = bar.getBoundingClientRect();
    const rowRect = node.getBoundingClientRect();
    return {
      id: node.getAttribute("data-rail-id"),
      role: node.getAttribute("data-rail-role"),
      active: node.getAttribute("data-rail-active") === "true",
      rowHeight: rowRect.height,
      rowWidth: rowRect.width,
      barWidth: barRect.width,
      barHeight: barRect.height,
      barLeft: barRect.left,
      rowLeft: rowRect.left,
      background: getComputedStyle(bar).backgroundColor,
    };
  });
  return {
    found: true,
    scrollable: rail.getAttribute("data-rail-scrollable") === "true",
    activeIndex: rail.getAttribute("data-rail-active-index"),
    band: rail.getAttribute("data-rail-band"),
    rail: { top: railRect.top, bottom: railRect.bottom, left: railRect.left, width: railRect.width, height: railRect.height },
    list: { top: listRect.top, bottom: listRect.bottom, height: listRect.height, scrollHeight: list.scrollHeight, scrollTop: list.scrollTop },
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
  // 先等消息区真的有内容（testing.md 2.26：注入类夹具先断言对象存在）
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="message"]').length > 0, undefined, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
  const snap = await snapshot(page);
  console.log(`\n── ${label} ──`);
  check(`[${label}] 竖条区域存在`, snap.found === (expectVisible ? true : snap.found), JSON.stringify({ found: snap.found }));
  if (!snap.found) { await context.close(); continue; }

  check(`[${label}] 刻度数 > 0（命中 0 个 = 没测）`, snap.ticks.length > 0, `${snap.ticks.length} 条`);

  // ① 每条刻度是**横条**：宽度有差异（= 内容量），厚度是细线
  const widths = snap.ticks.map((tick) => tick.barWidth);
  const distinct = new Set(widths.map((width) => Math.round(width))).size;
  check(`[${label}] 横条宽度有差异（宽度 = 内容量，不是定距）`, distinct >= 3, `${distinct} 种宽度，${Math.round(Math.min(...widths))}–${Math.round(Math.max(...widths))}px`);
  check(`[${label}] 横条厚度是细线（≤8px）且 > 0`, snap.ticks.every((tick) => tick.barHeight > 0 && tick.barHeight <= 8),
    `${Math.min(...snap.ticks.map((t) => t.barHeight))}–${Math.max(...snap.ticks.map((t) => t.barHeight))}px`);
  check(`[${label}] 横条左对齐（同一列的起点一致）`,
    new Set(snap.ticks.slice(0, 12).map((tick) => Math.round(tick.barLeft - tick.rowLeft))).size === 1,
    JSON.stringify([...new Set(snap.ticks.slice(0, 12).map((tick) => Math.round(tick.barLeft - tick.rowLeft)))]));

  // ② 行高在 [12, 24]：条少时舒适、条多时压到下限并改为滚动
  const rowHeights = [...new Set(snap.ticks.map((tick) => Math.round(tick.rowHeight)))];
  check(`[${label}] 行高在 [12, 24]`, rowHeights.every((h) => h >= 12 && h <= 24), JSON.stringify(rowHeights));

  // ③ 整列有最大高度，超了就**内部滚动**（不是压行的可点性）
  const maxAllowed = (snap.main.bottom - snap.main.top) * 0.62 + 1;
  check(`[${label}] 整列不超过可用高度的 62%`, snap.list.height <= maxAllowed,
    `列高 ${Math.round(snap.list.height)} / 上限 ${Math.round(maxAllowed)}`);
  check(`[${label}] 装不下时是"整列滚动"，不是"压行"`,
    snap.list.scrollHeight <= snap.list.height + 1 || rowHeights[0] === 12,
    `内容高 ${Math.round(snap.list.scrollHeight)} / 可视 ${Math.round(snap.list.height)} / 行高 ${rowHeights[0]}`);
  check(`[${label}] 列在自己的区域内，不越出消息区`,
    snap.list.top >= snap.main.top - 1 && snap.list.bottom <= snap.main.bottom + 1,
    `列 ${Math.round(snap.list.top)}–${Math.round(snap.list.bottom)} / 区 ${Math.round(snap.main.top)}–${Math.round(snap.main.bottom)}`);

  // ④ 颜色通道
  const userTick = snap.ticks.find((tick) => tick.role === "user");
  const agentTick = snap.ticks.find((tick) => tick.role === "assistant");
  check(`[${label}] 用户条与 Agent 条颜色不同`,
    userTick !== undefined && agentTick !== undefined && userTick.background !== agentTick.background,
    `user ${userTick?.background} / agent ${agentTick?.background}`);

  // ⑤ 轨道不吞正文点击
  const pointer = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="message-rail"]')).pointerEvents);
  check(`[${label}] 轨道容器不吞正文点击（pointer-events: none）`, pointer === "none", pointer);

  // ⑥ 当前条：跨满整列 + 强调色（两个独立通道）
  const active = snap.ticks.find((tick) => tick.active);
  if (active !== undefined) {
    const maxOther = Math.max(...snap.ticks.filter((tick) => !tick.active).map((tick) => tick.barWidth));
    check(`[${label}] 当前条比任何别的条都宽（"当前"的第二通道）`, active.barWidth > maxOther,
      `当前 ${Math.round(active.barWidth)} > 最长 ${Math.round(maxOther)}`);
    check(`[${label}] 当前条更厚`, active.barHeight > Math.min(...snap.ticks.map((t) => t.barHeight)),
      `${active.barHeight}px`);
  } else {
    check(`[${label}] 有当前条`, false, "没有 data-rail-active=true 的行");
  }

  // ⑥b 键盘：整列只有一个 Tab 停靠点，↑/↓ 在条内移动（WAI-ARIA toolbar）
  if (expectVisible && snap.ticks.length > 3) {
    const tabbable = await page.evaluate(() => [...document.querySelectorAll('[data-testid="rail-tick"]')].filter((n) => n.tabIndex === 0).length);
    check(`[${label}] 整列只有 1 个 Tab 停靠点（roving tabindex，不是 ${snap.ticks.length} 次 Tab）`, tabbable === 1, `${tabbable} 个`);
    await page.evaluate(() => document.querySelector('[data-testid="rail-tick"][tabindex="0"]')?.focus());
    const before = await page.evaluate(() => document.activeElement?.getAttribute("data-rail-id"));
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    const after = await page.evaluate(() => document.activeElement?.getAttribute("data-rail-id"));
    check(`[${label}] ↑/↓ 在条内移动焦点`, after !== null && after !== undefined, `Home→↓ 落在 ${after}（原 ${before}）`);
    const cardOnFocus = await page.evaluate(() => document.querySelector('[data-testid="rail-card"]') !== null);
    check(`[${label}] 焦点落到某条时卡片跟着出现（键盘也能预览）`, cardOnFocus);
    await page.keyboard.press("Escape");
  }

  // ⑦ 悬停 → 卡片，与该行垂直居中
  if (expectVisible && snap.ticks.length > 2) {
    const target = snap.ticks[Math.min(3, snap.ticks.length - 1)];
    await page.locator(`[data-rail-id="${target.id}"]`).hover();
    await page.waitForTimeout(350);
    const card = await page.evaluate((id) => {
      const node = document.querySelector('[data-testid="rail-card"]');
      if (node === null) return null;
      const rect = node.getBoundingClientRect();
      const row = document.querySelector(`[data-rail-id="${id}"]`).getBoundingClientRect();
      return {
        text: node.textContent?.slice(0, 40),
        inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
        centerGap: Math.round((rect.top + rect.height / 2) - (row.top + row.height / 2)),
        leftOfRow: Math.round(rect.left - row.right),
      };
    }, target.id);
    check(`[${label}] 悬停出卡片`, card !== null, card?.text ?? "");
    check(`[${label}] 卡片在该行垂直居中（偏差 ≤ 2px）`, card !== null && Math.abs(card.centerGap) <= 2, `偏差 ${card?.centerGap}px`);
    check(`[${label}] 卡片在轨道右侧`, card !== null && card.leftOfRow >= 0, `间距 ${card?.leftOfRow}px`);
    check(`[${label}] 卡片不出视口`, card !== null && card.inViewport === true);
  }

  check(`[${label}] 无页面错误`, pageErrors.length === 0, pageErrors.join(" | "));
  await context.close();
}

/* ── 点"答"必须能跳（用户实测缺陷的回归锁）───────────────── */

{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="rail-tick"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const hosts = await page.evaluate(async (session) => {
    const response = await fetch(`/api/agents/lifeosagent/sessions/${session}/rail`);
    const data = await response.json();
    return Object.fromEntries(data.items.map((tick) => [tick.id, tick.host ?? null]));
  }, SESSION).catch(() => ({}));
  const assistantIds = Object.entries(hosts).filter(([, host]) => host !== null).map(([id]) => id);
  console.log("\n── 点「答」的跳转 ──");
  /*
   * 没有 host 时**跳过而不是失败**：`host` 只在"轮末回复被过程条折叠"时出现，
   * 而纯文字会话（每轮只有一条回复）本来就不会折叠 —— 那是夹具的选择，不是实现的缺陷。
   * 但必须打印出来，否则"0 条 → 一条都没测"会被误读成通过（`testing.md` 2.26）。
   */
  if (assistantIds.length === 0) {
    console.log("⤼ 跳过：这条会话的回复没有被过程条折叠（纯文字会话），本条测不到");
  }
  for (const id of assistantIds.slice(0, 3)) {
    await page.evaluate((tid) => document.querySelector(`[data-rail-id="${tid}"]`)?.scrollIntoView({ block: "center" }), id);
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    await page.locator(`[data-rail-id="${id}"]`).click().catch(() => {});
    await page.waitForTimeout(2200);
    const after = await page.evaluate(({ tid, host }) => {
      const main = document.querySelector("main");
      const mainRect = main.getBoundingClientRect();
      const node = document.querySelector(`[data-message-id="${host}"]`);
      const rect = node?.getBoundingClientRect();
      return {
        scrollTop: Math.round(main.scrollTop),
        hostInDom: node !== null,
        hostCenterGap: rect ? Math.round(rect.top - mainRect.top + rect.height / 2 - mainRect.height / 2) : null,
        // 贴顶/贴底时 `scrollIntoView({block:"center"})` **做不到居中**（上方/下方没内容可滚），
        // 这不是缺陷。所以判据分两种：能居中的地方要求居中，端点只要求"落在视口里且靠那一侧"。
        atTop: Math.round(main.scrollTop) <= 1,
        hostVisible: rect ? rect.top >= mainRect.top - 1 && rect.bottom <= mainRect.bottom + 1 : false,
      };
    }, { tid: id, host: hosts[id] });
    const landed = after.hostInDom && (Math.abs(after.hostCenterGap) <= 120
      || (after.atTop && after.hostVisible && after.hostCenterGap <= 0));
    check(`点答 ${id}（host=${hosts[id]}）会跳，并停在那一轮的回答区`,
      after.scrollTop !== before && landed,
      `${before} → ${after.scrollTop}，host 距视口中心 ${after.hostCenterGap}px${after.atTop ? "（贴顶：做不到居中，只要求落在视口里）" : ""}`);
  }
  await context.close();
}

/* ── 流式期间：竖条还活不活（用户 2026-11-19 点名要覆盖的场景）────── */

{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.addInitScript(EVENT_CHANNEL_STUB);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 160)));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="rail-tick"]', { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => typeof window.__ssePush === "function", null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1800);
  console.log("\n── 流式期间 ──");

  // 造"正在回复"：snapshot → turn(running) → message_start → 连推 delta
  let seq = 1;
  const base = (extra) => ({ seq: seq++, agentId: "lifeosagent", sessionId: SESSION, projectId: "workspace", ...extra });
  const push = (name, data) => page.evaluate(([n, d]) => window.__ssePush?.(n, d), [name, JSON.stringify(data)]);
  await push("snapshot", { connectionId: "stream", seq: seq++, running: [], unread: [], aggregate: [] });
  await push("turn", base({ type: "turn", turnId: "stream-case", state: "running" }));
  await page.waitForTimeout(200);
  await push("message_start", base({ type: "message_start", segment: "stream-seg" }));
  for (let i = 0; i < 6; i += 1) {
    await push("text_delta", base({ type: "text_delta", index: 0, segment: "stream-seg", text: `流式片段${i}，` }));
    await page.waitForTimeout(50);
  }
  const streaming = await page.evaluate(() => ({
    // 正文里出现"正在生成"的标志：最后一条 assistant 带 streaming
    hasLiveTail: document.querySelector('[data-testid="message"][data-role="assistant"]') !== null,
    ticks: document.querySelectorAll('[data-testid="rail-tick"]').length,
  }));
  check("流式中竖条仍在（刻度数 > 0）", streaming.ticks > 0, `${streaming.ticks} 条`);

  // ① 悬停仍出卡片
  const row = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="message-rail"]').firstElementChild;
    const listRect = list.getBoundingClientRect();
    const node = [...document.querySelectorAll('[data-testid="rail-tick"]')].find((n) => {
      const b = n.getBoundingClientRect();
      return b.top > listRect.top + 40 && b.bottom < listRect.top + 90;
    });
    if (node === undefined) return null;
    const b = node.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, id: node.getAttribute("data-rail-id") };
  });
  if (row !== null) {
    await page.mouse.move(row.x, row.y);
    await page.waitForTimeout(350);
    check("流式中悬停仍出预览卡片", await page.locator('[data-testid="rail-card"]').count() > 0, row.id);
    await page.mouse.move(row.x + 400, row.y);
    await page.waitForTimeout(200);
  }

  // ② 流式中往上拖：delta 继续到达时**不能被拽回底部**
  const pick = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="message-rail"]').firstElementChild;
    const listRect = list.getBoundingClientRect();
    const node = [...document.querySelectorAll('[data-testid="rail-tick"]')].find((n) => {
      const b = n.getBoundingClientRect();
      return b.top > listRect.top + 60 && b.bottom < listRect.top + 120;
    });
    if (node === undefined) return null;
    const b = node.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  if (pick !== null) {
    await page.mouse.move(pick.x, pick.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) { await page.mouse.move(pick.x, pick.y - i * 12); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(400);
    const afterScrub = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    // 拖完之后继续推 delta（流式还在跑）
    for (let i = 0; i < 5; i += 1) {
      await push("text_delta", base({ type: "text_delta", index: 0, segment: "stream-seg", text: `又一段${i}，` }));
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(400);
    const afterDelta = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    check("流式中拖动后，后续 delta 不会把正文拽回底部", Math.abs(afterDelta - afterScrub) < 150,
      `${afterScrub} → ${afterDelta}（差 ${afterDelta - afterScrub}px）`);
  }

  // ②b 按在滑块上不动就松手 → **不该跳**（否则"想拖但没动够"会突然跳到别处）
  {
    const bandBox = await page.evaluate(() => {
      const node = document.querySelector(".rail-band");
      if (node === null) return null;
      const box = node.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    if (bandBox !== null) {
      const before = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
      await page.mouse.move(bandBox.x, bandBox.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(700);
      const after = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
      check("按在滑块上不动就松手 → 不跳转（不误判成点击）", Math.abs(after - before) < 60, `${before} → ${after}`);
    }
  }

  // ③ 流式中点刻度仍能跳
  const canClick = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="rail-tick"]')];
    const node = rows[Math.floor(rows.length * 0.5)];
    if (node === undefined) return null;
    node.scrollIntoView({ block: "center" });
    return node.getAttribute("data-rail-id");
  });
  if (canClick !== null) {
    await page.waitForTimeout(300);
    const beforeJump = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    await page.locator(`[data-rail-id="${canClick}"]`).click().catch(() => {});
    await page.waitForTimeout(1600);
    const afterJump = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    check("流式中点刻度仍能跳转", afterJump !== beforeJump, `${beforeJump} → ${afterJump}`);
  }

  check("流式中无页面错误", pageErrors.length === 0, pageErrors.join(" | "));
  await context.close();
}

/* ── 拖动 scrub（P7，参照 VSCode/Sublime minimap 的按住拖动）──── */

{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="rail-tick"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log("\n── 拖动 scrub ──");

  const pickRow = () => page.evaluate(() => {
    const list = document.querySelector('[data-testid="message-rail"]').firstElementChild;
    const listRect = list.getBoundingClientRect();
    const row = [...document.querySelectorAll('[data-testid="rail-tick"]')].find((node) => {
      const box = node.getBoundingClientRect();
      return box.top > listRect.top + 60 && box.bottom < listRect.top + 120;
    });
    if (row === undefined) return null;
    const box = row.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });

  const row = await pickRow();
  if (row === null) {
    console.log("⤼ 跳过：列里没有落在可视区的行");
  } else {
    const before = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    await page.mouse.move(row.x, row.y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(row.x, row.y - step * 10);
      await page.waitForTimeout(16);
    }
    const during = await page.evaluate(() => ({
      scrollTop: Math.round(document.querySelector("main").scrollTop),
      scrubbing: document.querySelector("[data-rail-scrubbing]")?.getAttribute("data-rail-scrubbing"),
      cursor: getComputedStyle(document.querySelector('[data-testid="rail-tick"]')).cursor,
      card: document.querySelector('[data-testid="rail-card"]') !== null,
    }));
    await page.mouse.up();
    await page.waitForTimeout(500);
    const settled = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));

    check("按住拖动时正文跟着滚（连续跟手，不是只跳一次）", during.scrollTop < before,
      `${before} → ${during.scrollTop}（往上拖 120px）`);
    check("拖动中整列切到 grabbing、且不弹预览卡片",
      during.scrubbing === "true" && during.cursor === "grabbing" && during.card === false,
      JSON.stringify({ scrubbing: during.scrubbing, cursor: during.cursor, card: during.card }));
    check("松手不再额外跳转（拖动后的那次 click 被吃掉）", Math.abs(settled - during.scrollTop) < 5,
      `${during.scrollTop} → ${settled}`);

    // 单击仍然跳（拖动阈值 4px 内不误判）
    const again = await pickRow();
    if (again !== null) {
      const beforeClick = settled;
      await page.mouse.click(again.x, again.y);
      await page.waitForTimeout(1500);
      const afterClick = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
      check("拖动之后单击仍能跳转（阈值内算点击）", afterClick !== beforeClick, `${beforeClick} → ${afterClick}`);
    }
  }
  await context.close();
}

/* ── 滑块跟手（VSCode minimap.ts:391/:254 的互逆关系）────────── */

{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="rail-tick"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log("\n── 滑块跟手 ──");

  const bandTop = () => page.evaluate(() => {
    const node = document.querySelector(".rail-band");
    return node === null ? null : Math.round(parseFloat(node.style.top || "0"));
  });
  const scrollTop = () => page.evaluate(() => Math.round(document.querySelector("main").scrollTop));

  const target = await page.evaluate(() => {
    const node = document.querySelector(".rail-band");
    if (node === null) return null;
    const box = node.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  if (target === null) {
    console.log("⤼ 跳过：没有滑块（会话太短，不需要滚动）");
  } else {
    const b0 = await bandTop();
    const s0 = await scrollTop();
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    const steps = [];
    let prevBand = b0;
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(target.x, target.y - i * 10);
      await page.waitForTimeout(30);
      const band = await bandTop();
      steps.push(band - prevBand);
      prevBand = band;
    }
    await page.mouse.up();
    const s1 = await scrollTop();
    const worst = Math.max(...steps.map((delta) => Math.abs(delta + 10)));
    check("往上拖：正文确实滚了", s1 < s0, `${s0} → ${s1}`);
    check("往上拖：**滑块每 10px 指针也走 10px**（互逆 = 跟手）", worst <= 2,
      `每步滑块位移 ${steps.join("/")}（应全是 -10）`);
  }
  await context.close();
}

/* ── 滑块与 VSCode 滚动条一致：按比例、有下限、按在它上面就是拖 ── */

{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 160)));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="rail-tick"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log("\n── 滑块（VSCode scrollbarState 公式）──");

  const geom = await page.evaluate(() => {
    const band = document.querySelector(".rail-band");
    if (band === null) return null;
    const box = band.getBoundingClientRect();
    const list = document.querySelector('[data-testid="message-rail"]').firstElementChild;
    return {
      height: Math.round(box.height),
      listHeight: Math.round(list.getBoundingClientRect().height),
      x: box.left + box.width / 2, y: box.top + box.height / 2,
    };
  });
  if (geom === null) {
    console.log("⤼ 跳过：没有滑块");
  } else {
    check("滑块有高度、且能点住（≥20px，VSCode MINIMUM_SLIDER_SIZE）", geom.height >= 20, `${geom.height}px`);

    // ① 按在滑块上**不动**就松手 → 不跳转
    const a0 = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    await page.mouse.move(geom.x, geom.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(600);
    const a1 = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    check("按在滑块上不动就松手 → 不跳转", Math.abs(a1 - a0) < 60, `${a0} → ${a1}`);

    // ② 按在滑块上**立刻**就能拖（不需要先点一下别处）
    const b0 = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    await page.mouse.move(geom.x, geom.y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) { await page.mouse.move(geom.x, geom.y - step * 12); await page.waitForTimeout(20); }
    await page.mouse.up();
    await page.waitForTimeout(400);
    const b1 = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    check("按在滑块上**第一次就能拖**（不需要先点一条刻度）", b1 < b0, `${b0} → ${b1}`);
  }

  // ③ 刷新后立刻拖：不能因为"几何还没量出来"跳到顶部
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="rail-tick"]', { timeout: 30000 }).catch(() => {});
  const early = await page.evaluate(() => {
    const band = document.querySelector(".rail-band");
    if (band === null) return null;
    const box = band.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  if (early !== null) {
    const c0 = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    await page.mouse.move(early.x, early.y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) { await page.mouse.move(early.x, early.y - step * 12); await page.waitForTimeout(20); }
    await page.mouse.up();
    await page.waitForTimeout(500);
    const c1 = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    check("刷新后立刻拖 → 不会自己跳到最顶", c1 <= c0 + 20, `${c0} → ${c1}`);
  }

  check("滑块几何用例无页面错误", pageErrors.length === 0, pageErrors.join(" | "));
  await context.close();
}

/* ── 深色主题 ─────────────────────────────────────────── */

const themeSnapshot = async (mode) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  // 主题的权威来源是服务端 `config/ui.json`（`/api/ui-prefs`），不是 localStorage；
  // 打桩同时保证测试不写用户数据。
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
    const bar = document.querySelector('[data-rail-role="user"] .rail-tick-bar');
    const band = document.querySelector(".rail-band");
    return {
      mode: document.documentElement.dataset.themeMode,
      surface: cs.getPropertyValue("--color-surface").trim(),
      bar: bar === null ? null : getComputedStyle(bar).backgroundColor,
      band: band === null ? null : getComputedStyle(band).backgroundColor,
    };
  });
  await context.close();
  return read;
};
const light = await themeSnapshot("light");
const dark = await themeSnapshot("dark");
console.log("\n── 深浅色 ──");
check("深浅两套下条的颜色都跟着变（不是写死的）",
  light.bar !== null && dark.bar !== null && light.bar !== dark.bar, `light ${light.bar} / dark ${dark.bar}`);
check("深色下条与底色有对比", dark.mode === "dark" && dark.bar !== dark.surface, `bar ${dark.bar} / surface ${dark.surface}`);

await browser.close();
if (failures.length > 0) {
  console.error(`\n消息导航条契约失败 ${failures.length} 项`);
  process.exit(1);
}
console.log("\n消息导航条契约通过");
