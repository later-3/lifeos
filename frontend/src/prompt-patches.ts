/**
 * Pi system 消息的**分区补丁**累加（纯函数，供完整历史面板与单测使用）。
 *
 * 事实（Pi `system-prompt.ts · diffSystemPromptSections`）：Pi 不会每轮把整个系统提示重写一遍，
 * 只落"与上一轮不同"的 key：`{ 新增或变化的区: 正文 }`，被删掉的区记 `null`。
 * 所以某条 system 消息的 `sections` **不是全量**；只看它就当成"这轮的系统提示"，会以为少了区
 * （实测：会话第 1 条是全量 6 区，第 2 条只有 {project_context, cwd}，其余 5 区其实"没变"）。
 */

export type SectionPatch = Record<string, string | null>;
export type Sections = Record<string, string>;

export type PatchResult = {
  sections: Sections;
  /** 本次补丁真正改动/删除的区名（按补丁里的出现顺序）。 */
  changed: string[];
};

/**
 * 在累计分区上应用一条补丁；`null` = 删除该区。
 * 首条补丁（此前为空）= 建立基线：全量落盘，不标"本次变更"。
 */
export function applySectionPatch(sections: Sections, patch: SectionPatch): PatchResult {
  const initial = Object.keys(sections).length === 0;
  const next: Sections = { ...sections };
  const changed: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      if (key in next) { delete next[key]; changed.push(key); }
      continue;
    }
    if (next[key] !== value) { next[key] = value; changed.push(key); }
  }
  return { sections: next, changed: initial ? [] : changed };
}

/** 会话里累计生效的分区集（同一份补丁序列反复用得到同一结果——面板与测试共用这条路径）。 */
export function sectionsAfter(patches: SectionPatch[]): Sections {
  return patches.reduce<Sections>((sections, patch) => applySectionPatch(sections, patch).sections, {});
}
