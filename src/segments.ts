/** 目录名清洗（项目名 / 任务名共用）：允许中文；去掉路径分隔符与控制字符，空白折成 `-`，最长 60。 */
export function sanitizeSegment(name: string): string {
  const cleaned = name
    .replace(/[\/\:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^[.\-]+|[.\-]+$/g, "")
    .slice(0, 60);
  return cleaned === "" ? "unnamed" : cleaned;
}
