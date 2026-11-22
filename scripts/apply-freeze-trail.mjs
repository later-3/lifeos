#!/usr/bin/env node
/**
 * 在 App.tsx 的关键动作上埋 `trail()`（Task 0033 · P2）。
 *
 * ## 为什么用脚本而不是手改
 *
 * App.tsx 5400+ 行，插入点必须锚在**代码结构事实**（函数签名、特定分支）上，不是行号。
 * 脚本可重跑、幂等、也留下"改了哪几处"的记录。
 *
 * ## 埋点原则
 *
 * 只记"做了什么"，**不记正文**（后端规范 2.10）。轨迹的用途是回答"卡死前发生了什么"，
 * 所以只埋在**会改变渲染规模/界面形态**的动作上，不给每个事件都加一行
 * （那会让 trail 全部被高频事件挤满，反而看不到关键动作）。
 *
 * 埋点清单与理由：
 * | 动作 | 为什么值得记 |
 * |---|---|
 * | open-session | 切会话是"重新装载+重新渲染"的唯一入口 |
 * | load-messages | 会话详情到手（消息条数与渲染规模在这一刻变化） |
 * | load-older | 历史分页（`visibleCount` 会跟着涨，是最可疑的放大路径） |
 * | load-rail | 刻度到手会触发后台全量补齐 |
 * | ensure-full-history | 全量补齐开始（一次可能连拉 9 页） |
 * | send | 发送（乐观插入 + 流式开始） |
 * | stream-delta | 收到流式增量（高频，但只在"新一段"时记，避免刷屏） |
 * | finish-turn | 一轮结束（收尾时会重取消息与刻度） |
 * | agents-changed | 侧栏重取（会触发 refreshMeta 的全量拉取） |
 * | open/close-panel | 文件面板开合（会改布局与可见区域） |
 * | open/close-history | 完整历史开合 |
 * | open/close-review | 检视面板开合 |
 */

import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2] ?? "frontend/src/App.tsx";
let source = readFileSync(path, "utf8");
const applied = [];

function insertAfterOnce(marker, addition, label) {
  if (source.includes(addition.trim())) return;
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`找不到锚点：${label}`);
  const end = at + marker.length;
  source = source.slice(0, end) + addition + source.slice(end);
  applied.push(label);
}

/* 1) 切会话：openSession 开头（重置渲染状态的那一行之前） */
insertAfterOnce(
  "  async function openSession(a: Agent, sid: string) {\n",
  '    trail("open-session");\n',
  "open-session",
);

/* 2) 会话详情到手：loadMessages 里 fetchSessionPayload 之后设置 messages 的那一行 */
insertAfterOnce(
  "    followTail.current = true;\n    setAtBottom(true);\n    setMessages(data.messages ?? []);",
  '\n    trail(`load-messages:${(data.messages ?? []).length}`);',
  "load-messages",
);

/* 3) 历史分页：loadOlder 拼进 messages 之后 */
insertAfterOnce(
  "      setMessages((existing) => [...older, ...existing]);",
  '\n      trail(`load-older:+${older.length}`);',
  "load-older",
);

/* 4) 刻度到手（会触发后台补齐） */
insertAfterOnce(
  "    setRailTicks(Array.isArray(items) ? items : []);",
  '\n    trail(`load-rail:${Array.isArray(items) ? items.length : 0}`);',
  "load-rail",
);

/* 5) 全量补齐开始 */
insertAfterOnce(
  "    if (fullHistoryInFlight.current === `${id}/${sid}`) return;   // 已经在补了\n",
  '    trail("ensure-full-history");\n',
  "ensure-full-history",
);

/* 6) 发送 */
insertAfterOnce(
  "    setMessages((list) => [...list, { role: \"user\", text, blocks: userBlocks(text, pending) }, { role: \"assistant\", text: \"\", blocks: [], streaming: true }]);",
  '\n    trail("send");',
  "send",
);

/* 7) 一轮结束 */
insertAfterOnce(
  "    setTurnStatus({ text: `4/4 · ${outcome === \"done\" ? \"完成\" : \"失败\"} · ${elapsed}s` });",
  '\n    trail(`finish-turn:${outcome}`);',
  "finish-turn",
);

/* 8) agents_changed（会触发侧栏重取 + refreshMeta 全量拉取） */
insertAfterOnce(
  "  async function onAgentsChanged(): Promise<void> {\n",
  '    trail("agents-changed");\n',
  "agents-changed",
);

writeFileSync(path, source);
console.log(applied.length === 0 ? "已埋点，跳过" : `已埋 ${applied.length} 处：\n  ${applied.join("\n  ")}`);
