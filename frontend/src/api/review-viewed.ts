// G10「已看」（Viewed）+ 文件树的三态：**纯函数**（不含 DOM、不碰网络）。
//
// 参考（2026-11-08 逐个读源码）：
//  - **difit** `src/client/hooks/useViewedFiles.ts`：每条记录 `{ filePath, viewedAt, diffContentHash }`，
//    并且**用内容哈希判定「看过之后又变了」**（`:143-160` 的 `changedSinceViewedFiles`）。
//    关键点：**只按文件路径记"看过"是错的**——文件改了之后还是"看过"，用户会漏看新改动。
//  - **difit** `src/client/utils/diffUtils.ts:37-50` `getDiffContentForHashing`：
//    哈希输入 = `path + status + 每个 chunk 的 header 与行（type:content）`，
//    刻意**不含行号**（行号会因上下文折展而漂移，不该导致"没看过"）。
//  - **difit** `src/client/utils/autoViewedPatterns.ts`：支持按模式自动标"已看"（他们给 generated 文件用）。
//  - **VS Code** 的多文件 diff / GitHub Files changed：都有「Viewed」复选框 + 顶部进度（我们取同一心智）。
//
// 我们的两处差异（有意的）：
//  1. **记录存服务端**（`src/review-viewed.ts`），不存 localStorage——换设备/换浏览器仍保留进度
//     （difit 只存 localStorage，这是它做不到的；与评论同一取舍，D22 精神）。
//  2. **哈希用同步 FNV-1a**，不用 `crypto.subtle.digest`（异步）：哈希只与"自己上一次"比较，
//     不需要密码学性质；同步实现能在渲染期直接算，也能在单测里穷举（difit 那版是 async，测试要 await）。
//
// 纪律：本文件只有纯函数。

/** 一条「已看」记录（与后端 `ViewedRecord` 同形状）。 */
export type ViewedRecord = {
  /** 相对路径（与 diff 里的 `path` 一致） */
  path: string;
  /** ISO 时间 */
  viewedAt: string;
  /** 标记时的 diff 内容哈希（见 `diffContentHash`） */
  hash: string;
};

/** 一个文件"看没看过"的三态。 */
export type ViewedStatus =
  /** 没看过 */
  | "unviewed"
  /** 看过，且内容与看的时候一致 */
  | "viewed"
  /** 看过，但内容已经变了（difit 的 `changedSinceViewed`） */
  | "changed";

export type HashableFile = {
  path: string;
  status: string;
  hunks: readonly { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: readonly { type: string; text: string }[] }[];
};

/**
 * diff 内容哈希（同步 FNV-1a 32 位，16 进制 8 位）。
 *
 * 输入与 difit 的 `getDiffContentForHashing` 同构：**path + status + 每个 hunk 的行 `type:text`**。
 * 有意**不含行号**：上下文展开/折叠会让行号漂移，不应该让"看过"失效（difit 同判）。
 */
export function diffContentHash(file: HashableFile): string {
  let hash = 0x811c9dc5;
  const feed = (text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      // FNV prime 16777619，用 Math.imul 保 32 位
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  feed(file.path);
  feed("\u0000");
  feed(file.status);
  for (const hunk of file.hunks) {
    feed("\u0001");
    for (const line of hunk.lines) {
      feed(line.type);
      feed(":");
      feed(line.text);
      feed("\n");
    }
  }
  return hash.toString(16).padStart(8, "0");
}

/** 某个文件当前的三态（`record` 为 undefined = 没看过）。 */
export function viewedStatusOf(record: ViewedRecord | undefined, currentHash: string): ViewedStatus {
  if (record === undefined) return "unviewed";
  return record.hash === currentHash ? "viewed" : "changed";
}

/** 一个文件的已看状态（含它当前的哈希，供 UI 直接拿去标记）。 */
export type FileViewedState = {
  path: string;
  hash: string;
  status: ViewedStatus;
};

/** 计算全部文件的状态（按传入顺序，保持与 diff 列表一致）。 */
export function viewedStatesOf(
  files: readonly HashableFile[],
  records: readonly ViewedRecord[],
): FileViewedState[] {
  const byPath = new Map(records.map((record) => [record.path, record]));
  return files.map((file) => {
    const hash = diffContentHash(file);
    return { path: file.path, hash, status: viewedStatusOf(byPath.get(file.path), hash) };
  });
}

export type ViewedSummary = {
  /** 看过且内容未变的文件数 */
  viewed: number;
  /** 看过但内容变了的文件数 */
  changed: number;
  /** 全部文件数 */
  total: number;
  /** 进度百分比（0–100，四舍五入；total=0 时为 0） */
  percent: number;
};

/**
 * 顶部进度。
 *
 * 口径（与 GitHub Files changed 的 "N files viewed" 一致）：**只有 `viewed` 计入进度**；
 * `changed` 不算（内容变了就等于需要重看）——这是"进度条不能骗人"的底线。
 */
export function viewedSummaryOf(states: readonly FileViewedState[]): ViewedSummary {
  const total = states.length;
  const viewed = states.filter((state) => state.status === "viewed").length;
  const changed = states.filter((state) => state.status === "changed").length;
  return { viewed, changed, total, percent: total === 0 ? 0 : Math.round((viewed / total) * 100) };
}

// ── 文件树（G9）与目录三态 ───────────────────────────────────────────────────

export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[]; state: DirViewedState; total: number; viewed: number }
  | { kind: "file"; name: string; path: string; status: ViewedStatus };

