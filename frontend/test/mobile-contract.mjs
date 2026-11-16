#!/usr/bin/env node
/**
 * 手机布局契约（frontend-spec §3.2）：
 * - 360/390/430：无横向溢出；无桌面 rail；有导航入口；
 * - 导航抽屉 tabs/按钮 ≥44；配置全屏 sheet；按钮 ≥44；状态条在 main 外。
 * 需要 dev server（默认 http://localhost:5173）。
 */
import pw from "/Users/xulater/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js";
const { chromium } = pw;
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
/**
 * 覆盖档（Task 0016 · P6-S1）：
 *  - 320：小屏 iPhone SE 的宽度。实测该档下头部标题可用宽度是 **0px**，
 *    是"6 个图标挤掉标题"最严重的档，之前没被测到。
 *  - 360/390/430：existing 的竖屏主力档。
 *  - 844×390 横屏单列在下面单独跑（粗指针 + 矮视口：命中区必须仍是 44）。
 */
const widths = [320, 360, 390, 430];
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
  if (!ok) failures.push(name);
};

/**
 * 已知缺陷（Task 0016 · P6）：断言现在**必然红**，但根因已定位、修复排在别的步骤。
 *
 * 为什么不用 `skip`：skip 会让"它其实好了"也看不出来。这里反过来——
 * 现在的状态必须红（否则说明判定写错了），而一旦变绿就打印提醒去删掉这条豁免。
 * 每条必须写 `fixedBy`，没人认领的已知缺陷不允许留在门禁里。
 */
