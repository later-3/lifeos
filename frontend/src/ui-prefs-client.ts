/**
 * UI 偏好的**客户端**（浏览器侧唯一入口）。
 *
 * 分工（2026-11-09 定，用户问「重启会不会丢配置」之后）：
 * - **事实源**：后端 `~/.lifeos/config/ui.json`（`GET/PUT /api/ui-prefs`）——
 *   跨设备、跨 origin（本机 5173 / 43120 / 手机域名）都一致；
 * - **首屏缓存**：localStorage。`index.html` 的防闪脚本在 React 起来之前读它上色，
 *   避免"等一个网络往返才变成深色"。缓存**永远服从服务端**：启动拉到真值就覆盖缓存。
 *
 * 为什么不干脆只用 localStorage：换浏览器 / 换设备 / 清缓存就全丢（实测），
 * 而手机访问的是另一个 origin，桌面上调的字号在手机上完全不生效。
 * 为什么不干脆只用服务端：首屏要等网络，深色用户每次刷新都会白闪一次（实测 44–99ms）。
 *
 * 写入用**防抖 + 合并**（300ms）：拖滑块会连续触发几十次 onChange，
 * 每次都 PUT 会把文件写入放大成每秒几十次（后端是原子写，代价不低）。
 */
import { DEFAULT_PREFS, parsePrefs, type DisplayPrefs } from "./display-prefs";
import { clampState, loadTheme, saveTheme, type ThemeState } from "./design/theme";

const DISPLAY_CACHE_KEY = "lifeos.displayPrefs";
const DEBOUNCE_MS = 300;

type UiPrefsBody = { theme?: unknown; display?: unknown };

/** 读缓存（首屏用；React 起来之前 index.html 也读同一份键）。 */
export function cachedDisplayPrefs(): DisplayPrefs {
  try {
    const raw = localStorage.getItem(DISPLAY_CACHE_KEY);
    return raw === null ? DEFAULT_PREFS : parsePrefs(JSON.parse(raw));
  } catch { return DEFAULT_PREFS; }
}

export function cachedTheme(): ThemeState {
  return loadTheme();
}

/**
 * 启动时拉一次真值。
 *
 * 返回值是"服务端有的那一半"：服务端没存过（首次使用）时返回 undefined，
 * 调用方保持本地默认值 —— **不拿默认值去覆盖用户本地已经调过的偏好**。
 */
export async function fetchUiPrefs(): Promise<{ theme?: ThemeState; display?: DisplayPrefs } | undefined> {
  try {
    const response = await fetch("/api/ui-prefs");
    if (!response.ok) return undefined;
    const body = await response.json() as UiPrefsBody;
    const out: { theme?: ThemeState; display?: DisplayPrefs } = {};
    if (body.theme !== undefined) out.theme = clampState(body.theme as Partial<ThemeState>);
    if (body.display !== undefined) out.display = parsePrefs(body.display);
    // 缓存同步（下次首屏就是最新值）
    if (out.display !== undefined) writeDisplayCache(out.display);
    if (out.theme !== undefined) saveTheme(out.theme);
    return out;
  } catch { return undefined; }
}

function writeDisplayCache(display: DisplayPrefs): void {
  try { localStorage.setItem(DISPLAY_CACHE_KEY, JSON.stringify(display)); } catch { /* 隐私模式忽略 */ }
}

/** 待发送的补丁（合并同一窗口内的多次改动）。 */
let pending: UiPrefsBody = {};
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  timer = undefined;
  const body = pending;
  pending = {};
  if (body.theme === undefined && body.display === undefined) return;
  // 失败不重试、不提示：偏好不是关键数据，下一次改动会带上最新值；
  // 而且 localStorage 缓存已经写过，用户当前这一屏不会丢。
  void fetch("/api/ui-prefs", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

function schedule(patch: UiPrefsBody): void {
  pending = { ...pending, ...patch };
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
}

/** 显示偏好改了：先写缓存（立刻生效且刷新不丢），再排队同步到服务端。 */
export function persistDisplayPrefs(display: DisplayPrefs): void {
  writeDisplayCache(display);
  schedule({ display });
}

/** 主题改了：theme.ts 自己会写缓存，这里只排队同步。 */
export function persistTheme(theme: ThemeState): void {
  schedule({ theme });
}
