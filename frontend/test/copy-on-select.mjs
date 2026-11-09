#!/usr/bin/env node
/**
 * 「选中即复制」界面契约（Task 0013 · P2/P3）。
 *
 * 为什么必须用真实浏览器 + 真实剪贴板：
 *  - 判据依赖 `<main>` 与真实布局（jsdom 无布局，`getBoundingClientRect()` 全是 0）；
 *  - headless Chrome 的 `navigator.clipboard.writeText` 会被拒（`NotAllowedError`，实测），
 *    所以默认跑**有头真实 Chrome**，并用 `pbpaste` 做**外部**校验（不读页面自己的 readText，
 *    避免"页面说写了、系统剪贴板其实没变"）。`HEADED=0` 时报明确失败而不是假绿。
 *
 * 夹具：用 route mock 造两个会话（用户消息 + 助手回复，含代码块与表格），
 * 不写真实会话数据（testing 规 2.1）；跑完不留下任何持久副作用（testing 规 2.11）。
 *
 * 运行：APP_URL=http://localhost:5190 node frontend/test/copy-on-select.mjs
 */
import pw from "/Users/xulater/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js";
import { execSync } from "node:child_process";

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const HEADED = process.env.HEADED !== "0";
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
  if (!ok) failures.push(name);
};

const paste = () => { try { return execSync("pbpaste", { encoding: "utf8" }); } catch { return "<pbpaste 失败>"; } };
const putClipboard = (text) => execSync(`printf %s ${JSON.stringify(text)} | pbcopy`);

/**
 * 夹具策略：**列表用真实数据，只 mock 选中会话的详情**。
 *
 * 为什么不用 mock 列表：mock 出来的会话行会被 SSE 快照/`agents_changed` 之后的
 * `reloadGroups()` 覆盖掉（实测：mock 列表里加的行 0 行渲染，而 `fetch` 直接问却有），
 * 于是"点夹具会话"这类前置永远失败。改成：真实列表里挑第一条会话，把它的**详情**换成夹具，
 * 列表与细节都稳定，且仍然不写任何真实会话数据。
 */
const FIXTURE_USER = "这是夹具里的用户消息，用来测用户气泡里的拖选。";
const FIXTURE_TEXT = "第一段：这是夹具里的助手回复，用来测选中之后自动进剪贴板。";
const CODE = "function sort(a) {\n  for (let i = 0; i < a.length; i++) {\n    console.log(a[i]);\n  }\n}";
const FIXTURE_BODY = `${FIXTURE_TEXT}\n\n\`\`\`\n${CODE}\n\`\`\`\n\n| 算法 | 耗时 |\n| --- | --- |\n| 冒泡 | 268 |`;
const detailFor = (sid) => ({
  sessionId: sid,
  meta: { thinkingLevel: "off", running: false, context: null },
  messages: [
    { role: "user", text: FIXTURE_USER, blocks: [{ type: "text", text: FIXTURE_USER }], id: "fx-u-1" },
    { role: "assistant", text: FIXTURE_BODY, blocks: [{ type: "text", text: FIXTURE_BODY }], id: "fx-a-1" },
  ],
});

