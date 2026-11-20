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
  /*
   * "有差异"的下限是 2（不是 3）：短会话里每轮内容量可能很接近（实测 cafe 只有 2 种宽度），
   * 那是数据本身的分布，不是"宽度没在表达内容量"。真正的反例是**全部同宽**（定距）。
   */
  check(`[${label}] 横条宽度有差异（宽度 = 内容量，不是定距）`, distinct >= 2, `${distinct} 种宽度，${Math.round(Math.min(...widths))}–${Math.round(Math.max(...widths))}px`);
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
    snap.list.scrollHeight <= snap.list.height + 1 || rowHeights.every((h) => h <= 14),
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
    /*
     * **宽度只表示内容量**（用户 2026-11-04 定的"长度有定义"，2026-11-19 审核确认不跨满）。
     * "当前"靠颜色 + 描边 + 厚度区分，不占宽度通道。
     */
    check(`[${label}] 当前条保持内容量宽度（不跨满整列）`, active.barWidth < snap.ticks[0].rowWidth - 2,
      `当前 ${Math.round(active.barWidth)}px < 列宽 ${Math.round(snap.ticks[0].rowWidth)}px`);
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
    /*
     * 必须挑一条**在视口内**的行：`snap.ticks[3]` 是列表第 4 行，长会话里它早被滚出可视区，
     * `hover()` 会失败但 Playwright 不报错（元素在 DOM 里），于是卡片停在上一位置、
     * 断言读出 6218px 的假红（`testing.md` 2.15 的"命中 0 个 = 没测"同族）。
     */
    const visibleTick = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="message-rail"] .rail-scroll');
      const listBox = list.getBoundingClientRect();
      const active = document.querySelector('[data-rail-active="true"]');
      const rows = [...list.querySelectorAll('[data-testid="rail-tick"]')];
      const found = rows.find((node) => {
        const box = node.getBoundingClientRect();
        return node !== active && box.top > listBox.top + 120 && box.bottom < listBox.bottom - 120;
      });
      if (found === undefined) return null;
      const box = found.getBoundingClientRect();
      return { id: found.getAttribute("data-rail-id"), x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    if (visibleTick === null) {
      console.log(`⤼ [${label}] 列里没有落在可视区的行（会话太短），悬停卡片用例跳过`);
    }
    const target = visibleTick ?? snap.ticks[Math.min(3, snap.ticks.length - 1)];
    if (visibleTick !== null) await page.mouse.move(visibleTick.x, visibleTick.y);
    else await page.locator(`[data-rail-id="${target.id}"]`).hover();
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
    /*
     * 先把这一行**滚进刻度列的视野**再点：会话末尾时它可能滚在列外，
     * `locator.click()` 会失败而 `.catch()` 把错误吞掉 → 什么都没发生（假红）。
     * 用列自己的 `scrollTop` 定位，不用 `scrollIntoView`（那会连带滚正文）。
     */
    await page.evaluate((tid) => {
      const rail = document.querySelector('[data-testid="message-rail"]');
      const list = rail.querySelector(".rail-scroll");
      const row = document.querySelector(`[data-rail-id="${tid}"]`);
      if (list === null || row === null) return;
      list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2);
    }, id);
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    // 用 DOM click 而不是 locator.click：后者要求元素"可见可点"，而它可能在列的滚动边缘
    await page.evaluate((tid) => document.querySelector(`[data-rail-id="${tid}"]`)?.click(), id);
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

  /*
   * ②b 按在滑块内的一条横条上、不动就松手 → **要跳**
   * （用户 2026-11-19："我点击任意一个横条，都应该跳转到那个横条"）。
   * 短会话里滑块很大、横条几乎都在滑块内，以前这批横条一条都点不动。
   */
  {
    const pressed = await page.evaluate(() => {
      const node = document.querySelector(".rail-band");
      if (node === null) return null;
      const box = node.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      const row = hit?.closest?.("[data-rail-id]") ?? null;
      const rows = [...document.querySelectorAll('[data-testid="rail-tick"]')];
      return row === null ? null : { x, y, index: rows.indexOf(row) };
    });
    if (pressed !== null) {
      await page.mouse.move(pressed.x, pressed.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(700);
      const active = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-testid="rail-tick"]')];
        const node = document.querySelector('[data-rail-active="true"]');
        return node === null ? -1 : rows.indexOf(node);
      });
      check("按在滑块内的横条上单击（不动）→ 跳到那一条", active === pressed.index, `按 #${pressed.index} → 高亮 #${active}`);
    }
  }

  // ③ 流式中点刻度仍能跳（先离开底部 —— 在底部时"往上跳"的位移为 0）
  await page.evaluate(() => { const m = document.querySelector("main"); m.scrollTop = m.scrollHeight * 0.5; });
  await page.waitForTimeout(800);
  const canClick = await page.evaluate(() => {
    /*
     * 挑一条**离当前高亮足够远**的可见行（≥ 10 条）：点它才有可观测的正文位移。
     * 原来的写法取"第 len/2 条"，它可能正好就是当前高亮那一条（列表已被滚到那里），
     * 点了位移为 0 → 假红。
     */
    const list = document.querySelector('[data-testid="message-rail"] .rail-scroll');
    const listBox = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll('[data-testid="rail-tick"]')];
    const activeIndex = rows.indexOf(document.querySelector('[data-rail-active="true"]'));
    const node = rows.find((row, index) => {
      const box = row.getBoundingClientRect();
      return Math.abs(index - activeIndex) >= 10 && box.top > listBox.top + 40 && box.bottom < listBox.bottom - 40;
    });
    return node === undefined ? null : node.getAttribute("data-rail-id");
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

/* ── 拖动 scrub（按住**滑块**拖，正文跟着滚）──────────────── */

{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="rail-tick"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log("\n── 拖动 scrub ──");

  // 先离开底部：在会话末尾往上拖没有内容可看
  await page.evaluate(() => { const m = document.querySelector("main"); m.scrollTop = (m.scrollHeight - m.clientHeight) * 0.5; });
  await page.waitForTimeout(1200);

  const bandAt = () => page.evaluate(() => {
    const band = document.querySelector(".rail-band");
    if (band === null) return null;
    const box = band.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, top: Math.round(box.top) };
  });
  const scrollTop = () => page.evaluate(() => Math.round(document.querySelector("main").scrollTop));

  const start = await bandAt();
  if (start === null) {
    console.log("⤼ 跳过：没有滑块");
  } else {
    const s0 = await scrollTop();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const frames = [];
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(start.x, start.y - step * 25);
      await page.waitForTimeout(70);
      frames.push(await page.evaluate(() => {
        const rail = document.querySelector('[data-testid="message-rail"]');
        const list = rail.querySelector(".rail-scroll");
        const lb = list.getBoundingClientRect();
        const bandBox = document.querySelector(".rail-band").getBoundingClientRect();
        const active = document.querySelector('[data-rail-active="true"]');
        const ab = active?.getBoundingClientRect();
        return {
          scrolling: list.getAttribute("data-rail-scrubbing"),
          cursor: getComputedStyle(document.querySelector('[data-testid="rail-tick"]')).cursor,
          card: document.querySelector('[data-testid="rail-card"]') !== null,
          wraps: ab ? (ab.top >= bandBox.top - 1 && ab.bottom <= bandBox.bottom + 1) : false,
          actives: document.querySelectorAll('[data-rail-active="true"]').length,
        };
      }));
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
    const s1 = await scrollTop();
    const mid = frames[Math.floor(frames.length / 2)];
    check("按住滑块拖动 → 正文跟着滚（连续跟手）", s1 < s0, `${s0} → ${s1}`);
    check("拖动中整列切到 grabbing、且不弹预览卡片",
      frames.every((f) => f.scrolling === "true") && mid.cursor === "grabbing" && frames.every((f) => f.card === false),
      JSON.stringify({ scrubbing: mid.scrolling, cursor: mid.cursor, card: frames.some((f) => f.card) }));
    check("拖动全程高亮条都在滑块内（包裹）", frames.every((f) => f.wraps), `${frames.filter((f) => f.wraps).length}/${frames.length} 帧`);
    check("拖动全程只有一条高亮", frames.every((f) => f.actives === 1), `${frames.map((f) => f.actives).join(",")}`);
  }
  await context.close();
}

