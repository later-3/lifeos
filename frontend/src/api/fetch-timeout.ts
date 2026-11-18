/**
 * 加载闸（Task 0028 · P2 / 缺陷 D2）。
 *
 * ## 为什么存在
 *
 * 缺陷来源（Task 0027 · E6）：全 `frontend/src` 里 `AbortController|AbortSignal.timeout` **0 处** ——
 * 会话详情、会话列表、对账、思考正文四类请求都没有时限，也没有失败出口。
 * 实测（打桩 500 / 直接断网）：
 *  - 聊天区**一片空白**，没有原因、没有重试；
 *  - 控制台一条 `pageerror: TypeError: Failed to fetch`，前端日志**零记录**。
 *
 * 更糟的一种（R3-2③）：浏览器同源连接被占满时，请求**排不到**，`await` 永不返回 →
 * 界面永久骨架。这不是后端慢（后端 p99 = 206ms），而是"没人给它一个期限"。
 *
 * ## 设计取舍
 *
 * - **只包一层**，不重写 `fetch`：调用点仍然拿到真实的 `Response`，用什么 body 由它决定；
 * - **四种结局穷举**：成功 / 超时 / 网络错 / http 错 —— 没有"其它"这种模糊档
 *   （`specs/code/backend/code.md` 2.9：错误必须可见）。
 * - **超时必须 abort 底层请求**：否则连接一直占着，池子永远不释放（这正是缺陷 D1 的加剧因素）。
 * - **文案不跨语义**：HTTP 5xx 不能说成"找不到"（`specs/code/api/api.md` 2.3）。
 */

/** 一次加载失败的三种形态（成功不算 failure）。 */
export type LoadFailureKind = "timeout" | "network" | "http";

export type LoadFailure = {
  kind: LoadFailureKind;
  /** `kind === "http"` 时的状态码。 */
  status?: number;
  /** 技术细节（进日志，不上界面当主文案）。 */
  detail?: string;
  /** 这个请求在业务上叫什么（用于日志定位："session" / "groups" / "turns-last" / "thinking"）。 */
  label: string;
  /** 实际耗时（ms）：排障时区分"秒回 500"与"挂满 15 秒"。 */
  ms: number;
};

export type LoadResult<T> = { ok: true; value: T } | { ok: false; failure: LoadFailure };

/**
 * 给一次请求加时限，并把"失败了"变成**可判定的返回值**而不是异常。
 *
 * `run` 会收到一个 `AbortSignal`：**必须**把它传给 `fetch`，否则到点只是我们不等了，
 * 底层连接还挂着（连接池不释放，缺陷 D1 会更容易发生）。
 */
export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<LoadResult<T>> {
  const controller = new AbortController();
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error("timeout") as Error & { __timeout?: true };
      error.__timeout = true;
      reject(error);
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([run(controller.signal), timeout]);
    return { ok: true, value };
  } catch (cause) {
    const elapsed = Date.now() - started;
    /*
     * 判"超时"看的是**我们自己发的 abort**，不是异常长什么样：
     * `fetch` 被 abort 时抛的是 `AbortError`/`TypeError: Failed to fetch`，
     * 与真正的网络中断在异常层几乎无法区分；而 `controller.signal.aborted` 是可靠事实。
     */
    if (controller.signal.aborted || (cause instanceof Error && (cause as { __timeout?: true }).__timeout === true)) {
      return { ok: false, failure: { kind: "timeout", label, ms: elapsed } };
    }
    return { ok: false, failure: { kind: "network", label, ms: elapsed, detail: messageOf(cause) } };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 把一次 HTTP 响应当作"需要 2xx"的结果来判定。
 *
 * 单独一个函数的原因：`fetch` 对 4xx/5xx **不抛错**，直接 `await response.json()`
 * 会得到 `{error:{...}}` 然后被当成正常数据用 —— 那正是"失败被静默吞掉"的常见写法。
 */
export function okOrFailure<T>(response: Response, label: string, ms: number): LoadResult<T> {
  if (response.ok) return { ok: true, value: response as unknown as T };
  return { ok: false, failure: { kind: "http", status: response.status, label, ms } };
}

/**
 * 一次性完成"取 JSON"，四种结局都收敛到 `LoadResult`。
 *
 * `timeoutMs` 与 `LoadFailure.ms`（真实耗时）是两个不同的量 —— 曾经用同一个变量名，
 * 于是"500 立即返回"被记成 `ms: 15000`（看起来像超时）。分开命名 + 各自测量。
 */
export async function fetchJsonWithTimeout<T>(
  input: string,
  timeoutMs: number,
  label: string,
): Promise<LoadResult<T>> {
  const started = Date.now();
  const result = await withTimeout((signal) => fetch(input, { signal }), timeoutMs, label);
  if (!result.ok) return result;
  const response = result.value;
  const ms = Date.now() - started;
  if (!response.ok) {
    return { ok: false, failure: { kind: "http", status: response.status, label, ms } };
  }
  try {
    return { ok: true, value: (await response.json()) as T };
  } catch (cause) {
    // 200 但不是 JSON（例如被代理换成 HTML 登录页）：算 http 错，但要带上线索
    return { ok: false, failure: { kind: "http", status: response.status, label, ms, detail: `非 JSON 响应：${messageOf(cause)}` } };
  }
}

/**
 * 界面上的一句话（主文案）。**技术细节不在这里**（进日志）。
 *
 * 参照 `failure-text.ts` 的语气：说清"发生了什么 + 大概是谁的问题"，不假装知道原因。
 * `api.md` 2.3：404 才能说"找不到"，5xx 不许说成"不存在"。
 */
export function failureTextOf(failure: LoadFailure): string {
  if (failure.kind === "timeout") {
    const seconds = Math.round(failure.ms / 1000);
    return `加载超时（等了 ${seconds} 秒没有响应）`;
  }
  if (failure.kind === "network") return "加载失败：连不上后端（网络中断或服务未运行）";
  if (failure.status === 404) return "加载失败：这个会话或项目不存在（可能已被删除）";
  if (failure.status === 409) return "加载失败：数据正在变化（刚发生过压缩或分支切换），重试即可";
  if (failure.status !== undefined && failure.status >= 500) return `加载失败：后端报错（HTTP ${failure.status}）`;
  if (failure.status !== undefined && failure.status >= 400) return `加载失败：请求被拒绝（HTTP ${failure.status}）`;
  return "加载失败";
}

/** 日志用的明细（不含正文/凭据；`specs/code/backend/code.md` 2.10）。 */
export function failureLogOf(failure: LoadFailure): Record<string, unknown> {
  return {
    label: failure.label,
    kind: failure.kind,
    ...(failure.status !== undefined ? { status: failure.status } : {}),
    ms: failure.ms,
    ...(failure.detail !== undefined ? { detail: failure.detail } : {}),
  };
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return String(cause);
}
