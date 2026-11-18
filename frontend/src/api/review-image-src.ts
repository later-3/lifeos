/**
 * 检视面板：把 markdown 里的**相对图片地址**改写成可取的字节 URL。
 *
 * 为什么需要（2026-11-16 用户实测截图）：
 *   检视面板的 md 渲染档把 markdown 交给 `Markdown` 组件渲染，而 `<img src="docs/images/hero.gif">`
 *   是**相对路径** —— 浏览器按当前页面地址（`http://127.0.0.1:5181/`）解析，打到 Vite 上就是 404，
 *   于是一屏破图。文件本身是存在的（在 worktree 里），只是没有一条"从这里取这个文件"的通道。
 *
 * 做法：渲染前把 src 换成 `/api/review/raw?taskDir=…&source=…&path=…&side=new`，
 *   由后端从**已注册的检视源**里读字节（安全口径与 `/api/review/blob` 完全相同）。
 *
 * 两条纪律：
 * 1. **只改相对路径**：`http(s):` / `data:` / `blob:` / `#` / `/api/` 开头的原样保留（外链图仍走外链）。
 * 2. **不改写失败就原样保留**：解析不出相对路径（例如 `../` 逃出仓根）时不替换 —— 宁可破图，
 *    也不悄悄指向一个错的文件。
 */

/** 把「当前文件路径」与「相对 src」解析成仓内相对路径；解析不了（逃出仓根）返回 undefined。 */
export function resolveRelativePath(filePath: string, src: string): string | undefined {
  const clean = src.split("?")[0]?.split("#")[0] ?? "";
  if (clean === "") return undefined;

  const segments = filePath.split("/");
  segments.pop();                     // 去掉文件名，留下所在目录
  for (const piece of clean.split("/")) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") {
      // 已经在仓根还想往上 → 这条路径不在检视范围内，不替换
      if (segments.length === 0) return undefined;
      segments.pop();
      continue;
    }
    segments.push(piece);
  }
  const resolved = segments.join("/");
  return resolved === "" ? undefined : resolved;
}

/** 是否"看起来就是外部/特殊地址"，这类一律不改写。 */
export function isAbsoluteOrSpecial(src: string): boolean {
  return /^(https?:|data:|blob:|mailto:|#|\/api\/|\/\/)/i.test(src.trim()) || src.trim().startsWith("/");
}

export type RawUrlContext = {
  /** 检视 URL 的构造器：把仓内相对路径变成可取字节的地址。 */
  urlOf: (repoRelativePath: string) => string;
  /** 当前被检视文件自身的路径（仓内相对），相对 src 以它的目录为基准。 */
  filePath: string;
};

/**
 * 改写一段 markdown 里的图片源。
 *
 * 两种写法都要覆盖，且**两种写法在我们仓库里都真实存在**：
 *   - markdown：`![alt](docs/images/a.webp)`
 *   - HTML：`<img src="docs/images/hero.gif" width="100%">`（README 的 hero 就是这么写的）
 */
export function rewriteImageSrc(text: string, context: RawUrlContext): string {
  const rewrite = (src: string): string | undefined => {
    if (src.trim() === "" || isAbsoluteOrSpecial(src)) return undefined;
    const resolved = resolveRelativePath(context.filePath, src);
    if (resolved === undefined) return undefined;
    return context.urlOf(resolved);
  };

  // ① HTML <img src="…">（README 用的是这种）
  let out = text.replace(/<img\b([^>]*?)\bsrc=("|')([^"']*)\2/gi, (whole, before: string, quote: string, src: string) => {
    const next = rewrite(src);
    return next === undefined ? whole : `<img${before}src=${quote}${next}${quote}`;
  });

  // ② markdown ![alt](src)
  out = out.replace(/(!\[[^\]]*\]\()([^)\s]+)(\s+"[^"]*")?(\))/g, (whole, head: string, src: string, title: string | undefined, tail: string) => {
    const next = rewrite(src);
    return next === undefined ? whole : `${head}${next}${title ?? ""}${tail}`;
  });

  return out;
}
