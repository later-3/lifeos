// 原子写文本文件（tmp + rename）：写到一半崩溃不会留下半截文件。
// 由 server（身份/配置）与 session-views（未读状态）共用，避免两份实现漂移。
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeTextAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}
