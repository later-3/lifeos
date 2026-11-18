// 词级 diff 的**执行层**：唯一 import `diff` 库的地方（便于替换/按需加载）。
//
// 为什么单独一层（与 `review-highlight.ts` / `review-highlight-prism.ts` 同一分法）：
//  - `review-word-diff.ts`：纯判定与拆分（可穷举、不依赖库）；
//  - 本文件：调库，且**按需加载**——`diff` v9 是 ESM、615KB 源码（打包后约 30-40KB gzip），
//    只有"并排/单列里存在成对的增删行"时才需要它。静态 import 会让所有用户付这份钱。
//
// 参考：difit `src/client/utils/wordLevelDiff.ts:1` 是**静态** `import { diffWords, diffWordsWithSpace } from 'diff'`；
// 我们用 `import()`（同 G8 的理由与实测方法）。

import { shouldComputeWordDiff, splitChanges, worthHighlighting, type WordDiff } from "./review-word-diff.ts";

type DiffLib = {
  diffWordsWithSpace: (oldText: string, newText: string) => Array<{ value: string; added?: boolean; removed?: boolean }>;
};

let lib: DiffLib | undefined;
let loading: Promise<DiffLib | undefined> | undefined;

/** 确保 `diff` 库已加载（幂等、并发安全）。失败返回 undefined（词级高亮是增强，不该让面板挂）。 */
export async function ensureWordDiffLib(): Promise<DiffLib | undefined> {
  if (lib !== undefined) return lib;
  if (loading !== undefined) return loading;
  loading = import("diff")
    .then((module) => {
      lib = { diffWordsWithSpace: module.diffWordsWithSpace as DiffLib["diffWordsWithSpace"] };
      return lib;
    })
    .catch(() => undefined)
    .finally(() => { loading = undefined; });
  return loading;
}

/** 库是否已就绪（同步判定；渲染期用）。 */
export function wordDiffReady(): boolean {
  return lib !== undefined;
}

/**
 * 计算两行的词级 diff。
 *
 * @returns `null` = 不做词级（不值得 / 库未加载 / 计算异常）——调用方整行标色即可，**不抛错**。
 */
export function wordDiffOf(oldContent: string, newContent: string): WordDiff | null {
  if (!shouldComputeWordDiff(oldContent, newContent)) return null;
  if (lib === undefined) return null;
  try {
    const diff = splitChanges(lib.diffWordsWithSpace(oldContent, newContent));
    // 改动占比过高就放弃词级（difit `wordLevelDiff.ts:56-72` 的相似度门槛，这里用同一份结果判断）
    return worthHighlighting(diff) ? diff : null;
  } catch {
    return null;
  }
}
