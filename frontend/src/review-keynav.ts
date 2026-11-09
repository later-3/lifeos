// 检视面板的键盘导航（G13）——**纯函数 + 单一键位表**。
//
// 为什么把键位表也放在这里（而不是散在组件里）：
//   帮助浮层（`?`）要列键位、测试要断言键位、`keydown` 要分发——三处必须读**同一份**，
//   否则"帮助里说 n 是下一个 hunk，实际按了没反应"这种偏差没人能自动发现。
//
// 键位取自 difit `src/client/hooks/useKeyboardNavigation.ts`（21 个键，2026-11-08 核对）：
//   `j, down` / `k, up`（行）、`n` / `p`（chunk）、`shift+n` / `shift+p`（评论）、
//   `]` / `[` / `{` / `}`（文件）、`h, left` / `l, right`（split 侧）、`v` / `shift+v`（Viewed）、
//   `shift+r`（刷新）、`c`（新建评论）、`?`（帮助）、`.`（居中）、
//   `shift+c` / `shift+d` / `shift+l`（复制全部 / 删除全部 / 评论列表）。
//
// 我们**这一版实现**（其余键位对应的功能还没做，不假装支持 —— 帮助里只列真的能用的）：
//   j/↓ k/↑（行）、n/p（改块）、]/[（文件）、{/}（首/尾文件）、c（在当前行建评论）、
//   ?（帮助）、Esc（关面板）。
//
// 纪律：纯函数，不读 DOM、不碰 React。行列表由调用方按**视觉顺序**给出。

export type NavRow = {
  /** 文件路径（分组内唯一） */
  file: string;
  /** hunk 标识（同一文件内唯一；用于 n/p 跳"下一个改动块"） */
  chunk: string;
  /**
   * 这一行在 DOM 里的稳定标识（`文件#hunk序号#行序号`）。
   * 用它而不是数组下标做光标：渲染时下标会因为折叠/展开与数据顺序不一致，
   * 拿下标去比会"光标在这一行、高亮在另一行"。
   */
  key?: string;
};

export type NavDirection = 1 | -1;

/** 一个键位：动作 + 帮助里显示的说法（单一事实源）。 */
export type KeyBinding = {
  /** 规范化的键名（见 `normalizeNavKey`） */
  keys: string[];
  /** 帮助里显示的按键 */
  label: string;
  /** 帮助里显示的说明 */
  description: string;
};

/**
 * 这一版**真的能用**的键位（帮助浮层直接读它，不另写一份文案）。
 * 顺序即帮助浮层的显示顺序（从最常用到最少用）。
 */
export const KEY_BINDINGS: readonly KeyBinding[] = [
  { keys: ["j", "arrowdown"], label: "j / ↓", description: "下一行" },
  { keys: ["k", "arrowup"], label: "k / ↑", description: "上一行" },
  { keys: ["n"], label: "n", description: "下一个改动块" },
  { keys: ["p"], label: "p", description: "上一个改动块" },
  { keys: ["]"], label: "]", description: "下一个文件" },
  { keys: ["["], label: "[", description: "上一个文件" },
  { keys: ["}"], label: "}", description: "最后一个文件" },
  { keys: ["{"], label: "{", description: "第一个文件" },
  { keys: ["c"], label: "c", description: "在当前行写评论" },
  { keys: ["?"], label: "?", description: "显示 / 隐藏这份快捷键" },
  { keys: ["escape"], label: "Esc", description: "关闭检视面板" },
];

/**
 * 把 `KeyboardEvent.key` 规范化成键位表里的写法。
 *
 * 为什么要规范化：`KeyboardEvent.key` 对方向键给 `"ArrowDown"`、对字母给 `"j"`（受 Shift 影响给 `"J"`）。
 * 统一成小写并把方向键转成 `arrowdown` / `arrowup`，键位表就只需要一份小写表。
 */
export function normalizeNavKey(key: string): string {
  return key.toLowerCase();
}

/** 键 → 动作（`undefined` = 这个键不归检视面板管，调用方不要 `preventDefault`）。 */
export function actionOfKey(key: string): KeyBinding | undefined {
  const normalized = normalizeNavKey(key);
  return KEY_BINDINGS.find((binding) => binding.keys.includes(normalized));
}

