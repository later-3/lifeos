/**
 * 工作台的失败表面（Task 0023 · S1；读路径闸 frontend 2.33）。
 *
 * 单列一个小文件：workbench.tsx / workbench-projects / workbench-calendar 三处共用，
 * 放进其中任何一个都会造成"父 ↔ 子"循环 import（workbench → 子 → workbench）。
 * 文案只说"发生了什么 + 怎么恢复"（`failureTextOf`），技术细节进日志不进界面。
 */
import { AppIcon } from "../design/icons";
import { IconButton } from "../design/ui";
import { failureTextOf, type LoadFailure } from "../api/fetch-timeout";

export function FailureNotice({ failure, onRetry }: { failure: LoadFailure; onRetry: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4" data-testid="workbench-load-failure">
      <p className="text-center text-body text-ink-700">{failureTextOf(failure)}</p>
      <IconButton label="重试" tone="accent" onClick={onRetry}><AppIcon name="refresh" size={16} /></IconButton>
    </div>
  );
}
