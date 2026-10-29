# 图片输入

**角色**：设计与现状说明 · **类型**：功能 · **状态**：已实现（Task 0010 首版，2026-10-25；**存储按 Task 0012 的 D7 改为附件外置，2026-10-29**）

目标：用户能在对话框粘贴、拖放或选择图片发送给 Agent；模型看得见；历史里看得见自己发过的图。

## 支持情况一览（问"图片支持到什么程度"看这里）

| 能力 | 现在 | 说明 |
|---|---|---|
| 发送图片 | 支持 | 粘贴 / 拖入 composer / 点图片按钮选择 |
| 图片进入模型 | 支持 | 走 Pi 原生 `prompt(text, { images })` 通道 |
| 历史里看到自己发的图 | 支持 | `messagesOf` **按引用回填**（`imageBlocksOfRefs`）：JSONL 里只有引用行，服务端从附件目录取回字节，前端零改动；刷新/换浏览器都还在 |
| 模型不支持看图时 | 拒绝并说明 | 按 `models.json` 的 `input` 声明判断；未声明视为无法判断，不拦 |
| 非图片文件 | **不支持** | 单独一期（见 ``todo/todo.md``）；当前靠文字里写路径 + `read` 工具 |
| 图片转成文字描述 | 不支持 | 没有 OCR/描述层，直接把图给模型 |
| 图片压缩 | 客户端自动 | 超过 1MB 才压，最长边 1024，JPEG 0.85 |
| Agent 读到的图片（`read` 工具） | 支持 | `tool_result` 钩子把说明改成 `screenshot <路径> <宽x高> <大小>` 并**只存引用**；当轮由 `context` 钩子重注入（最近 3 张），界面同样靠回填显示 |
| 图片存哪里 | **附件目录**：`attachments/<hash 前 2 位>/<内容 hash>.<ext>`（0700/0600，写入幂等） | 会话 JSONL **只存引用行** `图片 <路径> <宽x高> <大小>`。**D7 覆盖了 0010「不另建附件目录」的拍板**；老会话的内联图不迁移（D8），读取时按 `imageBlocksOfRefs` 兼容 |

## 约束表（唯一事实源）

改任何一个数字，**必须**同时改 `src/image-input.ts`（后端）或 `frontend/src/attachments.ts`（前端）里的常量。`test/image-input-doc.test.mjs` 会逐项比对本表与代码常量，不一致就测试失败。

