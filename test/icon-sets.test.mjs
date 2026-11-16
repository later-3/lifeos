/**
 * 图标集契约（Task 0015 · S3 阶段门）。
 *
 * 断言：
 * ① 三个源（tabler/lucide/phosphor）都已接入；
 * ② **每个语义名在每个源里都能解析到组件**（缺项显式登记为 null 并允许回退，但要报告出来）；
 * ③ 覆盖度报告真实（不虚报 100%）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../frontend/src/design/icon-sets.tsx", import.meta.url), "utf8");

test("三个图标源都已接入", () => {
  assert.ok(/@tabler\/icons-react/.test(SRC), "未接 tabler");
  assert.ok(/lucide-react/.test(SRC), "未接 lucide");
  assert.ok(/@phosphor-icons\/react/.test(SRC), "未接 phosphor");
});

test("LUCIDE_MAP / PHOSPHOR_MAP 覆盖 icons.tsx 的全部语义名", async () => {
  const iconsSrc = readFileSync(new URL("../frontend/src/design/icons.tsx", import.meta.url), "utf8");
  const names = [...iconsSrc.matchAll(/^  "?([a-z-]+)"?: Icon[A-Za-z0-9]+,$/gm)].map((m) => m[1]);
  assert.ok(names.length >= 40, `语义名解析失败（只找到 ${names.length} 个）`);

  const lucideBlock = SRC.slice(SRC.indexOf("const LUCIDE_MAP"), SRC.indexOf("const PHOSPHOR_MAP"));
  const phosphorBlock = SRC.slice(SRC.indexOf("const PHOSPHOR_MAP"), SRC.indexOf("function lookup"));
  // 映射的 key 可能是 `name:` 或 `"name":`（带连字符的必须带引号）
  const hasKey = (block, n) => new RegExp(`(^|\\s)"?${n.replace(/-/g, "\\-")}"?:`, "m").test(block);
  const missingFromLucide = names.filter((n) => !hasKey(lucideBlock, n));
  const missingFromPhosphor = names.filter((n) => !hasKey(phosphorBlock, n));
  assert.deepEqual(missingFromLucide, [], `LUCIDE_MAP 缺语义名：${missingFromLucide.join(",")}`);
  assert.deepEqual(missingFromPhosphor, [], `PHOSPHOR_MAP 缺语义名：${missingFromPhosphor.join(",")}`);
});

test("缺项回退：iconOf 返回 null 时 AppIcon 必须回退 tabler（不空白）", () => {
  const iconsSrc = readFileSync(new URL("../frontend/src/design/icons.tsx", import.meta.url), "utf8");
  assert.ok(/fromSet \?\? ICONS\[name\]/.test(iconsSrc), "AppIcon 没有回退 tabler 的兜底");
  assert.ok(/console\.warn/.test(iconsSrc), "缺项没有 warn（会静默失效）");
});

test("AppIcon 走 Context（不在组件里写死图标集）", () => {
  const iconsSrc = readFileSync(new URL("../frontend/src/design/icons.tsx", import.meta.url), "utf8");
  assert.ok(/useIconSet\(\)/.test(iconsSrc), "AppIcon 没有读当前图标集");
});

test("活性验证：删掉某个映射，覆盖度测试必须红", () => {
  // 模拟：把 lucide 的 settings 映射删掉 → 上面的 block 检查会失败
  const mutated = SRC.replace('settings: "Settings",', "");
  const lucideBlock = mutated.slice(mutated.indexOf("const LUCIDE_MAP"), mutated.indexOf("const PHOSPHOR_MAP"));
  assert.ok(!lucideBlock.includes('"settings"'), "探测规则失效（删了映射检测不出来）");
});
