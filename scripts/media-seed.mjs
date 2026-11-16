#!/usr/bin/env node
// 媒体库种子（Task 0016 · P1）：把外部素材收入 `~/.lifeos/media/` 并登记。
//
// 为什么要有这个脚本（而不是让 Agent 手工下载丢进目录）：
// - 素材必须有**出处与许可**才允许入库（`src/media.ts` 的 `source` / `license` 字段）；
// - 同一份素材重复收入必须幂等（按 id 覆盖），否则目录会越滚越大；
// - 新部署要能一条命令拿到"够用的一套图"，不能靠人去点网页。
//
// 用法：
//   node scripts/media-seed.mjs --pack=dicebear-avatars [--limit=40]
//   node scripts/media-seed.mjs --pack=bundled-emoji   [--limit=60]
//   node scripts/media-seed.mjs --list                 # 看已有包与统计
//
// 每个包声明的来源与许可都在 `PACKS` 里，**不写死 URL 里猜许可**：
// - dicebear 各风格许可不同（实测：shapes/lorelei/thumbs/pixel-art/initials = CC0 1.0，
//   bottts/adventurer/avataaars/micah/personas = CC BY 4.0），这里只启用 CC0 那批，
//   CC BY 的要用就必须署名，等有人愿意处理署名再说；
// - 表情用 Twemoji（图形 CC BY 4.0 / 代码 MIT）：**这是需要署名的**，所以登记 license 字段写清，
//   并在 UI 的关于页/文档里给出署名（未做之前不许把 pack 标成"干净可用"）。

import { mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
// 目录说明文件与目录骨架只源自 `src/media.ts`（单源，脚本不另写一份文字）
import { ensureMediaDir } from "../src/media.ts";

const HOME = process.env.LIFEOS_HOME ?? join(homedir(), ".lifeos");
const MEDIA = join(HOME, "media");
const CATALOG = join(MEDIA, "catalog.json");

const args = Object.fromEntries(process.argv.slice(2)
  .map((arg) => arg.replace(/^--/, "").split("="))
  .map(([key, value]) => [key, value ?? "true"]));

const PACKS = {
  /** DiceBear，只取 CC0 1.0 的四种风格（实测每张 2.7–7KB，512px png）。 */
  "dicebear-avatars": {
    kind: "avatar",
    license: "CC0-1.0",
    source: "https://api.dicebear.com/9.x/<style>/png?seed=<seed> (DiceBear 9.x, 各风格许可见 https://www.dicebear.com/styles/)",
    // 不含 `initials`：那一档渲染成首字母色块（实测出来是"ST"两个字母），当头像不如造型图。
    styles: ["shapes", "lorelei", "thumbs", "pixel-art", "notionists", "open-peeps"],
    // 语义关键词：中文 + 英文都给，Agent 用中文也能搜到
    seeds: [
      ["calm", ["平静", "calm", "steady"]],
      ["travel", ["旅行", "旅游", "出行", "travel", "trip", "journey"]],
      ["guide", ["向导", "指引", "guide", "navigate"]],
      ["home", ["家", "日常", "home", "everyday"]],
      ["money", ["省钱", "比价", "budget", "price"]],
      ["bright", ["明亮", "bright", "cheerful"]],
      ["curious", ["好奇", "curious"]],
      ["precise", ["严谨", "precise", "careful"]],
      ["kind", ["温和", "kind", "gentle"]],
      ["sharp", ["锐利", "sharp", "clear"]],
      ["warm", ["温暖", "warm"]],
      ["quiet", ["安静", "quiet", "calm"]],
      ["bold", ["大胆", "bold"]],
      ["tidy", ["整齐", "tidy", "neat"]],
      ["steady", ["稳重", "steady"]],
      ["playful", ["活泼", "playful"]],
      ["wise", ["智慧", "wise"]],
      ["patient", ["耐心", "patient"]],
      ["focused", ["专注", "focused"]],
      ["friendly", ["友好", "friendly"]],
    ],
  },
  /** Twemoji 72px（图形 CC BY 4.0，需要署名）；id 直接用官方 shortcode，正文里写 `:shortcode:` 就能发。 */
  "bundled-emoji": {
    kind: "emoji",
    license: "CC-BY-4.0",
    source: "https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/<codepoint>.png (Twemoji, graphics CC-BY 4.0)",
    items: [
      ["1f60a", "blush", ["微笑", "开心", "害羞", "smile", "happy", "blush"]],
      ["1f604", "smile", ["大笑", "开心", "smile", "happy"]],
      ["1f602", "joy", ["笑死", "大笑", "laugh", "joy"]],
      ["1f44d", "thumbsup", ["赞", "好的", "同意", "ok", "yes"]],
      ["1f64f", "pray", ["感谢", "拜托", "thanks", "please"]],
      ["1f389", "tada", ["庆祝", "完成", "celebrate", "done"]],
      ["1f680", "rocket", ["发布", "上线", "launch", "ship"]],
      ["1f525", "fire", ["厉害", "火", "great", "hot"]],
      ["1f4a1", "bulb", ["想法", "点子", "idea"]],
      ["2705", "white_check_mark", ["完成", "通过", "done", "pass"]],
      ["274c", "x", ["失败", "不行", "fail", "no"]],
      ["26a0", "warning", ["注意", "警告", "warning", "caution"]],
      ["1f914", "thinking", ["思考", "想想", "thinking", "hmm"]],
      ["1f440", "eyes", ["看", "注意这里", "look", "review"]],
      ["1f4dd", "memo", ["记录", "笔记", "note"]],
      ["1f6e0", "hammer_and_wrench", ["修复", "工具", "fix", "tools"]],
      ["1f41b", "bug", ["缺陷", "bug", "issue"]],
      ["1f9ea", "test_tube", ["测试", "实验", "test", "experiment"]],
      ["1f4da", "books", ["文档", "学习", "docs", "learn"]],
      ["1f3af", "dart", ["目标", "命中", "goal", "target"]],
      ["1f9ed", "compass", ["方向", "导航", "direction", "navigate"]],
      ["1f5fa", "world_map", ["地图", "行程", "map", "travel"]],
      ["2708", "airplane", ["飞机", "出行", "flight", "travel"]],
      ["1f3d6", "beach_with_umbrella", ["海边", "度假", "beach", "holiday"]],
      ["1f3d4", "snow_capped_mountain", ["山", "徒步", "mountain", "hike"]],
      ["1f3e8", "hotel", ["酒店", "住宿", "hotel", "stay"]],
      ["1f37d", "fork_and_knife_with_plate", ["吃饭", "美食", "food", "dining"]],
      ["2615", "coffee", ["咖啡", "休息", "coffee", "break"]],
      ["1f6cc", "sleeping_accommodation", ["休息", "困了", "rest", "sleepy"]],
      ["1f44b", "wave", ["你好", "再见", "hello", "bye"]],
    ],
  },
};

async function readCatalog() {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(CATALOG, "utf8").catch(() => undefined);
  if (text === undefined) return { schemaVersion: 1, entries: [] };
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.entries) ? parsed : { schemaVersion: 1, entries: [] };
  } catch {
    return { schemaVersion: 1, entries: [] };
  }
}

