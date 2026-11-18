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
  // 320 档曾因头部 6 个 44px 图标把移动布局视口撑到 336 而溢出；
  // P7-S5（头部收编成"返回 · 标题 · ⋯"）之后已修，这条恢复为普通断言。
  check(`[${width}] 无横向溢出`, base.scroll === base.client, `${base.scroll}/${base.client}`);
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
  check(`[${width}] 配置无横向溢出`, modal.scroll === modal.client, `${modal.scroll}/${modal.client}`);
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

    /*
     * P7-S1（Task 0016）：会话动作在手机上必须可达。
     * 改之前手机会话行只有标题 + 运行圆点，**完全无法重命名或删除**
     * （`knowledge/component-mobile-audit.md` §2.2 的实测）。
     *
     * 三条断言对应三个必须同时成立的条件，缺一条这个功能就是"看着有、其实点不动"：
     *   a) ⋯ 按钮存在且 44×44（`Row` 的 actions 槽默认靠 hover/focus 显形，
     *      手机抽屉里点行即离开，必须显式 `actionsAlwaysVisible`）；
     *   b) 点 ⋯ 真的展开菜单（而不是穿透到行、进了会话）；
     *   c) 菜单两项（重命名/删除）都 ≥44。
     */
    const actionBtn = page.locator("[data-session-actions]").first();
    const actionCount = await actionBtn.count();
    check(`[${width}] 会话行有动作入口（⋯）`, actionCount > 0, `命中 ${actionCount} 个`);
    if (actionCount > 0) {
      const actionBox = await actionBtn.boundingBox();
      check(`[${width}] ⋯ 命中区 ≥44`, actionBox !== null && actionBox.width >= 44 && actionBox.height >= 44,
        actionBox === null ? "取不到布局盒" : `${Math.round(actionBox.width)}x${Math.round(actionBox.height)}`);
      await actionBtn.click({ force: true });
      await page.waitForTimeout(400);
      const menuItems = await page.evaluate(() => {
        const menu = document.querySelector('[data-testid="session-actions-menu"]');
        if (menu === null) return null;
        return [...menu.querySelectorAll("[role='menuitem']")].map((el) => ({
          label: (el.textContent ?? "").trim(),
          h: Math.round(el.getBoundingClientRect().height),
        }));
      });
      check(`[${width}] 点 ⋯ 展开动作菜单`, menuItems !== null,
        menuItems === null ? "菜单没出现（点击可能穿透进了会话）" : "");
      if (menuItems !== null) {
        check(`[${width}] 动作菜单两项且都 ≥44`,
          menuItems.length === 2 && menuItems.every((item) => item.h >= 44),
          menuItems.map((item) => `${item.label}:${item.h}`).join(" / "));
        // 关闭菜单：只验证能收（不在这里执行重命名/删除——写操作会改夹具数据）
        await page.keyboard.press("Escape").catch(() => {});
        await page.evaluate(() => { document.querySelector("[data-session-actions]")?.click(); });
        await page.waitForTimeout(250);
      }
    }

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

  /*
   * 全屏面板必须有返回/关闭，且按钮在视口内。
   *
   * P7-S5 之后手机头部的"完整历史"进了动作层（头部只留「返回 · 标题 · ⋯」），
   * 所以这里先展开动作层再点 —— 入口位置变了，但**可达性不变**（这正是 P7-S5 的验收点）。
   */
  // 先把可能开着的抽屉/全屏表面关掉（它盖住头部，点不到动作层）
  if ((await page.locator('[data-testid="mobile-nav"]').count()) > 0) {
    await page.evaluate(() => { document.querySelector('[data-testid="mobile-nav"] button[aria-label="关闭导航"]')?.click(); });
    await page.waitForTimeout(300);
  }
  // 动作层可能已开：只在没开时展开（否则会把刚开的又收起）
  const layerOpen = await page.evaluate(() => document.querySelector('[data-mobile-toolbar-actions]') !== null);
  if (!layerOpen) {
    await page.evaluate(() => { document.querySelector('[data-mobile-toolbar-more]')?.click(); });
    await page.waitForTimeout(400);
  }
  const historyButton = page.locator('[data-mobile-toolbar-action="history"]').first();
  if (await historyButton.count() > 0 && await historyButton.isEnabled()) {
    await page.evaluate(() => { document.querySelector('[data-mobile-toolbar-action="history"]')?.click(); });
    await page.waitForTimeout(600);
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
    // 系统返回同样关闭全屏历史（动作层在点动作后自动收起，这里重开一次）
    await page.evaluate(() => { document.querySelector('[data-mobile-toolbar-more]')?.click(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { document.querySelector('[data-mobile-toolbar-action="history"]')?.click(); });
    await page.waitForTimeout(500);
    await page.goBack();
    await page.waitForTimeout(300);
    check(`[${width}] 完整历史可被系统返回关闭`, await page.locator('[data-shot-mask="history-body"]').count() === 0);
  } else {
    check(`[${width}] 完整历史有返回且可见`, false, "没有可用会话");
  }

  /*
   * 文件面板入口同样在动作层（P7-S5）。动作层是**开合**的：上一步若刚点过动作，
   * 它已自动收起。所以这里先看状态再决定要不要点（点两次会"开了又关"，测试就会挂）。
   */
  const ensureActionsOpen = async () => {
    const open = await page.evaluate(() => document.querySelector('[data-mobile-toolbar-actions]') !== null);
    if (open) return true;
    await page.evaluate(() => { document.querySelector('[data-mobile-toolbar-more]')?.click(); });
    await page.waitForTimeout(350);
    return await page.evaluate(() => document.querySelector('[data-mobile-toolbar-actions]') !== null);
  };
  await ensureActionsOpen();
  const fileButton = page.locator('[data-mobile-toolbar-action="files"]').first();
  if (await fileButton.count() > 0) {
    await page.evaluate(() => { document.querySelector('[data-mobile-toolbar-action="files"]')?.click(); });
    await page.waitForTimeout(500);
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
    // 系统返回同样关闭全屏文件面板（同理：先确保动作层开着）
    await ensureActionsOpen();
    await page.evaluate(() => { document.querySelector('[data-mobile-toolbar-action="files"]')?.click(); });
    await page.waitForTimeout(500);
    await page.goBack();
    await page.waitForTimeout(300);
    check(`[${width}] 文件面板可被系统返回关闭`, (await page.getByRole("button", { name: "关闭文件面板" }).count()) === 0);
  }
  /*
   * P7-S2（Task 0016）：项目概览在手机上必须可达。
   *
   * 改之前入口是分组头的计数药丸（`App.tsx` 的 `onOverview`），而 `leftColumns`
   * 在手机上整块不渲染 → **手机上完全看不到项目概览**（路径/6 格统计/移除项目）。
   *
   * 独立一块而不是插在导航流程中间：概览是**覆盖在抽屉之上**的独立表面，
   * Esc 只关它自己；插在中间会让后续断言依赖"关完之后抽屉恢复到哪一级"这种脆弱状态。
   */
  {
    const navTrigger = page.getByRole("button", { name: "打开导航" }).or(page.getByRole("button", { name: "返回项目" }));
    if ((await page.locator('[data-testid="mobile-nav"]').count()) === 0) {
      await navTrigger.first().click();
      await page.waitForTimeout(600);
    }
    if ((await page.locator('[data-mobile-level="projects"]').count()) === 0) {
      await page.locator('[data-mobile-level="agents"] [role="button"]').first().click().catch(() => {});
      await page.waitForTimeout(1000);
    }
    const infoBtn = page.locator("[data-project-info]").first();
    const infoCount = await infoBtn.count();
    check(`[${width}] 项目行有概览入口`, infoCount > 0, `命中 ${infoCount} 个`);
    if (infoCount > 0) {
      const infoBox = await infoBtn.boundingBox();
      check(`[${width}] 项目概览入口 ≥44`,
        infoBox !== null && infoBox.width >= 44 && infoBox.height >= 44,
        infoBox === null ? "取不到布局盒" : `${Math.round(infoBox.width)}x${Math.round(infoBox.height)}`);
      await page.evaluate(() => { document.querySelector("[data-project-info]")?.click(); });
      await page.waitForTimeout(1200);
      const surface = await page.evaluate(() => {
        const node = document.querySelector('[data-testid="project-overview-surface"]');
        const box = node?.getBoundingClientRect();
        const close = node?.querySelector('button[aria-label="关闭项目概览"]');
        return {
          exists: node !== null,
          fullScreen: box === undefined ? false
            : (Math.round(box.width) >= window.innerWidth - 1 && Math.round(box.height) >= window.innerHeight - 1),
          statCells: node === null ? 0 : node.querySelectorAll('[data-testid="overview-stats"] > div').length,
          closeH: close === null || close === undefined ? 0 : Math.round(close.getBoundingClientRect().height),
        };
      });
      check(`[${width}] 项目概览是全屏表面`, surface.exists && surface.fullScreen, JSON.stringify(surface));
      check(`[${width}] 项目概览 6 格统计都在`, surface.statCells === 6, `${surface.statCells} 格`);
      check(`[${width}] 项目概览关闭钮 ≥44`, surface.closeH >= 44, `${surface.closeH}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      check(`[${width}] 项目概览 Esc 可关`,
        await page.evaluate(() => document.querySelector('[data-testid="project-overview-surface"]') === null));
    }
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
      .map((el) => ({
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 12),
        w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height),
        /** 在用户内容区里（Markdown 正文）：这些链接的尺寸由内容决定，不算产品控件 */
        inContent: el.closest(".md-body") !== null,
      }))
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
  /*
   * 横屏命中区（Task 0016 · P7-S3）—— 判据收窄到**我们自己**的控件。
   *
   * 2026-11-18 合并 Task 0022 后实测到的 `https://mp.w:387x18` 是 **README 里的 Markdown 外链**
   * （`README.md` 的公众号链接被渲染进来）。它是用户内容里的文字链接，不是本产品的交互控件，
   * 也不该为它把 18px 的行高撑到 44 —— 那会把正文排版搞坏。
   *
   * 所以只查"产品控件"：按钮、[role=button]、以及带 aria-label 的链接（= 图标链接）。
   * 用户内容区（`.md-body` 内）不参与这条断言 —— 内容里的链接尺寸不由我们决定。
   */
  const controlSmall = landscape.small.filter((el) => el.inContent !== true);
  check("[844×390 横屏] 命中区 ≥44", controlSmall.length === 0, controlSmall.map((el) => `${el.label}:${el.w}x${el.h}`).join(" / "));
  check("[844×390 横屏] 无横向溢出", landscape.scroll === landscape.client, `${landscape.scroll}/${landscape.client}`);
  await context.close();
}

// ── 会话消息缓存（Task 0016 · B1）────────────────────────────────────────────
/*
 * 实测背景：三层都没缓存，退出会话再进去要重新下 490 KB（手机 4G ≈ 2.5 s）。
 *
 * 这一条用**时间判据**而不是"有没有发请求"：缓存命中后**仍然**会后台刷新
 * （这是我们相对 LibreChat 的加强——它的缓存永不到期）。所以判据是
 * "消息出现得比后台请求快得多"，而不是"没有请求"。
 */
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 300,
    downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const navTrigger = page.getByRole("button", { name: "打开导航" }).or(page.getByRole("button", { name: "返回项目" }));
  if (await navTrigger.count() > 0) {
    await navTrigger.first().click();
    await page.waitForTimeout(700);
    for (let i = 0; i < 3; i += 1) {
      if ((await page.locator('[data-mobile-level="agents"]').count()) > 0) break;
      await page.evaluate(() => {
        const back = [...document.querySelectorAll('[data-testid="mobile-nav"] button')].find((el) => (el.textContent ?? "").includes("返回"));
        back?.click();
      });
      await page.waitForTimeout(400);
    }
    await page.locator('[data-mobile-level="agents"] [role="button"]').first().click({ force: true });
    await page.waitForTimeout(1200);
    await page.locator('[data-mobile-level="projects"] [role="button"]').first().click({ force: true });
    await page.waitForTimeout(2000);

    /** 点第 n 个会话 → 消息出现耗时；再退回项目级，供下一次复用。 */
    const openOnce = async (index) => {
      const started = Date.now();
      await page.locator('[data-mobile-level="sessions"] [role="button"]').nth(index).click({ force: true });
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="message"]').length > 0, { timeout: 30000 }).catch(() => {});
      const visibleMs = Date.now() - started;
      await page.waitForTimeout(2500);
      await page.getByRole("button", { name: "返回项目" }).first().click();
      await page.waitForTimeout(1200);
      for (let i = 0; i < 3; i += 1) {
        if ((await page.locator('[data-mobile-level="projects"]').count()) > 0) break;
        await page.evaluate(() => {
          const back = [...document.querySelectorAll('[data-testid="mobile-nav"] button')].find((el) => (el.textContent ?? "").includes("返回"));
          back?.click();
        });
        await page.waitForTimeout(500);
      }
      await page.locator('[data-mobile-level="projects"] [role="button"]').first().click({ force: true });
      await page.waitForTimeout(1800);
      return visibleMs;
    };

    const cold = await openOnce(1);
    const warm = await openOnce(1);
    // 冷启动要等一次完整往返（300ms 延迟 + 4G 下载）；热启动应当**明显更快**（只等内存）
    check("[390] 会话缓存：二次打开明显更快", warm < cold / 3, `cold=${cold}ms warm=${warm}ms`);
    check("[390] 会话缓存：二次打开 < 600ms", warm < 600, `${warm}ms`);
  }
  await context.close();
}

// ── 点助手：立即切级，不等网络（2026-11-17 用户实测）──────────────────────────
/*
 * 用户原话："点击 agent 到会话页面的时候有时候还是卡，不过这个可能是我没连接 vpn，
 * 或者是网络的问题？"——不是网络问题，是我们的代码：`onSelectAgent(item).then(() => setLevel("projects"))`
 * 要等 "projects + 每个项目的 sessions + 那个会话的消息" 全回来才切级。
 * 实测（390×844，模拟 300ms 延迟 + CPU 4x）：**2850 ms** 抽屉一动不动 = "点了没反应"。
 *
 * 断言两条，都必须在**慢网**下成立：
 *  ① 点下去到抽屉切到项目级 ≤ 300 ms（不等网络）；
 *  ② 后台补齐后仍然打开了一个会话（不是落到空态）。
 */
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  /*
   * 用 `Network.emulateNetworkConditions`（老协议名）—— 实测 `Emulation.setNetworkConditions`
   * 在这个 Chromium 版本上**静默不生效**，限速没加上时断言会在"无限速"下跑，
   * 于是它永远是绿的（我第一版就踩了这个：活性验证反而抓不到红）。
   * 这里**不许 catch**：限速加不上就直接抛，让这条断言失去意义的可能性暴露出来。
   */
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 300,
    downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const navTrigger = page.getByRole("button", { name: "打开导航" }).or(page.getByRole("button", { name: "返回项目" }));
  if (await navTrigger.count() > 0) {
    await navTrigger.first().click();
    await page.waitForTimeout(700);
    // 回到助手级（可能停在上次的层级）
    for (let i = 0; i < 3; i += 1) {
      if ((await page.locator('[data-mobile-level="agents"]').count()) > 0) break;
      await page.evaluate(() => {
        const back = [...document.querySelectorAll('[data-testid="mobile-nav"] button')].find((el) => (el.textContent ?? "").includes("返回"));
        back?.click();
      });
      await page.waitForTimeout(400);
    }
    const started = Date.now();
    await page.locator('[data-mobile-level="agents"] [role="button"]').first().click({ force: true });
    await page.waitForFunction(() => document.querySelector('[data-mobile-level="projects"]') !== null, { timeout: 5000 }).catch(() => {});
    const switchMs = Date.now() - started;
    check("[390] 点助手后抽屉立即切到项目级（不等网络）", switchMs <= 300, `${switchMs} ms`);
    // 后台补齐：最终应当停在一个有消息的会话上（不是"发一条消息开始对话"）
    await page.waitForTimeout(6000);
    const settled = await page.evaluate(() => ({
      hasSession: new URLSearchParams(location.search).has("session"),
      messages: document.querySelectorAll('[data-testid="message"]').length,
      emptyChat: (document.querySelector("main")?.innerText ?? "").includes("发一条消息开始对话"),
    }));
    check("[390] 点助手后最终打开了会话（不是空态）",
      settled.hasSession && settled.messages > 0 && settled.emptyChat === false, JSON.stringify(settled));
  }
  await context.close();
}

// ── 引用化的图片：能取回的显示，取不回的给文案（Task 0016 · P3 补）────────────
/*
 * 引用化把图片变成**独立请求**，于是"文件还在不在"从"接口一定有 base64"变成"可能 404"。
 * 实测（用户真实家目录，1702 条消息）：67 张工具图里 **64 张的原始文件已被 /tmp 清理**，
 * 不给文案时界面就是一堆碎图 —— 用户分不清"网络慢"和"图没了"。
 *
 * 用 route mock 造两张：一张 200、一张 404，断言各走各的分支。
 */
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.route("**/api/attachment**", async (route) => {
    const url = new URL(route.request().url());
    const target = url.searchParams.get("path") ?? "";
    if (target.includes("gone")) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "attachment_not_found", message: "图片不在了" } }) });
      return;
    }
    // 1×1 透明 PNG
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
    await route.fulfill({ status: 200, contentType: "image/png", body: png });
  });
  // 会话详情只用一组工具图：一张在、一张不在
  // 只拦**详情**这一条（带尾 $），不要吞掉 /annotations、/turns/last
  await page.route(/\/api\/agents\/[^/]+\/sessions\/[^/?]+(\?[^/]*)?$/, async (route) => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        sessionId: "fx-img", meta: { thinkingLevel: "off", running: false, context: null },
        messages: [{
          id: "m1", role: "assistant", text: "", blocks: [
            { type: "toolCall", id: "c1", name: "read", arguments: {}, result: "ok",
              images: [
                { url: "/api/attachment?path=%2Ftmp%2Fok.png", mimeType: "image/png" },
                { url: "/api/attachment?path=%2Ftmp%2Fgone.png", mimeType: "image/png" },
              ] },
          ],
        }],
      }),
    });
  });
  await page.goto(`${APP_URL}/?agent=lifeosagent&project=workspace&session=fx-img`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  // 工具块默认在过程条里 → 展开（按钮文案是「N 次工具查看过程」，按包含匹配）
  const expand = page.getByRole("button", { name: /查看过程/ }).first();
  if (await expand.count() > 0) { await expand.click({ force: true }); await page.waitForTimeout(1500); }
  const images = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('[data-testid="tool-image"] img')];
    return {
      total: imgs.length,
      loaded: imgs.filter((img) => img.complete && img.naturalWidth > 0).length,
      failureNotes: document.querySelectorAll('[data-testid="image-failure"]').length,
      noteText: document.querySelector('[data-testid="image-failure"]')?.textContent?.trim() ?? null,
    };
  });
  check("[390] 引用图：能取回的显示出来", images.loaded >= 1, JSON.stringify(images));
  check("[390] 引用图：取不回的给一行说明（不是碎图）", images.failureNotes >= 1, JSON.stringify(images));
  check("[390] 说明文案说清「图不在了」", (images.noteText ?? "").includes("不在了"), String(images.noteText));
  await context.close();
}

