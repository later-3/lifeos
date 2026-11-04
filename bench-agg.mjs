import { aggregateStatus, globalSnapshot } from "./src/agent-host.ts";
import { sessionViewsOf } from "./src/session-views.ts";
await sessionViewsOf().load();
for (const pass of [1, 2, 3]) {
  const t = performance.now();
  const agg = aggregateStatus();
  console.log(`第 ${pass} 次 aggregateStatus：${(performance.now() - t).toFixed(2)}ms，${agg.length} 个分组`);
}
const snap = globalSnapshot();
console.log(`快照 aggregate 序列化：${JSON.stringify(snap.aggregate).length}B`);
console.log("内容:", JSON.stringify(snap.aggregate));