async function sniff(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return { ext: "webp", mime: "image/webp" };
  return undefined;
}

async function download(url) {
  const response = await fetch(url, { headers: { "user-agent": "lifeos-media-seed/1" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function put({ id, kind, pack, buffer, keywords, source, license }) {
  const sniffed = await sniff(buffer);
  if (sniffed === undefined) return { skipped: `不是认得的图片：${id}` };
  const file = `${kind}/${id}.${sniffed.ext}`;
  await mkdir(join(MEDIA, kind), { recursive: true, mode: 0o700 });
  const target = join(MEDIA, file);
  await writeFile(`${target}.tmp`, buffer, { mode: 0o600 });
  await rename(`${target}.tmp`, target);
  return {
    entry: {
      id, kind, pack, file, mime: sniffed.mime, bytes: buffer.length,
      keywords, source, license, addedAt: new Date().toISOString(),
    },
  };
}

await ensureMediaDir(HOME);

const packName = args.pack;
if (args.list === "true" || packName === undefined) {
  const catalog = await readCatalog();
  const counts = new Map();
  for (const entry of catalog.entries) counts.set(`${entry.kind}/${entry.pack}`, (counts.get(`${entry.kind}/${entry.pack}`) ?? 0) + 1);
  console.log(`媒体库：${CATALOG}`);
  console.log(`总条目：${catalog.entries.length}`);
  for (const [key, count] of [...counts].sort()) console.log(`  ${key}: ${count}`);
  console.log(`\n可用包：${Object.keys(PACKS).join(", ")}`);
  process.exit(0);
}

const pack = PACKS[packName];
if (pack === undefined) {
  console.error(`未知的包：${packName}（可用：${Object.keys(PACKS).join(", ")}）`);
  process.exit(2);
}

const limit = args.limit !== undefined ? Number.parseInt(args.limit, 10) : 1000;
const catalog = await readCatalog();
const byId = new Map(catalog.entries.map((entry) => [entry.id, entry]));
const collected = [];

if (packName === "dicebear-avatars") {
  let added = 0;
  outer:
  for (const style of pack.styles) {
    for (const [seed, keywords] of pack.seeds) {
      if (added >= limit) break outer;
      const id = `${style}-${seed}`;
      const url = `https://api.dicebear.com/9.x/${style}/png?seed=${encodeURIComponent(seed)}&size=512`;
      try {
        const buffer = await download(url);
        const result = await put({ id, kind: pack.kind, pack: packName, buffer, keywords, source: pack.source, license: pack.license });
        if (result.entry !== undefined) { collected.push(result.entry); added += 1; }
      } catch (error) {
        console.error(`  跳过 ${id}：${error.message}`);
      }
    }
  }
  console.log(`dicebear-avatars：收入 ${added} 张`);
}

if (packName === "bundled-emoji") {
  let added = 0;
  for (const [codepoint, shortcode, keywords] of pack.items) {
    if (added >= limit) break;
    const id = shortcode;
    const url = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${codepoint}.png`;
    try {
      const buffer = await download(url);
      const result = await put({
        id, kind: pack.kind, pack: packName, buffer,
        keywords: [shortcode, ...keywords], source: pack.source, license: pack.license,
      });
      if (result.entry !== undefined) { collected.push(result.entry); added += 1; }
    } catch (error) {
      console.error(`  跳过 ${id}：${error.message}`);
    }
  }
  console.log(`bundled-emoji：收入 ${added} 个`);
}

for (const entry of collected) byId.set(entry.id, entry);
const entries = [...byId.values()].sort((a, b) =>
  a.kind !== b.kind ? a.kind.localeCompare(b.kind)
  : a.pack !== b.pack ? a.pack.localeCompare(b.pack)
  : a.id.localeCompare(b.id));
await ensureMediaDir(HOME);
await writeFile(`${CATALOG}.tmp`, JSON.stringify({ schemaVersion: 1, entries }, null, 2) + "\n", { mode: 0o600 });
await rename(`${CATALOG}.tmp`, CATALOG);
console.log(`catalog 写入 ${entries.length} 条 → ${CATALOG}`);