// ── 会话加载期不显示空态（Task 0016 · P6-S4）────────────────────────────────
/*
 * P1-S1 修的那个缺陷：切到长会话时中间 1.4 秒显示「发一条消息开始对话」，
 * 用户以为对话丢了。纯函数侧已有 `viewStateOf` 穷举（`test/session-state.test.mjs`）。
 *
 * 这里补界面级：把会话详情延迟 1.5 s，断言这段时间里有骨架、**没有**空态文案。
 *
 * ## 为什么用"全新 context + 冷启动 URL"而不是"点一下会话"
 *
 * B1 之后**缓存命中不显示骨架**（那是收益）。而这个用例要求在**同一个 context 里
 * 连点几次会话**，第二次起就在缓存里了 —— 于是断言会时红时绿。
 * 冷启动（新 context 直接带 `?session=`）必然走冷路径，判据稳定。
 */
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  // 先导航到应用（相对 URL fetch 需要同源），再拿一条真实会话 id（不打开它，只读列表接口）
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  const sessionId = await page.evaluate(async () => {
    const agents = await (await fetch("/api/agents")).json();
    for (const agent of agents.items ?? []) {
      const projects = await (await fetch(`/api/agents/${agent.id}/projects`)).json();
      for (const project of projects.items ?? []) {
        const sessions = await (await fetch(`/api/agents/${agent.id}/projects/${project.id}/sessions`)).json();
        const hit = (sessions.items ?? [])[0];
        if (hit !== undefined) return `${agent.id}|${project.id}|${hit.sessionId}`;
      }
    }
    return null;
  }).catch(() => null);
  /*
   * 取不到会话时必须**显式**说出来（规范 2.15：0 个命中 = 没测）。
   * 之前写的是 `if (sessionId !== null)` 静默跳过 → 三条断言全不执行，跑起来却是绿的。
   */
  check("[390] 冷启动夹具：家目录里至少有一条会话", sessionId !== null, String(sessionId));
  if (sessionId !== null) {
    const [agentId, projectId, sid] = sessionId.split("|");
    // 只延迟"会话详情"这一条（`?tail=` 是 P3-S3 加的，正则必须允许，否则拦不到）
    await page.route(/\/api\/agents\/[^/]+\/sessions\/[^/?]+(\?[^/]*)?$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    // 冷启动：直接带 session 打开（App 启动时走 openSession，缓存必然是空的）
    await page.goto(`${APP_URL}/?agent=${agentId}&project=${projectId}&session=${sid}`, { waitUntil: "domcontentloaded" });
    // 逐帧采样，取"骨架出现过"与"从头到尾没出现过空态文案"
    const sampled = await page.evaluate(async () => {
      const start = performance.now();
      let sawSkeleton = false;
      let sawEmptyCopy = false;
      while (performance.now() - start < 2500) {
        if (document.querySelectorAll('[data-skeleton="message"]').length > 0) sawSkeleton = true;
        if ((document.querySelector("main")?.innerText ?? "").includes("发一条消息开始对话")) sawEmptyCopy = true;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return { sawSkeleton, sawEmptyCopy, messages: document.querySelectorAll('[data-testid="message"]').length };
    });
    check("[390] 冷启动会话加载期出现骨架", sampled.sawSkeleton === true, JSON.stringify(sampled));
    check("[390] 会话加载期不显示「开始对话」", sampled.sawEmptyCopy === false, JSON.stringify(sampled));
    check("[390] 加载完成后有消息", sampled.messages > 0, JSON.stringify(sampled));
  }
  await context.close();
}

// ── 检视面板在手机上可用（Task 0016 · P7-S6）──────────────────────────────────
// 改之前：`App.tsx` 的 `reviewOpen && !isMobile` 让面板**在手机上永不渲染**，
// 而 `openReview()` 照样执行 → 弹错"右侧放不下检视面板…或把窗口放宽"（手机上永远不成立）。
// 断言两条：面板真的出现（全屏）／**没有**那句错误提示。
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.querySelector("[data-mobile-toolbar-more]")?.click(); });
  await page.waitForTimeout(350);
  await page.evaluate(() => { document.querySelector('[data-mobile-toolbar-action="review"]')?.click(); });
  await page.waitForTimeout(2500);
  const review = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="review-panel"]');
    const box = panel?.getBoundingClientRect();
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((el) => (el.textContent ?? "").trim());
    return {
      panel: panel !== null,
      fullScreen: box === undefined ? false : (Math.round(box.width) >= 389 && Math.round(box.height) >= 700),
      wrongHint: alerts.some((text) => text.includes("右侧放不下")),
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  });
  check("[390] 检视面板在手机上能打开（全屏）", review.panel && review.fullScreen, JSON.stringify(review));
  check("[390] 检视不再弹「右侧放不下」", review.wrongHint === false, String(review.wrongHint));
  check("[390] 检视面板无横向溢出", review.scrollW === review.clientW, `${review.scrollW}/${review.clientW}`);
  await context.close();
}

