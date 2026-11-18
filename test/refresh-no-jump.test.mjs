/**
 * 刷新零跳变（Task 0015 · S5 门禁）——三件事各一条断言。
 *
 * ① 颜色：boot 脚本首帧写主题色（含外部主题包）；
 * ② 内容：agents/groups 缓存优先渲染（不是先白屏再出现）；
 * ③ 布局：骨架尺寸对齐真实行高 + 字体行高锁定（换字体不改行高）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HTML = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../frontend/src/index.css", import.meta.url), "utf8");
const APP = readFileSync(new URL("../frontend/src/App.tsx", import.meta.url), "utf8");
const SK = readFileSync(new URL("../frontend/src/design/skeleton.tsx", import.meta.url), "utf8");

test("① 颜色：boot 脚本读激活主题包并写首帧", () => {
  assert.ok(/lifeos\.themePackActive/.test(HTML), "boot 脚本没读激活主题包");
  assert.ok(/root\.style\.setProperty\(varName, modeVars\[varName\]\)/.test(HTML), "boot 脚本没写包的颜色");
  assert.ok(/theme-color/.test(HTML), "没同步 theme-color meta");
});

test("② 内容：agents 与 groups 都缓存优先", () => {
  assert.ok(/localStorage\.getItem\("lifeos\.agents"\)/.test(APP), "agents 没读缓存");
  assert.ok(/readGroupsCache/.test(APP), "groups 没读缓存");
  /*
   * "先画缓存、再 await 取数"的顺序（Task 0019 改写）。
   *
   * 改前锁的是 `if (cachedGroups !== undefined) { setGroups(cachedGroups); setLoaded(true); }` 这一整行字面量，
   * 而 `loaded` 已按 Task 0019 拆成 `agentsReady`/`groupsReady`（前者表示"服务端已确认"，
   * 缓存不再冒充它）——字面量随之消失。**但被保护的行为没变**：缓存必须在 fetch 之前落到界面上。
   * 所以断言改成"顺序"，不再绑某个变量名（`specs/code/testing` 2.5：断言行为，不断言实现细节）。
   */
  const cachedAt = APP.indexOf("if (cachedGroups !== undefined) setGroups(cachedGroups);");
  const fetchAt = APP.indexOf("const fetched = await fetchGroups", cachedAt);
  assert.ok(cachedAt > 0, "缓存渲染那一步不见了");
  assert.ok(fetchAt > cachedAt, "缓存渲染不在 fetch 之前（会先白屏）");
});

test("③ 布局：骨架行高 = Row 行高；字体行高锁定", () => {
  assert.ok(/h-11/.test(SK) && /sm:h-8/.test(SK), "骨架行高没对齐 Row");
  assert.ok(/line-height: 1\.5/.test(CSS), "字体没锁定行高（换字体整页会跳）");
});

test("活性验证：删掉缓存优先那一行，顺序断言必须红", () => {
  const broken = APP.replace("if (cachedGroups !== undefined) setGroups(cachedGroups);", "");
  assert.equal(broken.indexOf("if (cachedGroups !== undefined)"), -1, "探测规则失效");
  // 顺序断言本身也要能红：没有缓存渲染那一步时，cachedAt 取不到 → fetchAt 不可能大于它
  const cachedAt = broken.indexOf("if (cachedGroups !== undefined) setGroups(cachedGroups);");
  assert.ok(!(cachedAt > 0), "活性验证失败：删掉之后仍然判绿");
});