const known = [];
const checkKnown = (name, ok, detail, fixedBy) => {
  if (ok) {
    console.log(`⚠ KNOWN ${name} —— 已经不红了：请删掉这条豁免（${fixedBy}）${detail === "" ? "" : `  → ${detail}`}`);
    known.push({ name, fixedBy, resolved: true });
    return;
  }
  console.log(`⚠ KNOWN ${name}（修在 ${fixedBy}）${detail === "" ? "" : `  → ${detail}`}`);
  known.push({ name, fixedBy, resolved: false });
};
const browser = await chromium.launch({ headless: true });
for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(350);
  // 不依赖“第一个 Agent 恰好有会话”：选一个确实有会话的 Agent/项目/会话，再跑手机表面契约。
  const target = await page.evaluate(async () => {
    const agents = await (await fetch("/api/agents")).json();
    for (const agent of agents.items ?? []) {
      const projects = await (await fetch(`/api/agents/${agent.id}/projects`)).json();
      for (const project of projects.items ?? []) {
        const sessions = await (await fetch(`/api/agents/${agent.id}/projects/${project.id}/sessions`)).json();
        const session = sessions.items?.find((item) => item.sessionId !== undefined);
        if (session !== undefined) return { agent: agent.id, project: project.id, session: session.sessionId };
      }
    }
    return null;
  });
  const targetUrl = target === null ? null
    : `${APP_URL}/?${new URLSearchParams({ agent: target.agent, project: target.project, session: target.session }).toString()}`;
  if (targetUrl !== null) {
    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
  }
  const base = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    rail: document.querySelector('nav[aria-label="左侧图标轨"]') !== null,
    menu: document.querySelector('button[aria-label="打开导航"]') !== null,
    back: document.querySelector('button[aria-label="返回项目"]') !== null,
    small: [...document.querySelectorAll("button")].filter((button) => button.offsetParent !== null)
      .map((button) => ({ text: (button.textContent ?? "").trim().slice(0, 16), w: Math.round(button.getBoundingClientRect().width), h: Math.round(button.getBoundingClientRect().height) }))
      .filter((button) => button.w < 44 || button.h < 44),
  }));
  // 320 档的横向溢出是**已知缺陷**：头部 6 个 44px 图标 + 5 个 8px 间距 + 32px 内边距 = 336px，
  // 所以 mobile 布局视口被撑到 336（实测 docScrollWidth 336 > 320）。修法是 P7-S5「手机头部更多层」，
  // 那一步之后这条会变绿，届时 checkKnown 会打印"请删掉豁免"。
  if (width === 320) {
    checkKnown(`[${width}] 无横向溢出`, base.scroll === base.client, `${base.scroll}/${base.client}`, "P7-S5 手机头部");
  } else {
    check(`[${width}] 无横向溢出`, base.scroll === base.client, `${base.scroll}/${base.client}`);
  }
  check(`[${width}] 手机不显示桌面 rail`, base.rail === false);
  check(`[${width}] 有导航入口`, base.menu || base.back);
  check(`[${width}] 可见按钮触控目标 ≥44`, base.small.length === 0, base.small.map((button) => `${button.text}:${button.w}x${button.h}`).join(" / "));

  // 手机 composer（chat.md §3.5）：短 placeholder、可访问名、调色板行 ≥44。
  const composer = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="composer"]');
    const ta = c?.querySelector("textarea");
    return { exists: c !== null, placeholder: ta?.getAttribute("placeholder") ?? null, aria: ta?.getAttribute("aria-label") ?? null };
  });
  check(`[${width}] 手机 composer 短 placeholder`, composer.exists && composer.placeholder === "输入消息", JSON.stringify(composer));
  check(`[${width}] composer textarea 有可访问名`, composer.aria === "输入消息", String(composer.aria));
  const textarea = page.locator("textarea").first();
  await textarea.fill("/");
  await page.waitForTimeout(250);
  const paletteSmall = await page.evaluate(() => {
    const palette = document.querySelector('div[aria-label="斜杠命令"]');
    return [...(palette?.querySelectorAll("button") ?? [])].filter((button) => button.offsetParent !== null)
      .map((button) => ({ text: (button.textContent ?? "").trim().slice(0, 12), h: Math.round(button.getBoundingClientRect().height) }));
  });
  check(`[${width}] 调色板行 ≥44`, paletteSmall.length > 0 && paletteSmall.every((button) => button.h >= 44), paletteSmall.map((button) => `${button.text}:${button.h}`).join(" / "));
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    if (ta === null) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(150);

  const navEntry = page.getByRole("button", { name: "打开导航" }).or(page.getByRole("button", { name: "返回项目" }));

  // 系统返回：一次退一层，根级再退才关闭；不能直接离开应用。
  await navEntry.click();
  await page.waitForTimeout(300);
  const startLevel = await page.locator('[data-testid="mobile-nav"]').getAttribute("data-mobile-level");
  if (startLevel !== "agents") {
    await page.goBack();
    await page.waitForTimeout(300);
    check(`[${width}] 系统返回退一层`, (await page.locator('[data-testid="mobile-nav"]').count()) === 1 && (await page.locator('[data-testid="mobile-nav"]').getAttribute("data-mobile-level")) === "agents");
  }
  await page.goBack();
  await page.waitForTimeout(300);
  check(`[${width}] 系统返回根级关闭`, (await page.locator('[data-testid="mobile-nav"]').count()) === 0);

  // 右边缘向左滑：只退一层，不清空整个导航。
  await navEntry.click();
  await page.waitForTimeout(300);
  if ((await page.locator('[data-testid="mobile-nav"]').getAttribute("data-mobile-level")) === "agents") {
    await page.locator('[data-mobile-level="agents"] [role="button"]').first().click();
    await page.waitForTimeout(400);
  }
  const swiped = await page.evaluate(() => {
    const w = window.innerWidth;
    const make = (x) => new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 400, screenX: x, screenY: 400, pageX: x, pageY: 400 });
    window.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [make(w - 5)], targetTouches: [make(w - 5)], changedTouches: [make(w - 5)] }));
    window.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [make(w - 80)], targetTouches: [make(w - 80)], changedTouches: [make(w - 80)] }));
    window.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [make(w - 80)] }));
    return true;
  }).catch(() => false);
  await page.waitForTimeout(400);
  check(`[${width}] 右边缘滑返回只退一层`, swiped && (await page.locator('[data-testid="mobile-nav"]').count()) === 1 && (await page.locator('[data-testid="mobile-nav"]').getAttribute("data-mobile-level")) !== "sessions");
  await page.getByRole("button", { name: "关闭导航" }).click();
  await page.waitForTimeout(300);

  await navEntry.click();
  await page.waitForTimeout(200);
  if ((await page.locator('[data-testid="mobile-nav"]').getAttribute("data-mobile-level")) !== "agents") {
    await page.getByRole("button", { name: "返回上一级" }).click();
    await page.waitForTimeout(200);
  }
  const nav = await page.evaluate(() => {
    const n = document.querySelector('[data-testid="mobile-nav"]');
    const buttons = [...(n?.querySelectorAll("button") ?? [])].filter((button) => button.offsetParent !== null)
      .map((button) => ({ text: (button.textContent ?? "").trim().slice(0, 12), h: Math.round(button.getBoundingClientRect().height) }));
    const config = buttons.find((button) => button.text.includes("配置当前助手"));
    return { exists: n !== null, buttons, configH: config?.h ?? 0 };
  });
  check(`[${width}] 导航抽屉存在`, nav.exists);
  check(`[${width}] 导航按钮 ≥44`, nav.buttons.length > 0 && nav.buttons.every((button) => button.h >= 44), nav.buttons.map((button) => `${button.text}:${button.h}`).join(" / "));
  check(`[${width}] 配置入口 ≥44`, nav.configH >= 44, `${nav.configH}`);

  await page.getByRole("button", { name: "配置当前助手" }).click();
  await page.locator('[role="dialog"]').waitFor();
  await page.waitForTimeout(250);
  const modal = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const box = dialog?.getBoundingClientRect();
    const buttons = [...(dialog?.querySelectorAll("button") ?? [])].filter((button) => button.offsetParent !== null);
    return {
      w: box ? Math.round(box.width) : 0,
      h: box ? Math.round(box.height) : 0,
      buttons: buttons.map((button) => Math.round(button.getBoundingClientRect().height)),
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    };
  });
  check(`[${width}] 配置是全屏 sheet`, modal.w >= width - 1 && modal.h >= 843, `${modal.w}x${modal.h}`);
  check(`[${width}] 配置按钮 ≥44`, modal.buttons.length > 0 && modal.buttons.every((height) => height >= 44), modal.buttons.join("/"));
  if (width === 320) {
    checkKnown(`[${width}] 配置无横向溢出`, modal.scroll === modal.client, `${modal.scroll}/${modal.client}`, "P7-S5 手机头部");
  } else {
    check(`[${width}] 配置无横向溢出`, modal.scroll === modal.client, `${modal.scroll}/${modal.client}`);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // 多级导航：选 Agent 不能关闭抽屉；进入项目，再进入会话；只有选会话才关闭。
  await navEntry.click();
  await page.waitForTimeout(200);
  if ((await page.locator('[data-testid="mobile-nav"]').getAttribute("data-mobile-level")) !== "agents") {
    await page.getByRole("button", { name: "返回上一级" }).click();
    await page.waitForTimeout(200);
  }
  check(`[${width}] 导航从助手级开始`, (await page.locator('[data-testid="mobile-nav"]').getAttribute("data-mobile-level")) === "agents");
  await page.locator('[data-mobile-level="agents"] [role="button"]').first().click();
  await page.waitForTimeout(400);
  check(`[${width}] 选 Agent 后导航仍在、进入项目级`, (await page.locator('[data-testid="mobile-nav"]').count()) === 1 && (await page.locator('[data-testid="mobile-nav"]').getAttribute("data-mobile-level")) === "projects");
  const projectRow = page.locator('[data-mobile-level="projects"] [role="button"]').first();
  if (await projectRow.count() === 0) {
    check(`[${width}] 选项目后进入会话级`, false, "没有项目行");
  } else {
    await projectRow.click();
    await page.waitForTimeout(400);
    check(`[${width}] 选项目后导航仍在、进入会话级`, (await page.locator('[data-testid="mobile-nav"]').count()) === 1 && (await page.locator('[data-testid="mobile-nav"]').getAttribute("data-mobile-level")) === "sessions");
    /**
     * P1-S2（Task 0016）：选项目 = **只切项目**。
     * 改之前 `selectProject()` 末尾会 `openSession(pickLatest(...))`，于是点项目顺手打开了
     * 该项目最新会话——手机上实测 1711 ms + 1497 ms 长任务，期间屏幕显示"发一条消息开始对话"。
     * 三条断言缺一不可，否则"看起来还在会话级"也能过：
     *   a) URL 不带 `session`（指针真的没指向任何会话）；
     *   b) 消息区**没有**消息节点（没有偷偷渲染旧会话）；
     *   c) 不出现"发一条消息开始对话"（那是空会话的文案，会让人以为对话丢了）。
     */
    const afterProject = await page.evaluate(() => ({
      hasSessionParam: new URLSearchParams(window.location.search).has("session"),
      messageNodes: document.querySelectorAll('[data-testid="message"]').length,
      emptyChatCopy: (document.querySelector("main")?.innerText ?? "").includes("发一条消息开始对话"),
    }));
    check(`[${width}] 选项目后 URL 不带 session`, afterProject.hasSessionParam === false, JSON.stringify(afterProject));
    check(`[${width}] 选项目后不渲染任何消息`, afterProject.messageNodes === 0, `${afterProject.messageNodes}`);
    // 空态文案必须是"选一条对话"（有对话时），**不是**"发一条消息开始对话"
    // （后者是空会话的文案，先看到它会让人以为对话列表丢了）。
    check(`[${width}] 选项目后空态不说"开始对话"`, afterProject.emptyChatCopy === false, String(afterProject.emptyChatCopy));

    // 点会话行仍然要能打开（这条是"不许过度收敛"的反向保险）
    const sessionRow = page.locator('[data-mobile-level="sessions"] [role="button"]').first();
    if (await sessionRow.count() > 0) {
      await sessionRow.click();
      await page.waitForTimeout(600);
      const opened = await page.evaluate(() => ({
        drawerClosed: document.querySelector('[data-testid="mobile-nav"]') === null,
        hasSessionParam: new URLSearchParams(window.location.search).has("session"),
      }));
      check(`[${width}] 点会话行仍能打开会话`, opened.drawerClosed && opened.hasSessionParam, JSON.stringify(opened));
      // 点会话行会关闭抽屉（预期）。后面的用例会 goto targetUrl 恢复，
      // 这里不试图把抽屉恢复到特定层级——那会让后续断言依赖脆弱的中间态。
    }
  }
  // 抽屉可能已被"点会话行"用例关掉（那是预期行为）：只在还开着时关闭。
  const closeNav = page.getByRole("button", { name: "关闭导航" });
  if (await closeNav.count() > 0) { await closeNav.click(); await page.waitForTimeout(200); }
  // 导航测试可能切到没有会话的 Agent/项目；回到有会话的目标，再测全屏面板。
  if (targetUrl !== null) {
    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
  }

  // 全屏面板必须有返回/关闭，且按钮在视口内。
  const historyButton = page.getByRole("button", { name: "完整历史" }).first();
  if (await historyButton.count() > 0 && await historyButton.isEnabled()) {
    await historyButton.click();
    await page.waitForTimeout(400);
    const historyBack = page.locator('aside [aria-label="返回"]').first();
    const historyBox = await historyBack.boundingBox().catch(() => null);
    check(`[${width}] 完整历史有返回且可见`, historyBox !== null && historyBox.x >= 0 && historyBox.x + historyBox.width <= width, JSON.stringify(historyBox));
    const historySmall = await page.evaluate(() => {
      const root = document.querySelector('aside');
      return [...(root?.querySelectorAll('button, a[href]') ?? [])].filter((el) => el.offsetParent !== null)
        .map((el) => ({ text: (el.textContent ?? "").trim().slice(0, 12), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }))
        .filter((el) => el.w < 44 || el.h < 44);
    });
    check(`[${width}] 完整历史按钮 ≥44`, historySmall.length === 0, historySmall.map((el) => `${el.text}:${el.w}x${el.h}`).join(" / "));
    await page.keyboard.press("Tab");
    const focusInside = await page.evaluate(() => document.activeElement?.closest("aside") !== null);
    check(`[${width}] 完整历史焦点在面板内`, focusInside);
    if (historyBox !== null) await historyBack.click();
    await page.waitForTimeout(300);
    check(`[${width}] 完整历史可返回`, await page.locator('[data-shot-mask="history-body"]').count() === 0);
    // 系统返回同样关闭全屏历史。
    await historyButton.click();
    await page.waitForTimeout(300);
    await page.goBack();
    await page.waitForTimeout(300);
    check(`[${width}] 完整历史可被系统返回关闭`, await page.locator('[data-shot-mask="history-body"]').count() === 0);
  } else {
    check(`[${width}] 完整历史有返回且可见`, false, "没有可用会话");
  }

  const fileButton = page.getByRole("button", { name: "展开文件面板" }).first();
  if (await fileButton.count() > 0) {
    await fileButton.click();
    await page.waitForTimeout(300);
    const fileClose = page.getByRole("button", { name: "关闭文件面板" }).first();
    const fileBox = await fileClose.boundingBox().catch(() => null);
    check(`[${width}] 文件面板有关闭且可见`, fileBox !== null && fileBox.x >= 0 && fileBox.y >= 0 && fileBox.x + fileBox.width <= width, JSON.stringify(fileBox));
    const fileSmall = await page.evaluate(() => {
      const root = document.querySelector('aside');
      return [...(root?.querySelectorAll('button, a[href]') ?? [])].filter((el) => el.offsetParent !== null)
        .map((el) => ({ text: (el.textContent ?? "").trim().slice(0, 12), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }))
        .filter((el) => el.w < 44 || el.h < 44);
    });
    check(`[${width}] 文件面板按钮 ≥44`, fileSmall.length === 0, fileSmall.map((el) => `${el.text}:${el.w}x${el.h}`).join(" / "));
    if (fileBox !== null) await fileClose.click();
    await page.waitForTimeout(300);
    check(`[${width}] 文件面板可关闭`, (await page.getByRole("button", { name: "关闭文件面板" }).count()) === 0);
    // 系统返回同样关闭全屏文件面板。
    await fileButton.click();
    await page.waitForTimeout(300);
    await page.goBack();
    await page.waitForTimeout(300);
    check(`[${width}] 文件面板可被系统返回关闭`, (await page.getByRole("button", { name: "关闭文件面板" }).count()) === 0);
  }
  await context.close();
}

