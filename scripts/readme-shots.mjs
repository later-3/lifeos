#!/usr/bin/env node
/**
 * README 配图生成器（可重复运行）。
 *
 * 两张来源，不许混：
 * - **真实截图**：从正在运行的实例抓（主实例 = 已上线行为；开发实例 = 未合并分支）。
 *   图注必须写清它是哪一档，不许拿开发实例冒充已上线。
 * - **设计稿**：本文件里内嵌 HTML，按 tokens.css 的数值与 IM 设计语言渲染。
 *   图上永久带「设计稿 · 未实现」角标——图是给人看形态的，不是"我们已有这个功能"。
 *
 * 用法：
 *   node scripts/readme-shots.mjs                  # 全部重拍（需要实例在跑）
 *   MAIN=http://127.0.0.1:43120 ANNO=http://127.0.0.1:5175 node scripts/readme-shots.mjs
 *   node scripts/readme-shots.mjs --only=design    # 只重画设计稿（不需要实例）
 *
 * 产物：docs/images/*.webp（进 Git）；PNG 原图落 /tmp/lifeos-readme-shots。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "docs/images");
const RAW = "/tmp/lifeos-readme-shots";
// 默认指向**演示实例**（scripts/readme-demo-home.mjs 造的数据），不拍用户真实会话：
// 真实主实例里全是测试残留（标题形如 `草稿契约-1793599187754`），不能进 README。
const MAIN = process.env.MAIN ?? "http://127.0.0.1:43140";
const ANNO = process.env.ANNO ?? "http://127.0.0.1:5175";
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const WEBP_WIDTH = 1440;

const PLAYWRIGHT = process.env.PLAYWRIGHT_CORE
  ?? join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js");

mkdirSync(OUT, { recursive: true });
mkdirSync(RAW, { recursive: true });

const { default: pw } = await import(PLAYWRIGHT);
const { chromium } = pw;

async function toWebp(pngName) {
  const png = join(RAW, `${pngName}.png`);
  const webp = join(OUT, `${pngName}.webp`);
  execFileSync("cwebp", ["-quiet", "-q", "84", "-resize", String(WEBP_WIDTH), "0", png, "-o", webp]);
  const size = (await import("node:fs")).statSync(webp).size;
  console.log(`  ${pngName}.webp  ${(size / 1024).toFixed(0)} KB`);
}

const browser = await chromium.launch({ headless: true });
const consoleErrors = [];

async function newPage(width = 1440, height = 900) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => consoleErrors.push(String(error).slice(0, 160)));
  return page;
}

/* ------------------------------------------------------------------ *
 * 一、真实截图
 * ------------------------------------------------------------------ */

/** 打开演示实例并落到指定会话（按会话标题条目点）。 */
async function openDemo(agentName, titleFragment) {
  const page = await newPage(1440, 900);
  await page.goto(MAIN, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  await page.locator(`[data-testid="groups-panel"] >> text=${agentName}`).first().click().catch(() => {});
  await page.waitForTimeout(900);
  await page.locator(`[data-testid="groups-panel"] >> text=${titleFragment}`).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.mouse.move(1420, 880);
  return page;
}

/** 已上线：主工作区三列 + 一轮已完成的过程折叠 + usage 状态条。 */
async function shotWorkspace() {
  const page = await openDemo("Life Agent", "支付状态机");
  await page.screenshot({ path: join(RAW, "01-workspace.png") });
  await page.close();
  await toWebp("01-workspace");
}

/**
 * 已上线：会话参与者（Agent ↔ Agent 叠放头像）+ 头部对端 + 消息行头像。
 * 这是"多 Agent"这一档里唯一已经在主线跑起来的部分，所以单独一张。
 */
async function shotParticipants() {
  const page = await openDemo("coder", "与 Life Agent 的对话");
  await page.screenshot({ path: join(RAW, "02-participants.png"), clip: { x: 0, y: 0, width: 1240, height: 520 } });
  await page.close();
  await toWebp("02-participants");
}

/** 已上线：完整历史 = 每次请求的 prompt 分区（谁加的、改哪里会变、占多少 token）。 */
async function shotPromptRegions() {
  const page = await openDemo("Life Agent", "支付状态机");
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.waitForTimeout(600);
  await page.locator('button[aria-label="完整历史"]').click();
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("button, div[role=button], summary")];
    const hit = nodes.find((n) => (n.textContent ?? "").includes("请求") && (n.textContent ?? "").includes("模型"));
    if (hit !== undefined) hit.click();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(RAW, "03-prompt-regions.png"), clip: { x: 1160, y: 0, width: 440, height: 700 } });
  await page.close();
  await toWebp("03-prompt-regions");
}

