// 图片引用的**取回路径**（Task 0016 · P3-S1）：把"内联 base64"换成"可按需取的 URL"。
//
// ## 为什么必须做（实测）
//
// 会话历史里图片本来就是**引用行**（`screenshot /abs/x.png` / `图片 /abs/x.png`，Task 0012 · D7
// 已经做到"存储不存 base64"）。但 `messagesOf()` 为了显示，用 `imageBlocksOfRefs()` 把文件
// **读回来转成 base64 塞进 HTTP 响应**——于是"不内联存"在接口边界上被撤销了：
//
//   最大会话：JSONL 3.23 MB → 接口响应 35.79 MB（其中工具图 33.58 MB）
//   全库 63 个会话：152.1 MB，图片占 100.1 MB（66%）
//   上行实测 5.26 MB/s → 22 MB（brotli 后）光上传就 4.1 s
//
// ## 做法
//
// 不再读盘。引用行里已经有**路径**，直接换成一个 URL：
//
//   `screenshot /abs/x.png`  →  `{ url: "/api/attachment?path=%2Fabs%2Fx.png", mimeType: "image/png" }`
//
// 前端 `<img src>` 按需取（浏览器原生懒加载），响应体里一个 base64 都没有。
//
// ## 边界（规范 api 2.5 / backend 2.5）
//
// 引用行里的路径来自**会话文件**（我们自己的数据），但会话文件可能包含任意绝对路径
// （例如 `read` 工具读的 `/tmp/map3d.png`）。所以服务端不能"按 URL 就去读任意文件"，
// 必须过三道闸（见 `src/attachment-serve.ts` 的 `resolveServeTarget`）：
//   1. 必须是图片扩展名；
//   2. resolve 之后必须落在**已注册的根**内（家目录 / 已绑定项目 / fs 已注册根）；
//   3. 必须是常规文件，且不超过上限。
//
// ## 与既有决策的关系
//
// 这是 Task 0012 · D7「存储不存 base64」推到**接口边界**的延续；不引入新策略，只是让
// 同一条原则在传输侧也成立（案例 C002）。
import { mimeTypeOfImagePath } from "./attachment-serve.ts";

/** 响应里的图片引用（前端两种形态都认：`url` 取回，`data` 是老会话的内联图）。 */
export type ImageRef = {
  /** 取回地址（绝对路径已编码）。 */
  url?: string;
  /** 老会话的内联图（D8 不迁移的历史数据）：仍然内联返回。 */
  data?: string;
  mimeType: string;
};

/**
 * 把一条图片引用行里的路径换成 URL。
 *
 * 为什么是纯函数：不读盘、不查文件系统 → 可以离线穷举（`test/attachment-serve.test.mjs`）。
 * 路径是否**允许**被取回，由服务端端点用 `resolveServeTarget` 判定（读取时才知道磁盘状态）。
 */
export function imageRefOfPath(absolutePath: string): ImageRef | undefined {
  const mimeType = mimeTypeOfImagePath(absolutePath);
  if (mimeType === undefined) return undefined;          // 不是图片扩展名 → 不当作图片引用
  return { url: `/api/attachment?path=${encodeURIComponent(absolutePath)}`, mimeType };
}

/** 取回地址（与 `imageRefOfPath` 同一处拼装，测试与前端各自不需要重复规则）。 */
export function attachmentUrlOf(absolutePath: string): string | undefined {
  return imageRefOfPath(absolutePath)?.url;
}