// ── 横屏档（Task 0016 · P6-S1）────────────────────────────────────────────────
// 844×390：iPhone 横屏。宽度超 640，但**粗指针 + 矮视口** → 必须留在移动布局，
// 且命中区仍要 44（实测改前 28–36px：`返回项目` 28 / `完整历史` 32 / `设置` 36）。
{
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const landscape = await page.evaluate(() => {
    const vis = (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0;
    const small = [...document.querySelectorAll("button,a[href],[role='button']")].filter(vis)
      .map((el) => ({ label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 12), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }))
      .filter((el) => el.w < 44 || el.h < 44);
    return {
      rail: document.querySelector('nav[aria-label="左侧图标轨"]') !== null,
      mobileNav: document.querySelector('button[aria-label="打开导航"],button[aria-label="返回项目"]') !== null,
      small,
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    };
  });
  check("[844×390 横屏] 仍走移动布局（无桌面 rail）", landscape.rail === false, String(landscape.rail));
  check("[844×390 横屏] 有移动导航入口", landscape.mobileNav === true, String(landscape.mobileNav));
  check("[844×390 横屏] 命中区 ≥44", landscape.small.length === 0, landscape.small.map((el) => `${el.label}:${el.w}x${el.h}`).join(" / "));
  check("[844×390 横屏] 无横向溢出", landscape.scroll === landscape.client, `${landscape.scroll}/${landscape.client}`);
  await context.close();
}

