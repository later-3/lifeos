#!/usr/bin/env node
/**
 * 在 App.tsx 里装配冻结观测（Task 0033 · P0）。
 *
 * 为什么用脚本而不是手改：App.tsx 是 5000+ 行的单体文件，插入点必须**锚在结构事实**上
 * （某个 ref 的声明之后），而不是行号。脚本可重跑、可回退，也留下"改了哪里"的记录。
 *
 * 幂等：检测到已装配就退出，不重复插入。
 */

import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2] ?? "frontend/src/App.tsx";
let source = readFileSync(path, "utf8");

if (source.includes("installFreezeWatch(")) {
  console.log("已装配，跳过");
  process.exit(0);
}

/* 1) import */
const importAnchor = 'import { cacheableOf, createMessageCache } from "./message-cache";';
if (!source.includes(importAnchor)) throw new Error("找不到 import 锚点");
source = source.replace(
  importAnchor,
  importAnchor
  + '\nimport { installFreezeWatch, refreshSnapshot, trail } from "./api/freeze-watch";'
  + '\nimport { updateSnapshot } from "./api/freeze-snapshot";',
);

/* 2) 一个 ref 用来给观测读最新渲染窗口（state 在 effect 里会闭包旧值） */
const refAnchor = "  const messagesRef = useRef<Message[]>([]);\n  messagesRef.current = messages;";
if (!source.includes(refAnchor)) throw new Error("找不到 messagesRef 锚点");
source = source.replace(
  refAnchor,
  refAnchor
  + "\n  /** 渲染窗口的最新值（冻结快照要读它；放 ref 是为了不进 effect 依赖）。 */"
  + "\n  const visibleCountRef = useRef(VISIBLE_PAGE_SIZE);"
  + "\n  visibleCountRef.current = visibleCount;",
);

/* 3) 装配 effect：放在 messagesRef 之后（此时 agentIdRef/current/busyRef 都已声明） */
const assembly = [
  "",
  "  /*",
  "   * 冻结观测（Task 0033 · P0）：装一次，之后主线程只负责报活与记动作。",
  "   * 为什么在 App 里而不是 main.tsx：快照要读 App 的内部状态（会话/消息数/界面开关）。",
  "   * 装配幂等（StrictMode 双跑 effect 由 installFreezeWatch 内部挡住）。",
  "   */",
  "  useEffect(() => {",
  "    installFreezeWatch();",
  "  }, []);",
  "",
  "  /* 快照登记：状态一变就把\"能解释卡顿的因子\"写进寄存器（一次属性赋值，不触发渲染）。 */",
  "  useEffect(() => {",
  "    updateSnapshot({",
  "      ...(agent?.id !== undefined ? { agentId: agent?.id } : {}),",
  "      ...(sessionId !== undefined ? { sessionId } : {}),",
  "      messages: messages.length,",
  "      visibleCount,",
  "      busy,",
  "      phase,",
  "      ...(activeTool !== undefined ? { activeTool } : {}),",
  "      panelOpen,",
  "      historyOpen: history !== undefined,",
  "      reviewOpen,",
  "    });",
  "  }, [agent?.id, sessionId, messages.length, visibleCount, busy, phase, activeTool, panelOpen, history, reviewOpen]);",
  "",
].join("\n");

source = source.replace(refAnchor
  + "\n  /** 渲染窗口的最新值（冻结快照要读它；放 ref 是为了不进 effect 依赖）。 */"
  + "\n  const visibleCountRef = useRef(VISIBLE_PAGE_SIZE);"
  + "\n  visibleCountRef.current = visibleCount;",
  refAnchor
  + "\n  /** 渲染窗口的最新值（冻结快照要读它；放 ref 是为了不进 effect 依赖）。 */"
  + "\n  const visibleCountRef = useRef(VISIBLE_PAGE_SIZE);"
  + "\n  visibleCountRef.current = visibleCount;"
  + assembly,
);

writeFileSync(path, source);
console.log("已装配冻结观测（import + ref + 两个 effect）");
