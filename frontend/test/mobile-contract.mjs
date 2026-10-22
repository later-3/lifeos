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
const widths = [360, 390, 430];
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
  if (!ok) failures.push(name);
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
  }
  await page.getByRole("button", { name: "关闭导航" }).click();
  await page.waitForTimeout(200);
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
await browser.close();
if (failures.length > 0) {
  console.error(`手机契约失败 ${failures.length} 项`);
  process.exit(1);
}
console.log(`手机契约通过（${widths.length} 个宽度）`);
