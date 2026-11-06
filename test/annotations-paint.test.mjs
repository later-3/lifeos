/**
 * 上色与命中的单测（Task 0003 · P2）。
 *
 * 需要真实浏览器：CSS Highlight API 与 getClientRects 在 jsdom 里不存在。
 * 用 esbuild 把 TS 编成可注入的 JS（annotations.ts 依赖 marks.ts，bundle 一起打）。
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
  test("annotations-paint: playwright-core 不可用，跳过", (t) => {
    t.skip("找不到 playwright-core");
  });
} else {
  const pwmod = await import(found);
  const chromium = (pwmod.default ?? pwmod).chromium;
  const esbuildPath = join(ROOT, "node_modules/esbuild/lib/main.js");
  const esbuild = (await import(esbuildPath)).default ?? (await import(esbuildPath));
  const built = await esbuild.build({
    entryPoints: [join(ROOT, "frontend/src/annotations.ts")],
    bundle: true, format: "iife", globalName: "__M", write: false, target: "es2020",
  });
  const src = built.outputFiles[0].text;

  let browser, page;
  before(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.setContent("<body></body>");
    await page.addScriptTag({ content: src });
  });
  after(async () => { await browser?.close(); });

  // 每个 owner 的名字记在模块级 Map 里，会跨测试残留；每测前清 registry + owner 表
  const resetRegistry = async () => {
    await page.evaluate(() => {
      for (const name of [...CSS.highlights.keys()]) CSS.highlights.delete(name);
      window.__M.__resetOwnersForTest?.();
    });
  };

  const MD = `<div id="root"><p>0123456789ABCDEFGHIJ</p></div>`;

  const mkAnno = (id, start, end, marks) => ({
    id, messageId: "m1", blockIndex: 0, start, end,
    quote: "", marks, note: "", ui: { mode: "open", pinned: false, dx: 0, dy: 0 },
  });

  test("上色：按标记分组，一个标记装多个 Range", async () => {
    const r = await page.evaluate((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const root = host.querySelector("#root");
      const index = window.__M.buildIndex(root);
      const annos = [
        { id:"a1", messageId:"m1", blockIndex:0, start:0,  end:4,  quote:"", marks:["critic"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} },
        { id:"a2", messageId:"m1", blockIndex:0, start:6,  end:9,  quote:"", marks:["critic"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} },
        { id:"a3", messageId:"m1", blockIndex:0, start:12, end:15, quote:"", marks:["query"],  note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} },
      ];
      window.__M.paintAnnotations(index, annos, undefined, "t");
      const out = {};
      for (const [name, hl] of CSS.highlights) {
        out[name] = hl.size;
      }
      host.remove();
      return out;
    }, MD);
    assert.deepEqual(r, { "anno-critic--t": 2, "anno-query--t": 1 }, "批评应装 2 个 Range，疑问 1 个");
  });

  test("清空：没有批注的标记不留空 Highlight", async () => {
    const r = await page.evaluate((html) => {
      for (const name of [...CSS.highlights.keys()]) CSS.highlights.delete(name);
      window.__M.__resetOwnersForTest?.();
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const index = window.__M.buildIndex(host.querySelector("#root"));
      const annos = [{ id:"a1", messageId:"m1", blockIndex:0, start:0, end:4, quote:"", marks:["critic"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} }];
      window.__M.paintAnnotations(index, annos, undefined, "blk-a");
      const before = [...CSS.highlights.keys()];
      window.__M.paintAnnotations(index, [], undefined, "blk-a");
      const after = [...CSS.highlights.keys()];
      host.remove();
      return { before, after };
    }, MD);
    assert.equal(r.before.length, 1, "paint 后应有本块的高亮（名字带 owner）");
    assert.deepEqual(r.after, [], "本块没有批注时，自己画的高亮必须被清掉（不能留空壳）");
  });

  test("owner 隔离：块 B 的空 paint 不得擦掉块 A 的高亮（2026-11-05 事故回归）", async () => {
    // 事故：registry 是全局单例，旧实现里"本块没有某标记 → delete 全同名"，
    // 三个回复块顺序 paint，最后一块把第一块画的高亮全擦了。
    // 用户看到的就是"高亮只在鼠标附近重渲染时闪现"。
    const r = await page.evaluate((html) => {
      for (const name of [...CSS.highlights.keys()]) CSS.highlights.delete(name);
      window.__M.__resetOwnersForTest?.();
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const index = window.__M.buildIndex(host.querySelector("#root"));
      const anno = { id:"a1", messageId:"m1", blockIndex:0, start:0, end:4, quote:"", marks:["critic"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} };
      window.__M.paintAnnotations(index, [anno], undefined, "blk-a1");   // a1 有批注
      window.__M.paintAnnotations(index, [],      undefined, "blk-a2");   // a2 空
      window.__M.paintAnnotations(index, [],      undefined, "blk-a3");   // a3 空
      const afterEmpties = [...CSS.highlights.keys()];
      window.__M.paintAnnotations(index, [anno], undefined, "blk-a1");   // a1 重画（重渲染）
      const afterRepaint = [...CSS.highlights.keys()];
      host.remove();
      return { afterEmpties, afterRepaint };
    }, MD);
    assert.equal(r.afterEmpties.length, 1, "空块的 paint 不能动别人的高亮");
    assert.equal(r.afterRepaint.length, 1, "重画后仍在");
  });

  test("owner 隔离：两个块同用 critic，互不覆盖（同名 Highlight 只能存一份）", async () => {
    const r = await page.evaluate((html) => {
      for (const name of [...CSS.highlights.keys()]) CSS.highlights.delete(name);
      window.__M.__resetOwnersForTest?.();
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const index = window.__M.buildIndex(host.querySelector("#root"));
      const anno = { id:"a1", messageId:"m1", blockIndex:0, start:0, end:4, quote:"", marks:["critic"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} };
      window.__M.paintAnnotations(index, [anno], undefined, "blk-x");
      window.__M.paintAnnotations(index, [anno], undefined, "blk-y");
      const keys = [...CSS.highlights.keys()].sort();
      host.remove();
      return keys;
    }, MD);
    assert.equal(r.length, 2, "两个 owner 各自一条名字（anno-critic--blk-x / --blk-y）");
  });

  test("越界批注被跳过，不抛异常", async () => {
    const r = await page.evaluate((html) => {
      for (const name of [...CSS.highlights.keys()]) CSS.highlights.delete(name);
      window.__M.__resetOwnersForTest?.();
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const index = window.__M.buildIndex(host.querySelector("#root"));
      const annos = [{ id:"bad", messageId:"m1", blockIndex:0, start:0, end:9999, quote:"", marks:["critic"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} }];
      window.__M.paintAnnotations(index, annos, undefined, "t");
      const keys = [...CSS.highlights.keys()];
      host.remove();
      return keys;
    }, MD);
    assert.deepEqual(r, [], "越界批注应被跳过（toRange 返回 null）");
  });

  test("非法 markId 被忽略（防选择器注入）", async () => {
    const r = await page.evaluate((html) => {
      for (const name of [...CSS.highlights.keys()]) CSS.highlights.delete(name);
      window.__M.__resetOwnersForTest?.();
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const index = window.__M.buildIndex(host.querySelector("#root"));
      const annos = [{ id:"x", messageId:"m1", blockIndex:0, start:0, end:4, quote:"", marks:["bad){}"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} }];
      window.__M.paintAnnotations(index, annos, undefined, "t");
      const keys = [...CSS.highlights.keys()];
      host.remove();
      return keys;
    }, MD);
    assert.deepEqual(r, [], "非法 id 不应产生任何 Highlight");
  });

  test("命中：段内命中 1 个、重叠命中 2 个、空白 0 个", async () => {
    const r = await page.evaluate((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const root = host.querySelector("#root");
      const index = window.__M.buildIndex(root);
      const annos = [
        { id:"a1", messageId:"m1", blockIndex:0, start:0, end:6,  quote:"", marks:["critic"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} },
        { id:"a2", messageId:"m1", blockIndex:0, start:4, end:10, quote:"", marks:["query"],  note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} },
      ];
      const at = (i) => {
        const rg = window.__M.toRange(index, i, i + 1);
        const rc = rg.getBoundingClientRect();
        return { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2 };
      };
      const out = {
        onlyA1: window.__M.annotationsAt(index, annos, at(1)).map(a => a.id),
        overlap: window.__M.annotationsAt(index, annos, at(5)).map(a => a.id),
        outside: window.__M.annotationsAt(index, annos, at(15)).map(a => a.id),
      };
      host.remove();
      return out;
    }, MD);
    assert.deepEqual(r.onlyA1, ["a1"]);
    assert.deepEqual(r.overlap, ["a1", "a2"]);
    assert.deepEqual(r.outside, []);
  });

  test("上色不改 DOM：加批注前后 innerHTML 完全相同", async () => {
    const r = await page.evaluate((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const root = host.querySelector("#root");
      const before = root.innerHTML;
      const index = window.__M.buildIndex(root);
      const annos = [
        { id:"a1", messageId:"m1", blockIndex:0, start:0, end:4, quote:"", marks:["critic"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} },
        { id:"a2", messageId:"m1", blockIndex:0, start:6, end:9, quote:"", marks:["query"],  note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} },
      ];
      window.__M.paintAnnotations(index, annos, undefined, "t");
      const after = root.innerHTML;
      host.remove();
      return { same: before === after, before, after };
    }, MD);
    assert.equal(r.same, true, `上色绝不能改 DOM（before=${r.before} after=${r.after}）`);
  });

  test("重渲染后旧 Range 失效，重新 paint 能恢复", async () => {
    const r = await page.evaluate((html) => {
      for (const name of [...CSS.highlights.keys()]) CSS.highlights.delete(name);
      window.__M.__resetOwnersForTest?.();
      const wrap = document.createElement("div");
      wrap.innerHTML = html;
      document.body.appendChild(wrap);
      const root = wrap.querySelector("#root");
      const read = () => {
        const hl = CSS.highlights.get("anno-critic--t");
        return hl === undefined ? [] : [...hl].map(r => r.toString());
      };
      const annos = [{ id:"a1", messageId:"m1", blockIndex:0, start:0, end:4, quote:"", marks:["critic"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} }];
      window.__M.paintAnnotations(window.__M.buildIndex(root), annos, undefined, "t");
      const ok = read();
      // 模拟整块重渲染
      root.innerHTML = root.innerHTML;
      const stale = read();
      window.__M.paintAnnotations(window.__M.buildIndex(root), annos, undefined, "t");
      const fresh = read();
      wrap.remove();
      return { ok, stale, fresh };
    }, MD);
    assert.deepEqual(r.ok, ["0123"]);
    assert.deepEqual(r.stale, [""], "重渲染后旧 Range 失效（toString 为空）——这是必须重算的原因");
    assert.deepEqual(r.fresh, ["0123"], "重算后恢复");
  });
}
