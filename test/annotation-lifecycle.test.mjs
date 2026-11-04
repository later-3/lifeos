/**
 * 批注生命周期与失败路径（Task 0003 · P3，2026-11-03 自检补齐）。
 *
 * 检视规范（`specs/review/review.md` §5）：**只测成功路径 = 没验证**。
 * 这个文件专门锁"不该发生的事"和"边界输入"。
 *
 * 依赖真实浏览器（CSS Highlight / getClientRects / 事件时序），用 esbuild 把纯逻辑编进页面。
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
  test("annotation-lifecycle: playwright-core 不可用，跳过", (t) => { t.skip(); });
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

  test("失败路径：重叠批注命中返回多个（调用方要能处理）", async () => {
    const r = await page.evaluate((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const index = window.__M.buildIndex(host.querySelector("#root"));
      const annos = [
        // 内容 26 字符，两条都必须是有效范围（越界会被 toRange 跳过的，见另一条用例）
        { id:"x", messageId:"m", blockIndex:0, start:0,  end:26, quote:"", marks:["critic"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} },
        { id:"y", messageId:"m", blockIndex:0, start:1,  end:25, quote:"", marks:["query"],  note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} },
      ];
      const rg = window.__M.toRange(index, 20, 25);
      const rc = rg.getBoundingClientRect();
      const hit = window.__M.annotationsAt(index, annos, { x: rc.left + 1, y: rc.top + rc.height/2 });
      host.remove();
      return hit.map((a) => a.id);
    }, `<div id="root">0123456789ABCDEFGHIJKLMNOP</div>`);
    assert.deepEqual(r, ["x", "y"], "完全包含的两个批注在中间区域应同时命中");
  });

  test("失败路径：marks 为空时不影响其它批注的绘制", async () => {
    const r = await page.evaluate((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const index = window.__M.buildIndex(host.querySelector("#root"));
      const annos = [
        { id:"ok",  messageId:"m", blockIndex:0, start:0, end:4, quote:"", marks:["critic"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} },
        { id:"bad", messageId:"m", blockIndex:0, start:5, end:9, quote:"", marks:[],          note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} },
      ];
      window.__M.paintAnnotations(index, annos);
      const keys = Object.fromEntries([...CSS.highlights].map(([k, v]) => [k, v.size]));
      host.remove();
      return keys;
    }, `<div id="root">0123456789</div>`);
    assert.deepEqual(r, { "anno-critic": 1 }, "marks 为空的批注跳过，不影响其它");
  });

  test("失败路径：未知 markId 不绘制但也不抛", async () => {
    const r = await page.evaluate((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const index = window.__M.buildIndex(host.querySelector("#root"));
      const annos = [
        { id:"a", messageId:"m", blockIndex:0, start:0, end:4, quote:"", marks:["nope"], note:"", ui:{mode:"open",pinned:false,dx:0,dy:0} },
      ];
      window.__M.paintAnnotations(index, annos);
      const keys = [...CSS.highlights.keys()];
      host.remove();
      return keys;
    }, `<div id="root">0123456789</div>`);
    assert.deepEqual(r, [], "未知 markId 不产生高亮");
  });

  test("边界：整段恰好等于扁平串（start=0, end=total）", async () => {
    const r = await page.evaluate((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const index = window.__M.buildIndex(host.querySelector("#root"));
      const rg = window.__M.toRange(index, 0, index.total);
      const out = { text: rg === null ? null : rg.toString(), total: index.total };
      host.remove();
      return out;
    }, `<div id="root">全部文字</div>`);
    assert.equal(r.text, "全部文字");
    assert.equal(r.total, 4);
  });

  test("边界：UTF-16 代理对（emoji）偏移不被拆开", async () => {
    const r = await page.evaluate((html) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.appendChild(host);
      const index = window.__M.buildIndex(host.querySelector("#root"));
      const text = index.text;
      const at = text.indexOf("😀");
      // 取整个 emoji（JS 里长度是 2）
      const rg = window.__M.toRange(index, at, at + 2);
      const out = { text: rg === null ? null : rg.toString(), len: text.length };
      host.remove();
      return out;
    }, `<div id="root">前😀后</div>`);
    assert.equal(r.text, "😀", "按偏移取 emoji 必须得到完整的代理对");
    assert.equal(r.len, 4, "😀 在 JS 字符串里长度是 2");
  });

/* ============================================================
   `<br>` 处理（2026-11-03 对标 hypothesis/client 后补）
   ------------------------------------------------------------
   参考：hypothesis/client `src/annotator/anchoring/rendered-text.ts`
        的 `substituteBrs()` —— 把 `<br>` 换成一个空格，让 quote 反映屏幕所见。

   我们沿用同一口径但保留换行信息：`<br>` → `\n`。
   没有这条，`textContent` 会把 "第一行<br>第二行" 读成 "第一行第二行"，
   用户跨行圈选时存下来的 quote 就丢掉了换行。
   ============================================================ */

test("<br> 在扁平串里是一个 \\n（与屏幕所见一致）", async () => {
  const r = await page.evaluate(() => {
    const host = document.createElement("div");
    host.innerHTML = `<div id="root">第一行<br>第二行</div>`;
    document.body.appendChild(host);
    const index = window.__M.buildIndex(host.querySelector("#root"));
    const out = {
      flat: index.text,
      rawTextContent: host.querySelector("#root").textContent,
      total: index.total,
    };
    host.remove();
    return out;
  });
  assert.equal(r.flat, "第一行\n第二行", "<br> 必须表现为换行");
  assert.equal(r.rawTextContent, "第一行第二行", "textContent 里 <br> 不贡献字符（这是我们必须自己补的原因）");
  assert.equal(r.total, 7, "5 + 1(换行) + 1 = 7");
});

test("<br> 的偏移能往返：选中跨 <br> 的片段", async () => {
  const r = await page.evaluate(() => {
    const host = document.createElement("div");
    host.innerHTML = `<div id="root">第一行<br>第二行</div>`;
    document.body.appendChild(host);
    const index = window.__M.buildIndex(host.querySelector("#root"));
    const quote = window.__M.quoteOf(index, 1, 6);     // "一行\n第二"
    const rg = window.__M.toRange(index, 1, 6);
    const out = {
      quote,
      rangeText: rg === null ? null : rg.toString(),
      offsets: rg === null ? null : window.__M.toOffset(index, rg),
    };
    host.remove();
    return out;
  });
  assert.equal(r.quote, "一行\n第二");
  assert.ok(r.rangeText !== null, "跨 <br> 也必須能建 Range");
  // Range 的 toString 不含合成换行（浏览器不知道我们补的字符），
  // 但边界必须精确落回原偏移 —— 这是"能用"的判据
  assert.deepEqual(r.offsets, { start: 1, end: 6 }, "往返后偏移必须完全一致");
});

test("边界：只有 <br> 没有文字时 toRange 返回 null（不抛）", async () => {
  const r = await page.evaluate(() => {
    const host = document.createElement("div");
    host.innerHTML = `<div id="root"><br><br></div>`;
    document.body.appendChild(host);
    const index = window.__M.buildIndex(host.querySelector("#root"));
    const out = {
      total: index.total,
      range: window.__M.toRange(index, 0, 1) === null ? "null" : "range",
    };
    host.remove();
    return out;
  });
  assert.equal(r.total, 2, "两个 <br> = 两个换行字符");
  assert.equal(r.range, "null", "没有真实文本节点时无法建 Range，应返回 null");
});
}