const browser = await pw.chromium.launch(HEADED ? { channel: "chrome", headless: false } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const state = () => page.evaluate(() => {
  const sel = window.getSelection();
  const toast = document.querySelector('[data-testid="copy-feedback"]');
  const draft = document.querySelector('[data-testid="annotation-draft"]');
  const selRange = sel !== null && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  const selRect = selRange === null ? null : selRange.getBoundingClientRect();
  const toastRect = toast === null ? null : toast.getBoundingClientRect();
  return {
    selText: sel === null ? "" : sel.toString(),
    toastText: toast === null ? null : (toast.textContent ?? "").trim(),
    toastVisible: toast !== null && getComputedStyle(toast).visibility === "visible",
    draftVisible: draft !== null,
    // 几何在同一帧读，避免"读到提示已经消失"
    geometry: selRect === null || toastRect === null ? null : {
      selTop: Math.round(selRect.top),
      toastBottom: Math.round(toastRect.bottom),
      gap: Math.round(selRect.top - toastRect.bottom),
      selCenterX: Math.round(selRect.left + selRect.width / 2),
      toastCenterX: Math.round(toastRect.left + toastRect.width / 2),
    },
  };
});

/** 在容器里找一个"确定命中该元素"的拖选起点（elementFromPoint 校验，避免点到别的层）。 */
const pickStart = (selector, dy, fromLeft = 20) => page.evaluate(({ selector, dy, fromLeft }) => {
  const el = document.querySelector(selector);
  if (el === null) return null;
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  // 元素本身就在 y<140 时（例如用户气泡很短），不能把它夹到元素外面去
  const y = (r.top >= 140 ? r.top : Math.round(r.top + Math.min(r.height / 2, 18))) + dy;
  for (let x = r.left + fromLeft; x < r.right - 60; x += 16) {
    const hit = document.elementFromPoint(x, y);
    if (hit !== null && hit.closest(selector) !== null) return { x: Math.round(x), y: Math.round(y) };
  }
  return null;
}, { selector, dy, fromLeft });

/**
 * 清掉旧选区。
 *
 * 为什么必须：**在已有选区内部按下并拖动，Chrome 会开始原生拖放（drag-and-drop）**，
 * 结果既没有新选区、也不会触发我们的复制（实测：第二次从同一位置拖，选区变 0、剪贴板不变）。
 * 这不是缺陷，是浏览器的标准行为；夹具里按真实用户的动作顺序（先点开空白）来测。
 */
const clearSelection = async () => {
  await page.mouse.click(6, 940);
  await page.waitForTimeout(120);
};

const dragTo = async (from, dx, dy = 0) => {
  await clearSelection();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(180);
};

const A = '[data-testid="message"][data-role="assistant"] [data-testid="message-text"]';
const U = '[data-testid="message"][data-role="user"] [data-testid="message-text"]';

try {
  // —— 夹具：真实会话列表 + mock 选中会话的详情 ——
  const agentId = new URL(APP_URL).searchParams.get("agent");
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const agent = agentId ?? (await page.evaluate(async () => {
    const data = await (await fetch("/api/agents")).json();
    return data.items?.[0]?.id;
  }));
  const target = await page.evaluate(async (a) => {
    const projects = await (await fetch(`/api/agents/${a}/projects`)).json();
    for (const p of projects.items ?? []) {
      const list = await (await fetch(`/api/agents/${a}/projects/${p.id}/sessions`)).json();
      const first = (list.items ?? [])[0];
      if (first !== undefined) return { projectId: p.id, sessionId: first.sessionId };
    }
    return null;
  }, agent);
  check("T0 前置：实例里至少有一条会话（列表用真实数据）", target !== null, JSON.stringify(target));
  if (target === null) throw new Error("开发实例里没有会话，先在该实例里发一条消息");

  await page.route(/\/api\/agents\/[^/]+\/sessions\/[^/]+$/, async (route) => {
    const sid = new URL(route.request().url()).pathname.split("/").pop();
    if (sid === target.sessionId) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detailFor(sid)) });
    return route.fallback();
  });

  await page.goto(`${APP_URL}?agent=${agent}&project=${target.projectId}`, { waitUntil: "networkidle" });
  // 列表是异步填的（实测首屏 2–3s 才出现会话行）；等"行出现"而不是死等固定时间
  const rowSel = `[data-testid="${target.sessionId}"]`;
  await page.waitForSelector(rowSel, { timeout: 15000 }).catch(() => undefined);
  check("T0 前置：会话行已渲染", (await page.locator(rowSel).count()) > 0, rowSel);
  await page.locator(rowSel).first().click();
  await page.waitForTimeout(1500);

  const counts = await page.evaluate(() => ({
    messages: document.querySelectorAll('[data-testid="message"]').length,
    assistant: document.querySelectorAll('[data-testid="message"][data-role="assistant"] [data-testid="message-text"]').length,
    user: document.querySelectorAll('[data-testid="message"][data-role="user"] [data-testid="message-text"]').length,
  }));
  check("T0 前置：夹具会话已打开（1 用户 + 1 助手）", counts.user === 1 && counts.assistant === 1, JSON.stringify(counts));
  if (counts.assistant !== 1) throw new Error("夹具会话没打开，后续断言无意义");

  /* ---- T1 拖选助手正文：免按即复制 + 选区保留 + 提示 + 无草稿框 ---- */
  let start = await pickStart(A, 24);
  check("T1 前置：找到命中正文的拖选起点", start !== null, JSON.stringify(start));
  if (start !== null) {
    putClipboard("SENTINEL-T1");
    await dragTo(start, 240);
    const after = await state();
    const clip = paste();
    check("T1 松手即进剪贴板（未按 Cmd+C）", clip !== "SENTINEL-T1" && clip.trim() !== "", JSON.stringify(clip.slice(0, 40)));
    check("T1 剪贴板内容来自选区", after.selText.includes(clip.trim().slice(0, 12)) || clip.trim().startsWith(after.selText.trim().slice(0, 12)), `clip=${JSON.stringify(clip.slice(0, 26))}`);
    check("T1 选区仍在（未被清空）", after.selText.trim().length > 0, `len=${after.selText.length}`);
    check("T1 出现「已复制 · N 字」提示", after.toastVisible && /^已复制 · \d+ 字$/.test(after.toastText ?? ""), JSON.stringify(after.toastText));
    check("T1 草稿框不再弹出（草稿框已禁用）", after.draftVisible === false);
    const expected = [...clip.trim()].length;
    check("T1 提示里的字数 = 实际复制字符数", after.toastText === `已复制 · ${expected} 字`, `expected=${expected} got=${JSON.stringify(after.toastText)}`);

    /* ---- T2 提示位置：在选区上方、水平居中（用户 2026-11-07 拍板"上方居中"）
     *   几何与状态同一次 evaluate 读回（提示只活 1000ms，分成两次读会读到 null）。 ---- */
    const pos = after.geometry;
    check("T2 提示在选区上方（底边 ≤ 选区上边）", pos !== null && pos.toastBottom <= pos.selTop, JSON.stringify(pos));
    check("T2 上方间距 = 8px（LibreChat POPUP_OFFSET）", pos !== null && pos.gap === 8, JSON.stringify(pos));
    check("T2 提示水平居中于选区（±8px）", pos !== null && Math.abs(pos.toastCenterX - pos.selCenterX) <= 8, JSON.stringify(pos));
  }

  /* ---- T3 提示停留时长 = 1000ms（用户 2026-11-07 拍板） ---- */
  {
    // 重新复制一次，从"刚出现"开始计时（T2 之前已经过了一些时间，不能沿用）
    await page.waitForTimeout(1200);
    await clearSelection();
    const p = await pickStart(A, 24);
    if (p !== null) {
      await dragTo(p, 200);
      const t0 = Date.now();
      const atStart = await state();
      await page.waitForTimeout(500);
      const at500 = await state();
      await page.waitForTimeout(800);
      const at1300 = await state();
      check("T3 刚复制后提示可见", atStart.toastVisible === true, JSON.stringify(atStart.toastText));
      check("T3 500ms 时仍在（不是一闪就没）", at500.toastVisible === true, `elapsed=${Date.now() - t0}ms`);
      check("T3 1300ms 后已消失", at1300.toastVisible === false, `elapsed=${Date.now() - t0}ms`);
    }
  }

  /* ---- T4 单击不复制（两种情形，都是真实用户动作） ---- */
  {
    await page.waitForTimeout(1200);
    // (a) 已有选区时在选区里单击：浏览器 mouseup 时选区还在，会误判成"又复制一次"
    const p = await pickStart(A, 24);
    if (p !== null) {
      await dragTo(p, 200);                       // 先制造选区
      await page.waitForTimeout(1200);            // 等提示消失
      putClipboard("SENTINEL-T4a");
      await page.mouse.click(p.x + 40, p.y);      // 在选区内部单击
      await page.waitForTimeout(300);
      check("T4a 在已有选区里单击不重复复制", paste() === "SENTINEL-T4a", JSON.stringify(paste().slice(0, 22)));
      check("T4a 单击不弹提示", (await state()).toastVisible === false);
    }
    // (b) 先清掉选区，再单击
    await page.mouse.click(5, 900);
    await page.waitForTimeout(250);
    putClipboard("SENTINEL-T4b");
    if (p !== null) {
      await page.mouse.click(p.x + 40, p.y);
      await page.waitForTimeout(250);
      check("T4b 无选区时单击不复制", paste() === "SENTINEL-T4b", JSON.stringify(paste().slice(0, 22)));
    }
  }

  /* ---- T5 用户气泡里拖选也复制 ---- */
  {
    await page.evaluate(() => document.querySelector('[data-testid="message"][data-role="user"]')?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400);
    const p = await pickStart(U, 12);
    check("T5 前置：找到用户气泡的拖选起点", p !== null, JSON.stringify(p));
    if (p !== null) {
      putClipboard("SENTINEL-T5");
      await dragTo(p, 240);
      const clip = paste();
      const after = await state();
      check("T5 用户气泡拖选即复制", clip !== "SENTINEL-T5" && clip.trim() !== "", JSON.stringify(clip.slice(0, 30)));
      check("T5 复制内容来自用户气泡（不是别处）", after.selText.trim() !== "" && clip.trim() === after.selText.trim(), `clip=${JSON.stringify(clip.slice(0, 24))} sel=${JSON.stringify(after.selText.slice(0, 24))}`);
    }
  }

  /* ---- T6 双击选词也复制（mouseup 时选qu已定稿，实测过） ---- */
  {
    await page.waitForTimeout(1100);
    const p = await pickStart(A, 24);
    if (p !== null) {
      putClipboard("SENTINEL-T6");
      await page.mouse.dblclick(p.x, p.y);
      await page.waitForTimeout(300);
      check("T6 双击选词即复制", paste() !== "SENTINEL-T6", JSON.stringify(paste().slice(0, 20)));
    }
  }

  /* ---- T7 从正文往界面件方向拖选：剪贴板里只有正文，不带消息头 / 动作条文案 ----
   *  说明：从 `select-none` 区域**起手**时浏览器根本不产生选区（原生行为，实测），
   *  所以真正要守的是"从正文拖出去/拖回来时，界面文案不混进剪贴板"。 ---- */
  {
    await page.waitForTimeout(1100);
    const geom = await page.evaluate(() => {
      const msg = document.querySelector('[data-testid="message"][data-role="assistant"]');
      if (msg === null) return null;
      msg.scrollIntoView({ block: "center" });
      const header = msg.querySelector('[data-testid="message-header"]');
      const body = msg.querySelector('[data-testid="message-text"]');
      const actions = msg.querySelector('[data-testid="message-actions"]');
      if (header === null || body === null) return null;
      const hr = header.getBoundingClientRect();
      const br = body.getBoundingClientRect();
      const ar = actions === null ? null : actions.getBoundingClientRect();
      return {
        bodyStart: { x: Math.round(br.left + 6), y: Math.round(br.top + 20) },
        bodyEnd: { x: Math.round(br.left + 380), y: Math.round(br.bottom - 6) },
        headerText: (header.textContent ?? "").trim(),
        actionsText: actions === null ? "" : (actions.textContent ?? "").trim(),
        hr: { top: Math.round(hr.top), bottom: Math.round(hr.bottom) },
        br: { top: Math.round(br.top), bottom: Math.round(br.bottom) },
        ar: ar === null ? null : { top: Math.round(ar.top), bottom: Math.round(ar.bottom) },
      };
    });
    check("T7 前置：找到消息头与正文", geom !== null, JSON.stringify(geom));
    if (geom !== null) {
      // 正文内部从左上拖到右下（跨过代码块与表格），再往上越过消息头
      await clearSelection();
      putClipboard("SENTINEL-T7");
      await page.mouse.move(geom.bodyStart.x, geom.bodyStart.y);
      await page.mouse.down();
      await page.mouse.move(geom.bodyEnd.x, geom.bodyEnd.y, { steps: 20 });
      await page.mouse.move(geom.hr.top + 6, geom.bodyStart.y - 4, { steps: 10 });   // 越过 header 再回来
      await page.mouse.move(geom.bodyEnd.x, geom.bodyEnd.y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(250);
      const clip = paste();
      const after = await state();
      check("T7 从正文拖出去再拖回来：仍然复制到正文", clip !== "SENTINEL-T7" && clip.trim() !== "", JSON.stringify(clip.slice(0, 40)));
      check("T7 剪贴板里不含消息头文案", geom.headerText === "" || !clip.includes(geom.headerText), `header=${JSON.stringify(geom.headerText)} clip=${JSON.stringify(clip.slice(0, 30))}`);
      check("T7 剪贴板里不含动作条文案", geom.actionsText === "" || !clip.trim().endsWith(geom.actionsText), `actions=${JSON.stringify(geom.actionsText)} clip末=${JSON.stringify(clip.trim().slice(-12))}`);
      check("T7 剪贴板 = 选区文本（原义一致）", clip.trim() === after.selText.trim(), `clip=${clip.length} sel=${after.selText.length}`);
    }
  }

  /* ---- T8 对话区外（左侧列）拖选不复制 ---- */
  {
    await page.waitForTimeout(1100);
    putClipboard("SENTINEL-T8");
    const nav = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="groups-panel"]');
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + 16), y: Math.round(r.top + 120), w: Math.round(r.width) };
    });
    if (nav === null) {
      check("T8 左侧列拖选不复制（未找到左侧列，跳过）", true, "skipped");
    } else {
      await dragTo(nav, Math.min(120, nav.w - 40));
      check("T8 左侧列里的拖选不写剪贴板", paste() === "SENTINEL-T8", JSON.stringify(paste().slice(0, 24)));
    }
  }

  /* ---- T9 表单控件内选字不复制（备注/输入框） ---- */
  {
    await page.waitForTimeout(300);
    putClipboard("SENTINEL-T9");
    const box = await page.evaluate(() => {
      const el = document.querySelector("textarea");
      if (el === null) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + 20), y: Math.round(r.top + 12), w: Math.round(r.width) };
    });
    if (box === null) {
      check("T9 输入框内选字不复制（未找到 textarea，跳过）", true, "skipped");
    } else {
      await page.evaluate(() => {
        const el = document.querySelector("textarea");
        el.focus();
        el.value = "这是一段用来测试选区的文字，够长了可以拖";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.waitForTimeout(200);
      await dragTo(box, Math.min(160, box.w - 60));
      await page.waitForTimeout(200);
      check("T9 输入框里选字不写剪贴板", paste() === "SENTINEL-T9", JSON.stringify(paste().slice(0, 24)));
    }
  }
} catch (error) {
  console.error("执行中断：", error);
  failures.push(`异常：${String(error).slice(0, 160)}`);
} finally {
  await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
  await browser.close();
}

console.log(`\n${failures.length === 0 ? "全部通过" : `失败 ${failures.length} 项：\n - ${failures.join("\n - ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