/** 目录的"看没看完"三态（GitHub/VS Code 的复选框 indeterminate）。 */
export type DirViewedState = "all" | "none" | "some";

/**
 * 用路径分段建树（目录在前、同类按名字排序）。
 *
 * 为什么按 `/` 分段而不是让后端给树：后端给的是扁平文件列表（`ReviewFileDiff[]`），
 * 树是**呈现层**的组织方式；放前端一段纯函数里，面板换布局也不需要改接口（difit/opencode 同判）。
 */
export function buildFileTree(states: readonly FileViewedState[]): TreeNode[] {
  type DirBuilder = { name: string; path: string; dirs: Map<string, DirBuilder>; files: TreeNode[] };
  const root: DirBuilder = { name: "", path: "", dirs: new Map(), files: [] };

  for (const state of states) {
    const segments = state.path.split("/").filter((segment) => segment !== "");
    const fileName = segments.pop() ?? state.path;
    let cursor = root;
    for (const segment of segments) {
      const nextPath = cursor.path === "" ? segment : `${cursor.path}/${segment}`;
      let child = cursor.dirs.get(segment);
      if (child === undefined) {
        child = { name: segment, path: nextPath, dirs: new Map(), files: [] };
        cursor.dirs.set(segment, child);
      }
      cursor = child;
    }
    cursor.files.push({ kind: "file", name: fileName, path: state.path, status: state.status });
  }

  const toNodes = (builder: DirBuilder): TreeNode[] => {
    const dirs = [...builder.dirs.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => dirNodeOf(child, toNodes));
    const files = [...builder.files].sort((a, b) => (a.kind === "file" && b.kind === "file" ? a.name.localeCompare(b.name) : 0));
    return [...dirs, ...files];
  };
  return toNodes(root);
}

function dirNodeOf(builder: { name: string; path: string; dirs: Map<string, unknown>; files: TreeNode[] }, toNodes: (b: never) => TreeNode[]): TreeNode {
  const children = toNodes(builder as never);
  const files = flattenFiles(children);
  const viewed = files.filter((file) => file.status === "viewed").length;
  const state: DirViewedState = viewed === 0 ? "none" : viewed === files.length ? "all" : "some";
  return { kind: "dir", name: builder.name, path: builder.path, children, state, total: files.length, viewed };
}

function flattenFiles(nodes: readonly TreeNode[]): Array<Extract<TreeNode, { kind: "file" }>> {
  const out: Array<Extract<TreeNode, { kind: "file" }>> = [];
  for (const node of nodes) {
    if (node.kind === "file") out.push(node);
    else out.push(...flattenFiles(node.children));
  }
  return out;
}

/** 某个目录下的全部文件路径（勾选目录 = 批量标记这些）。 */
export function filesUnder(nodes: readonly TreeNode[], dirPath: string): string[] {
  const walk = (list: readonly TreeNode[]): string[] => {
    for (const node of list) {
      if (node.kind === "dir" && node.path === dirPath) return flattenFiles(node.children).map((file) => file.path);
      if (node.kind === "dir") {
        const found = walk(node.children);
        if (found.length > 0) return found;
      }
    }
    return [];
  };
  return walk(nodes);
}
