import { useEffect, useState } from "react";

// 折叠状态（前端开发路径 · 折叠底层唯一入口）：`useFold(key)` 统一状态 + `lifeos.fold.*` 持久化。
// 控件与收起态呈现不在这里：列头收起钮 = design/ui 的 IconButton；收起轨 = design/rail 的 NavRail。

export function useFold(key: string, initial = true): [boolean, (next: boolean) => void] {
  const storageKey = `lifeos.fold.${key}`;
  const [open, setOpen] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null) return raw !== "0";
    } catch { /* 忽略 */ }
    return initial;
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, open ? "1" : "0"); } catch { /* 忽略 */ }
  }, [storageKey, open]);
  return [open, setOpen];
}
