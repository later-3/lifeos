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
      window.__M.paintAnnotations(index, annos);
      const out = {};
      for (const [name, hl] of CSS.highlights) {
        out[name] = hl.size;
      }
      host.remove();
      return out;
    }, MD);
    assert.deepEqual(r, { "anno-critic": 2, "anno-query": 1 }, "批评应装 2 个 Range，疑问 1 个");
  });

  test("清空：没有批注的标记不留空 Highlight", async () => {
    const r = await page.evaluate((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const index = window.__M.buildIndex(host.querySelector("#root"));
      const annos = [{ id:"a1", messageId:"m1", blockIndex:0, start:0, end:4, quote:"", marks:["critic"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} }];
      window.__M.paintAnnotations(index, annos);
      const before = [...CSS.highlights.keys()];
      window.__M.paintAnnotations(index, []);
      const after = [...CSS.highlights.keys()];
      host.remove();
      return { before, after };
    }, MD);
    assert.deepEqual(r.before, ["anno-critic"]);
    assert.deepEqual(r.after, [], "没有批注时所有 Highlight 必须被清掉（不能留空壳）");
  });

  test("越界批注被跳过，不抛异常", async () => {
    const r = await page.evaluate((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const index = window.__M.buildIndex(host.querySelector("#root"));
      const annos = [{ id:"bad", messageId:"m1", blockIndex:0, start:0, end:9999, quote:"", marks:["critic"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} }];
      window.__M.paintAnnotations(index, annos);
      const keys = [...CSS.highlights.keys()];
      host.remove();
      return keys;
    }, MD);
    assert.deepEqual(r, [], "越界批注应被跳过（toRange 返回 null）");
  });

  test("非法 markId 被忽略（防选择器注入）", async () => {
    const r = await page.evaluate((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const index = window.__M.buildIndex(host.querySelector("#root"));
      const annos = [{ id:"x", messageId:"m1", blockIndex:0, start:0, end:4, quote:"", marks:["bad){}"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} }];
      window.__M.paintAnnotations(index, annos);
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
      window.__M.paintAnnotations(index, annos);
      const after = root.innerHTML;
      host.remove();
      return { same: before === after, before, after };
    }, MD);
    assert.equal(r.same, true, `上色绝不能改 DOM（before=${r.before} after=${r.after}）`);
  });

  test("重渲染后旧 Range 失效，重新 paint 能恢复", async () => {
    const r = await page.evaluate((html) => {
      const wrap = document.createElement("div");
      wrap.innerHTML = html;
      document.body.appendChild(wrap);
      const root = wrap.querySelector("#root");
      const read = () => {
        const hl = CSS.highlights.get("anno-critic");
        return hl === undefined ? [] : [...hl].map(r => r.toString());
      };
      const annos = [{ id:"a1", messageId:"m1", blockIndex:0, start:0, end:4, quote:"", marks:["critic"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} }];
      window.__M.paintAnnotations(window.__M.buildIndex(root), annos);
      const ok = read();
      // 模拟整块重渲染
      root.innerHTML = root.innerHTML;
      const stale = read();
      window.__M.paintAnnotations(window.__M.buildIndex(root), annos);
      const fresh = read();
      wrap.remove();
      return { ok, stale, fresh };
    }, MD);
    assert.deepEqual(r.ok, ["0123"]);
    assert.deepEqual(r.stale, [""], "重渲染后旧 Range 失效（toString 为空）——这是必须重算的原因");
    assert.deepEqual(r.fresh, ["0123"], "重算后恢复");
  });
}