/**
 * 开发中（分支 dev/0003-annotation，未合并）：在 Agent 回复上拖选 → 标语气 + 写话 → 标上。
 * 批注是数据不是高亮：它会作为一条普通消息发给 Agent。
 */
async function shotAnnotation() {
  const page = await newPage(1440, 760);
  await page.goto(ANNO, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);

  const selectAt = async (blockFromEnd, chars) => {
    const target = await page.evaluate(({ blockFromEnd, chars }) => {
      const blocks = [...document.querySelectorAll('[data-testid="message-text"][data-block-index]')];
      const block = blocks[blocks.length - 1 - blockFromEnd] ?? blocks[0];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node;
      while (walker.nextNode()) {
        const value = walker.currentNode.nodeValue ?? "";
        if (value.trim().length > chars + 2) { node = walker.currentNode; break; }
      }
      if (node === undefined) return null;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(chars, node.length));
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, text: node.nodeValue.slice(0, chars) };
    }, { blockFromEnd, chars });
    if (target === null) return undefined;
    await page.mouse.move(target.x + 1, target.y + target.h / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.w - 1, target.y + target.h / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(450);
    return target.text;
  };

  const annotate = async (blockFromEnd, chars, marks, note) => {
    const quoted = await selectAt(blockFromEnd, chars);
    if (quoted === undefined) return;
    for (const mark of marks) {
      await page.locator('[data-testid="draft-marks"] button', { hasText: mark }).first().click();
    }
    if (note !== "") await page.locator('[data-testid="draft-note"]').fill(note);
    await page.locator('[data-testid="draft-commit"]').click();
    await page.waitForTimeout(600);
    console.log(`  批注「${quoted}」→ ${marks.join("+")}`);
  };

  await annotate(0, 9, ["批评"], "这个口径是按文件算还是按条算？");
  await annotate(1, 6, ["疑问"], "「行内代码」也算一段吗？");

  // 收起鼠标造成的悬浮态，让画面稳定
  await page.mouse.move(1430, 740);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(RAW, "04-annotation.png"), clip: { x: 340, y: 0, width: 1100, height: 700 } });
  await page.close();
  await toWebp("04-annotation");
}

/**
 * 已上线：Task 在界面上的落点——会话行的 Task 编号 + 头部的 Task 标题。
 * 长条特写，避免为它再拍整屏。
 */
async function shotTask() {
  const page = await openDemo("Life Agent", "支付状态机");
  await page.screenshot({ path: join(RAW, "05-task-header.png"), clip: { x: 300, y: 0, width: 1140, height: 46 } });
  await page.close();
  await toWebp("05-task-header");
}

/* ------------------------------------------------------------------ *
 * 二、设计稿（内嵌 HTML，数值来自 tokens.css / design-language.md）
 * ------------------------------------------------------------------ */

