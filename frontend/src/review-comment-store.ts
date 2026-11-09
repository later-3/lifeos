// 检视评论的前端 store（S4-d）：**后端为主、localStorage 为离线兜底**。
//
// 为什么要有这一层（用户 2026-11-05 的核心要求）：
//   "评论应该是单独存在的，它是跟那一次 worktree 绑定的……你这样子做就跟当前的对话绑定了。"
//   "你怎么保存这些草稿？刷新一下就不见了？服务断掉重启呢？"
//
// 依据：
//  - **Gerrit**（`user-changeid.html`）：评论绑逻辑单元（Change-Id），代码重写/变基后仍在 → 我们绑 taskId。
//  - **difit** `useLocalComments.ts:6-22`：只存 localStorage（`difit-comments-<commitHash>`）——
//    刷新不丢、但**换设备/清缓存就丢、Agent 读不到**。我们不重复这个问题：localStorage 只当离线缓存。
//  - **VS Code** `languages.ts:2376-2387`：`PendingCommentThread`（草稿）与 `CommentThread`（已提交）
//    是两种独立数据；我们用 `state: draft | open | resolved` 表达同一件事。
//
// 接口刻意只有五个动作（读/写/删/迁移/健康检查），两种实现（Http / Local）行为一致，
// 由 `frontend/test/review-comment-store.test.mjs` 的同一套契约测试覆盖两边。

import type { ReviewDraft } from "./review-drafts.ts";
import { draftsOfTask, upsertDraft, removeDraft as removeLocalDraft, readDrafts } from "./review-drafts.ts";