/* ── 松手不回弹 / 点击一步到位（用户 2026-11-19 报的两个缺陷）──── */

{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="rail-tick"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log("\n── 松手不回弹 / 点击一步到位 ──");

  const snapshot = () => page.evaluate(() => {
    const rail = document.querySelector('[data-testid="message-rail"]');
    const list = rail.querySelector(".rail-scroll");
    const listBox = list.getBoundingClientRect();
    const bandBox = document.querySelector(".rail-band").getBoundingClientRect();
    const active = document.querySelector('[data-rail-active="true"]');
    const activeBox = active?.getBoundingClientRect();
    const rows = [...list.querySelectorAll('[data-testid="rail-tick"]')];
    return {
      bandTop: Math.round(bandBox.top - listBox.top),
      index: active ? rows.indexOf(active) : -1,
      wraps: activeBox === undefined ? false : (activeBox.top >= bandBox.top - 1 && activeBox.bottom <= bandBox.bottom + 1),
      scrollTop: Math.round(document.querySelector("main").scrollTop),
    };
  });

  await page.evaluate(() => { const m = document.querySelector("main"); m.scrollTop = (m.scrollHeight - m.clientHeight) * 0.85; });
  await page.waitForTimeout(900);

  // ① 拖动 → 松手 → 5 秒内不得挪动
  const band = await page.evaluate(() => {
    const box = document.querySelector(".rail-band").getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await page.mouse.move(band.x, band.y);
  await page.mouse.down();
  await page.mouse.move(band.x, band.y - 200);
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const settled = await snapshot();
  const drift = [];
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(600);
    drift.push(await snapshot());
  }
  check("松手后滑块与高亮**停在原处**（5 秒内不弹走）",
    drift.every((s) => s.bandTop === settled.bandTop && s.index === settled.index),
    `松手 ${settled.bandTop}/#${settled.index} → 采样 ${drift.map((s) => `${s.bandTop}/#${s.index}`).join(" ")}`);
  check("松手后高亮仍在滑块内", drift.every((s) => s.wraps));

  // ② 点一条远处的行 → 立刻切过去（不等平滑滚动）
  const target = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="message-rail"]');
    const list = rail.querySelector(".rail-scroll");
    const listBox = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll('[data-testid="rail-tick"]')];
    const activeIndex = rows.indexOf(document.querySelector('[data-rail-active="true"]'));
    const found = rows.map((row, index) => ({ row, index })).find(({ row, index }) => {
      const box = row.getBoundingClientRect();
      if (Math.abs(index - activeIndex) < 3) return false;
      /*
       * 只挑**真正落在可视区里、且没被滑块盖住**的行：
       * 短会话（列表不滚）里"第 8 条"可能正好在滑块下面，点它会打到滑块上 → 变成拖动。
       * 用 `elementFromPoint` 确认命中目标就是这一行。
       */
      if (!(box.top > listBox.top + 20 && box.bottom < listBox.bottom - 20)) return false;
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit !== null && row.contains(hit);
    });
    if (found === undefined) return null;
    const box = found.row.getBoundingClientRect();
    return { id: found.row.getAttribute("data-rail-id"), index: found.index, x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  if (target === null) {
    console.log("⤼ 跳过：列里没有离当前足够远的可见行");
  } else {
    const before = await snapshot();
    await page.mouse.click(target.x, target.y);
    // 300ms 内必须已经切过去（长距离跳转不允许走 smooth）
    await page.waitForTimeout(300);
    const at300 = await snapshot();
    await page.waitForTimeout(1500);
    const at1800 = await snapshot();
    check(`点第 ${target.index} 条 → **300ms 内**高亮已切到它（不是"慢慢爬"）`,
      at300.index === target.index, `点前 #${before.index} → 300ms #${at300.index}（期望 ${target.index}）`);
    check("点完之后滑块立刻包裹它、位置也切过去",
      at300.wraps && at300.bandTop !== before.bandTop, `${before.bandTop} → ${at300.bandTop}`);
    check("点完之后不再自己变化（1.8s 后与 300ms 一致）",
      at1800.index === at300.index && at1800.bandTop === at300.bandTop,
      `300ms ${at300.bandTop}/#${at300.index} → 1.8s ${at1800.bandTop}/#${at1800.index}`);
  }
  await context.close();
}

/* ── 连续点击：每一轮都要"点哪到哪"（用户 2026-11-19："我点击任意一个横条…"）── */

{
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="rail-tick"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log("\n── 连续点击 8 轮 ──");

  const failures = [];
  let rounds = 0;
  for (let round = 0; round < 8; round += 1) {
    /*
     * 每轮都**重新取坐标**。这是这条用例的关键：第一次点击会让刻度列滚动，
     * 上一轮算出的 (x, y) 就指向别的行了（实测：用旧坐标点，`elementFromPoint` 返回 null，
     * 根本没发生点击，于是"没到"是测试的错，不是产品的错）。
     */
    const target = await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="message-rail"]');
      const list = rail.querySelector(".rail-scroll");
      const listBox = list.getBoundingClientRect();
      const rows = [...list.querySelectorAll('[data-testid="rail-tick"]')];
      const activeIndex = rows.indexOf(document.querySelector('[data-rail-active="true"]'));
      const found = rows.map((row, index) => ({ row, index })).find(({ row, index }) => {
        const box = row.getBoundingClientRect();
        if (Math.abs(index - activeIndex) < 5) return false;
        if (!(box.top > listBox.top + 20 && box.bottom < listBox.bottom - 20)) return false;
        // 必须命中这一行本身（不被滑块或其他层挡住）
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit !== null && row.contains(hit);
      });
      if (found === undefined) return null;
      const box = found.row.getBoundingClientRect();
      return { index: found.index, x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    if (target === null) break;
    rounds += 1;
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(700);
    const landed = await page.evaluate((wanted) => {
      const rail = document.querySelector('[data-testid="message-rail"]');
      const list = rail.querySelector(".rail-scroll");
      const rows = [...list.querySelectorAll('[data-testid="rail-tick"]')];
      const active = document.querySelector('[data-rail-active="true"]');
      const listBox = list.getBoundingClientRect();
      const bandBox = document.querySelector(".rail-band").getBoundingClientRect();
      const activeBox = active?.getBoundingClientRect();
      return {
        index: active ? rows.indexOf(active) : -1,
        wraps: activeBox === undefined ? false : (activeBox.top >= bandBox.top - 1 && activeBox.bottom <= bandBox.bottom + 1),
      };
    }, target.index);
    if (landed.index !== target.index || !landed.wraps) failures.push(`#${target.index}→#${landed.index}${landed.wraps ? "" : "(未包裹)"}`);
  }
  check(`连续点 ${rounds} 轮，每轮都"点哪到哪"且滑块包裹`,
    rounds >= 3 && failures.length === 0,
    failures.length === 0 ? `${rounds}/${rounds} 全部到位` : `失败：${failures.join(" ")}`);
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
    /*
     * 从**第 2 步**开始判：第一步（`steps[0]`）是"进入拖动"的那一帧 ——
     * `setScrubbing(true)` 要等 React 提交，那一帧滑块还没跟。它不构成"跟手"的反例。
     * ±2 容差：滑块 top 是整数像素（`Math.round`），指针是 10px 步进，取整带来 ±1。
     */
    /*
     * 判**总位移**而不是逐步位移：滑块位置跟"行号"走（`resolvedIndex`），
     * 而行号是整数、行高 12px —— 逐步会有 ±2px 的量化抖动（-11/-6/-12），
     * 但 100px 指针位移对应的总位移必须吻合（累积误差不会发散）。
     */
    const total = steps.reduce((sum, delta) => sum + delta, 0);
    const totalTravel = await page.evaluate(() => {
      const b = document.querySelector(".rail-band");
      const list = document.querySelector('[data-testid="message-rail"] .rail-scroll');
      return Math.round(b.getBoundingClientRect().top - list ? 0 : 0);
    });
    check("往上拖：正文确实滚了", s1 < s0, `${s0} → ${s1}`);
    /*
     * 指针总位移 = 每步 10px × 步数（`steps` 有 10 项）。容忍 ±(行高/2 + 1)：
     * 滑块位置跟整数行号走，最后一步可能跨过一整行的一半。
     */
    const pointerTotal = -10 * steps.length;
    check("往上拖：**滑块总位移 ≈ 指针总位移**（互逆 = 跟手）", Math.abs(total - pointerTotal) <= 8,
      `指针 ${-pointerTotal}px → 滑块 ${-total}px（逐步 ${steps.join("/")}；±8 = 行高 12px 的量化上界）`);
    void totalTravel;
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

    /*
     * ① 单击滑块（不动）→ 跳到指针下那一条（用户 2026-11-19 的要求）。
     * 以前的断言是"不跳"，它把"按在滑块内 = 一律拖动"写成了契约 —— 正是那条契约
     * 让滑块覆盖区域里的横条全部点不动（cafe 实测滑块占 66% 高度）。
     */
    const pressedRow = await page.evaluate((p) => {
      const hit = document.elementFromPoint(p.x, p.y);
      const row = hit?.closest?.("[data-rail-id]") ?? null;
      const rows = [...document.querySelectorAll('[data-testid="rail-tick"]')];
      return row === null ? null : { index: rows.indexOf(row) };
    }, geom);
    if (pressedRow !== null) {
      await page.mouse.move(geom.x, geom.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(600);
      const landed = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-testid="rail-tick"]')];
        const node = document.querySelector('[data-rail-active="true"]');
        return node === null ? -1 : rows.indexOf(node);
      });
      check("单击滑块内的横条 → 跳到那一条（不误判成拖动）",
        landed === pressedRow.index, `按 #${pressedRow.index} → 高亮 #${landed}`);
    }

    // ② 按在滑块上**立刻**就能拖（不需要先点一下别处）
    //    滑块会被上一步的跳转挪走，所以**重新取**它此刻的中心（用旧坐标按会按到滑块外面）
    const bandNow = await page.evaluate(() => {
      const box = document.querySelector(".rail-band").getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    const b0 = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    await page.mouse.move(bandNow.x, bandNow.y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) { await page.mouse.move(bandNow.x, bandNow.y - step * 12); await page.waitForTimeout(20); }
    await page.mouse.up();
    await page.waitForTimeout(400);
    const b1 = await page.evaluate(() => Math.round(document.querySelector("main").scrollTop));
    check("按在滑块上**第一次就能拖**（不需要先点一条刻度）", b1 < b0, `${b0} → ${b1}`);
  }

  /*
   * ③ 刷新后立刻**往上**拖：不能因为"几何还没量出来"跳到顶部。
   *
   * 判据是"没跳到**顶**"而不是"位移 < 20px"：刷新后后台在补齐历史（`ensureFullHistory`），
   * 内容会**变长**，`scrollTop` 的绝对值随之增大 —— 那是加载造成的，不是拖动造成的。
   * 真缺陷的形态是"一拖就跳到 0"（顶端），所以断言顶端。
   */
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
    check("刷新后立刻往上拖 → 不会自己跳到最顶", c1 > 0, `${c0} → ${c1}（>0 = 没跳到顶）`);
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