const CSS = `
  * { box-sizing: border-box; }
  :root {
    --surface: #ffffff; --sunken: #fafafa; --hover: #f7f7f9; --line: #e9e9ec; --nav-line: #dcdce1;
    --ink-900: #111113; --ink-700: #3f3f46; --ink-500: #71717a; --ink-300: #a1a1aa;
    --accent: #2563eb; --accent-soft: #eff4ff; --accent-line: #cbdcff;
    --success: #067647; --success-soft: #ecfdf3; --danger: #b42318; --danger-soft: #fef3f2;
    --anno-q: #b8860b; --anno-q-bg: #fff6d6; --anno-c: #c53030; --anno-c-bg: #ffe8e8;
    --plain: #6d28d9; --plain-2: #047857; --plain-3: #b45309;
  }
  html, body { margin: 0; height: 900px; }
  body {
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", "Segoe UI", sans-serif;
    color: var(--ink-900); background: var(--surface); -webkit-font-smoothing: antialiased;
  }
  .app { display: flex; height: 900px; }
  .rail { width: 44px; flex: 0 0 44px; background: var(--sunken); border-right: 1px solid var(--line);
          display: flex; flex-direction: column; align-items: center; padding-top: 8px; gap: 4px; }
  .rail i { width: 30px; height: 30px; border-radius: 10px; display: flex; align-items: center;
            justify-content: center; color: var(--ink-500); font-size: 13px; font-style: normal; }
  .rail i.on { background: var(--accent-soft); color: var(--accent); }
  .col { flex: 0 0 264px; background: var(--sunken); border-right: 1px solid var(--line); display: flex; flex-direction: column; }
  .col.wide { flex-basis: 300px; }
  .colhead { height: 40px; display: flex; align-items: center; padding: 0 12px; gap: 6px;
             font-size: 11px; font-weight: 600; color: var(--ink-500); letter-spacing: .02em; }
  .count { margin-left: auto; min-width: 16px; height: 16px; padding: 0 6px; border-radius: 8px;
           background: var(--hover); color: var(--ink-700); font-size: 11px; display: inline-flex;
           align-items: center; justify-content: center; }
  .rows { padding: 0 8px 8px; }
  .row { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 10px; }
  .row.sel { background: var(--accent-soft); }
  .row .nm { font-size: 13.5px; line-height: 1.55; }
  .row .sub { font-size: 11px; color: var(--ink-500); }
  .av { border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
        color: #fff; font-weight: 500; flex: none; }
  .stack { display: inline-flex; }
  .stack .av + .av { margin-left: -5px; box-shadow: 0 0 0 2px var(--sunken); }
  .ghead { height: 32px; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 8px;
           font-size: 15px; font-weight: 600; color: var(--ink-900); }
  .ghead .car { color: var(--ink-500); font-size: 12px; width: 28px; text-align: center; }
  .chat { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--surface); }
  .chathead { height: 44px; border-bottom: 1px solid var(--line); display: flex; align-items: center;
              gap: 10px; padding: 0 16px; }
  .chathead .t { font-size: 13.5px; font-weight: 600; }
  .chathead .m { font-size: 11px; color: var(--ink-500); }
  .pill { border-radius: 999px; padding: 2px 8px; font-size: 11px; background: var(--success-soft); color: var(--success); }
  .pill.gray { background: var(--hover); color: var(--ink-700); }
  .body { flex: 1; overflow: hidden; padding: 16px 24px; display: flex; flex-direction: column; gap: 14px; }
  .msg { display: flex; gap: 10px; max-width: 720px; }
  .msg .who { font-size: 11px; color: var(--ink-500); margin-bottom: 3px; display: flex; gap: 6px; align-items: center; }
  .msg .who b { color: var(--ink-700); font-weight: 600; font-size: 12px; }
  .msg .txt { font-size: 15px; line-height: 1.72; color: var(--ink-900); }
  .msg.me { margin-left: auto; flex-direction: row-reverse; }
  .msg.me .bubble { background: var(--ink-900); color: #fff; border-radius: 14px 14px 6px 14px;
                    padding: 10px 16px; font-size: 15px; line-height: 1.72; max-width: 460px; }
  .process { font-size: 11px; color: var(--ink-500); display: flex; gap: 6px; align-items: center; margin: 2px 0 6px; }
  .mention { background: var(--accent-soft); color: var(--accent); border-radius: 4px; padding: 0 4px; font-weight: 600; }
  .handoff { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink-500);
             border: 1px dashed var(--nav-line); border-radius: 999px; padding: 2px 8px; }
  ul.dots { margin: 6px 0 0; padding-left: 18px; }
  ul.dots li { font-size: 15px; line-height: 1.72; }
  .composer { margin: 0 24px 16px; border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px;
              display: flex; align-items: center; gap: 10px; color: var(--ink-500); font-size: 15px; }
  .send { margin-left: auto; width: 32px; height: 32px; border-radius: 50%; background: var(--ink-900);
          color: #fff; display: flex; align-items: center; justify-content: center; font-size: 14px; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: var(--surface); }
  .card .ct { font-size: 13.5px; font-weight: 600; }
  .card .cs { font-size: 11px; color: var(--ink-500); margin-top: 2px; }
  .sub-card { display: flex; gap: 10px; align-items: center; border: 1px solid var(--line);
              border-radius: 10px; padding: 10px 12px; }
  .sub-card.run { border-color: var(--accent-line); background: var(--accent-soft); }
  .sub-card.bad { border-color: #f3c6c0; background: var(--danger-soft); }
  .tag { font-size: 11px; border-radius: 4px; padding: 0 6px; background: var(--hover); color: var(--ink-700); }
  .tag.run { background: var(--success-soft); color: var(--success); }
  .tag.bad { background: var(--danger-soft); color: var(--danger); }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .stat .n { font-size: 17px; font-weight: 700; }
  .stat .l { font-size: 11px; color: var(--ink-500); }
  .grid3 { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 16px; }
  .watermark { position: fixed; right: 14px; bottom: 12px; font-size: 11px; color: var(--ink-500);
               background: var(--sunken); border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; }
  .sec { font-size: 12px; font-weight: 600; color: var(--ink-500); margin-bottom: 8px; }
`;