// ── 平台层几何（Task 0016 · P6-S1 / P2-S2）────────────────────────────────────
// 这四条锁的是"与页面无关的整站行为"。写法遵循规范 2.15：
// 真实选择器 + 先打印命中数（取不到元素 = 失败，不是恒绿）+ 断言到计算值。
for (const width of [360, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const platform = await page.evaluate(() => {
    const ta = document.querySelector('textarea[aria-label="输入消息"]');
    const main = document.querySelector("main");
    const btn = [...document.querySelectorAll("button")].find((el) => el.offsetParent !== null);
    return {
      textareaFound: ta !== null,
      textareaFont: ta === null ? null : parseFloat(getComputedStyle(ta).fontSize),
      htmlOverscroll: getComputedStyle(document.documentElement).overscrollBehaviorY,
      mainOverscroll: main === null ? "no-main" : getComputedStyle(main).overscrollBehaviorY,
      buttonTouchAction: btn === undefined ? "no-button" : getComputedStyle(btn).touchAction,
    };
  });
  check(`[${width}] 输入框存在（否则下面两条是假绿）`, platform.textareaFound === true);
  check(`[${width}] 输入框字号 ≥16px（iOS 聚焦不放大）`, (platform.textareaFont ?? 0) >= 16, `${platform.textareaFont}px`);
  check(`[${width}] 根 overscroll = none（不链出浏览器手势）`, platform.htmlOverscroll === "none", platform.htmlOverscroll);
  check(`[${width}] 消息区 overscroll = contain`, platform.mainOverscroll === "contain", platform.mainOverscroll);
  check(`[${width}] 可点元素 touch-action = manipulation`, platform.buttonTouchAction === "manipulation", platform.buttonTouchAction);
  await context.close();
}

await browser.close();
if (known.length > 0) {
  const open = known.filter((item) => !item.resolved);
  const resolved = known.filter((item) => item.resolved);
  console.log(`\n已知缺陷 ${open.length} 项（不计入失败，必须有 fixedBy）：`);
  for (const item of open) console.log(`  · ${item.name} → ${item.fixedBy}`);
  if (resolved.length > 0) {
    console.log(`已修复但豁免还在 ${resolved.length} 项（请删掉对应 checkKnown）：`);
    for (const item of resolved) console.log(`  · ${item.name}`);
  }
}

if (failures.length > 0) {
  console.error(`手机契约失败 ${failures.length} 项`);
  process.exit(1);
}
console.log(`手机契约通过（${widths.length} 个宽度 + 横屏 + 平台层几何）`);