| 约束 | 值 | 依据 | 强制执行位置 |
|---|---|---|---|
| 单张原图上限 | 10MB | A：pi-web `upstream/main e533d9b` `lib/image-attachments.ts:1`；用户 2026-10-25 拍板 | `src/image-input.ts` `MAX_IMAGE_BYTES`；`frontend/src/attachments.ts` `MAX_IMAGE_BYTES` |
| 单条消息张数 | 10 张 | A：pi-web `lib/image-attachments.ts:2`（错误文案 `:45`）；LibreChat `librechat.example.yaml:1495` `fileLimit: 10` | `src/image-input.ts` `MAX_IMAGES_PER_MESSAGE`；前端同值 |
| 会话图片总字节预算 | 16MB | C：Task 0012 实测（现场会话 3.25MB 图片即逼近 3.5MB 网关上限）。**本行数值是 0010 的策略拍板**，其旧依据「网关 32MB÷2」已作废（见 Task 0012/evidence 02），只管「不让单会话无限囤图」，与网关无关 | `src/image-input.ts` `MAX_SESSION_IMAGE_BYTES`；计量在 `sessionImageBytesOf`：**inline 图按 base64→字节 + 引用图按附件文件字节**（同口径，引用化后预算不被废掉） |
| 请求体上限（**入站**：浏览器 → Life OS） | 32MB（= 预算 × 2） | C：本机实测（Task 0010 A.3） | `src/server.ts` `messagesBodyLimit` |
| 请求体上限（**出站**：Life OS → 网关） | **3.5MB** | C：2026-10-28 真实 413 原文 + 复测表（Task 0012 `evidence/2026-10-28-02`） | **数据**，不进代码：`config/payload-limits.json` 的 provider 默认 → 解析见 `src/payload-limit.ts` |
| 允许的图片类型 | png/jpeg/webp/gif/bmp/avif | A：pi-web `lib/tool-result-images.ts:3-9` | `src/image-input.ts` `IMAGE_MIME_TYPES`；前端同值 |
| 真实类型校验 | 按文件头（魔数）比对声明 | A：pi-web `lib/session-reader.ts` 与 `tool-result-images` 都按块读取真实 mime；B：不可只信客户端声明 | `src/image-input.ts` `sniffImageMime`、`validateImages` |
| 客户端压缩阈值 | 超过 1MB | A：pi-web `components/ChatInput.tsx:427` | `frontend/src/attachments.ts` `CLIENT_COMPRESS_THRESHOLD_BYTES` |
| 客户端压缩长边 | 1024px | A：pi-web `components/ChatInput.tsx:428` | `frontend/src/attachments.ts` `CLIENT_MAX_IMAGE_SIDE` |
| 客户端 JPEG 质量 | 0.85 | A：pi-web `components/ChatInput.tsx:429` | `frontend/src/attachments.ts` `CLIENT_JPEG_QUALITY` |
| GIF 是否压缩 | 不压缩 | A：pi-web `components/ChatInput.tsx:433` | `frontend/src/attachments.ts` `shouldCompressImage` |
| Pi 图片缩放 | 用 Pi 默认（最长边 2000、4.5MB base64） | A：Pi `utils/image-resize-core.ts:32-37` | 不覆盖；`models.json` 可配 `inputLimits.images.resize` |

**说明：** 会话层限制用**字节**而不是张数：每回合重建上下文后**所有图都会被重新上传**，而单张图的字节与其 token 成本不成比例（一张截图约 50 字节/token，文本约 3–4 字节/token）。参考产品也都不按张数限制会话（详见 `0010/evidence` G 节）。

**依赖外部变化的数字：** 出站请求体上限来自**网关**（当前 command 网关 3.5MB，2026-10-28 用带鉴权的真实请求测得）。**体积校验发生在鉴权与模型校验之后**——所以用"不存在的模型名"去撑 body 的探针测不到它（会先拿到 400），0010 的 32MB 结论即因此失效。

换 provider / 换套餐必须重测：出站上限按 provider 写进 `config/payload-limits.json`（一处生效，不写进代码），未声明时回落到观测值；策略类数字（10MB、10 张、16MB、2.5/1.2MB 迟滞带）不随网关变化。

## 数字例子（便于核对语义）

- 一条消息发 10 张、每张 200KB：允许（10 张 = 上限，1.9MB ≪ 16MB）。
- 一条消息发 11 张：拒绝，`too_many_images`，提示"一条消息最多 10 张图片"。
- 单张 11MB：拒绝，`image_too_large`。
- 会话里已有 15.9MB 图片，再发一张 0.2MB：拒绝，`session_image_budget_exceeded`，提示新建会话。
- 声明 `image/jpeg` 但文件头是 PNG：拒绝，`invalid_image`，提示实际格式。

## 接口

`POST /api/agents/:id/sessions/:sessionId/messages`

```jsonc
{
  "text": "这张图是什么颜色？",              // 必填、非空（只有图片也要给一句说明）
  "images": [                                // 可选；最多 10 项
    { "type": "image", "data": "<base64>", "mimeType": "image/png" }
  ]
}
```

