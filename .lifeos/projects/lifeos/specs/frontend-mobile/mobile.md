# 手机适配规范（手机 <640px）

> 角色：设计规范　类型：跨页面主题　状态：实施中（2026-10-22）
>
> 本文是手机端的**布局与交互规范**；页面专属的数据/状态写在页面文档，统一视觉规则仍以
> [`frontend-spec.md`](../frontend-development/frontend-spec.md) 为准。开发流程见
> [`standards/frontend-development.md`](../frontend-development/process.md)。

## 1. 范围与断点

- 手机 = `max-width: 639px`；640px 以上仍走桌面/平板布局，不把手机规范套到窄桌面。
- **手机横屏（宽度 ≥640）当前仍走桌面/平板布局**，不在本轮竖屏手机适配范围；需要单独立项，不能假装已支持。
- 手机是独立布局模式，不是桌面三列压窄。
- 横屏与竖屏都按同一套表面模型；键盘弹起时以 `visualViewport` 高度为准。

## 2. 表面模型

| 表面 | 例子 | 退出 | 说明 |
|---|---|---|---|
| 根视图 | 消息流（首页）/聊天 | — | 唯一主列；聊天是根级 |
| 导航层 | 项目 Tab、项目详情、同事详情 | 返回上一层；根级关闭 | 全屏/Tab 切换；头 header 返回，不重复教育 |
| Sheet | 话题选择、配置、目录选择 | 取消/关闭 | `role=dialog`、焦点陷阱、Esc、滚动锁；话题选择默认当前项目 |
| 检查页 | 完整历史 | 返回聊天 | 页面型，不重复放 X |
| 工具浮层 | 文件树/文件查看器 | 返回树 / 关闭面板 | 查看器可返回树；面板级关闭在视口内 |
| Sheet | 配置、目录选择 | 取消/关闭 | `role=dialog`、焦点陷阱、Esc、滚动锁 |

### 导航与返回（模型 B：IM 模式，2026-10-27 拍板）

> 任务 0003 取代模型 A（用户反馈：drill-down 像设置页；风格以 IM 为准）。参考：Zulip 单层 overlay（`overlays.ts`/`overlay_util.ts`，本机检出 3e9bc1e）、飞书/Telegram 的“列表→对话→详情”心智（C 级观察，视觉同理）；完整映射见任务 0003 `02-design.md`。

**产品心智：Agent = 同事；对话页 = 根级；导航 = IM 三屏 + 项目工作台。**

- **手机四屏**：①消息流（同事行：头像+角色徽标+最新一句/生成中+未读徽标）→ ②聊天（默认上次会话，即“接着聊”）→ 右上“…”→ ③同事详情（切对话/切项目/开新对话）；④项目 Tab（项目卡工作台：进行中任务卡+近期对话+参与同事）。
- **开新对话 = 话题选择**：session∈Agent×Project（后端事实不变）；弹窗默认勾选当前项目，同项目连续办事零选择；跨项目才一次点选（参考 Zulip stream+topic 容器模型）。
- **聊天页 header**：左上头像+会话名（点击进详情）；header 下任务条（当前任务名+类型徽标+进度）常显。
- **工具调用/系统事件自成一类**：以 IM 卡片呈现（步骤卡/文件卡），不混入用户消息流，不用终端样式。
- **系统返回/浏览器返回**：一次退一层（详情页→聊天→首页流）；根级（首页流）再返回不退出应用。所有表面共用单层 overlay 语义（保留同一 sentinel，不叠加栈）。
- **右边缘向左滑**同系统返回；输入框/横向滚动区不抢手势。
- URL 仍是导航协议：`?agent&project&session`（Zulip narrow/browser_history 同构）。
- **不做已读回执**（三家开源均仅用未读徽标）；未读徽标语义不变（`status-map.ts` 派生），只随新界面换呈现位置：同事行、项目卡、项目详情对话行；项目内未看较多时用折叠气泡（参考 RC `MoreUnreadsBubble`）。
- **视觉**：结构与机制取参考源码，视觉不取——以 Telegram/飞书/钉钉风格为准（demo 已用户拍板）：气泡式对话（用户右侧、同事左侧）、底部 Tab、圆角卡片；落码仍走 design/tokens.css。

### 全屏表面

