/**
 * 检视面板（Task 0017 · P5 领域 hook #2）。
 *
 * ## 这个 hook 管什么
 *
 * 右侧检视面板的全部状态：开合、宽度比例、当前检视的 Task、两组 diff 数据、
 * 加载/失败、路径映射、候选 Task 列表。
 *
 * ## 纪律（搬自 App.tsx，逐条保留）
 *
 * - `reviewTask` 是**唯一状态源**：标题与 reload 都从它推导。网络晚到由 loadReview 的
 *   序号守卫丢弃（否则会出现"标题 0018 / 内容 0015"的撕裂，Task 0018 实测过）。
 * - 比例存 localStorage（存比例不存 px，D12）：窗口变化时面板宽度按比例走。
 * - 候选 Task 懒加载：只在**打开面板时**拉一次（实测 15 个 Task 0.93s）。
 */
import { useState } from "react";

import { DEFAULT_REVIEW_RATIO } from "../design/layout";
import type { ReviewData, TaskCandidateView } from "../views/ReviewPanel";

export function useReviewSurface() {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRatio, setReviewRatio] = useState<number>(() => {
    const raw = Number(localStorage.getItem("lifeos.reviewRatio"));
    return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : DEFAULT_REVIEW_RATIO;
  });
  /** 当前检视的 taskDir —— **唯一状态源**。 */
  const [reviewTask, setReviewTask] = useState<string | undefined>(undefined);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewFailed, setReviewFailed] = useState<string | null>(null);
  const [reviewTaskPaths, setReviewTaskPaths] = useState<Record<string, string>>({});
  const [reviewCandidates, setReviewCandidates] = useState<readonly TaskCandidateView[]>([]);
  const [reviewCandidatesLoading, setReviewCandidatesLoading] = useState(false);

  return {
    reviewOpen, setReviewOpen,
    reviewRatio, setReviewRatio,
    reviewTask, setReviewTask,
    reviewData, setReviewData,
    reviewLoading, setReviewLoading,
    reviewFailed, setReviewFailed,
    reviewTaskPaths, setReviewTaskPaths,
    reviewCandidates, setReviewCandidates,
    reviewCandidatesLoading, setReviewCandidatesLoading,
  };
}
