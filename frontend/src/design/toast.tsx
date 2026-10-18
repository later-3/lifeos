import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { IconAlertCircle, IconCheck } from "@tabler/icons-react";

/**
 * 全局反馈（前端开发路径 · 闸 2）：保存成功/失败不再各页面自己写"✓ 已保存"。
 * 语义：success 只用于"操作已完成"，error 只用于"操作失败且需要用户知道"。
 */

type Tone = "success" | "error";
type Toast = { id: number; tone: Tone; text: string };

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((text: string, tone: Tone = "success") => {
    const id = ++seq.current;
    setItems((list) => [...list, { id, tone, text }]);
    setTimeout(() => setItems((list) => list.filter((item) => item.id !== id)), 2600);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 top-3 z-50 flex flex-col items-end gap-1.5">
        {items.map((item) => (
          <div key={item.id}
            className={`flex items-center gap-2 rounded-panel px-3 py-2 text-body shadow-lg ring-1 ${
              item.tone === "error" ? "bg-danger-soft text-danger ring-danger/20" : "bg-surface text-ink-900 ring-line"
            }`}>
            {item.tone === "error" ? <IconAlertCircle size={16} /> : <IconCheck size={16} className="text-success" />}
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