- 容器：`position: fixed; inset: 0`；高度用 `var(--app-height, 100dvh)`；不横向溢出。
- header 左侧返回/右侧关闭，至少一个在视口内；不能因为内容 `min-width` 把按钮挤出屏幕。
- 顶部 `pt-safe`、底部 `pb-safe`；`viewport-fit=cover` 时不能压到刘海/home indicator。
- 只有内容区滚动；`overscroll-behavior: contain`；打开时锁背景滚动。
- 打开时焦点进入表面，Tab 在表面内循环；关闭后焦点回到触发按钮；Esc 关闭。
- 内容 `min-width: 0`、长文本 `truncate`/换行；不出现横向滚动条。

## 3. 布局与触控

- 单主列：消息区 + 固定状态条 + composer；不并排三列。
- 所有可点元素 ≥44×44（移动端主操作/行/工具）；桌面密集尺寸不带到手机。
- 触屏上关键动作**常显**，不允许 `opacity-0` + `group-hover` 才能出现；页签关闭、文件/历史关闭都属于关键动作。
- 文件树、文件页签、历史回合行在手机上都要有 44 的命中区，视觉密度可以低，命中区不能低。
- composer 是一个对象：`/` 调色板和未来排队/通知横幅在输入容器内；手机 placeholder 只写“输入消息”；调色板行、发送/停止 ≥44 且不 hover-only。
- 状态条保留步骤/阶段/耗时；tokens/context 以紧凑指标呈现，空间不足时收起次要项；每个符号必须有 tooltip，并提供可点击的 `?` 图例。

## 4. 滚动与回到底部

- 只有消息区滚动；header/status/composer 固定。
- 默认只有“贴底”时才跟随新消息；上滑离开底部后停止自动跟随。
- 离开底部时显示**向下箭头 / “回到底部”**；点击滚到最新并恢复跟随。
- 这是 Pi TUI 的基线（`↓ Jump to latest message`），不能低于它；按钮桌面/手机都要有。
- 键盘弹起时 composer 在 `visualViewport` 上方；状态条在 composer 上方，不被遮。

## 5. 安装与访问（PWA）

- 远程访问走 Cloudflare Tunnel + Access；手机打开 `https://lifeos.ai4child.asia` 完成 One-time PIN。
- 安装条件：manifest（name/short_name/start_url/scope/display + 192/512 图标 + maskable）、service worker、HTTPS。
- 在 Cloudflare Access 后面，manifest 链接必须带 `crossorigin="use-credentials"`；否则浏览器不带 Access cookie 抓 manifest，被 302 到登录页，CORS 失败，只能“创建快捷方式”。
- iOS 用 `apple-touch-icon` + `apple-mobile-web-app-capable`；Android Chrome 用 manifest + SW，满足后应出现“安装应用”，而不是只“创建快捷方式”。
- 浏览器发出 `beforeinstallprompt` 时，手机导航页footer显示“安装 Life OS”；iOS 没有该事件，走 Safari 分享菜单。
- service worker 只缓存同源 GET 壳；`/api/*` 与 SSE 永远走网络；更新时清旧 cache。
- 失败时先查：manifest `content-type`、图标尺寸、SW scope、HTTPS/Access 是否拦截。

## 6. 验收

- 360 / 390 / 430 竖屏；横屏 ≥640 当前走桌面/平板，单独立项。
- 每个表面：进入、可见返回/关闭、点击返回、系统返回、Esc、焦点循环、背景不可达、滚动锁。
- 导航（模型 B）：首页流 → 同事行即入聊天；详情页切对话/项目/开新对话（话题选择默认当前项目）；系统返回逐层退；右缘滑一层。
- 历史/文件：按钮在视口内、可关闭；文件树/查看器可返回；无横向溢出。
- 所有可见 button/link 在手机宽度 ≥44；没有 hover-only 关键动作。
- 真机 iOS Safari/Android Chrome：键盘、刘海、home indicator、安装入口。

## 7. 参考

参考行以 [`reference-baseline.md`](../../knowledge/reference-baseline.md) 为准；本规范采用：

- **LobeHub**：移动设置/详情页的 back 语义、直接进入回根；
- **LibreChat**：scrim、焦点交还、底部安全区、手势阈值；
- **Open WebUI**：抽屉关闭即选择、`inert`、`100dvh`；
- **Pi TUI**：回到底部的交互基线。

闭源产品只做视觉/交互补充（截图/录屏/官方文档），不冒充源码；参考产品会变，使用前重新核对版本。
