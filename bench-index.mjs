// 若失败/未读都走索引：聚合本身要多久？
import { sessionViewsOf } from "./src/session-views.ts";
const t = performance.now();
const unread = sessionViewsOf().unread();
console.log(`未读索引读：${(performance.now()-t).toFixed(1)}ms，${unread.length} 条`);

// 模拟 13 Agent × 22 项目的聚合计算
const t2 = performance.now();
const agg = new Map();
for (let i = 0; i < 250; i++) {   // 假设 250 条有状态会话
  const key = `a${i % 13}\u0000p${i % 22}`;
  const cur = agg.get(key) ?? { running: 0, unread: 0, failure: 0 };
  if (i % 7 === 0) cur.running++; else if (i % 5 === 0) cur.failure++; else cur.unread++;
  agg.set(key, cur);
}
console.log(`聚合 250 条 → ${agg.size} 个分组：${(performance.now()-t2).toFixed(2)}ms`);
console.log(`序列化后大小：${JSON.stringify([...agg.entries()]).length}B`);
