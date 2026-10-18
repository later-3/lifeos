/** 文件类型小工具：树与查看器共用（原两处各自重复实现，2026-10-17 坏味道清理）。 */
export const isMarkdown = (name: string) => /\.(md|markdown|mdx)$/i.test(name);
