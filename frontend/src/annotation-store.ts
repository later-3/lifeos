/**
 * 批注的状态（Task 0003 · P2）。
 *
 * 为什么单独一个模块而不是塞进 App.tsx：
 * `App.tsx` 已经承担会话、消息、流式、输入、斜杠命令、图片等一堆状态；
 * 批注是**独立的一条线**（自己增删改、自己重画高亮），混进去会让两边都难改。
 * 这里只放"批注集合 + 对它的操作"，UI 由组件订阅。
 *
 * 本阶段（P2）只在内存里：刷新即丢。持久化在 P5（会话 custom entry）。
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { Annotation } from "./annotations.ts";

/** 一条待创建批注的定位信息（拖选得到）。 */
export type AnnotationDraftAnchor = {
  messageId: string;
  blockIndex: number;
  start: number;
  end: number;
  quote: string;
};

export type AnnotationStore = {
  annotations: readonly Annotation[];
  /** 按消息+块取（渲染时用）。返回稳定顺序：按 start 升序。 */
  ofBlock: (messageId: string, blockIndex: number) => readonly Annotation[];
  /** 新增一条；返回它的 id。 */
  add: (anchor: AnnotationDraftAnchor, marks: readonly string[], note: string) => string;
  /** 改语气（至少留 1 个；给空数组会被忽略）。 */
  setMarks: (id: string, marks: readonly string[]) => void;
  /** 改内容。 */
  setNote: (id: string, note: string) => void;
  /** 展开/收起（收起不删数据）。 */
  setMode: (id: string, mode: Annotation["ui"]["mode"]) => void;
  /** 钉住切换；解除钉住时把拖动偏移归零（回到默认位置）。 */
  togglePinned: (id: string) => void;
  /** 记录拖动偏移（只在钉住后有意义）。 */
  setOffset: (id: string, dx: number, dy: number) => void;
  /** 删除一条（高亮由调用方按新集合重画）。 */
  remove: (id: string) => void;
  /** 全部清空。 */
  clear: () => void;
};

let seq = 0;
const nextId = (): string => `a${++seq}`;

export function useAnnotations(): AnnotationStore {
  const [annotations, setAnnotations] = useState<readonly Annotation[]>([]);
  // ofBlock 需要稳定引用（避免每次渲染都新建 Map 造成子组件重渲染）
  const cacheRef = useRef<{ source: readonly Annotation[]; map: Map<string, Annotation[]> } | null>(null);

  const ofBlock = useCallback((messageId: string, blockIndex: number) => {
    const cache = cacheRef.current;
    if (cache === null || cache.source !== annotations) {
      const map = new Map<string, Annotation[]>();
      for (const anno of annotations) {
        const key = `${anno.messageId}\u0000${anno.blockIndex}`;
        const list = map.get(key);
        if (list === undefined) map.set(key, [anno]);
        else list.push(anno);
      }
      for (const list of map.values()) list.sort((a, b) => a.start - b.start);
      cacheRef.current = { source: annotations, map };
    }
    const fresh = cacheRef.current;
    return fresh === null ? [] : (fresh.map.get(`${messageId}\u0000${blockIndex}`) ?? []);
  }, [annotations]);

  const add = useCallback((anchor: AnnotationDraftAnchor, marks: readonly string[], note: string) => {
    const id = nextId();
    setAnnotations((list) => [
      ...list,
      {
        id,
        messageId: anchor.messageId,
        blockIndex: anchor.blockIndex,
        start: anchor.start,
        end: anchor.end,
        quote: anchor.quote,
        marks: [...marks],
        note,
        ui: { mode: "open", pinned: false, dx: 0, dy: 0 },
      },
    ]);
    return id;
  }, []);

  const patch = useCallback((id: string, fn: (anno: Annotation) => Annotation) => {
    setAnnotations((list) => list.map((anno) => (anno.id === id ? fn(anno) : anno)));
  }, []);

  const setMarks = useCallback((id: string, marks: readonly string[]) => {
    if (marks.length === 0) return;   // 至少留一个（demo 行为）
    patch(id, (anno) => ({ ...anno, marks: [...marks] }));
  }, [patch]);

  const setNote = useCallback((id: string, note: string) => {
    patch(id, (anno) => ({ ...anno, note }));
  }, [patch]);

  const setMode = useCallback((id: string, mode: Annotation["ui"]["mode"]) => {
    patch(id, (anno) => ({ ...anno, ui: { ...anno.ui, mode } }));
  }, [patch]);

  const togglePinned = useCallback((id: string) => {
    patch(id, (anno) => ({
      ...anno,
      // 解除钉住 → 偏移归零，框回默认位置（demo 行为）
      ui: anno.ui.pinned
        ? { ...anno.ui, pinned: false, dx: 0, dy: 0 }
        : { ...anno.ui, pinned: true, mode: "open" },
    }));
  }, [patch]);

  const setOffset = useCallback((id: string, dx: number, dy: number) => {
    patch(id, (anno) => ({ ...anno, ui: { ...anno.ui, dx, dy } }));
  }, [patch]);

  const remove = useCallback((id: string) => {
    setAnnotations((list) => list.filter((anno) => anno.id !== id));
  }, []);

  const clear = useCallback(() => { setAnnotations([]); }, []);

  return useMemo(
    () => ({ annotations, ofBlock, add, setMarks, setNote, setMode, togglePinned, setOffset, remove, clear }),
    [annotations, ofBlock, add, setMarks, setNote, setMode, togglePinned, setOffset, remove, clear],
  );
}
