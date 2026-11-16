/**
 * 骨架屏（Task 0015 · S5）——**尺寸必须等于真实内容**，否则刷新会跳版。
 *
 * 为什么单列一个文件：S5 的核心是"零跳变"，而跳变的主要来源是
 * 骨架屏和真实内容高度不一致（骨架 3 行 × 28px，真数据 12 行 × 44px → 加载完整体上移）。
 * 所以骨架的每一档都对着一个真实 primitive 的尺寸来，并由测试锁住（test/skeleton-parity.test.mjs）。
 *
 * 尺寸依据：Row = h-11 sm:h-8（移动 44 / 桌面 32）+ space-y-0.5（2px）。
 */
import { Skeleton } from "./ui";

/** 助手/会话列表的骨架：行高与 Row 一致（桌面 32 + 2 gap）。 */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="px-2" aria-hidden="true" data-skeleton="list">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="mb-0.5 flex h-11 items-center gap-2 px-2 sm:h-8">
          <div className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-hover" />
          <div className="h-3 min-w-0 flex-1 animate-pulse rounded-inner bg-hover" />
          <div className="h-3 w-8 shrink-0 animate-pulse rounded-inner bg-hover" />
        </div>
      ))}
    </div>
  );
}

/** 消息区的骨架：与 ChatMessage 的气泡高度对齐（单行 34 + 2 gap）。 */
export function MessageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3" aria-hidden="true" data-skeleton="message">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={i % 2 === 0 ? "flex justify-end" : "flex justify-start"}>
          <div className={`h-8 animate-pulse rounded-bubble bg-hover ${i % 2 === 0 ? "w-2/5" : "w-3/5"}`} />
        </div>
      ))}
    </div>
  );
}

/** 通用行骨架（保留旧名，页面已有调用点）。 */
export function RowSkeleton({ rows = 3 }: { rows?: number }) {
  return <Skeleton rows={rows} />;
}