/**
 * 行步进：`dir = 1` 下一行、`-1` 上一行；**到头就停**（不环绕）。
 *
 * 为什么不环绕：diff 是有序文档，从最后一行跳回第一行会让人失去位置感
 * （difit 的行/块导航同样不环绕；只有"文件"导航是环绕的，见 `stepFile`）。
 */
export function stepLine(rows: readonly NavRow[], index: number, dir: NavDirection): number {
  if (rows.length === 0) return -1;
  const next = index + dir;
  if (next < 0 || next >= rows.length) return index;
  return next;
}

/**
 * 改动块步进：跳到**相邻的下一个/上一个**不同的 chunk 的首行。
 * 已经在块首时，`dir = 1` 跳到下一个块的首行（而不是原地不动）。
 */
export function stepChunk(rows: readonly NavRow[], index: number, dir: NavDirection): number {
  if (rows.length === 0) return -1;
  const current = rows[index];
  if (current === undefined) return dir === 1 ? 0 : rows.length - 1;
  if (dir === 1) {
    for (let i = index + 1; i < rows.length; i += 1) {
      const row = rows[i];
      if (row !== undefined && (row.chunk !== current.chunk || row.file !== current.file)) {
        // 回退到那个块的首行（同一 chunk 的连续行里第一个）
        let head = i;
        while (head > 0) {
          const prev = rows[head - 1];
          if (prev === undefined || prev.chunk !== row.chunk || prev.file !== row.file) break;
          head -= 1;
        }
        return head;
      }
    }
    return index;   // 没有下一个块：停在原地
  }
  // 往回：先回到当前块的首行，再找前一个块的首行
  let head = index;
  while (head > 0) {
    const prev = rows[head - 1];
    if (prev === undefined || prev.chunk !== current.chunk || prev.file !== current.file) break;
    head -= 1;
  }
  if (head === index) {
    // 已经在块首：找前一个块的首行
    for (let i = index - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (row === undefined) continue;
      const prev = rows[i - 1];
      if (prev === undefined || prev.chunk !== row.chunk || prev.file !== row.file) return i;
    }
    return index;
  }
  return head;
}

/**
 * 文件步进：跳到相邻文件的**首行**；**环绕**（difit 的 `]`/`[` 同判）。
 *
 * 为什么文件级环绕而块级不环绕：文件是"分散的单位"，环绕等于"循环切换"。
 * 用户预期按 `]` 若干次能走一圈；而块在长文件里有几十个，环绕只会让人失去位置。
 */
export function stepFile(rows: readonly NavRow[], index: number, dir: NavDirection): number {
  if (rows.length === 0) return -1;
  const current = rows[Math.max(0, index)];
  const files = [...new Set(rows.map((row) => row.file))];
  if (current === undefined) return dir === 1 ? 0 : rows.length - 1;
  const at = files.indexOf(current.file);
  const nextFile = files[(at + dir + files.length) % files.length];
  if (nextFile === undefined) return index;
  const rowIndex = rows.findIndex((row) => row.file === nextFile);
  return rowIndex < 0 ? index : rowIndex;
}

/** 首/尾文件（`{` / `}`）：直接给第一个/最后一个文件的首行。 */
export function firstFileRow(rows: readonly NavRow[]): number {
  return rows.length === 0 ? -1 : 0;
}

export function lastFileRow(rows: readonly NavRow[]): number {
  if (rows.length === 0) return -1;
  const lastFile = rows[rows.length - 1]?.file;
  const index = rows.findIndex((row) => row.file === lastFile);
  return index < 0 ? 0 : index;
}

/**
 * 是否应该在输入类元素里**不响应**导航键。
 *
 * difit 用 `enableOnFormTags: false`（`useKeyboardNavigation.ts:325`）——同一取向：
 * 用户在写评论正文时按 `j` 必须打出一个 j，不能被抢走。
 */
export function shouldIgnoreNav(target: {
  tagName?: string;
  isContentEditable?: boolean;
} | null | undefined): boolean {
  if (target === null || target === undefined) return false;
  if (target.isContentEditable === true) return true;
  const tag = (target.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/** 光标 key → 行下标（找不到返回 -1）。 */
export function indexOfKey(rows: readonly NavRow[], key: string | undefined): number {
  if (key === undefined) return -1;
  return rows.findIndex((row) => row.key === key);
}