const shell = (title, body) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${title}</title><style>${CSS}</style></head><body>${body}
<div class="watermark">设计稿 · 未实现</div></body></html>`;

const avatar = (initial, bg, size = 24) =>
  `<span class="av" style="width:${size}px;height:${size}px;background:${bg};font-size:${Math.round(size * 0.42)}px">${initial}</span>`;

const RAIL = `<div class="rail"><i class="on">◍</i><i>▤</i><i>◔</i><i>☺</i></div>`;

/** 设计稿 1：群聊房间（人 + 多个 Agent 同一条持久时间线；@ 定向；handoff 走私聊）。 */
const MOCKUP_ROOM = shell("群聊房间", `<div class="app">${RAIL}
  <div class="col">
    <div class="colhead">同事 <span class="count">4</span></div>
    <div class="rows">
      ${[["Architect", "契约与方案 · 空闲", "--plain"], ["Frontend Developer", "改 3 处字段名 · 进行中", "--plain-2"],
         ["coder", "两路并行 · 进行中", "--plain"], ["E2E Tester", "等契约冻结 · 空闲", "--plain-3"]]
        .map(([name, sub, color]) => `<div class="row">${avatar(name.slice(0, 1), `var(${color})`)}
          <span><div class="nm">${name}</div><div class="sub">${sub}</div></span></div>`).join("")}
    </div>
    <div class="ghead"><span class="car">▾</span> 群聊 <span class="count">2</span></div>
    <div class="rows">
      <div class="row sel">
        <span class="stack">${avatar("A", "var(--plain)", 20)}${avatar("F", "var(--plain-2)", 20)}${avatar("c", "var(--plain)", 20)}</span>
        <span style="min-width:0"><div class="nm">支付重构</div><div class="sub">4 人 · 3 分钟前</div></span>
      </div>
      <div class="row">
        <span class="stack">${avatar("c", "var(--plain)", 20)}${avatar("E", "var(--plain-3)", 20)}</span>
        <span style="min-width:0"><div class="nm">发布检查</div><div class="sub">2 人 · 昨天</div></span>
      </div>
    </div>
  </div>
  <div class="chat">
    <div class="chathead">
      <span class="t">支付重构</span>
      <span class="stack">${avatar("A", "var(--plain)", 20)}${avatar("F", "var(--plain-2)", 20)}${avatar("c", "var(--plain)", 20)}${avatar("你", "var(--ink-900)", 20)}</span>
      <span class="m">4 人 · Architect 主持</span>
      <span style="margin-left:auto" class="pill">进行中 2</span>
    </div>
    <div class="body">
      <div class="msg me"><div class="bubble">这次支付重构，先把契约定下来，再动实现。</div></div>
      <div class="msg">${avatar("A", "var(--plain)", 24)}
        <div style="min-width:0">
          <div class="who"><b>Architect</b><span>14:02</span><span class="tag">主持</span></div>
          <div class="process">▸ 2 次工具 · 12 秒 · 8.4k tokens 查看过程</div>
          <div class="txt">契约三条：</div>
          <ul class="dots"><li>金额一律用整数分，不用浮点</li><li>回调幂等键 = 订单号 + 渠道</li><li>退款状态机只有 4 个态</li></ul>
        </div>
      </div>
      <div class="msg me"><div class="bubble"><span class="mention">@Frontend Developer</span> 你按这个契约改字段名，只改显示层。</div></div>
      <div class="msg">${avatar("F", "var(--plain-2)", 24)}
        <div><div class="who"><b>Frontend Developer</b><span>14:05</span></div>
          <div class="txt">收到，涉及 3 处：金额展示、退款状态、回调日志列。</div>
          <div style="margin-top:6px"><span class="handoff">↪ 与 coder 的私下交接：字段命名细节（不进房间）</span></div>
        </div>
      </div>
    </div>
    <div class="composer">回复所有人 · @ 指定谁接手<span class="send">↑</span></div>
  </div>