/** 与后端 `ReviewComment` 同形状（前端只关心展示需要的字段）。 */
export type ReviewComment = {
  id: string;
  taskId: string;
  author: { kind: "user" | "agent"; id: string };
  anchor: {
    source: "worktree" | "lifeos";
    path: string;
    side: "old" | "new";
    start: number;
    end: number;
    quote?: string;
    snapshot?: string;
    baseCommit?: string;
  };
  body: string;
  marks: string[];
  state: "draft" | "open" | "resolved";
  /** 等谁处理（S4-e · A18）：不是状态，是责任方 */
  awaiting: "user" | "agent" | null;
  /** 谁能关闭（A19）：`author` | `author-or-user` */
  canClose: "author" | "author-or-user";
  /** 线程里的回复（S4-h）：`body` 是根发言，这里只放后追加的 */
  replies: { id: string; author: { kind: "user" | "agent"; id: string }; body: string; createdAt: string; updatedAt?: string }[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolvedBy?: { kind: "user" | "agent"; id: string };
};

export type CommentStore = {
  /** 这个 store 背后是否真的持久化到了服务端（LocalStore 为 false，UI 据此提示"离线"）。 */
  readonly durable: boolean;
  /** 读某 Task 的全部评论。失败时抛错，由调用方决定降级。 */
  list(taskDir: string): Promise<ReviewComment[]>;
  /** 新增或编辑（同键覆盖）。 */
  /**
   * 新增或编辑（同键覆盖）。
   * `replies` 不在入参里：回复只能通过 `reply()` 追加（不能靠“保存整条”把别人的回复覆盖掉）。
   */
  save(taskDir: string, comment: Omit<ReviewComment, "id" | "createdAt" | "updatedAt" | "state" | "awaiting" | "canClose" | "replies"> & { id?: string; state?: ReviewComment["state"]; awaiting?: ReviewComment["awaiting"]; canClose?: ReviewComment["canClose"] }): Promise<ReviewComment>;
  /** 删除（幂等）。 */
  remove(taskDir: string, id: string): Promise<boolean>;
  /**
   * 改状态（A18/A19）。服务端按 `canClose` 校验权限；
   * LocalStore 实现同样的语义（离线时也能关，联网后同步）。
   */
  setCommentState(taskDir: string, id: string, state: ReviewComment["state"], by: { kind: "user" | "agent"; id: string }): Promise<ReviewComment | undefined>;
  /**
   * 追加一条回复（S4-h）。服务端会把 `awaiting` 翻到对方（交棒）。
   * @returns 更新后的线程
   */
  reply(taskDir: string, id: string, reply: { author: { kind: "user" | "agent"; id: string }; body: string }): Promise<ReviewComment | undefined>;
  /** 编辑一条回复（作者或用户；服务端 `op:"reply-update"`）。 */
  editReply(taskDir: string, id: string, reply: { id: string; author: { kind: "user" | "agent"; id: string }; body: string }): Promise<ReviewComment | undefined>;
  /** 删一条回复（幂等）。 */
  removeReply(taskDir: string, id: string, replyId: string, by: { kind: "user" | "agent"; id: string }): Promise<ReviewComment | undefined>;
  /** 手动设“现在等谁”（G1）。 */
  setAwaiting(taskDir: string, id: string, awaiting: ReviewComment["awaiting"], by: { kind: "user" | "agent"; id: string }): Promise<ReviewComment | undefined>;
  /** 把本地草稿一次性上送（迁移）。返回上送条数。 */
  migrate(taskDir: string): Promise<number>;
};

/** fetch 的最小形状（便于测试注入，不依赖全局 fetch）。 */
export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type HttpStoreOptions = {
  /** 例如 `/api/review/comments`（同源，走 vite 代理）。 */
  endpoint?: string;
  fetch?: FetchLike;
  /** localStorage 兜底用（测试可注入）。 */
  storage?: Storage;
  /** 服务端不可用时是否回退到本地（默认 true）。 */
  fallback?: boolean;
  /** 日志钩子（前端 logger；测试可注入 spy）。 */
  log?: (level: "warn" | "error" | "info", msg: string, details?: Record<string, unknown>) => void;
};

const DEFAULT_ENDPOINT = "/api/review/comments";

/**
 * 服务端实现：**唯一的事实源**。
 *
 * 失败处理（这是重点）：
 *  - `list` 失败 → 降级读 localStorage 里该 Task 的草稿并返回（UI 顶部提示"离线数据"）；
 *  - `save` 失败 → 写 localStorage（不丢用户输入）+ 抛出可识别的错误，让 UI 提示"未保存到服务端"；
 *  - `remove` 失败 → 只删本地副本，并返回 false。
 */
export function createHttpStore(options: HttpStoreOptions = {}): CommentStore {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init) as never);
  const storage = options.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  const fallback = options.fallback ?? true;
  const log = options.log ?? (() => undefined);

  const urlOf = (taskDir: string): string => `${endpoint}?taskDir=${encodeURIComponent(taskDir)}`;

  return {
    durable: true,

    async list(taskDir) {
      try {
        const response = await doFetch(urlOf(taskDir));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as { items?: ReviewComment[] };
        return body.items ?? [];
      } catch (error) {
        log("warn", "评论从服务端读取失败，降级到本地缓存", { taskDir, error: String(error) });
        if (fallback && storage !== undefined) return localAsComments(storage, taskDir);
        throw error;
      }
    },

    async save(taskDir, comment) {
      try {
        const response = await doFetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ taskDir, op: "add", comment }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as { comment?: ReviewComment };
        if (body.comment === undefined) throw new Error("服务端没有返回 comment");
        // 成功后清掉本地同名草稿（否则下次迁移会重复上送）
        if (storage !== undefined) dropLocal(storage, taskDir, body.comment);
        return body.comment;
      } catch (error) {
        log("error", "评论写入服务端失败", { taskDir, path: comment.anchor.path, error: String(error) });
        if (fallback && storage !== undefined) keepLocal(storage, taskDir, comment);
        throw error;
      }
    },

    async remove(taskDir, id) {
      try {
        const response = await doFetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ taskDir, op: "remove", id }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as { removed?: boolean };
        if (storage !== undefined) removeLocalDraft(storage, id);
        return body.removed === true;
      } catch (error) {
        log("warn", "评论删除服务端失败，只删本地", { taskDir, id, error: String(error) });
        if (storage !== undefined) removeLocalDraft(storage, id);
        return false;
      }
    },

    async setCommentState(taskDir, id, state, by) {
      const response = await doFetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskDir, op: "state", id, state, by }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      }
      return ((await response.json()) as { comment?: ReviewComment }).comment;
    },

    async reply(taskDir, id, reply) {
      const response = await doFetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskDir, op: "reply", id, reply }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      }
      return ((await response.json()) as { comment?: ReviewComment }).comment;
    },

    async editReply(taskDir, id, reply) {
      const response = await doFetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskDir, op: "reply-update", id, reply }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      }
      return ((await response.json()) as { comment?: ReviewComment }).comment;
    },

    async removeReply(taskDir, id, replyId, by) {
      const response = await doFetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskDir, op: "reply-remove", id, replyId, by }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      }
      return ((await response.json()) as { comment?: ReviewComment }).comment;
    },

    async setAwaiting(taskDir, id, awaiting, by) {
      const response = await doFetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskDir, op: "awaiting", id, awaiting, by }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      }
      return ((await response.json()) as { comment?: ReviewComment }).comment;
    },

    /**
     * 迁移：把 localStorage 里该 Task 的草稿上送服务端。
     *
     * 只上送**有内容**的（body 或 marks 非空）——空草稿是"点了＋没写"，上送只会污染数据。
     * 同键已存在于服务端时**不覆盖**（服务端更权威：可能是另一个 Agent 后来改的）。
     */
    async migrate(taskDir) {
      if (storage === undefined) return 0;
      const local = draftsOfTask(storage, taskDir).filter((draft) => draft.note.trim() !== "" || (draft.marks ?? []).length > 0);
      if (local.length === 0) return 0;
      let existing: ReviewComment[] = [];
      try {
        const response = await doFetch(urlOf(taskDir));
        if (response.ok) existing = ((await response.json()) as { items?: ReviewComment[] }).items ?? [];
      } catch { /* 读不到就当服务端为空，逐条上送（服务端 upsert 是幂等覆盖同键） */ }
      const keyOf = (c: { author: { kind: string; id: string }; anchor: { source: string; path: string; side: string; start: number; end: number } }): string =>
        `${c.author.kind}:${c.author.id}|${c.anchor.source}|${c.anchor.path}|${c.anchor.side}|${Math.min(c.anchor.start, c.anchor.end)}-${Math.max(c.anchor.start, c.anchor.end)}`;
      const existingKeys = new Set(existing.map(keyOf));
      let sent = 0;
      for (const draft of local) {
        const asComment = {
          taskId: taskIdOf(taskDir),
          author: draft.author ?? { kind: "user" as const, id: "user" },
          anchor: {
            source: draft.source, path: draft.filePath, side: draft.side,
            start: draft.start, end: draft.end,
            ...(draft.snapshot !== undefined ? { snapshot: draft.snapshot } : {}),
          },
          body: draft.note,
          marks: draft.marks ?? [],
          state: "draft" as const,
        };
        if (existingKeys.has(keyOf(asComment))) {
          // 服务端已有同键 → 只清理本地（不覆盖服务端的更新版本）
          removeLocalDraft(storage, draft.id);
          continue;
        }
        try {
          const response = await doFetch(endpoint, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ taskDir, op: "add", comment: asComment }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          removeLocalDraft(storage, draft.id);
          sent += 1;
        } catch (error) {
          log("warn", "迁移单条失败（保留在本地，下次再试）", { taskDir, id: draft.id, error: String(error) });
        }
      }
      log("info", "迁移完成", { taskDir, candidates: local.length, sent });
      return sent;
    },
  };
}

