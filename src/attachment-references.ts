// 会话引用过的图片路径集合（Task 0016 · P3 修正）。
//
// ## 为什么需要
//
// 引用化之后，前端按 `/api/attachment?path=…` 取图。但取回端点必须判"这条路径允不允许被读"。
// 只按 `readRoots()`（家目录 + 文件浏览器注册根）判会**误杀一大片**：
//
// 实测（用户真实家目录，1702 条消息的会话）：73 张工具图里 **0 张**在已注册根内 ——
// 它们来自 `/tmp/map3d.png`、绑定项目里的 `data/s2_recent.jpg`，
// 都是工具 `read` 读过的真实文件。结果界面上一堆碎图（403）。
//
// 判据不是"放宽成任意路径"（那等于给任意文件开只读通道），而是
// **"这条路径确实被某个会话的引用行提到过"** —— 数据本来就在用户自己的会话里。
//
// ## 为什么收集是"全局"的
//
// 会话可能被归档、被封进别的 Agent；按单个会话收集会让"换个 Agent 打开同一张图"失效。
// 而扫描成本很低（按 mtime 缓存，见下方 `REFERENCE_TTL_MS`），且结果只用于**放行判断**。
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseImageRefs } from "./image-note.ts";

/** 缓存有效期：会话不会在几秒内大量新增引用行；5 分钟足够且能覆盖"刚截了图"的场景。 */
const REFERENCE_TTL_MS = 5 * 60 * 1000;

type Snapshot = { at: number; paths: Set<string>; signature: string };
let snapshot: Snapshot | undefined;

/** 递归列出所有会话 JSONL（`agents/<id>/projects/<pid>/sessions/*.jsonl`）。 */
async function listSessionFiles(home: string): Promise<string[]> {
  const out: string[] = [];
  const agentsDir = join(home, "agents");
  const agents = await readdir(agentsDir, { withFileTypes: true }).catch(() => []);
  for (const agent of agents) {
    if (!agent.isDirectory()) continue;
    const projectsDir = join(agentsDir, agent.name, "projects");
    const projects = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const sessionsDir = join(projectsDir, project.name, "sessions");
      const files = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (file.isFile() && file.name.endsWith(".jsonl")) out.push(join(sessionsDir, file.name));
      }
    }
  }
  return out;
}

/**
 * 扫描所有会话，收集被引用的图片路径。
 *
 * `signature` = 文件数 + 最新 mtime：变了就重扫（新建会话/追加消息都会改它）。
 * 这条让"刚截的图马上能看到"不需要等 5 分钟，也不会每读一张图就全扫一遍。
 */
export async function referencedImagePaths(home: string): Promise<ReadonlySet<string>> {
  const files = await listSessionFiles(home);
  let newest = 0;
  for (const file of files) {
    const info = await stat(file).catch(() => undefined);
    if (info !== undefined && info.mtimeMs > newest) newest = info.mtimeMs;
  }
  const signature = `${files.length}:${Math.round(newest)}`;
  if (snapshot !== undefined && snapshot.signature === signature && Date.now() - snapshot.at < REFERENCE_TTL_MS) {
    return snapshot.paths;
  }

  const paths = new Set<string>();
  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (text === "") continue;
    for (const line of text.split("\n")) {
      // 只扫"像引用行"的行：JSONL 一行可能很长，先做一次廉价包含判断再解析
      if (!line.includes("图片 ") && !line.includes("screenshot ")) continue;
      let entry: unknown;
      try { entry = JSON.parse(line); } catch { continue; }
      const message = (entry as { message?: { content?: unknown } }).message;
      const content = message?.content;
      const texts: string[] = [];
      if (typeof content === "string") texts.push(content);
      else if (Array.isArray(content)) {
        for (const block of content) {
          const part = block as { type?: unknown; text?: unknown } | null;
          if (part !== null && part.type === "text" && typeof part.text === "string") texts.push(part.text);
        }
      }
      for (const text of texts) {
        for (const ref of parseImageRefs(text)) paths.add(resolve(ref));
      }
    }
  }
  snapshot = { at: Date.now(), paths, signature };
  return paths;
}

/** 仅测试/热重载用：清空缓存。 */
export function clearReferenceCache(): void {
  snapshot = undefined;
}