</div>`);

/** 设计稿 2：一次派给多个 Agent（fan-out），进度与汇总都留在发起会话里。 */
const MOCKUP_DELEGATE = shell("多 Agent 委派", `<div class="app">${RAIL}
  <div class="col">
    <div class="colhead">同事 <span class="count">4</span></div>
    <div class="rows">
      ${[["Life Agent", "在协调 3 路子会话", "--ink-900"], ["Architect", "契约复核 · 进行中", "--plain"],
         ["coder", "补测试 · 失败待看", "--plain-2"], ["E2E Tester", "真链路验收 · 已完成", "--plain-3"]]
        .map(([name, sub, color]) => `<div class="row">${avatar(name.slice(0, 1), `var(${color})`)}
          <span><div class="nm">${name}</div><div class="sub">${sub}</div></span></div>`).join("")}
    </div>
    <div class="ghead"><span class="car">▾</span> 会话 <span class="count">1</span></div>
    <div class="rows">
      <div class="row sel"><span style="min-width:0"><div class="nm">补齐 0018 验收测试</div>
        <div class="sub">Task 0018 · 3 路子会话</div></span></div>
    </div>
  </div>
  <div class="chat">
    <div class="chathead"><span class="t">补齐 0018 验收测试</span><span class="m">Life Agent · lifoOS · 0001 默认</span>
      <span style="margin-left:auto" class="pill">3 路并行</span></div>
    <div class="body">
      <div class="msg me"><div class="bubble">把 0018 的验收测试补齐，三个方向并行，回来汇总给我。</div></div>
      <div class="msg">${avatar("L", "var(--ink-900)", 24)}
        <div style="min-width:0;flex:1">
          <div class="who"><b>Life Agent</b><span>15:10</span></div>
          <div class="txt">拆成三路，各自独立 worktree；我不合并，只汇总。</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
            <div class="sub-card run">${avatar("A", "var(--plain)", 20)}
              <span style="flex:1"><div class="ct" style="font-size:12px;font-weight:600">Architect · 复核契约边界</div>
                <div class="cs">跑 1 分 08 秒 · 正在读 specs/code/api/api.md</div></span>
              <span class="tag run">进行中</span></div>
            <div class="sub-card">${avatar("E", "var(--plain-3)", 20)}
              <span style="flex:1"><div class="ct" style="font-size:12px;font-weight:600">E2E Tester · 真链路验收</div>
                <div class="cs">2 分 14 秒 · 3 句验收全绿 · 有录屏</div></span>
              <span class="tag">已完成</span></div>
            <div class="sub-card bad">${avatar("c", "var(--plain-2)", 20)}
              <span style="flex:1"><div class="ct" style="font-size:12px;font-weight:600">coder · 补单测</div>
                <div class="cs">失败：pnpm test 2 个用例红 · 未提交</div></span>
              <span class="tag bad">失败</span></div>
          </div>
          <div class="txt" style="margin-top:10px">两路完成、一路失败：契约无变更，验收已过；单测失败是 <code style="font-size:13px">turn-group</code> 的期望值过期。要我把第三路修掉再汇总吗？</div>
        </div>
      </div>
    </div>
    <div class="composer">输入消息 · Enter 发送 · Esc 打断<span class="send">↑</span></div>
  </div>