// ── 手机头部（Task 0016 · P7-S5）─────────────────────────────────────────────
// 改之前头部平铺 6 个图标，标题可用宽度实测 430→78px / 390→38px / 360→8px / ≤336→0px。
// 现在只留「返回/菜单 · 标题 · ⋯」，其余动作进"原地覆盖的动作层"。
// 断言四条：标题 ≥120 / 头部按钮数 = 2 / 动作层 4 项且都 ≥44 / 三种关闭方式。
for (const width of [320, 360, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  const head = await page.evaluate(() => {
    const h1 = document.querySelector("header h1");
    const box = h1?.getBoundingClientRect();
    return {
      titleW: box === undefined ? 0 : Math.round(box.width),
      buttons: [...document.querySelectorAll("header button")].filter((b) => b.offsetParent !== null).length,
    };
  });
  // 120px = 「Life OS 会话标题」这类短标题在 text-body 13.5px 下能显示 8–9 个汉字的下限
  check(`[${width}] 头部标题可用宽度 ≥120px`, head.titleW >= 120, `${head.titleW}px`);
  check(`[${width}] 头部只留 2 个按钮（返回/菜单 + ⋯）`, head.buttons === 2, `${head.buttons} 个`);

  const moreBtn = page.locator("[data-mobile-toolbar-more]").first();
  if (await moreBtn.count() > 0) {
    await moreBtn.click({ force: true });
    await page.waitForTimeout(400);
    const layer = await page.evaluate(() => {
      const node = document.querySelector('[data-mobile-toolbar-actions]');
      if (node === null) return null;
      const items = [...node.querySelectorAll("[data-mobile-toolbar-action]")];
      return {
        ids: items.map((el) => el.getAttribute("data-mobile-toolbar-action")),
        sizes: items.map((el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }),
        titleW: Math.round(document.querySelector("header h1")?.getBoundingClientRect().width ?? 0),
      };
    });
    check(`[${width}] ⋯ 展开动作层（4 项齐全）`,
      layer !== null && layer.ids.length === 4 && ["history", "review", "files", "settings"].every((id) => layer.ids.includes(id)),
      layer === null ? "动作层没出现" : layer.ids.join(","));
    check(`[${width}] 动作层每项命中 ≥44`,
      layer !== null && layer.sizes.every((s) => { const [w, h] = s.split("x").map(Number); return w >= 44 && h >= 44; }),
      layer === null ? "" : layer.sizes.join(" / "));
    /*
     * ★ 2026-11-17 用户实测抓到的缺陷：点 ⋯ 只看到图标变 ✕，其余什么都不变。
     * 根因是动作层的定位父级是**那个 44px 宽的 ⋯ 容器**，`left-11 right-11` 算出 44−44−44 < 0
     * → 层被压成 **1px 宽**，4 个按钮渲染在 x=375/419/463/507（全在屏外）。
     *
     * 上面 4 条断言当时**全绿**：它们只查"元素存在 / 自身 44×44 / 标题没被挤"，
     * 没有一条查"这个按钮在不在屏幕里、能不能点到"。这就是规范 2.15 那类假绿的又一种形态：
     * **尺寸对、位置错**。
     *
     * 现在补三条硬判据（每条都直接对应"用户能不能用"）：
     *   a) 动作层自身宽度 ≥ 动作数量 × 44（层不能比它的内容还窄）；
     *   b) 每个动作**整块落在视口内**（x ≥ 0 且 right ≤ 视口宽）；
     *   c) 中心点命中测试：`elementFromPoint` 取到的必须是这个按钮（不是被盖住）。
     */
    const inViewport = await page.evaluate(() => {
      const layer = document.querySelector('[data-mobile-toolbar-actions]');
      if (layer === null) return null;
      const layerBox = layer.getBoundingClientRect();
      const items = [...layer.querySelectorAll("[data-mobile-toolbar-action]")];
      const vw = window.innerWidth;
      return {
        layerWidth: Math.round(layerBox.width),
        actions: items.map((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
          return {
            id: el.getAttribute("data-mobile-toolbar-action"),
            x: Math.round(r.x),
            right: Math.round(r.right),
            inside: r.x >= 0 && r.right <= vw + 0.5,
            hittable: top === el || el.contains(top),
          };
        }),
      };
    });
    check(`[${width}] 动作层宽度能容纳全部动作`,
      inViewport !== null && inViewport.layerWidth >= inViewport.actions.length * 44,
      inViewport === null ? "层没出现" : `${inViewport.layerWidth}px / 需 ${inViewport.actions.length * 44}px`);
    check(`[${width}] 每个动作都整块落在视口内`,
      inViewport !== null && inViewport.actions.every((a) => a.inside),
      inViewport === null ? "" : inViewport.actions.map((a) => `${a.id}:${a.x}–${a.right}`).join(" / "));
    check(`[${width}] 每个动作中心点能点到（没被盖住）`,
      inViewport !== null && inViewport.actions.every((a) => a.hittable),
      inViewport === null ? "" : inViewport.actions.map((a) => `${a.id}:${a.hittable}`).join(" / "));
    check(`[${width}] 动作层展开时标题宽度不被挤掉`, layer !== null && layer.titleW >= 120, layer === null ? "" : `${layer.titleW}px`);

    // 关闭方式 1：Esc
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
    check(`[${width}] 动作层 Esc 可关`, await page.evaluate(() => document.querySelector('[data-mobile-toolbar-actions]') === null));
    // 关闭方式 2：外部点击
    await moreBtn.click({ force: true });
    await page.waitForTimeout(300);
    await page.evaluate(() => { document.querySelector("main")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    await page.waitForTimeout(350);
    check(`[${width}] 动作层点外面可关`, await page.evaluate(() => document.querySelector('[data-mobile-toolbar-actions]') === null));
    // 关闭方式 3：再点 ⋯
    await moreBtn.click({ force: true });
    await page.waitForTimeout(300);
    await moreBtn.click({ force: true });
    await page.waitForTimeout(350);
    check(`[${width}] 动作层再点 ⋯ 可关`, await page.evaluate(() => document.querySelector('[data-mobile-toolbar-actions]') === null));
  }
  await context.close();
}

// ── 抽屉列表分页（Task 0016 · P7-S4）──────────────────────────────────────────
// 手机抽屉每级一屏，项目/会话都可能有几十上百条：首屏只渲染一页 + "显示更多"，
// 比虚拟滚动便宜得多（与 P4 的消息分页同一结论）。
// 断言用**具体数字**（≤20 行、点一次变 40），不写"有/没有"——数字才能抓住"翻页没生效"。
for (const width of [360, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const navEntry3 = page.getByRole("button", { name: "打开导航" }).or(page.getByRole("button", { name: "返回项目" }));
  if (await navEntry3.count() > 0) {
    await navEntry3.first().click();
    await page.waitForTimeout(700);
    if ((await page.locator('[data-mobile-level="projects"]').count()) === 0) {
      await page.locator('[data-mobile-level="agents"] [role="button"]').first().click().catch(() => {});
      await page.waitForTimeout(1000);
    }
    const projectRow3 = page.locator('[data-mobile-level="projects"] [role="button"]').first();
    if (await projectRow3.count() > 0) {
      await projectRow3.click();
      await page.waitForTimeout(1200);
    }
    const rowsState = () => page.evaluate(() => ({
      rows: document.querySelectorAll('[data-mobile-level="sessions"] [role="button"]').length,
      hasMore: document.querySelector('[data-testid="load-more-rows"]') !== null,
      moreH: Math.round(document.querySelector('[data-testid="load-more-rows"]')?.getBoundingClientRect().height ?? 0),
    }));
    const before = await rowsState();
    check(`[${width}] 抽屉列表首屏不超过一页`, before.rows <= 20, `${before.rows} 行`);
    if (before.hasMore) {
      check(`[${width}] "显示更多"命中区 ≥44`, before.moreH >= 44, `${before.moreH}`);
      await page.evaluate(() => { document.querySelector('[data-testid="load-more-rows"]')?.click(); });
      await page.waitForTimeout(600);
      const after = await rowsState();
      check(`[${width}] 点"显示更多"后行数增加`, after.rows > before.rows, `${before.rows} → ${after.rows}`);
    }
  }
  await context.close();
}

// ── 全屏表面内的触控目标（Task 0016 · P7-S3）──────────────────────────────────
// `mobile-contract` 原来只查 main 与导航抽屉里的 button，**不查全屏表面内部**，
// 于是设置页 Tab 68×36、深浅色分段 46×28、AgentConfig 的 select 318×36 全部漏过去了。
// 这一块专查"手机上的全屏表面"：设置页 + 助手配置。
//
// 判据用"可点目标"而不是"所有 input"：复选框/单选框本体是 14×14（浏览器默认），
// 由 `<label>` 撑命中区 —— 点 label 也算点控件，所以 label 与 input 都不单独算不合格。
for (const width of [360, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  const auditSurface = async (selector) => page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (root === null) return { missing: true, smallCount: -1, small: [] };
    const targets = [...root.querySelectorAll(
      "button,[role='button'],[role='tab'],[role='radio'],[role='switch'],select,input[type='text'],input[type='search'],input[type='range'],label",
    )].filter((el) => el.offsetParent !== null);
    const small = targets.map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height) };
    }).filter((x) => x.h < 44 || x.w < 44);
    return { total: targets.length, smallCount: small.length, small: small.slice(0, 6) };
  }, selector);

  // 设置页
  const settingsBtn = page.getByRole("button", { name: "打开设置" });
  if (await settingsBtn.count() > 0) {
    await settingsBtn.first().click({ force: true });
    await page.waitForTimeout(900);
    const settings = await auditSurface('[data-testid="settings-surface"]');
    check(`[${width}] 设置页触控目标 ≥44`, settings.missing !== true && settings.total > 0 && settings.smallCount === 0,
      settings.missing === true ? "设置页没打开" : `共 ${settings.total} 个，小于 44 的 ${settings.smallCount}：${settings.small.map((x) => `${x.label}:${x.w}x${x.h}`).join(" / ")}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  // 助手配置（从抽屉进）
  const navEntry2 = page.getByRole("button", { name: "打开导航" }).or(page.getByRole("button", { name: "返回项目" }));
  if (await navEntry2.count() > 0) {
    await navEntry2.first().click({ force: true });
    await page.waitForTimeout(700);
    if ((await page.locator('[data-mobile-level="agents"]').count()) === 0) {
      await page.getByRole("button", { name: "返回上一级" }).click().catch(() => {});
      await page.waitForTimeout(400);
    }
    const cfg = page.getByRole("button", { name: "配置当前助手" });
    if (await cfg.count() > 0) {
      await cfg.click({ force: true });
      await page.waitForTimeout(1000);
      const config = await auditSurface('[role="dialog"]');
      check(`[${width}] 助手配置触控目标 ≥44`, config.missing !== true && config.total > 0 && config.smallCount === 0,
        config.missing === true ? "配置弹窗没打开" : `共 ${config.total} 个，小于 44 的 ${config.smallCount}：${config.small.map((x) => `${x.tag}:${x.w}x${x.h}`).join(" / ")}`);
      await page.keyboard.press("Escape");
    }
  }
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

// ── 压缩卡在手机上可见（Task 0016 · P7-S9）────────────────────────────────────
/*
 * 用户 2026-11-17 实测：「怎么感觉 session 被截断了呢？Session 历史消息看不到了」。
 * 事实是 Pi 自动压缩了上下文，而界面**只渲染模型上下文投影**、对压缩不可见 —— 用户只能
 * 理解成"历史丢了"。这里锁的是"用户能看见压缩发生过"，不是"历史被还回来"。
 *
 * 夹具要点（为什么必须自己造消息而不用家目录里的真会话）：
 *  - 压缩卡的位置是**第一条**，而 P4-S2 的渲染窗口只留最后 50 条 —— 真会话里卡片一会被窗口裁掉；
 *  - 所以要断言"它在窗口外也必须常显"，就必须让夹具的条目数远大于窗口。
 */
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const summary = "## Goal\n把手机端性能做完。";
  // 1 张压缩卡 + 120 条消息（远超 50 条的渲染窗口）
  const messages = [
    { id: "card-1", role: "assistant", text: "", blocks: [{ type: "compaction", summary, tokensBefore: 984407 }] },
    ...Array.from({ length: 120 }, (_, i) => ({
      id: `m${i}`, role: i % 2 === 0 ? "user" : "assistant", text: `消息 ${i}`,
      blocks: [{ type: "text", text: `消息 ${i}` }],
    })),
  ];
  await page.route(/\/api\/agents\/[^/]+\/sessions\/[^/?]+(\?[^/]*)?$/, async (route) => {
    // 复刻后端的裁剪语义：只给最后 50 条 + 把窗口外的压缩标记补回队首
    const tail = 50;
    const start = Math.max(0, messages.length - tail);
    const windowed = messages.slice(start);
    const markers = messages.slice(0, start).filter((m) => m.blocks.some((b) => b.type === "compaction"));
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        sessionId: "fx-compaction", meta: { thinkingLevel: "off", running: false, context: null },
        messages: [...markers, ...windowed], total: messages.length, tailStart: start,
      }),
    });
  });
  await page.goto(`${APP_URL}/?agent=lifeosagent&project=workspace&session=fx-compaction`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  const card = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="compaction-card"]');
    const box = el?.getBoundingClientRect();
    const rows = [...document.querySelectorAll("main [data-testid='message'], main [data-testid='compaction-card']")];
    return {
      exists: el !== null,
      h: box === undefined ? 0 : Math.round(box.height),
      w: box === undefined ? 0 : Math.round(box.width),
      first: rows[0]?.getAttribute("data-testid") ?? null,
      text: (el?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
      // 触控目标：卡头那一行要能点开（≥44）
      toggleH: Math.round(el?.querySelector("button")?.getBoundingClientRect().height ?? 0),
    };
  });
  check("[390] 压缩卡存在（在渲染窗口之外也常显）", card.exists, JSON.stringify(card));
  check("[390] 压缩卡排在消息流第一条", card.first === "compaction-card", String(card.first));
  check("[390] 压缩卡说清「已压缩」与压缩前大小",
    card.text.includes("已压缩") && card.text.includes("984.4k"), card.text);
  check("[390] 压缩卡可点开（触控目标 ≥44）", card.toggleH >= 44, `${card.toggleH}px`);
  /*
   * 展开后必须看得到摘要正文。
   *
   * 先滚到顶再点：卡片是**第一条**，而消息区默认贴底 —— 不滚的话它不在视口里，
   * Playwright 的 `click({force:true})` 不会帮我们滚动（force 跳过全部可操作性检查），
   * 点下去的坐标落在别的元素上，于是"点了没反应"（本轮实测就是这个：
   * 用 DOM `btn.click()` 300 ms 内必然展开，用 `locator.click({force:true})` 则一直不展开）。
   * 真实用户也只能点看得见的东西，所以先滚到顶是**符合真实路径**的写法，不是绕过。
   */
  await page.evaluate(() => { const main = document.querySelector("main"); if (main !== null) main.scrollTop = 0; });
  await page.waitForTimeout(300);
  await page.locator('[data-testid="compaction-card"] button').first().click();
  await page.waitForTimeout(400);
  const expanded = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="compaction-card"]');
    return { text: (el?.innerText ?? "").replace(/\s+/g, " "), h: Math.round(el?.getBoundingClientRect().height ?? 0) };
  });
  check("[390] 展开后显示摘要正文", expanded.text.includes("把手机端性能做完"), `h=${expanded.h}`);
  check("[390] 展开后给出「原文去哪看」的指引", expanded.text.includes("完整历史"), expanded.text.slice(0, 120));
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