/** 纯本地实现（无服务端时的兜底 / 测试用；行为与 HttpStore 的失败分支一致）。 */
export function createLocalStore(storage: Storage): CommentStore {
  return {
    durable: false,
    async list(taskDir) { return localAsComments(storage, taskDir); },
    async save(taskDir, comment) {
      const saved = upsertDraft(storage, {
        taskDir,
        source: comment.anchor.source,
        filePath: comment.anchor.path,
        side: comment.anchor.side,
        start: comment.anchor.start,
        end: comment.anchor.end,
        ...(comment.anchor.snapshot !== undefined ? { snapshot: comment.anchor.snapshot } : {}),
        note: comment.body,
        marks: comment.marks,
        author: comment.author,
      });
      return draftAsComment(saved, taskDir);
    },
    async remove(taskDir, id) {
      // 与 HttpStore 语义一致：**只在真的删掉时返回 true**（幂等，但结果要如实）。
      const existed = localCommentsOf(storage, taskDir).some((c) => c.id === id);
      removeLocalDraft(storage, id);
      return existed;
    },
    async setCommentState(taskDir, id, state) {
      // 离线兜底：本地草稿没有 state 字段（它就是 draft），改状态只对"已在服务端的"有意义。
      // 这里如实返回 undefined，让 UI 提示"离线时不能关"（而不是假装成功）。
      void taskDir; void id; void state;
      return undefined;
    },
    // 回复 / 删回复 / 改等待方同理：都是服务端语义（线程与交棒）。离线时如实返回 undefined，
    // 由 UI 提示“离线不能回复”，而不是本地假装成功（下次刷新就消失的假象比禁用更糟）。
    async reply() { return undefined; },
    async editReply() { return undefined; },
    async removeReply() { return undefined; },
    async setAwaiting() { return undefined; },
    async migrate() { return 0; },
  };
}

// ── localStorage ↔ ReviewComment 的桥（迁移与降级双向都要）────────────────────

function taskIdOf(taskDir: string): string {
  const base = taskDir.replace(/\/+$/, "").split("/").pop() ?? "";
  return /^(\d{4})/.exec(base)?.[1] ?? base;
}

function localAsComments(storage: Storage, taskDir: string): ReviewComment[] {
  return draftsOfTask(storage, taskDir).map((draft) => draftAsComment(draft, taskDir));
}