</div>`);

/** 设计稿 3：项目空间 = 一个项目里有什么人、在干什么（Task 是这里的一等公民）。 */
const MOCKUP_PROJECT = shell("项目空间", `<div class="app" style="background:var(--sunken)">${RAIL}
  <div class="col">
    <div class="colhead">同事 <span class="count">4</span></div>
    <div class="rows">
      ${[["Life Agent", "在协调 3 路子会话", "--ink-900"], ["Architect", "契约复核 · 进行中", "--plain"],
         ["coder", "补测试 · 失败待看", "--plain-2"], ["E2E Tester", "真链路验收 · 已完成", "--plain-3"]]
        .map(([name, sub, color]) => `<div class="row">${avatar(name.slice(0, 1), `var(${color})`)}
          <span><div class="nm">${name}</div><div class="sub">${sub}</div></span></div>`).join("")}
    </div>
  </div>
  <div style="flex:1;background:var(--surface);display:flex;flex-direction:column;min-width:0">
    <div style="height:56px;display:flex;align-items:center;gap:10px;padding:0 20px;border-bottom:1px solid var(--line)">
      <span style="font-size:17px;font-weight:600">lifoOS</span>
      <span class="stack">${avatar("你", "var(--ink-900)", 20)}${avatar("A", "var(--plain)", 20)}${avatar("c", "var(--plain-2)", 20)}${avatar("E", "var(--plain-3)", 20)}</span>
      <span class="pill run" style="background:var(--accent-soft);color:var(--accent)">3 项进行中</span>
    </div>
    <div style="padding:16px 20px 0">
      <div class="stats">
        <div class="stat card"><div class="n">3</div><div class="l">进行中任务</div></div>
        <div class="stat card"><div class="n">4</div><div class="l">参与同事</div></div>
        <div class="stat card"><div class="n">27</div><div class="l">对话总数</div></div>
      </div>
      <div class="grid3" style="margin-top:16px">
        <div>
          <div class="sec">在做的事</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div class="card"><div style="display:flex;gap:8px;align-items:center">
              <span class="ct">0018 验收测试补齐</span><span class="tag">开发</span><span class="tag run">进行中</span></div>
              <div class="cs">第 2/4 阶段 · 3 路子会话 · Life Agent</div></div>
            <div class="card"><div style="display:flex;gap:8px;align-items:center">
              <span class="ct">0003 对话批注</span><span class="tag">开发</span><span class="tag run">进行中</span></div>
              <div class="cs">P4 发送链路 · coder</div></div>
            <div class="card" style="opacity:.999"><div style="display:flex;gap:8px;align-items:center">
              <span class="ct" style="color:var(--ink-500)">0012 图片字节预算</span><span class="tag">开发</span></div>
              <div class="cs">已完成 · 已合并 main</div></div>
          </div>
        </div>
        <div>
          <div class="sec">最近的对话</div>
          <div class="card" style="display:flex;flex-direction:column;gap:8px">
            <div><div class="ct">补齐 0018 验收测试</div><div class="cs">Life Agent · 2 分钟前</div></div>
            <div><div class="ct">批注定位的跨元素选区</div><div class="cs">coder · 1 小时前</div></div>
            <div><div class="ct">fe-optimize 的列宽回归</div><div class="cs">Frontend Developer · 昨天</div></div>
          </div>
        </div>
        <div>
          <div class="sec">在这个项目里</div>
          <div class="card" style="display:flex;flex-direction:column;gap:10px">
            ${[["Life Agent", "协调", "--ink-900"], ["Architect", "方案", "--plain"], ["coder", "实现", "--plain-2"], ["E2E Tester", "验收", "--plain-3"]]
              .map(([n, r, c]) => `<div style="display:flex;gap:8px;align-items:center">${avatar(n.slice(0, 1), `var(${c})`, 20)}
                <span><div class="ct" style="font-size:12px">${n}</div><div class="cs">${r}</div></span></div>`).join("")}
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`);

async function renderMockup(name, html) {
  const page = await newPage(1440, 900);
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(300);
  const file = join(RAW, `${name}.png`);
  await page.screenshot({ path: file });
  writeFileSync(join(RAW, `${name}.html`), html);
  await page.close();
  await toWebp(name);
}

/* ------------------------------------------------------------------ */

console.log("真实截图：");
if (ONLY !== "design") {
  for (const [name, run] of [
    ["01 工作区", shotWorkspace],
    ["02 参与者", shotParticipants],
    ["03 prompt 分区", shotPromptRegions],
    ["04 批注", shotAnnotation],
    ["05 Task", shotTask],
  ]) {
    try {
      await run();
      console.log(`  ✓ ${name}`);
    } catch (error) {
      console.log(`  ✗ ${name}：${String(error).slice(0, 200)}`);
    }
  }
}

console.log("设计稿：");
if (ONLY !== "shots") {
  await renderMockup("06-room", MOCKUP_ROOM);
  await renderMockup("07-delegate", MOCKUP_DELEGATE);
  await renderMockup("08-project", MOCKUP_PROJECT);
}

if (consoleErrors.length > 0) console.log("页面错误：", [...new Set(consoleErrors)].slice(0, 5));
await browser.close();
console.log(`产物：${OUT}`);
