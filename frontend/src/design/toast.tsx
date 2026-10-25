import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { IconAlertCircle, IconCheck } from "@tabler/icons-react";

/**
 * 全局反馈（前端开发路径 · 闸 2）：保存成功/失败不再各页面自己写"✓ 已保存"。
 * 语义：success 只用于"操作已完成"，error 只用于"操作失败且需要用户知道"。
 */

type Tone = "success" | "error";
/** 带动作的提示（如"后台会话已完成 · 查看"）：停留更久，动作按钮可点。 */
export type ToastAction = { label: string; run: () => void };
type Toast = { id: number; tone: Tone; text: string; action?: ToastAction };

const ToastContext = createContext<(text: string, tone?: Tone, action?: ToastAction) => void>(() => {});
const ACTION_TOAST_MS = 8000;
const PLAIN_TOAST_MS = 2600;

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((text: string, tone: Tone = "success", action?: ToastAction) => {
    const id = ++seq.current;
    setItems((list) => [...list, { id, tone, text, ...(action !== undefined ? { action } : {}) }]);
    setTimeout(() => setItems((list) => list.filter((item) => item.id !== id)), action !== undefined ? ACTION_TOAST_MS : PLAIN_TOAST_MS);
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
            {item.action !== undefined && (
              <button type="button" onClick={() => { item.action?.run(); setItems((list) => list.filter((entry) => entry.id !== item.id)); }}
                className="pointer-events-auto ml-1 rounded-control px-1.5 py-0.5 text-accent hover:bg-accent-soft">
                {item.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
