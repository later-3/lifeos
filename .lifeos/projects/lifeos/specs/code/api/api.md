# 前后端交互规范

> 角色：架构 / 开发　类型：规范（接口）　状态：现行（2026-10-24）
>
> 场景与入口见仓库根 `AGENTS.md`；各接口与事件的**事实清单**见 `knowledge/architecture/agent.md`、`conversation.md`；本文只写设计约束。

## 怎么用

新增路由/事件时按 §2 逐条定位（包裹结构、错误族、命名）；违反 = 后端缺陷（前端要么拒绝、要么误显示，已发生过）。

## 2 条文

### 2.1 响应统一包裹：列表 `{items}`，错误 `{error:{code,message}}`

- 规则：一切列表接口返回 `{items:[…]}`；失败统一 `{error:{code, message}}`；前端对"包"只认一种。
- 依据：现行实现（`src/server.ts` 全部路由）；事实清单见 `knowledge/architecture/agent.md`。

### 2.2 SSE 事件名 = 事件类型；每条带 seq；可 since 续传；沿用 Pi 不发明新名

- 规则：事件名与 Pi 一致（`snapshot/thinking/…/done/error`），新事件先在映射层加类型与来源，再进入 UI；不把生命周期事件（compact/queue）泄漏成 UI 事件。
- 依据：`knowledge/architecture/conversation.md`（事件全集唯一事实源）+ `test/stream-events.test.mjs`。

### 2.3 状态码语义：409 打架 / 400 参数 / 404 不存在；"资源在、失败在别处"不重构成 404

- 规则：接口若因鉴权/配置/第三方原因失败，状态码与 code 需正确分类；`not_found` 只给了真不存在的资源。
- 依据：案例 C050（`No API key` 被报"找不到"）。

### 2.4 失败归因集中一份映射（`src/failure.ts`），后端种类与界面文案 1:1

- 规则：新增失败种类时同时增补映射与界面九类文案（`aborted/truncated/empty/timeout/network/auth/rate_limit/server/unknown`），两侧互为断言（不漏项）。
- 依据：案例 C064（一句"调用失败"等于没解释）。机器检查：`test/failure.test.mjs`。

### 2.5 任何响应不含 apiKey/凭据；会话数据只按目录归属返回

- 规则：模型解析接口返回 provider/清单但不含密钥；文件浏览按已注册根与目录边界过滤（越权 403）。
- 依据：`test/api.test.mjs`（响应绝不含 apiKey）+ `src/fs.ts`（安全边界 P1，事实见 `knowledge/design/file-browser.md`）。

### 2.6 写操作完成由共享写层广播 `agents_changed` 等事件流，不靠轮询

- 规则：跨 Agent 的变更（创建/归档/模型默认）发 `agents_changed`；会话事件只进当前 Agent 的流；前端订阅不轮询。
- 依据：案例 C070/C085。机器检查：`pnpm test`（广播用例）。
