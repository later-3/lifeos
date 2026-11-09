// 统一 diff patch 的解析纯函数（Task 0010 · P1）。
//
// 输入是 `git diff --no-color --no-ext-diff --unified=3` 的文本输出（调用方保证
// `core.quotePath=false`，中文/全角路径不转义）。参考 pi-web `lib/patch.ts` 的
// 行序状态机（MIT，upstream/main f130910），按我们的形状重写：
//  - 输出行带 oldNo/newNo 双行号（DSH 的教训：行号是契约，后端不给前端就没有）；
//  - hunk 头的 oldStart/oldLines/newStart/newLines 保留（前端并排视图要用）；
//  - 只认 hunk 体；文件头由 src/review.ts 的 splitPatchByFile 处理。
//
// 纪律：不读文件系统、不碰全局状态——可穷举单测（architecture 2.5）。

export type DiffLineType = "context" | "added" | "removed";

export type DiffLine = {
  type: DiffLineType;
  oldNo: number | null;
  newNo: number | null;
  text: string;
};

export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * 解析一个文件的 hunk 体（若干 "@@ ..." 行与其后的 +/-/空格 行）。
 * 非法行跳过不抛——diff 文本来自 git 输出，形状可靠；防御的是 "\ No newline" 与空行。
 */
export function parseUnifiedPatchToHunks(body: string[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;

  for (const raw of body) {
    const line = raw.endsWith("\n") ? raw.slice(0, -1) : raw;

    const hunk = HUNK_RE.exec(line);
    if (hunk !== null) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[3]);
      oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
      current = { oldStart: oldNo, oldLines: oldLeft, newStart: newNo, newLines: newLeft, lines: [] };
      hunks.push(current);
      continue;
    }
    if (current === undefined) continue; // hunk 外的内容（文件头残余）：跳过
    if (line.startsWith("\\ ")) continue; // "\ No newline at end of file"

    const prefix = line.charAt(0);
    const text = line.slice(1);
    if (prefix === " " || (prefix === "" && text === "")) {
      if (oldLeft <= 0 && newLeft <= 0) continue; // hunk 计数已尽：越界的空行跳过
      current.lines.push({ type: "context", oldNo: oldNo++, newNo: newNo++, text });
      if (oldLeft > 0) oldLeft--;
      if (newLeft > 0) newLeft--;
      continue;
    }
    if (prefix === "-") {
      current.lines.push({ type: "removed", oldNo: oldNo++, newNo: null, text });
      if (oldLeft > 0) oldLeft--;
      continue;
    }
    if (prefix === "+") {
      current.lines.push({ type: "added", oldNo: null, newNo: newNo++, text });
      if (newLeft > 0) newLeft--;
      continue;
    }
    // 其他前缀（不该出现）：跳过，不产出幽灵行
  }
  return hunks;
}

/**
 * 从 `git diff` 的 patch 里取"变更行"内的一段原文（批注 quote 的兜底重定位用）。
 * side="old" 在 removed/context 行里找；side="new" 在 added/context 行里找。
 * 找不到（行号越界/被截断）返回 undefined——调用方据此把批注标 stale。
 */
export function quoteAtLines(
  hunks: readonly DiffHunk[],
  side: "old" | "new",
  startLine: number,
  endLine: number,
): string | undefined {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) return undefined;
  const wanted: string[] = [];
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const no = side === "old" ? line.oldNo : line.newNo;
      if (no === null || no < startLine || no > endLine) continue;
      // 行类型必须匹配侧：old 侧不接受纯 added 行，反之亦然
      if (side === "old" && line.type === "added") continue;
      if (side === "new" && line.type === "removed") continue;
      wanted.push(line.text);
    }
  }
  return wanted.length > 0 ? wanted.join("\n") : undefined;
}
