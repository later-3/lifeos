/**
 * 批注定位地基的单测（Task 0003 · P1-3）。
 *
 * 需要真实 DOM：Range / TreeWalker 的行为在 jsdom 与浏览器有差异（实测过 isConnected
 * 在整块替换后仍为 true 这类陷阱），所以这里用 playwright-core 在真实 Chromium 里跑纯函数。
 *
 * 若本机没有 playwright-core，跳过并给出明确提示（不静默通过）。
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(ROOT, "frontend/node_modules/playwright-core/index.js"),
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
].filter(Boolean);

const found = CANDIDATES.find((p) => existsSync(p));

if (found === undefined) {
  test("annotations: playwight-core 不可用，跳过", (t) => {
    t.skip("找不到 playwright-core：设置 PLAYWRIGHT_CORE=/path/to/index.js");
  });
} else {
  const pwmod = await import(found);
  const chromium = (pwmod.default ?? pwmod).chromium;

  // 用 esbuild 把 TS 编成浏览器可执行的 JS（annotations.ts 没有 import，天然自包含）。
  // 不用正则剥类型——那种做法一碰注释/f字符串就碎（本轮踩过）。
  const esbuildPath = join(ROOT, "node_modules/esbuild/lib/main.js");
  const esbuild = (await import(esbuildPath)).default ?? (await import(esbuildPath));
  const built = await esbuild.build({
    entryPoints: [join(ROOT, "frontend/src/annotations.ts")],
    bundle: false, format: "iife", globalName: "__M", write: false, target: "es2020",
  });
  const src = built.outputFiles[0].text;

  let browser;
  let page;
  before(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.setContent("<body></body>");
    await page.addScriptTag({ content: src });
  });
  after(async () => { await browser?.close(); });

  const MD_HTML = `
    <div class="md-body" id="root">
      <p>这里是<strong>加粗的重点</strong>和普通文字混排的一段。</p>
      <ol>
        <li>列表第一项，含 <code>行内代码</code></li>
        <li>列表第二项</li>
      </ol>
      <table><tbody><tr><td>数据1</td><td>数据2</td></tr></tbody></table>
    </div>`;

  const run = (fn, args) => page.evaluate(fn, args);

  test("T1-10 buildIndex 的 text 与 textContent 完全一致", async () => {
    const r = await run((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const root = host.querySelector("#root");
      const idx = window.__M.buildIndex(root);
      const same = idx.text === root.textContent;
      const total = idx.total === idx.text.length;
      host.remove();
      return { same, total, len: idx.total };
    }, MD_HTML);
    assert.equal(r.same, true, "扁平串必须与 textContent 一致（不裁剪、不丢空白）");
    assert.equal(r.total, true, "total 必须等于扁平串长度");
  });

  test("T1-11 跨加粗边界往返一致", async () => {
    const r = await run((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const root = host.querySelector("#root");
      const idx = window.__M.buildIndex(root);
      const i = idx.text.indexOf("加粗的重点");
      const rg = window.__M.toRange(idx, i, i + "加粗的重点".length);
      const text = rg === null ? null : rg.toString();
      const back = rg === null ? null : window.__M.toOffset(idx, rg);
      host.remove();
      return { text, back, start: i, end: i + 5 };
    }, MD_HTML);
    assert.equal(r.text, "加粗的重点");
    assert.deepEqual(r.back, { start: r.start, end: r.end });
  });

  test("T1-12 跨两个列表项往返一致", async () => {
    const r = await run((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const root = host.querySelector("#root");
      const idx = window.__M.buildIndex(root);
      const s = idx.text.indexOf("列表第一项");
      const e = idx.text.indexOf("列表第二项") + "列表第二项".length;
      const rg = window.__M.toRange(idx, s, e);
      const out = { text: rg === null ? null : rg.toString(), back: rg === null ? null : window.__M.toOffset(idx, rg), start: s, end: e };
      host.remove();
      return out;
    }, MD_HTML);
    assert.ok(r.text !== null && r.text.includes("列表第一项") && r.text.includes("列表第二项"), `跨列表项应能建 Range，实际：${r.text}`);
    assert.deepEqual(r.back, { start: r.start, end: r.end });
  });

  test("T1-13 跨两个表格单元格往返一致", async () => {
    const r = await run((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const root = host.querySelector("#root");
      const idx = window.__M.buildIndex(root);
      const s = idx.text.indexOf("数据1");
      const e = idx.text.indexOf("数据2") + "数据2".length;
      const rg = window.__M.toRange(idx, s, e);
      const out = { text: rg === null ? null : rg.toString(), back: rg === null ? null : window.__M.toOffset(idx, rg), start: s, end: e };
      host.remove();
      return out;
    }, MD_HTML);
    assert.ok(r.text !== null && r.text.includes("数据1") && r.text.includes("数据2"), `跨单元格应能建 Range，实际：${r.text}`);
    assert.deepEqual(r.back, { start: r.start, end: r.end });
  });

  test("T1-13b quoteOf 取自扁平串：与偏移同源，不受浏览器 toString 分隔符影响", async () => {
    const r = await run((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const root = host.querySelector("#root");
      const idx = window.__M.buildIndex(root);
      const s = idx.text.indexOf("数据1");
      const e = idx.text.indexOf("数据2") + "数据2".length;
      const out = {
        quote: window.__M.quoteOf(idx, s, e),
        slice: idx.text.slice(s, e),
        sameAsSlice: window.__M.quoteOf(idx, s, e) === idx.text.slice(s, e),
        hasTab: window.__M.quoteOf(idx, s, e).includes("\t"),
        bad: window.__M.quoteOf(idx, -1, 3),
        reversed: window.__M.quoteOf(idx, 5, 3),
      };
      host.remove();
      return out;
    }, MD_HTML);
    assert.equal(r.sameAsSlice, true, "quote 必须与扁平串切片逐字相同（同源）");
    assert.equal(r.hasTab, false, "扁平串切片不含制表符（浏览器 toString 才用 \\t，实测跨单元格时不同）");
    assert.ok(r.quote.includes("数据1") && r.quote.includes("数据2"));
    assert.equal(r.bad, "", "越界返回空串，不抛");
    assert.equal(r.reversed, "", "反向区间返回空串，不抛");
  });

  test("T1-14 空选区 / 反向选区 → null（不抛）", async () => {
    const r = await run((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const root = host.querySelector("#root");
      const idx = window.__M.buildIndex(root);
      const a = window.__M.toRange(idx, 5, 5);
      const b = window.__M.toRange(idx, 9, 3);
      host.remove();
      return { a: a === null, b: b === null };
    }, MD_HTML);
    assert.equal(r.a, true, "start === end 应返回 null");
    assert.equal(r.b, true, "end < start 应返回 null");
  });

  test("T1-15 越界偏移 → null（不抛）", async () => {
    const r = await run((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const root = host.querySelector("#root");
      const idx = window.__M.buildIndex(root);
      const out = {
        beyond: window.__M.toRange(idx, 0, idx.total + 10) === null,
        negative: window.__M.toRange(idx, -1, 3) === null,
        nan: window.__M.toRange(idx, Number.NaN, 3) === null,
      };
      host.remove();
      return out;
    }, MD_HTML);
    assert.deepEqual(r, { beyond: true, negative: true, nan: true });
  });

  test("T1-16 终点落在节点右边界时归到本节点", async () => {
    const r = await run(() => {
      const host = document.createElement("div");
      host.innerHTML = `<div id="root"><strong>加粗</strong>后面</div>`;
      document.body.appendChild(host);
      const root = host.querySelector("#root");
      const idx = window.__M.buildIndex(root);
      // 「加粗」= [0,2)，终点 2 正好是 <strong> 文本节点右边界
      const rg = window.__M.toRange(idx, 0, 2);
      const out = { text: rg === null ? null : rg.toString(), endNodeIsStrong: rg === null ? null : (rg.endContainer.parentElement?.tagName === "STRONG") };
      host.remove();
      return out;
    });
    assert.equal(r.text, "加粗");
    assert.equal(r.endNodeIsStrong, true, "终点在边界上应归属前一个节点（<strong>），不是后面那个");
  });

  test("T1-16b 起点落在节点边界时归到后一节点", async () => {
    const r = await run(() => {
      const host = document.createElement("div");
      host.innerHTML = `<div id="root"><strong>加粗</strong>后面</div>`;
      document.body.appendChild(host);
      const root = host.querySelector("#root");
      const idx = window.__M.buildIndex(root);
      // 起点 2 = <strong> 结束处 = 「后面」开头
      const rg = window.__M.toRange(idx, 2, 4);
      const out = { text: rg === null ? null : rg.toString(), startNodeIsText: rg === null ? null : (rg.startContainer.nodeType === 3) };
      host.remove();
      return out;
    });
    assert.equal(r.text, "后面");
    assert.equal(r.startNodeIsText, true);
  });

  test("索引里不包含元素节点、空白不被裁剪", async () => {
    const r = await run(() => {
      const host = document.createElement("div");
      host.innerHTML = `<div id="root">  有 空白 \n 的文字  </div>`;
      document.body.appendChild(host);
      const root = host.querySelector("#root");
      const idx = window.__M.buildIndex(root);
      const out = {
        same: idx.text === root.textContent,
        hasSpace: idx.text.startsWith("  "),
        nodeCount: idx.nodes.length,
      };
      host.remove();
      return out;
    });
    assert.equal(r.same, true);
    assert.equal(r.hasSpace, true, "首部空白必须保留（裁剪会让偏移与 DOM 对不上）");
    assert.equal(r.nodeCount, 1);
  });

}
