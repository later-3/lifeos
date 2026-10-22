# 手机适配规范（手机 <640px）

> 角色：设计规范　类型：跨页面主题　状态：实施中（2026-10-22）
>
> 本文是手机端的**布局与交互规范**；页面专属的数据/状态写在页面文档，统一视觉规则仍以
> [`frontend-spec.md`](./frontend-spec.md) 为准。开发流程见
> [`standards/frontend-development.md`](../standards/frontend-development.md)。

## 1. 范围与断点

- 手机 = `max-width: 639px`；640px 以上仍走桌面/平板布局，不把手机规范套到窄桌面。
- **手机横屏（宽度 ≥640）当前仍走桌面/平板布局**，不在本轮竖屏手机适配范围；需要单独立项，不能假装已支持。
- 手机是独立布局模式，不是桌面三列压窄。
- 横屏与竖屏都按同一套表面模型；键盘弹起时以 `visualViewport` 高度为准。

## 2. 表面模型

| 表面 | 例子 | 退出 | 说明 |
|---|---|---|---|
| 根视图 | 聊天 | — | 唯一主列；header 无返回时显示导航入口 |
| 导航页 | 助手 → 项目 → 会话 | header 返回上一级；根级关闭 | 全屏，不是桌面抽屉 |
| 检查页 | 完整历史 | 返回聊天 | 页面型，不重复放 X |
| 工具浮层 | 文件树/文件查看器 | 返回树 / 关闭面板 | 查看器可返回树；面板级关闭在视口内 |
| Sheet | 配置、目录选择 | 取消/关闭 | `role=dialog`、焦点陷阱、Esc、滚动锁 |

### 导航与返回

采用 **模型 A：会话页返回项目 + 全屏 drill-down**；不采用面包屑 B / 底部 Tab。原因：根只有一个聊天，三级是同一任务下的层级；LobeHub/Telegram 的“列表 → 对话”与 Codex/Claude 的“导航 + 会话页”都支持这种父级返回；面包屑会把 header 变重，底部 Tab 会造出第二套信息架构。

- 会话页 header 左侧是**返回项目**（不是普通菜单）：打开导航并停在项目级；项目行高亮当前项目。
- 没有会话时 header 左侧才是**打开导航**，从助手级开始。
- 导航页内选助手进入项目级、选项目进入会话级；选会话才关闭导航。
- 返回目标 = 语义父级：会话 → 项目 → 助手 → 关闭。
- 系统返回/浏览器返回一次退一层；在根级再返回才关闭，不直接退出应用。
- 右边缘向左滑 = 返回上一级；只作为系统返回的补充，输入框/横向滚动区不抢手势；一次只退一层。
- 直接进入某个表面时，没有历史就回根，不把用户留在空栈。

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
- 导航：助手 → 项目 → 会话；系统返回逐级退；右边缘滑一次只退一层。
- 历史/文件：按钮在视口内、可关闭；文件树/查看器可返回；无横向溢出。
- 所有可见 button/link 在手机宽度 ≥44；没有 hover-only 关键动作。
- 真机 iOS Safari/Android Chrome：键盘、刘海、home indicator、安装入口。

## 7. 参考

参考行以 [`reference-baseline.md`](../standards/reference-baseline.md) 为准；本规范采用：

- **LobeHub**：移动设置/详情页的 back 语义、直接进入回根；
- **LibreChat**：scrim、焦点交还、底部安全区、手势阈值；
- **Open WebUI**：抽屉关闭即选择、`inert`、`100dvh`；
- **Pi TUI**：回到底部的交互基线。

闭源产品只做视觉/交互补充（截图/录屏/官方文档），不冒充源码；参考产品会变，使用前重新核对版本。