- 成功：`202 { "accepted": true, "images": 1 }`
- 失败：`{ "error": { "code": "...", "message": "..." } }`，错误码见下表。
- 历史：`GET /api/agents/:id/sessions/:sessionId` 的 `messages[].blocks` 里，用户消息带 `{ "type": "image", "data": "<base64>", "mimeType": "image/png" }`。
- 前端把附件放在 `frontend/src/attachments.ts` 的 `PendingImage` 里，发送时用 `toRequestImages` 转成本形状（不传界面字段）。

## 错误码

| code | HTTP | 含义 |
|---|---|---|
| `invalid_request` | 400 | `images` 不是数组，或每项缺 `data`/`mimeType` |
| `too_many_images` | 422 | 单条消息超过 10 张 |
| `session_image_budget_exceeded` | 422 | 会话图片总字节超过 16MB |
| `image_too_large` | 400 | 单张超过 10MB |
| `unsupported_image_type` | 400 | 类型不在白名单 |
| `invalid_image` | 400 | 非 base64、空内容、或文件头与声明不一致 |
| `model_no_image_input` | 400 | 当前模型未声明图片输入能力 |
| `payload_too_large` | 413 | 请求体超过 32MB |

## 与 Pi 的关系

- 发送：`runTurn` → `session.prompt(text, { images })`；图片在进入历史前由 Pi 按 `inputLimits.images.resize` 规范化。
- 存储（**2026-10-29 按 D7 改**）：`runTurn` 不再把 images 交给 Pi——图片先落盘附件，**发出去的消息只带引用行**，Pi `appendMessage` 写进 JSONL 的就是纯文本；实测一次发图的会话文件 64KB（inline 时约 700KB）。老会话仍是内联（D8 不迁移）。
- 历史：`messagesOf` 从 Pi 的消息投影里取用户消息的 `image` 块。

## 实测记录（2026-10-25，真实链路，非模拟）

**链路验证（单次）**

| 步骤 | 结果 |
|---|---|
| 生成纯蓝 PNG（64×64，`#0000FF`） | 用 `image/png` 发给会话 |
| POST 带 images | 202 `{accepted:true, images:1}` |
| 会话文件落盘 | user 消息含 `image` 块（224 字节 base64），证明图片到达 Pi 并写进 JSONL |
| 历史接口 | 用户消息 blocks = `["text","image"]` |
| 界面 | 发送后立即显示缩略图；刷新后仍在 |
| **工具读图** | Agent 调 `read` 读纯绿 PNG：工具块带 1 张图片、模型回「绿色」；界面工具块里能看到该图（`data-testid=tool-image`） |

**模型是否真的看见（同一张纯色图，问"这张图是什么颜色？只回一个颜色词"）**

用默认模型 `command/z-ai/glm-5.3-flash`，每个颜色建新会话，跑完即删：

| 图 | 回答 | 判定 |
|---|---|---|
| 纯红 | 红色 | ✅ |
| 纯绿 | 绿色 | ✅ |
| 纯蓝 | 红色（"不确定性标注：紫色"） | ❌ |
| 纯白 | 白色 | ✅ |
| 纯黑 | 黑色 | ✅ |

**结论：图片确实进入了模型视野（5 次里 4 次正确），但同一模型对蓝色不稳定。** 同一张蓝图先后得到过"白色""蓝色""红色"三种回答——所以：

- 不能说这个模型"看不到图"（那是我用单次结果下的错误结论，已更正）。
- 也不能说"看图可靠"：单次测量不足以下判断，颜色类判断有明显抖动。
- 门控只能读 `models.json` 的声明，管不了"声明对但能力不稳"；这类差异要按模型实测记录（见 `todo/todo.md` #14）。

## 已知边界

- 历史接口返回的图片 base64 是**服务端按引用回填**的（JSONL 里没有）；模型侧则是 `context` 钩子在**请求时**按最近 3 张重注入——即 pi-web 上游"按需取图"的做法，我们对**所有**图（用户图 + 工具产图）都启用了。
- 重发（resend）只重发文字，不重发图片。
- 草稿不持久化：刷新页面会丢掉未发送的图片。