function draftAsComment(draft: ReviewDraft, taskDir: string): ReviewComment {
  return {
    id: draft.id,
    taskId: taskIdOf(taskDir),
    author: draft.author ?? { kind: "user", id: "user" },
    anchor: {
      source: draft.source, path: draft.filePath, side: draft.side, start: draft.start, end: draft.end,
      ...(draft.snapshot !== undefined ? { snapshot: draft.snapshot } : {}),
    },
    body: draft.note,
    marks: draft.marks ?? [],
    state: draft.state ?? "draft",
    awaiting: draft.awaiting ?? null,
    canClose: draft.canClose ?? "author-or-user",
    // 本地草稿没有线程语义（回复只存在于服务端）：空数组是正确的事实
    replies: [],
    createdAt: draft.createdAt,
    updatedAt: draft.createdAt,
  };
}

function keepLocal(storage: Storage, taskDir: string, comment: { author: ReviewComment["author"]; anchor: ReviewComment["anchor"]; body: string; marks: string[] }): void {
  upsertDraft(storage, {
    taskDir,
    source: comment.anchor.source,
    filePath: comment.anchor.path,
    side: comment.anchor.side,
    start: comment.anchor.start,
    end: comment.anchor.end,
    ...(comment.anchor.snapshot !== undefined ? { snapshot: comment.anchor.snapshot } : {}),
    note: comment.body,
    marks: comment.marks,
    author: comment.author,
  });
}

function dropLocal(storage: Storage, taskDir: string, saved: ReviewComment): void {
  // 服务端已存 → 本地同键的草稿不再需要（避免下次迁移重复）
  for (const draft of draftsOfTask(storage, taskDir)) {
    const same = draft.source === saved.anchor.source
      && draft.filePath === saved.anchor.path
      && draft.side === saved.anchor.side
      && Math.min(draft.start, draft.end) === Math.min(saved.anchor.start, saved.anchor.end)
      && Math.max(draft.start, draft.end) === Math.max(saved.anchor.start, saved.anchor.end)
      && (draft.author?.id ?? "user") === saved.author.id;
    if (same) removeLocalDraft(storage, draft.id);
  }
}

/** 读全部（诊断用；测试断言"localStorage 与后端不再重复"）。 */
export function localCommentsOf(storage: Storage, taskDir: string): ReviewComment[] {
  return localAsComments(storage, taskDir);
}

/**
 * 本地还有**未上送的内容草稿**吗（决定 UI 是否显示"离线数据"提示）。
 *
 * 只算"有内容"的（body 或 marks 非空）：空草稿是"点了＋还没写"，它本来就该留在本地，
 * 不该触发"还有东西没上送"的提示（否则用户会看到一个永远消不掉的提示）。
 */
export function hasLocalOnlyComments(storage: Storage, taskDir: string): boolean {
  return readDrafts(storage).some((draft) =>
    taskDirOf(draft.taskDir) === taskDirOf(taskDir)
    && (draft.note.trim() !== "" || (draft.marks ?? []).length > 0));
}

function taskDirOf(dir: string): string { return dir.replace(/\/+$/, ""); }


// ── 「已看」进度的数据源（G10）─────────────────────────────────────────────
//
// 与评论同一个取舍：**服务端是事实源**（换设备仍保留、Agent 可读）。
// 与 difit 的差异：difit 只存 localStorage（`StorageService`），我们走接口 + 服务端落盘。

export type ViewedRecordWire = { path: string; viewedAt: string; hash: string };

export type ViewedStore = {
  list(taskDir: string): Promise<ViewedRecordWire[]>;
  /**
   * 标记/取消（可批量）。失败**抛错**（调用方要能提示"没存上"，不能假装成功）。
   * @returns 更新后的全部记录
   */
  set(taskDir: string, entries: readonly { path: string; hash: string }[], viewed: boolean): Promise<ViewedRecordWire[]>;
};

export function createHttpViewedStore(options: HttpStoreOptions = {}): ViewedStore {
  const endpoint = options.endpoint ?? "/api/review/viewed";
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init) as never);
  const log = options.log ?? (() => undefined);
  const urlOf = (taskDir: string): string => `${endpoint}?taskDir=${encodeURIComponent(taskDir)}`;

  return {
    async list(taskDir) {
      try {
        const response = await doFetch(urlOf(taskDir));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as { items?: ViewedRecordWire[] };
        return body.items ?? [];
      } catch (error) {
        // 已看进度丢了可以重建（用户再点一次），不像评论那样不可恢复 —— 降级成空数组并记日志
        log("warn", "已看进度读取失败，按空处理", { taskDir, error: String(error) });
        return [];
      }
    },

    async set(taskDir, entries, viewed) {
      const response = await doFetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskDir, op: "set", paths: entries, viewed }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return ((await response.json()) as { items?: ViewedRecordWire[] }).items ?? [];
    },
  };
}
